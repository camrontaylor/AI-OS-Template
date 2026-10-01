#!/usr/bin/env node
/**
 * memory-consolidation-tick — local Team OS consolidation trigger.
 *
 * This runs on the user's machine. It never performs server-side LLM work: the
 * hosted API only claims staged captures and receives the final publish/review/
 * discard result from memory-consolidate.cjs.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { isExpired, readConfigOptional } = require("./lib/team-config.cjs");
const consolidate = require("./memory-consolidate.cjs");

const DEFAULT_LIMIT = 20;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 21 * 60 * 1000;
const RESCHEDULE_GRACE_MS = 5 * 60 * 1000;
const LOCK_STALE_MS = 35 * 60 * 1000;

const USAGE = `memory-consolidation-tick — local Team OS consolidation trigger

Usage:
  node scripts/memory-consolidation-tick.cjs [--client slug] [--after-capture]

Options:
  --client <slug>       consolidate client-scoped captures
  --limit <n>           max captures to claim (default ${DEFAULT_LIMIT})
  --model <name>        Claude model passed to memory-consolidate
  --timeout-ms <n>      Claude timeout passed to memory-consolidate
  --delay-ms <n>        wait before trying to consolidate
  --after-capture       also schedule a delayed retry after capture eligibility
  --force               ignore local cooldown
  --quiet               only print errors
  --reason <label>      diagnostic label for state/logs
  --help`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--client": flags.client = next(); break;
      case "--limit": flags.limit = Number(next()); break;
      case "--model": flags.model = next(); break;
      case "--timeout-ms": flags.timeoutMs = Number(next()); break;
      case "--delay-ms": flags.delayMs = Number(next()); break;
      case "--after-capture": flags.afterCapture = true; break;
      case "--force": flags.force = true; break;
      case "--quiet": flags.quiet = true; break;
      case "--reason": flags.reason = next(); break;
      case "--help": case "-h": flags.help = true; break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

function normalizeLimit(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : DEFAULT_LIMIT;
}

function normalizeDelayMs(value) {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 24 * 60 * 60 * 1000) : 0;
}

function retryDelayMs(env = process.env) {
  const value = Number(env.MEMORY_CONSOLIDATE_RETRY_DELAY_MS);
  return normalizeDelayMs(value) || DEFAULT_RETRY_DELAY_MS;
}

function resolveRoot(start = __dirname, env = process.env) {
  return env.AI_OS_DIR ? path.resolve(env.AI_OS_DIR) : findWorkspaceRoot(start);
}

function statePath(rootDir) {
  return path.join(rootDir, ".command-centre", "memory", "consolidation-tick.json");
}

function lockPath(rootDir) {
  return path.join(rootDir, ".command-centre", "memory", "consolidation-tick.lock");
}

function scopeKey(flags) {
  const client = typeof flags.client === "string" ? flags.client.trim() : "";
  return client ? `client:${client}` : "team";
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function getScopeState(state, key) {
  const scopes = state.scopes && typeof state.scopes === "object" ? state.scopes : {};
  const current = scopes[key] && typeof scopes[key] === "object" ? scopes[key] : {};
  return { scopes, current };
}

function dateMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function shouldRunNow(state, key, now = Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS, force = false) {
  if (force) return true;
  const { current } = getScopeState(state, key);
  const lastRun = dateMs(current.lastRunAt);
  return !lastRun || now - lastRun >= cooldownMs;
}

function markRun(filePath, key, patch) {
  const state = readState(filePath);
  const { scopes, current } = getScopeState(state, key);
  scopes[key] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeState(filePath, { ...state, scopes });
}

function acquireLock(filePath, now = Date.now()) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    const handle = fs.openSync(filePath, "wx");
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date(now).toISOString() }));
    return () => {
      try {
        fs.closeSync(handle);
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        /* ignore */
      }
    };
  } catch (error) {
    if (error && error.code === "EEXIST") {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(filePath, { force: true });
        return acquireLock(filePath, now);
      }
      return null;
    }
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldScheduleDelayedRetry(state, key, desiredAtMs) {
  const { current } = getScopeState(state, key);
  const scheduled = dateMs(current.delayedRetryAt);
  return !scheduled || scheduled < desiredAtMs - RESCHEDULE_GRACE_MS;
}

