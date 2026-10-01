#!/usr/bin/env node
/**
 * memory-watch — live sync for changed memory source files. Watches the memory
 * source roots (chokidar) and reindexes on add/change/delete/move, covering edits
 * made outside a Claude session. Long-running: spawned detached on SessionStart
 * and guarded by a PID-lock dir so repeated firings are a no-op. Keeps only the
 * embedder resident, not an open store connection.
 *
 * Usage:
 *   node scripts/memory-watch.cjs --visibility system
 *   node scripts/memory-watch.cjs --visibility client --client acme --verbose
 *
 * Flags:
 *   --auto-local     SessionStart mode: local private watcher; hosted no-op
 *   --visibility <system|team|client|private>   local default: private
 *   --team <id> / --client <slug> / --user <id>  scope ids (per visibility)
 *   --root <path>    override source root (repeatable)
 *   --debounce <ms>  debounce window for add/change events (default 2000)
 *   --embedder <bge-m3|hash>  default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
 *   --verbose        print what it does (default: silent, like memory-bootstrap)
 *   --help
 */

const fs = require("node:fs");
const path = require("node:path");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");
const { ensureLocalUserId } = require("./local-memory-identity.cjs");

const { backend, scope, embedder, watcher } = loadMemoryModules({ withWatcher: true });

const LOCK_DIR_NAME = ".watch.lock";
const LOCK_PID_FILE = "pid";
const STOP_SENTINEL_FILE = "stop-requested";
const STOP_POLL_MS = 1000;

/**
 * The lock dir lives as a SIBLING of dataDir, never inside it: PGLite's open
 * cycle sweeps unrecognized dot-entries inside the data dir, so a nested lock
 * would be deleted. Mirrors pglite-adapter.ts's ownerLockPath.
 */
function watchLockDirFor(dataDir) {
  return `${dataDir.replace(/[/\\]+$/, "")}${LOCK_DIR_NAME}`;
}

