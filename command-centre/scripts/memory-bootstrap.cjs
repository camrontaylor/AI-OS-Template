#!/usr/bin/env node
/**
 * memory-bootstrap — first-run auto-index of the LOCAL memory store.
 *
 * Closes the "first session" gap. A freshly cloned workspace has an empty local
 * PGLite store, so Tier 1 semantic recall returns nothing until the Stop-hook
 * capture or the nightly cron eventually indexes it. This runs at SessionStart
 * (spawned detached by .claude/hooks/memory-bootstrap-index.js) and, IF the local
 * store is empty, backfills it from the memory already on disk — once — so recall
 * works from within the first session instead of the second.
 *
 * It is safe to fire on every session start because it self-guards:
 *   - LOCAL ONLY. If the resolved backend is hosted Postgres, it does nothing.
 *     Hosted scopes are seeded deliberately via `memory:reindex`, never
 *     auto-pushed per user.
 *   - RUN ONCE. A sentinel (.bootstrap-done in the data dir) short-circuits later
 *     starts without even opening the store.
 *   - IF EMPTY. If the store already has chunks (capture or the cron got there
 *     first), it just records the sentinel and exits — it never re-indexes.
 *   - BEST EFFORT. Any error (e.g. the persisted store can't open) exits 0
 *     silently. This is a background nicety, never a session blocker.
 *
 * It reuses the SAME indexer as memory:index / memory:reindex, so chunking,
 * embedding, and idempotency are identical.
 *
 * Usage:
 *   node scripts/memory-bootstrap.cjs            # used by the SessionStart hook
 *   node scripts/memory-bootstrap.cjs --force    # ignore the sentinel and re-check
 *   node scripts/memory-bootstrap.cjs --verbose  # print what it did (hook runs silent)
 */

const fs = require("node:fs");
const path = require("node:path");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { ensureLocalUserId } = require("./local-memory-identity.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");

const { backend, scope, store, embedder, indexer } = loadMemoryModules({ withCapture: false });

const SENTINEL = ".bootstrap-done";

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === "--force") flags.force = true;
    else if (arg === "--verbose") flags.verbose = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

const USAGE = `memory-bootstrap — first-run auto-index of the LOCAL memory store

Indexes existing on-disk memory into the local PGLite store IF it is empty.
No-ops on hosted Postgres, when already populated, or once the sentinel exists.

Usage:
  node scripts/memory-bootstrap.cjs [--force] [--verbose]`;

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

  // LOCAL ONLY — never auto-seed the shared hosted corpus per user.
  const resolved = backend.resolveMemoryBackend({ dataDir }, process.env);
  if (resolved.kind !== "pglite") {
    say(`memory-bootstrap: backend is ${resolved.kind}; nothing to do (hosted is seeded via memory:reindex).`);
    return 0;
  }

  // RUN ONCE — cheap short-circuit, no store open.
  const sentinel = path.join(dataDir, SENTINEL);
  if (!flags.force && fs.existsSync(sentinel)) {
    say("memory-bootstrap: already bootstrapped (sentinel present).");
    return 0;
  }

  // On a fresh workspace the parent .command-centre/ may not exist yet; PGLite
  // mkdirs the data dir non-recursively, so ensure its parent is there first.
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const localUserId = ensureLocalUserId(rootDir);

  const emb = await embedder.createEmbedder({});
  const memStore = await store.openMemoryStore({ dataDir, embedDim: emb.dim });
  try {
    const { rows } = await memStore.client.query("SELECT count(*)::int AS n FROM memory_chunks");
    const existing = Number(rows[0].n);

    if (existing > 0) {
      // Capture or the cron already populated it — just mark done.
      writeSentinel(sentinel, `already populated (${existing} chunks)`);
      say(`memory-bootstrap: store already has ${existing} chunk(s); marked done.`);
      return 0;
    }

    // EMPTY → backfill under the same private identity automatic capture uses.
    const baseScope = scope.normalizeScope({
      teamId: null,
      clientId: null,
      userId: localUserId,
      visibility: "private",
    });
    scope.assertValidScope(baseScope);
    const summary = await indexer.indexSources({
      store: memStore,
      embedder: emb,
      scope: baseScope,
      rootDir,
      reason: "backfill",
      log: (msg) => say(msg),
    });

    writeSentinel(sentinel, `indexed ${summary.sourcesIndexed} source(s), ${summary.chunksInserted} chunk(s)`);
    say(
      `memory-bootstrap: indexed ${summary.sourcesIndexed} source(s), ` +
        `${summary.chunksInserted} chunk(s) into the local store.`,
    );
    return 0;
  } finally {
    await memStore.close();
  }
}

/** Record that bootstrap ran so later session starts skip it cheaply. */
function writeSentinel(file, note) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${new Date().toISOString()}  ${note}\n`);
  } catch {
    /* best effort */
  }
}

main()
  .then((code) => {
    // Drain the event loop instead of process.exit(): forcing exit aborts
    // onnxruntime-node's native teardown (mutex lock failed → SIGABRT / Abort trap 6).
    process.exitCode = code;
  })
  .catch((error) => {
    // Best effort: a background bootstrap must never break a session. Surface the
    // reason only in --verbose; otherwise exit 0 silently.
    if (process.argv.includes("--verbose")) {
      console.error(`memory-bootstrap (skipped): ${error instanceof Error ? error.message : error}`);
    }
    process.exitCode = 0;
  });