function scheduleDelayedRetry({ rootDir, flags, now = Date.now(), env = process.env }) {
  const key = scopeKey(flags);
  const filePath = statePath(rootDir);
  const state = readState(filePath);
  const delayMs = retryDelayMs(env);
  const desiredAtMs = now + delayMs;
  if (!shouldScheduleDelayedRetry(state, key, desiredAtMs)) return false;

  markRun(filePath, key, {
    delayedRetryAt: new Date(desiredAtMs).toISOString(),
    delayedReason: flags.reason || "after-capture",
  });

  const args = [
    __filename,
    "--quiet",
    "--delay-ms",
    String(delayMs),
    "--limit",
    String(normalizeLimit(flags.limit)),
    "--reason",
    "delayed-after-capture",
  ];
  if (flags.client) args.push("--client", String(flags.client));
  if (flags.model) args.push("--model", String(flags.model));
  if (flags.timeoutMs) args.push("--timeout-ms", String(flags.timeoutMs));

  const child = spawn(process.execPath, args, {
    cwd: path.join(rootDir, "command-centre"),
    env,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref();
  return true;
}

async function runTick(options = {}) {
  const flags = options.flags || parseArgs(options.argv || []);
  if (flags.help) {
    if (!flags.quiet) console.log(USAGE);
    return { status: "help" };
  }

  const rootDir = options.rootDir || resolveRoot(__dirname, options.env || process.env);
  const key = scopeKey(flags);
  const filePath = statePath(rootDir);
  const delayMs = normalizeDelayMs(flags.delayMs);

  if (flags.afterCapture) {
    scheduleDelayedRetry({ rootDir, flags, env: options.env || process.env });
  }

  if (delayMs > 0) await sleep(delayMs);

  const config = readConfigOptional();
  if (!config || isExpired(config)) {
    markRun(filePath, key, { lastSkipAt: new Date().toISOString(), lastSkipReason: "not_logged_in" });
    return { status: "skipped", reason: "not_logged_in" };
  }

  const release = acquireLock(lockPath(rootDir));
  if (!release) return { status: "skipped", reason: "locked" };

  try {
    const state = readState(filePath);
    if (!shouldRunNow(state, key, Date.now(), DEFAULT_COOLDOWN_MS, flags.force === true)) {
      return { status: "skipped", reason: "cooldown" };
    }

    markRun(filePath, key, {
      lastAttemptAt: new Date().toISOString(),
      lastReason: flags.reason || "tick",
    });

    const result = await (options.consolidateOnce || consolidate.consolidateOnce)({
      flags: {
        client: flags.client,
        limit: normalizeLimit(flags.limit),
        model: flags.model,
        timeoutMs: flags.timeoutMs,
        quiet: true,
      },
      limit: normalizeLimit(flags.limit),
      model: flags.model,
      timeoutMs: flags.timeoutMs,
    });

    markRun(filePath, key, {
      delayedRetryAt: null,
      lastRunAt: new Date().toISOString(),
      lastResult: result,
      lastError: null,
    });

    if (!flags.quiet) {
      console.log(
        `memory-consolidation-tick: claimed ${result.claimed}, published ${result.published}, ` +
          `review ${result.review}, discarded ${result.discarded}`,
      );
    }
    return { status: "ran", result };
  } catch (error) {
    markRun(filePath, key, {
      lastRunAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    release();
  }
}

if (require.main === module) {
  runTick({ argv: process.argv.slice(2) })
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      console.error(`memory-consolidation-tick failed: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_RETRY_DELAY_MS,
  parseArgs,
  retryDelayMs,
  runTick,
  scheduleDelayedRetry,
  scopeKey,
  shouldRunNow,
  shouldScheduleDelayedRetry,
  statePath,
};
