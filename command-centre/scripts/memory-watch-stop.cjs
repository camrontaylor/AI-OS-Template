#!/usr/bin/env node
/**
 * memory-watch-stop — stop a running memory-watch process. Reads the PID lock at
 * <dataDir>.watch.lock/pid and requests shutdown by writing a stop-sentinel file
 * the watcher polls. On non-Windows it also sends SIGTERM as a faster path
 * (Windows signal delivery skips the graceful handler, so the sentinel is the
 * portable mechanism). The watcher guards against shutting down twice.
 *
 * Usage:
 *   node scripts/memory-watch-stop.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const { findWorkspaceRoot } = require("./workspace-root.cjs");

const STOP_POLL_MS = 1000;
const STOP_WAIT_MS = 8000;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rootDir = process.env.AI_OS_DIR
    ? path.resolve(process.env.AI_OS_DIR)
    : findWorkspaceRoot(__dirname);
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  const lockDir = `${dataDir}.watch.lock`;
  const pidFile = path.join(lockDir, "pid");

  if (!fs.existsSync(pidFile)) {
    console.log("memory-watch-stop: no watcher lock found — nothing to stop.");
    return 0;
  }

  const pid = Number(fs.readFileSync(pidFile, "utf-8").trim());
  if (!Number.isInteger(pid) || !isProcessAlive(pid)) {
    console.log("memory-watch-stop: lock owner is not running — removing stale lock.");
    fs.rmSync(lockDir, { recursive: true, force: true });
    return 0;
  }

  fs.writeFileSync(path.join(lockDir, "stop-requested"), String(Date.now()));
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* the alive-check above already raced once; fall through to the poll wait */
    }
  }
  console.log(`memory-watch-stop: stop requested for pid ${pid}, waiting for it to exit...`);

  const deadline = Date.now() + STOP_WAIT_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      console.log("memory-watch-stop: stopped.");
      return 0;
    }
    await sleep(STOP_POLL_MS);
  }

  console.log(`memory-watch-stop: pid ${pid} did not exit within ${STOP_WAIT_MS}ms — forcing.`);
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  fs.rmSync(lockDir, { recursive: true, force: true });
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(`\nmemory-watch-stop failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