function parseArgs(argv) {
  const flags = { roots: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--visibility": flags.visibility = next(); break;
      case "--team": flags.team = next(); break;
      case "--client": flags.client = next(); break;
      case "--user": flags.user = next(); break;
      case "--root": flags.roots.push(next()); break;
      case "--debounce": flags.debounce = Number(next()); break;
      case "--embedder": flags.embedder = next(); break;
      case "--auto-local": flags.autoLocal = true; break;
      case "--verbose": flags.verbose = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

const USAGE = `memory-watch — live sync for changed memory source files

Options:
  --auto-local     SessionStart mode: watch local private memory; hosted no-op
  --visibility <system|team|client|private>   local default: private;
                                               required for hosted Postgres
  --team <id> / --client <slug> / --user <id>  scope ids (per visibility)
  --root <path>    override source root (repeatable)
  --debounce <ms>  debounce window for add/change events (default 2000)
  --embedder <bge-m3|hash>  default: bge-m3 (or $MEMORY_EMBEDDER); hash is explicit offline mode
  --verbose        print what it does
  --help`;

function buildScope(flags, { backendKind, rootDir }) {
  if (backendKind === "postgres" && !flags.visibility) {
    throw new Error(
      "Hosted Postgres requires an explicit --visibility. Refusing to guess a shared scope.",
    );
  }
  const visibility = flags.visibility ?? "private";
  const valid = ["system", "team", "client", "private"];
  if (!valid.includes(visibility)) {
    throw new Error(`--visibility must be one of: ${valid.join(", ")}`);
  }
  const userId =
    flags.user ??
    (backendKind === "pglite" && visibility === "private"
      ? ensureLocalUserId(rootDir)
      : null);
  const s = scope.normalizeScope({
    teamId: flags.team ?? null,
    clientId: flags.client ?? null,
    userId,
    visibility,
  });
  scope.assertValidScope(s); // throws if a required id is missing for the visibility
  return s;
}

/** Atomic PID-lock singleton: refuse to start a second watcher for this dataDir. */
function acquireWatchLock(lockDir) {
  const pidFile = path.join(lockDir, LOCK_PID_FILE);
  try {
    fs.mkdirSync(lockDir);
    fs.writeFileSync(pidFile, String(process.pid));
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  // Lock dir exists — is its owner still alive?
  let ownerPid = null;
  try {
    ownerPid = Number(fs.readFileSync(pidFile, "utf-8").trim());
  } catch {
    /* missing/corrupt pid file — treat as stale */
  }

  if (ownerPid && isProcessAlive(ownerPid)) {
    return false; // a live watcher already holds the lock
  }

  // Stale lock (owner gone, or unreadable) — reclaim it once.
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.mkdirSync(lockDir);
    fs.writeFileSync(pidFile, String(process.pid));
    return true;
  } catch {
    return false; // lost the race to another watcher reclaiming it
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0: liveness probe, no-op on success
    return true;
  } catch {
    return false;
  }
}

function releaseWatchLock(lockDir) {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  const say = (msg) => {
    if (flags.verbose) console.log(msg);
  };

  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  process.env.MEMORY_MODEL_CACHE_DIR =
    process.env.MEMORY_MODEL_CACHE_DIR || path.join(rootDir, ".command-centre", "models");
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const resolvedBackend = backend.resolveMemoryBackend({ dataDir }, process.env);

  // SessionStart must never guess ownership in a shared database. A hosted,
  // authenticated watcher through the Team OS API is tracked in AIOS-436.
  if (flags.autoLocal && resolvedBackend.kind === "postgres") {
    say("memory-watch: --auto-local is local-only; hosted watcher is tracked in AIOS-436.");
    return 0;
  }
  if (
    flags.autoLocal &&
    (flags.visibility != null ||
      flags.team != null ||
      flags.client != null ||
      flags.user != null)
  ) {
    throw new Error("--auto-local cannot be combined with explicit scope flags.");
  }

  const baseScope = buildScope(flags, {
    backendKind: resolvedBackend.kind,
    rootDir,
  });
  fs.mkdirSync(dataDir, { recursive: true });

  const lockDir = watchLockDirFor(dataDir);
  if (!acquireWatchLock(lockDir)) {
    say(`memory-watch: already watching (lock held at ${lockDir}); exiting.`);
    return 0;
  }

  let shuttingDown = false;
  const shutdown = async (memWatcher) => {
    if (shuttingDown) return;
    shuttingDown = true;
    say("memory-watch: stopping.");
    try {
      await memWatcher.close();
    } finally {
      releaseWatchLock(lockDir);
    }
    process.exitCode = 0;
  };

  try {
    const emb = await embedder.createEmbedder({ kind: flags.embedder });
    say(`memory-watch: embedder ${emb.model} (dim ${emb.dim})`);
    const roots = flags.roots.length > 0 ? flags.roots : undefined;

    const memWatcher = watcher.startMemoryWatcher({
      embedder: emb,
      scope: baseScope,
      rootDir,
      roots,
      dataDir,
      debounceMs: Number.isFinite(flags.debounce) ? flags.debounce : undefined,
      log: say,
    });

    say(`memory-watch: watching ${(roots ?? ["context/memory", "context/learnings.md"]).join(", ")} → ${rootDir}`);

    // SIGINT/SIGTERM work for an interactive foreground run (e.g. Ctrl+C), but
    // Windows has no real cross-process signal delivery — process.kill(pid,
    // "SIGTERM") from another process just hard-terminates us there without
    // ever invoking this handler. The stop-sentinel poll below is the one
    // mechanism memory-watch-stop.cjs can rely on across platforms.
    process.on("SIGINT", () => { shutdown(memWatcher).then(() => process.exit(0)); });
    process.on("SIGTERM", () => { shutdown(memWatcher).then(() => process.exit(0)); });

    const stopFile = path.join(lockDir, STOP_SENTINEL_FILE);
    const stopPoll = setInterval(() => {
      if (fs.existsSync(stopFile)) {
        clearInterval(stopPoll);
        shutdown(memWatcher).then(() => process.exit(0));
      }
    }, STOP_POLL_MS);
  } catch (error) {
    releaseWatchLock(lockDir);
    throw error;
  }

  return undefined; // stay alive — chokidar's handles keep the event loop open
}

module.exports = { buildScope, parseArgs };

if (require.main === module) {
  main()
    .then((code) => {
      if (code !== undefined) process.exitCode = code;
    })
    .catch((error) => {
      console.error(`\nmemory-watch failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      process.exitCode = 1;
    });
}
