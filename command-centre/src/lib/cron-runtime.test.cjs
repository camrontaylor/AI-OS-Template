const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const test = require("node:test");
const Database = require("better-sqlite3");

const cronRuntime = require("./cron-runtime.js");

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "command-centre-cron-runtime-"));
}

function cleanupTempWorkspace(workspaceDir) {
  try {
    cronRuntime.getDb(workspaceDir).close();
  } catch {
    // Best-effort cleanup for tests only.
  }
  fs.rmSync(workspaceDir, { recursive: true, force: true });
}

function createLegacyCommandCentreDb(workspaceDir) {
  const dataDir = path.join(workspaceDir, ".command-centre");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "data.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      parentId TEXT
    );
    INSERT INTO tasks VALUES ('legacy-goal', 'Existing Goal', 'queued', NULL);
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    INSERT INTO conversations VALUES (
      'legacy-conversation',
      'Existing Conversation',
      'active',
      '2025-01-01T00:00:00.000Z',
      '2025-01-01T00:00:00.000Z'
    );
  `);
  db.close();
  return dbPath;
}

test("cron database startup upgrades schema-referenced legacy columns before loading schema", () => {
  const workspaceDir = makeTempWorkspace();

  try {
    createLegacyCommandCentreDb(workspaceDir);
    const db = cronRuntime.getDb(workspaceDir);
    const taskColumns = db.prepare("PRAGMA table_info(tasks)").all().map((column) => column.name);
    const conversationColumns = db.prepare("PRAGMA table_info(conversations)").all().map((column) => column.name);
    const indexes = db.prepare("PRAGMA index_list(tasks)").all().map((index) => index.name);
    const existing = db
      .prepare("SELECT id, title, archivedAt, archivingAt FROM tasks WHERE id = ?")
      .get("legacy-goal");
    const existingConversation = db
      .prepare("SELECT id, title FROM conversations WHERE id = ?")
      .get("legacy-conversation");
    assert.ok(taskColumns.includes("archivedAt"));
    assert.ok(taskColumns.includes("archivingAt"));
    assert.ok(taskColumns.includes("clientId"));
    assert.ok(taskColumns.includes("workScope"));
    assert.ok(conversationColumns.includes("clientId"));
    assert.ok(conversationColumns.includes("workScope"));
    assert.ok(indexes.includes("idx_tasks_archivedAt"));
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()
      .some((trigger) => trigger.name === "block_children_of_read_only_task_tree"));
    assert.deepEqual(existing, {
      id: "legacy-goal",
      title: "Existing Goal",
      archivedAt: null,
      archivingAt: null,
    });
    assert.deepEqual(existingConversation, {
      id: "legacy-conversation",
      title: "Existing Conversation",
    });
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

async function spawnIdleTestProcess() {
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore", windowsHide: true },
  );
  await once(child, "spawn");
  return child;
}

async function waitForProcessExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!cronRuntime.isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Process ${pid} did not exit within ${timeoutMs}ms`);
}

async function stopTestProcess(child) {
  if (!child?.pid || !cronRuntime.isProcessAlive(child.pid)) return;
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {
    return;
  }
  await waitForProcessExit(child.pid);
}

async function waitForCondition(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

function cronDaemonTestEnv(workspaceDir, extra = {}) {
  return {
    ...process.env,
    AI_OS_DIR: workspaceDir,
    AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
    ...extra,
  };
}

async function spawnLegacyDaemonCandidate(workspaceDir, markerMode) {
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");
  const child = spawn(process.execPath, [cronDaemonPath, "serve"], {
    cwd: workspaceDir,
    env: cronDaemonTestEnv(workspaceDir),
    stdio: "ignore",
    windowsHide: true,
  });
  await once(child, "spawn");
  const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
  const markerPath = path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json");
  await waitForCondition(
    () =>
      cronRuntime.readDaemonPid(workspaceDir) === child.pid &&
      fs.existsSync(markerPath),
  );
  if (markerMode === "markerless") {
    fs.rmSync(markerPath, { force: true });
  } else {
    fs.writeFileSync(
      markerPath,
      JSON.stringify({
        version: 1,
        profileKey: "solo",
        pid: child.pid,
      }),
      "utf8",
    );
  }
  return { child, cronDaemonPath, markerPath, runtimePaths };
}

function runCronCommandAsync(cronDaemonPath, command, workspaceDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cronDaemonPath, command], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function createFakeClaudeCommand(workspaceDir, name, lines) {
  if (process.platform === "win32") {
    const commandPath = path.join(workspaceDir, `${name}.cmd`);
    fs.writeFileSync(commandPath, lines.join("\r\n"), "utf-8");
    return commandPath;
  }

  const commandPath = path.join(workspaceDir, `${name}.sh`);
  fs.writeFileSync(commandPath, ["#!/usr/bin/env bash", ...lines].join("\n"), "utf-8");
  fs.chmodSync(commandPath, 0o755);
  return commandPath;
}

function writeCronJob(aiOsDir, clientId, slug, prompt, extraFrontmatter = []) {
  const jobsDir = clientId
    ? path.join(aiOsDir, "clients", clientId, "cron", "jobs")
    : path.join(aiOsDir, "cron", "jobs");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobsDir, `${slug}.md`),
    [
      "---",
      `name: ${slug}`,
      "time: 00:00",
      "days: daily",
      "active: true",
      "model: sonnet",
      "timeout: 30s",
      "retry: 0",
      ...extraFrontmatter,
      "---",
      "",
      prompt,
      "",
    ].join("\n"),
    "utf-8"
  );
}

test("buildRecoveredCronRunUpdate preserves inferred recovery truth", () => {
  const recovery = cronRuntime.buildRecoveredCronRunUpdate("recovered_from_stuck_needs_input", {
    durationMs: 4500,
    costUsd: 2.5,
  });

  assert.equal(recovery.resultSource, "inferred");
  assert.equal(recovery.result, "failure");
  assert.equal(recovery.completionReason, "recovered_from_stuck_needs_input");
  assert.equal(recovery.durationSec, 5);
  assert.equal(recovery.costUsd, 2.5);
  assert.equal(recovery.exitCode, 1);
});

test("getManagedRuntimeStatus treats a stale lock plus live daemon pid as stale ownership", () => {
  const workspaceDir = makeTempWorkspace();

  try {
    const { lockPath } = cronRuntime.getRuntimePaths(workspaceDir);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    cronRuntime.writeDaemonPid(workspaceDir, process.pid);

    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          runtime: "daemon",
          leader: true,
          identifier: "daemon-stale",
          pid: process.pid,
          startedAt: staleHeartbeat,
          heartbeatAt: staleHeartbeat,
          workspaceCount: 1,
          startCommand: "start",
          stopCommand: "stop",
        },
        null,
        2
      ),
      "utf-8"
    );

    const status = cronRuntime.getManagedRuntimeStatus(workspaceDir);

    assert.equal(status.leaderState, "stale");
    assert.equal(status.runtime, "daemon");
    assert.equal(status.leader, false);
    assert.equal(status.ownershipReason, "stale-leader-record");
    assert.equal(status.identifier, "daemon-stale");
    assert.equal(status.pid, process.pid);
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("getManagedRuntimeStatus treats the local identifier as leader only when the lock matches", () => {
  const workspaceDir = makeTempWorkspace();

  try {
    cronRuntime.claimRuntimeLeadership(workspaceDir, {
      runtime: "in-process",
      identifier: "in-process-123",
      pid: process.pid,
      workspaceCount: 1,
      startedAt: new Date().toISOString(),
    });

    const status = cronRuntime.getManagedRuntimeStatus(workspaceDir, "in-process-123");

    assert.equal(status.leaderState, "active");
    assert.equal(status.runtime, "in-process");
    assert.equal(status.leader, true);
    assert.equal(status.ownershipReason, "local-leader-active");
    assert.equal(status.identifier, "in-process-123");
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("daemon relinquishes leadership without losing its PID until final cleanup", () => {
  const workspaceDir = makeTempWorkspace();
  const daemonPid = 424242;

  try {
    cronRuntime.writeDaemonPid(workspaceDir, daemonPid);
    cronRuntime.claimRuntimeLeadership(workspaceDir, {
      runtime: "daemon",
      identifier: `daemon-${daemonPid}`,
      pid: daemonPid,
      profileKey: "solo",
      startToken: "start-token",
      workspaceCount: 1,
    });

    assert.equal(
      cronRuntime.releaseRuntimeLeadership(
        workspaceDir,
        `daemon-${daemonPid}`,
        {
          pid: daemonPid,
          profileKey: "solo",
          startToken: "start-token",
        },
      ),
      true,
    );
    assert.equal(cronRuntime.readRuntimeRecord(workspaceDir), null);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), daemonPid);

    assert.equal(cronRuntime.removeDaemonPid(workspaceDir, daemonPid), true);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), null);

    cronRuntime.writeDaemonPid(workspaceDir, daemonPid + 1);
    assert.equal(cronRuntime.removeDaemonPid(workspaceDir, daemonPid), false);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), daemonPid + 1);
    assert.equal(cronRuntime.removeDaemonPid(workspaceDir), false);
  } finally {
    fs.rmSync(cronRuntime.getRuntimePaths(workspaceDir).pidPath, { force: true });
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron daemon start does not spawn a passive daemon when an in-process leader is active", () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    cronRuntime.claimRuntimeLeadership(workspaceDir, {
      runtime: "in-process",
      identifier: "in-process-test",
      pid: process.pid,
      workspaceCount: 1,
      startedAt: new Date().toISOString(),
    });

    const result = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        AI_OS_DIR: workspaceDir,
        AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
      },
      encoding: "utf-8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /runtime: in-process/);
    assert.doesNotMatch(result.stdout, /started daemon pid/);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), null);
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron start and stop preserve a live foreign PID and foreign profile records", async () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");
  let foreignProcess = null;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    foreignProcess = await spawnIdleTestProcess();
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    const markerPath = path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json");
    const foreignMarker = {
      version: 1,
      profileKey: "foreign-profile",
      pid: foreignProcess.pid,
      startToken: "foreign-start-token",
      readyAt: new Date().toISOString(),
    };
    const foreignLock = {
      runtime: "daemon",
      leader: true,
      identifier: `daemon-${foreignProcess.pid}`,
      pid: foreignProcess.pid,
      profileKey: "foreign-profile",
      startToken: "foreign-start-token",
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      workspaceCount: 1,
      startCommand: "foreign-start",
      stopCommand: "foreign-stop",
    };
    cronRuntime.writeDaemonPid(workspaceDir, foreignProcess.pid);
    fs.writeFileSync(markerPath, JSON.stringify(foreignMarker, null, 2), "utf8");
    fs.writeFileSync(runtimePaths.lockPath, JSON.stringify(foreignLock, null, 2), "utf8");

    const env = {
      ...process.env,
      AI_OS_DIR: workspaceDir,
      AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
    };
    const start = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env,
      encoding: "utf8",
    });
    assert.notEqual(start.status, 0);
    assert.match(start.stderr, /not proven to be a ready daemon for the active profile/);
    assert.doesNotMatch(start.stdout, /started daemon pid/);
    assert.equal(cronRuntime.isProcessAlive(foreignProcess.pid), true);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), foreignProcess.pid);
    assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), foreignMarker);
    assert.deepEqual(cronRuntime.readRuntimeRecord(workspaceDir), foreignLock);

    const stop = spawnSync(process.execPath, [cronDaemonPath, "stop"], {
      cwd: workspaceDir,
      env,
      encoding: "utf8",
    });
    assert.notEqual(stop.status, 0);
    assert.match(stop.stderr, /not proven to be a ready daemon for the active profile/);
    assert.doesNotMatch(stop.stdout, /stopped daemon/);
    assert.equal(cronRuntime.isProcessAlive(foreignProcess.pid), true);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), foreignProcess.pid);
    assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), foreignMarker);
    assert.deepEqual(cronRuntime.readRuntimeRecord(workspaceDir), foreignLock);
  } finally {
    await stopTestProcess(foreignProcess);
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    fs.rmSync(runtimePaths.pidPath, { force: true });
    fs.rmSync(runtimePaths.lockPath, { force: true });
    fs.rmSync(
      path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json"),
      { force: true },
    );
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron start and stop require a live handshake beyond a same-profile stale marker", async () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");
  let foreignProcess = null;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    foreignProcess = await spawnIdleTestProcess();
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    const markerPath = path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json");
    const staleMarker = {
      version: 1,
      profileKey: "solo",
      pid: foreignProcess.pid,
      startToken: "copied-stale-start-token",
      readyAt: new Date().toISOString(),
    };
    cronRuntime.writeDaemonPid(workspaceDir, foreignProcess.pid);
    fs.writeFileSync(markerPath, JSON.stringify(staleMarker, null, 2), "utf8");

    const env = {
      ...process.env,
      AI_OS_DIR: workspaceDir,
      AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
    };
    const start = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env,
      encoding: "utf8",
    });
    assert.notEqual(start.status, 0);
    assert.match(start.stderr, /live handshake failed/);
    assert.match(start.stderr, /did not answer its live handshake/);
    assert.doesNotMatch(start.stdout, /started daemon pid/);
    assert.equal(cronRuntime.isProcessAlive(foreignProcess.pid), true);

    const stop = spawnSync(process.execPath, [cronDaemonPath, "stop"], {
      cwd: workspaceDir,
      env,
      encoding: "utf8",
    });
    assert.notEqual(stop.status, 0);
    assert.match(stop.stderr, /live handshake failed/);
    assert.doesNotMatch(stop.stdout, /stopped daemon/);
    assert.equal(cronRuntime.isProcessAlive(foreignProcess.pid), true);

    assert.equal(cronRuntime.readDaemonPid(workspaceDir), foreignProcess.pid);
    assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), staleMarker);
    assert.equal(fs.existsSync(runtimePaths.lockPath), false);
    assert.deepEqual(
      fs.readdirSync(runtimePaths.dataDir).filter((name) =>
        name.startsWith("cron-daemon-handshake-")),
      [],
    );
  } finally {
    await stopTestProcess(foreignProcess);
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    fs.rmSync(runtimePaths.pidPath, { force: true });
    fs.rmSync(
      path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json"),
      { force: true },
    );
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron start safely replaces a markerless standby legacy daemon after exact OS process proof", async () => {
  const workspaceDir = makeTempWorkspace();
  let legacy = null;
  let replacementPid = null;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf8");
    legacy = await spawnLegacyDaemonCandidate(workspaceDir, "markerless");
    const foreignLock = {
      runtime: "in-process",
      leader: true,
      identifier: "in-process-foreign",
      pid: process.pid,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      workspaceCount: 1,
      startCommand: "foreign-start",
      stopCommand: "foreign-stop",
    };
    fs.writeFileSync(legacy.runtimePaths.lockPath, JSON.stringify(foreignLock), "utf8");
    const result = spawnSync(process.execPath, [legacy.cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
      timeout: 15_000,
    });

    if (process.platform === "darwin") {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /no signal was sent/);
      assert.match(result.stderr, new RegExp(`ps -p ${legacy.child.pid}`));
      assert.match(result.stderr, new RegExp(`kill -TERM ${legacy.child.pid}`));
      assert.match(result.stderr, /bash scripts\/start-crons\.sh/);
      assert.doesNotMatch(result.stdout, /started daemon pid/);
      assert.equal(cronRuntime.isProcessAlive(legacy.child.pid), true);
      assert.equal(cronRuntime.readDaemonPid(workspaceDir), legacy.child.pid);
      assert.deepEqual(cronRuntime.readRuntimeRecord(workspaceDir), foreignLock);
      return;
    }

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /started daemon pid/);
    assert.doesNotMatch(result.stderr, /Refusing to restart/);
    await waitForProcessExit(legacy.child.pid);

    replacementPid = cronRuntime.readDaemonPid(workspaceDir);
    assert.ok(replacementPid && replacementPid !== legacy.child.pid);
    assert.equal(cronRuntime.isProcessAlive(replacementPid), true);
    const marker = JSON.parse(fs.readFileSync(legacy.markerPath, "utf8"));
    assert.equal(marker.pid, replacementPid);
    assert.equal(typeof marker.startToken, "string");
    assert.ok(marker.startToken);
    assert.equal(typeof marker.readyAt, "string");
    assert.deepEqual(cronRuntime.readRuntimeRecord(workspaceDir), foreignLock);

    const stop = spawnSync(process.execPath, [legacy.cronDaemonPath, "stop"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
    });
    assert.equal(stop.status, 0, stop.stderr);
    await waitForProcessExit(replacementPid);
    replacementPid = null;
    assert.deepEqual(cronRuntime.readRuntimeRecord(workspaceDir), foreignLock);
  } finally {
    await stopTestProcess(legacy?.child);
    if (replacementPid && cronRuntime.isProcessAlive(replacementPid)) {
      try {
        process.kill(replacementPid, "SIGTERM");
      } catch {
        // Best-effort cleanup after a failed assertion.
      }
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron stop accepts the exact old readiness marker but rejects a markerless foreign process", async () => {
  const workspaceDir = makeTempWorkspace();
  let legacy = null;
  let foreign = null;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf8");
    legacy = await spawnLegacyDaemonCandidate(workspaceDir, "old-marker");
    const stopLegacy = spawnSync(process.execPath, [legacy.cronDaemonPath, "stop"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
      timeout: 15_000,
    });
    if (process.platform === "darwin") {
      assert.notEqual(stopLegacy.status, 0);
      assert.match(stopLegacy.stderr, /no signal was sent/);
      assert.match(stopLegacy.stderr, new RegExp(`ps -p ${legacy.child.pid}`));
      assert.match(stopLegacy.stderr, new RegExp(`kill -TERM ${legacy.child.pid}`));
      assert.equal(cronRuntime.isProcessAlive(legacy.child.pid), true);
      assert.equal(cronRuntime.readDaemonPid(workspaceDir), legacy.child.pid);
      await stopTestProcess(legacy.child);
      fs.rmSync(legacy.runtimePaths.pidPath, { force: true });
      fs.rmSync(legacy.markerPath, { force: true });
      fs.rmSync(legacy.runtimePaths.lockPath, { force: true });
    } else {
      assert.equal(stopLegacy.status, 0, stopLegacy.stderr);
      assert.match(stopLegacy.stdout, /stopped daemon/);
      await waitForProcessExit(legacy.child.pid);
      assert.equal(cronRuntime.readDaemonPid(workspaceDir), null);
    }

    foreign = await spawnIdleTestProcess();
    cronRuntime.writeDaemonPid(workspaceDir, foreign.pid);
    fs.rmSync(legacy.markerPath, { force: true });
    fs.rmSync(legacy.runtimePaths.lockPath, { force: true });
    const startForeign = spawnSync(process.execPath, [legacy.cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.notEqual(startForeign.status, 0);
    assert.match(
      startForeign.stderr,
      process.platform === "darwin"
        ? /no signal was sent/
        : /could not be verified as the legacy cron daemon process/,
    );
    assert.doesNotMatch(startForeign.stdout, /started daemon pid/);
    assert.equal(cronRuntime.isProcessAlive(foreign.pid), true);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), foreign.pid);
  } finally {
    await stopTestProcess(legacy?.child);
    await stopTestProcess(foreign);
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron start removes an exact stale lock left by a crashed daemon and restarts", async () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");
  let crashedPid = null;
  let replacementPid = null;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf8");
    writeCronJob(workspaceDir, null, "leader-without-prompt", "");
    const start = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
    });
    assert.equal(start.status, 0, start.stderr);
    crashedPid = cronRuntime.readDaemonPid(workspaceDir);
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    const markerPath = path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    await waitForCondition(() => Boolean(cronRuntime.readRuntimeRecord(workspaceDir)));
    const staleLock = {
      ...cronRuntime.readRuntimeRecord(workspaceDir),
      heartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };

    process.kill(crashedPid, "SIGKILL");
    await waitForProcessExit(crashedPid);
    fs.writeFileSync(runtimePaths.pidPath, String(crashedPid), "utf8");
    fs.writeFileSync(markerPath, JSON.stringify(marker), "utf8");
    fs.writeFileSync(runtimePaths.lockPath, JSON.stringify(staleLock), "utf8");

    const restart = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
    });
    assert.equal(restart.status, 0, restart.stderr);
    assert.match(restart.stdout, /started daemon pid/);
    replacementPid = cronRuntime.readDaemonPid(workspaceDir);
    assert.ok(replacementPid && replacementPid !== crashedPid);
    assert.equal(cronRuntime.isProcessAlive(replacementPid), true);

    const stop = spawnSync(process.execPath, [cronDaemonPath, "stop"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
    });
    assert.equal(stop.status, 0, stop.stderr);
    await waitForProcessExit(replacementPid);
    replacementPid = null;
  } finally {
    if (crashedPid && cronRuntime.isProcessAlive(crashedPid)) {
      try {
        process.kill(crashedPid, "SIGKILL");
      } catch {
        // Best-effort cleanup after a failed assertion.
      }
    }
    if (replacementPid && cronRuntime.isProcessAlive(replacementPid)) {
      try {
        process.kill(replacementPid, "SIGTERM");
      } catch {
        // Best-effort cleanup after a failed assertion.
      }
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron stop handshakes with a standby daemon and preserves the foreign active lock", async () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");
  let daemonPid = null;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf8");
    const start = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
    });
    assert.equal(start.status, 0, start.stderr);
    daemonPid = cronRuntime.readDaemonPid(workspaceDir);
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    const foreignLock = {
      runtime: "in-process",
      leader: true,
      identifier: "in-process-foreign",
      pid: process.pid,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      workspaceCount: 1,
      startCommand: "foreign-start",
      stopCommand: "foreign-stop",
    };
    fs.writeFileSync(runtimePaths.lockPath, JSON.stringify(foreignLock), "utf8");

    const stop = spawnSync(process.execPath, [cronDaemonPath, "stop"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
    });
    assert.equal(stop.status, 0, stop.stderr);
    assert.match(stop.stdout, /stopped daemon/);
    await waitForProcessExit(daemonPid);
    daemonPid = null;
    assert.deepEqual(cronRuntime.readRuntimeRecord(workspaceDir), foreignLock);
  } finally {
    if (daemonPid && cronRuntime.isProcessAlive(daemonPid)) {
      try {
        process.kill(daemonPid, "SIGTERM");
      } catch {
        // Best-effort cleanup after a failed assertion.
      }
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("two concurrent cron starts leave one ready daemon and one canonical identity", async () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");
  let daemonPid = null;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf8");
    const [first, second] = await Promise.all([
      runCronCommandAsync(cronDaemonPath, "start", workspaceDir),
      runCronCommandAsync(cronDaemonPath, "start", workspaceDir),
    ]);
    assert.ok(
      first.code === 0 || second.code === 0,
      `first: ${first.stderr}\nsecond: ${second.stderr}`,
    );

    daemonPid = cronRuntime.readDaemonPid(workspaceDir);
    assert.ok(daemonPid && cronRuntime.isProcessAlive(daemonPid));
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    const markerPath = path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.equal(marker.pid, daemonPid);
    assert.equal(typeof marker.startToken, "string");
    assert.ok(marker.startToken);

    const confirm = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
    });
    assert.equal(confirm.status, 0, confirm.stderr);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), daemonPid);

    const stop = spawnSync(process.execPath, [cronDaemonPath, "stop"], {
      cwd: workspaceDir,
      env: cronDaemonTestEnv(workspaceDir),
      encoding: "utf8",
    });
    assert.equal(stop.status, 0, stop.stderr);
    await waitForProcessExit(daemonPid);
    daemonPid = null;
  } finally {
    if (daemonPid && cronRuntime.isProcessAlive(daemonPid)) {
      try {
        process.kill(daemonPid, "SIGTERM");
      } catch {
        // Best-effort cleanup after a failed assertion.
      }
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron daemon reports ready only after upgrading a legacy database", async () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");
  const schedulePath = path.join(workspaceDir, "cron", "jobs", "legacy-schedule.md");
  const scheduleContents = [
    "---",
    "name: Legacy Schedule",
    "time: 09:15",
    "days: weekdays",
    "active: false",
    "---",
    "",
    "Preserve this legacy schedule.",
    "",
  ].join("\n");

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    fs.mkdirSync(path.dirname(schedulePath), { recursive: true });
    fs.writeFileSync(schedulePath, scheduleContents, "utf8");
    createLegacyCommandCentreDb(workspaceDir);
    const env = {
      ...process.env,
      AI_OS_DIR: workspaceDir,
      AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
    };

    const start = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env,
      encoding: "utf-8",
    });

    assert.equal(start.status, 0, start.stderr);
    assert.match(start.stdout, /started daemon pid/);
    const pid = cronRuntime.readDaemonPid(workspaceDir);
    assert.ok(pid && cronRuntime.isProcessAlive(pid));

    const marker = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, ".command-centre", "cron-daemon-profile-v1.json"), "utf8"),
    );
    assert.equal(marker.pid, pid);
    assert.equal(marker.profileKey, "solo");
    assert.equal(typeof marker.readyAt, "string");
    assert.equal(
      fs.existsSync(cronRuntime.getRuntimePaths(workspaceDir).lockPath),
      false,
      "a standby daemon should answer handshakes without holding leadership",
    );

    const status = spawnSync(process.execPath, [cronDaemonPath, "status"], {
      cwd: workspaceDir,
      env,
      encoding: "utf-8",
    });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /runtime: daemon/);
    assert.match(status.stdout, new RegExp(`pid: ${pid}`));

    const secondStart = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env,
      encoding: "utf-8",
    });
    assert.equal(secondStart.status, 0, secondStart.stderr);
    assert.match(secondStart.stdout, /runtime: daemon/);
    assert.doesNotMatch(secondStart.stdout, /started daemon pid/);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), pid);
    assert.equal(cronRuntime.isProcessAlive(pid), true);

    const db = new Database(path.join(workspaceDir, ".command-centre", "data.db"), { readonly: true });
    assert.equal(db.prepare("SELECT title FROM tasks WHERE id = ?").get("legacy-goal").title, "Existing Goal");
    assert.equal(
      db.prepare("SELECT title FROM conversations WHERE id = ?").get("legacy-conversation").title,
      "Existing Conversation",
    );
    db.close();
    assert.equal(fs.readFileSync(schedulePath, "utf8"), scheduleContents);

    const stop = spawnSync(process.execPath, [cronDaemonPath, "stop"], {
      cwd: workspaceDir,
      env,
      encoding: "utf-8",
    });
    assert.equal(stop.status, 0, stop.stderr);
    await waitForProcessExit(pid);
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), null);
    assert.equal(fs.existsSync(runtimePaths.lockPath), false);
    assert.equal(
      fs.existsSync(path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json")),
      false,
    );
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("daemon exit preserves PID and lock records replaced by a foreign process", async () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");
  let daemonPid = null;
  let foreignProcess = null;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    const env = {
      ...process.env,
      NODE_ENV: "test",
      AI_OS_DIR: workspaceDir,
      AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
      AI_OS_CRON_TEST_CLEANUP_REQUEST: "1",
    };
    const start = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env,
      encoding: "utf8",
    });
    assert.equal(start.status, 0, start.stderr);
    daemonPid = cronRuntime.readDaemonPid(workspaceDir);
    assert.ok(daemonPid && cronRuntime.isProcessAlive(daemonPid));
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    const markerPath = path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));

    foreignProcess = await spawnIdleTestProcess();
    const foreignLock = {
      runtime: "daemon",
      leader: true,
      identifier: `daemon-${foreignProcess.pid}`,
      pid: foreignProcess.pid,
      profileKey: "foreign-profile",
      startToken: "foreign-start-token",
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      workspaceCount: 1,
      startCommand: "foreign-start",
      stopCommand: "foreign-stop",
    };
    cronRuntime.writeDaemonPid(workspaceDir, foreignProcess.pid);
    fs.writeFileSync(runtimePaths.lockPath, JSON.stringify(foreignLock, null, 2), "utf8");

    fs.writeFileSync(
      path.join(
        runtimePaths.dataDir,
        `cron-daemon-test-cleanup-${marker.startToken}.request`,
      ),
      "cleanup\n",
      "utf8",
    );
    await waitForProcessExit(daemonPid);

    assert.equal(cronRuntime.readDaemonPid(workspaceDir), foreignProcess.pid);
    assert.deepEqual(cronRuntime.readRuntimeRecord(workspaceDir), foreignLock);
    assert.equal(cronRuntime.isProcessAlive(foreignProcess.pid), true);
    assert.equal(
      fs.existsSync(markerPath),
      false,
    );
  } finally {
    if (daemonPid && cronRuntime.isProcessAlive(daemonPid)) {
      try {
        process.kill(daemonPid, "SIGTERM");
      } catch {
        // Best-effort cleanup for a failed assertion.
      }
    }
    await stopTestProcess(foreignProcess);
    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    fs.rmSync(runtimePaths.pidPath, { force: true });
    fs.rmSync(runtimePaths.lockPath, { force: true });
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron daemon returns an error when startup fails and removes stale state", () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    fs.mkdirSync(path.join(workspaceDir, ".command-centre", "data.db"), { recursive: true });

    const result = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        AI_OS_DIR: workspaceDir,
        AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
        AI_OS_CRON_STARTUP_TIMEOUT_MS: "1000",
      },
      encoding: "utf-8",
    });

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /started daemon pid/);
    assert.match(result.stderr, /Failed to start the managed cron daemon/);
    assert.match(result.stderr, /Recent daemon log/);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), null);
    assert.equal(
      fs.existsSync(path.join(workspaceDir, ".command-centre", "cron-daemon-profile-v1.json")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, ".command-centre", "cron-runtime-lock.json")),
      false,
    );
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron daemon rejects a real process that exits after its first readiness confirmation", () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    const result = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        AI_OS_DIR: workspaceDir,
        AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
        AI_OS_CRON_STARTUP_TIMEOUT_MS: "1000",
        AI_OS_CRON_TEST_EXIT_AFTER_FIRST_CONFIRMATION: "1",
      },
      encoding: "utf-8",
    });

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /started daemon pid/);
    assert.match(result.stderr, /Failed to start the managed cron daemon/);
    assert.match(result.stderr, /stopped before it became ready \(exit code 86\)/);
    assert.match(result.stderr, /Recent daemon log/);
    assert.match(result.stderr, /Test hook stopping pid \d+ after the first readiness confirmation/);
    const pid = Number.parseInt(
      result.stderr.match(/Test hook stopping pid (\d+)/)?.[1] || "",
      10,
    );
    assert.ok(Number.isFinite(pid));
    assert.equal(cronRuntime.isProcessAlive(pid), false);

    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    assert.equal(fs.existsSync(runtimePaths.pidPath), false);
    assert.equal(fs.existsSync(runtimePaths.lockPath), false);
    assert.equal(
      fs.existsSync(path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json")),
      false,
    );
    assert.deepEqual(
      fs.readdirSync(runtimePaths.dataDir).filter((name) =>
        name.startsWith("cron-daemon-test-first-confirmation-")),
      [],
    );
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron daemon timeout stops the real child and removes its startup state", () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    const startedAt = Date.now();
    const result = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        AI_OS_DIR: workspaceDir,
        AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
        AI_OS_CRON_STARTUP_TIMEOUT_MS: "60000",
        AI_OS_CRON_TEST_OMIT_READY_MARKER: "1",
      },
      encoding: "utf-8",
    });
    const elapsedMs = Date.now() - startedAt;

    assert.notEqual(result.status, 0);
    assert.ok(elapsedMs < 10_000, `startup failure took ${elapsedMs}ms`);
    assert.doesNotMatch(result.stdout, /started daemon pid/);
    assert.match(result.stderr, /Failed to start the managed cron daemon/);
    assert.match(result.stderr, /did not become ready within \d+ms/);
    assert.match(result.stderr, /Recent daemon log/);
    assert.match(result.stderr, /Test hook omitted the readiness marker for pid \d+/);
    const pid = Number.parseInt(
      result.stderr.match(/omitted the readiness marker for pid (\d+)/)?.[1] || "",
      10,
    );
    assert.ok(Number.isFinite(pid));
    assert.equal(cronRuntime.isProcessAlive(pid), false);

    const runtimePaths = cronRuntime.getRuntimePaths(workspaceDir);
    assert.equal(fs.existsSync(runtimePaths.pidPath), false);
    assert.equal(fs.existsSync(runtimePaths.lockPath), false);
    assert.equal(
      fs.existsSync(path.join(runtimePaths.dataDir, "cron-daemon-profile-v1.json")),
      false,
    );
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("completeCronRunForTask updates the existing running row instead of inserting a second row", () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const startedAt = new Date().toISOString();
  const completedAt = new Date(Date.now() + 5_000).toISOString();
  const taskId = "task-complete-existing-row";

  try {
    db.prepare(
      `INSERT INTO tasks (
        id, title, description, status, level, parentId, columnOrder, createdAt, updatedAt,
        costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt,
        clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode
      ) VALUES (?, ?, ?, 'done', 'task', NULL, 0, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, 0, NULL, NULL, ?, 'default')`
    ).run(
      taskId,
      "Complete cron row",
      "Uses the runtime helper",
      startedAt,
      startedAt,
      startedAt,
      "existing-row-job"
    );

    db.prepare(
      `INSERT INTO cron_runs (jobSlug, taskId, startedAt, result, trigger, clientId, scheduledFor)
       VALUES (?, ?, ?, 'running', 'manual', NULL, ?)`
    ).run("existing-row-job", taskId, startedAt, startedAt);

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);

    cronRuntime.completeCronRunForTask(workspaceDir, task, {
      result: "success",
      exitCode: 0,
      durationMs: 4200,
      costUsd: 1.25,
      completedAt,
      trigger: "manual",
    });

    const rows = db
      .prepare(
        `SELECT result, durationSec, costUsd, exitCode, trigger
         FROM cron_runs
         WHERE taskId = ?`
      )
      .all(taskId);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, "success");
    assert.equal(rows[0].durationSec, 4);
    assert.equal(rows[0].costUsd, 1.25);
    assert.equal(rows[0].exitCode, 0);
    assert.equal(rows[0].trigger, "manual");
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("buildCronClaudeArgs keeps root cron runs on the broad bypass path", () => {
  const args = cronRuntime.buildCronClaudeArgs(
    {
      prompt: "Run the root cron job",
      model: "sonnet",
    },
    {
      clientId: null,
      workspaceDir: "C:\\AI-OS",
    }
  );

  assert.deepEqual(args, [
    "-p",
    "--model",
    "sonnet",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--disallowedTools",
    "AskUserQuestion",
    "--",
    "Run the root cron job",
  ]);
});

test("buildCronClaudeArgs scopes client cron runs to dontAsk and --add-dir without bypass", () => {
  const workspaceDir = "C:\\AI-OS\\clients\\acme";
  const args = cronRuntime.buildCronClaudeArgs(
    {
      prompt: "Run the client cron job",
      model: "sonnet",
    },
    {
      clientId: "acme",
      workspaceDir,
    }
  );

  assert.deepEqual(args, [
    "-p",
    "--model",
    "sonnet",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--add-dir",
    workspaceDir,
    "--disallowedTools",
    "AskUserQuestion",
    "--",
    "Run the client cron job",
  ]);
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
});

test("cron job frontmatter can opt out of memory capture", () => {
  const workspaceDir = makeTempWorkspace();
  try {
    writeCronJob(
      workspaceDir,
      null,
      "no-memory-capture",
      "Run maintenance.",
      ["memoryCapture: false"]
    );
    writeCronJob(workspaceDir, null, "default-memory-capture", "Run useful work.");

    const disabled = cronRuntime.getCronJob(workspaceDir, "no-memory-capture", null);
    const enabled = cronRuntime.getCronJob(workspaceDir, "default-memory-capture", null);

    assert.equal(disabled.memoryCapture, false);
    assert.equal(enabled.memoryCapture, true);
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron execution env passes memory capture skip flag only for opted-out jobs", () => {
  const baseEnv = {
    CLAUDECODE: "1",
    AI_OS_SKIP_MEMORY_CAPTURE: "stale",
  };
  const disabled = cronRuntime.buildCronExecutionEnv(
    baseEnv,
    { slug: "nightly-memory-index", memoryCapture: false },
    "C:\\AI-OS"
  );
  const enabled = cronRuntime.buildCronExecutionEnv(
    baseEnv,
    { slug: "useful-report", memoryCapture: true },
    "C:\\AI-OS"
  );

  assert.equal(disabled.AI_OS_SKIP_MEMORY_CAPTURE, "1");
  assert.equal(disabled.AI_OS_CRON_JOB_SLUG, "nightly-memory-index");
  assert.equal(disabled.AI_OS_DIR, "C:\\AI-OS");
  assert.equal(disabled.CLAUDECODE, undefined);
  assert.equal(enabled.AI_OS_SKIP_MEMORY_CAPTURE, undefined);
});

test("cron execution env tells hooks which task they belong to, including through the Windows wrapper", () => {
  const baseEnv = { AI_OS_TASK_ID: "inherited-parent-task" };
  const job = { slug: "daily-memory-distill", memoryCapture: true };
  const withTask = cronRuntime.buildCronExecutionEnv(baseEnv, job, "C:\AI-OS", "task-cron-1");
  const withoutTask = cronRuntime.buildCronExecutionEnv(baseEnv, job, "C:\AI-OS");

  assert.equal(withTask.AI_OS_TASK_ID, "task-cron-1");
  assert.equal(withoutTask.AI_OS_TASK_ID, undefined);
  assert.equal(cronRuntime.buildWrapperEnvironmentOverrides(withTask).AI_OS_TASK_ID, "task-cron-1");
});

test("executeCronTask keeps a prose cron question as one assistant message and marks the run as needs_input", async () => {
  const workspaceDir = makeTempWorkspace();
  const scheduledFor = new Date().toISOString();
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    writeCronJob(
      workspaceDir,
      null,
      "needs-input-job",
      "Ask one follow-up question and stop."
    );

    const wrapperPath = createFakeClaudeCommand(
      workspaceDir,
      "fake-claude-needs-input",
      process.platform === "win32"
        ? [
            "@echo off",
            "setlocal",
            "echo {\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"The mock file is already there. What should I test next?\"}]}}",
            "echo {\"type\":\"result\",\"cost_usd\":0.42}",
            "exit /b 0",
            "",
          ]
        : [
            "set -e",
            "printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"The mock file is already there. What should I test next?\"}]}}'",
            "printf '%s\\n' '{\"type\":\"result\",\"cost_usd\":0.42}'",
            "exit 0",
          ]
    );

    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "needs-input-job", null);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "scheduled",
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const db = cronRuntime.getDb(workspaceDir);
    const taskRow = db
      .prepare("SELECT status, needsInput, completedAt, errorMessage, activityLabel FROM tasks WHERE id = ?")
      .get(queued.task.id);
    const cronRun = db
      .prepare("SELECT result, completionReason, costUsd FROM cron_runs WHERE taskId = ?")
      .get(queued.task.id);
    const logRows = db
      .prepare("SELECT type, content FROM task_logs WHERE taskId = ? ORDER BY rowid ASC")
      .all(queued.task.id);

    assert.equal(result.result, "failure");
    assert.equal(taskRow.status, "review");
    assert.equal(taskRow.needsInput, 1);
    assert.equal(taskRow.completedAt, null);
    assert.equal(taskRow.errorMessage, null);
    assert.equal(taskRow.activityLabel, "The mock file is already there. What should I test next?");
    assert.equal(cronRun.result, "failure");
    assert.equal(cronRun.completionReason, "needs_input");
    assert.equal(cronRun.costUsd, 0.42);
    assert.deepEqual(logRows, [
      {
        type: "text",
        content: "The mock file is already there. What should I test next?",
      },
    ]);
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("scheduled retry attempts are capped at exactly twice even when retry is higher", async () => {
  const workspaceDir = makeTempWorkspace();
  const jobsDir = path.join(workspaceDir, "cron", "jobs");
  const attemptsPath = path.join(workspaceDir, "attempt-count.txt");
  const scheduledFor = new Date().toISOString();
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobsDir, "retry-cap-job.md"),
      [
        "---",
        "name: Retry Cap Job",
        "time: 00:00",
        "days: daily",
        "active: true",
        "model: sonnet",
        "timeout: 30s",
        "retry: 5",
        "---",
        "",
        "Fail on purpose so the scheduler retry cap can be measured.",
        "",
      ].join("\n"),
      "utf-8"
    );
    const wrapperPath = createFakeClaudeCommand(
      workspaceDir,
      "fake-claude",
      process.platform === "win32"
        ? [
            "@echo off",
            "setlocal EnableDelayedExpansion",
            "set COUNT=0",
            "if exist attempt-count.txt set /p COUNT=<attempt-count.txt",
            "set /a COUNT+=1",
            "> attempt-count.txt echo !COUNT!",
            "exit /b 1",
            "",
          ]
        : [
            "set -e",
            "COUNT=0",
            "if [ -f attempt-count.txt ]; then COUNT=$(cat attempt-count.txt); fi",
            "COUNT=$((COUNT + 1))",
            "printf '%s\\n' \"$COUNT\" > attempt-count.txt",
            "exit 1",
          ]
    );

    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "retry-cap-job", null);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "scheduled",
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const attempts = Number(fs.readFileSync(attemptsPath, "utf-8").trim());
    const cronRun = cronRuntime
      .getDb(workspaceDir)
      .prepare("SELECT result, trigger FROM cron_runs WHERE taskId = ?")
      .get(queued.task.id);

    assert.equal(result.result, "failure");
    assert.equal(attempts, 2);
    assert.equal(cronRun.result, "failure");
    assert.equal(cronRun.trigger, "scheduled");
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("executeCronTask claims a queued cron task once so a second dispatcher skips", async () => {
  const workspaceDir = makeTempWorkspace();
  const attemptsPath = path.join(workspaceDir, "attempt-count.txt");
  const scheduledFor = new Date().toISOString();
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    writeCronJob(workspaceDir, null, "single-claim-job", "Succeed once so the second runtime dispatcher must skip cleanly.");

    const wrapperPath = createFakeClaudeCommand(
      workspaceDir,
      "fake-claude-success",
      process.platform === "win32"
        ? [
            "@echo off",
            "setlocal EnableDelayedExpansion",
            "set COUNT=0",
            "if exist attempt-count.txt set /p COUNT=<attempt-count.txt",
            "set /a COUNT+=1",
            "> attempt-count.txt echo !COUNT!",
            "ping -n 2 127.0.0.1 >nul",
            "echo success",
            "exit /b 0",
            "",
          ]
        : [
            "set -e",
            "COUNT=0",
            "if [ -f attempt-count.txt ]; then COUNT=$(cat attempt-count.txt); fi",
            "COUNT=$((COUNT + 1))",
            "printf '%s\\n' \"$COUNT\" > attempt-count.txt",
            "sleep 1",
            "printf 'success\\n'",
            "exit 0",
          ]
    );

    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "single-claim-job", null);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "manual",
      dedupeByMinute: false,
      scheduledFor,
    });

    const [first, second] = await Promise.all([
      cronRuntime.executeCronTask(workspaceDir, queued.task.id),
      cronRuntime.executeCronTask(workspaceDir, queued.task.id),
    ]);

    const attempts = Number(fs.readFileSync(attemptsPath, "utf-8").trim());
    const outcomes = [first.result, second.result].sort();
    const cronRuns = cronRuntime
      .getDb(workspaceDir)
      .prepare("SELECT result FROM cron_runs WHERE taskId = ?")
      .all(queued.task.id);

    assert.equal(attempts, 1);
    assert.deepEqual(outcomes, ["skipped", "success"]);
    assert.equal(cronRuns.length, 1);
    assert.equal(cronRuns[0].result, "success");
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("client cron runs fail when they touch files outside the selected workspace", async () => {
  const workspaceDir = makeTempWorkspace();
  const clientId = "acme";
  const clientDir = path.join(workspaceDir, "clients", clientId);
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;
  const scheduledFor = new Date().toISOString();

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# root workspace\n", "utf-8");
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, "AGENTS.md"), "# client workspace\n", "utf-8");
    writeCronJob(workspaceDir, clientId, "client-leak-job", "Write outside the workspace.");

    const wrapperPath = createFakeClaudeCommand(workspaceDir, "client-leak-claude", process.platform === "win32"
      ? [
          "@echo off",
          "setlocal",
          "> ..\\..\\root-leak.txt echo leaked",
          "exit /b 0",
          "",
        ]
      : [
          "set -e",
          "printf 'leaked\\n' > ../../root-leak.txt",
          "exit 0",
        ]);
    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "client-leak-job", clientId);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "manual",
      dedupeByMinute: false,
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const taskRow = cronRuntime
      .getDb(workspaceDir)
      .prepare("SELECT status, errorMessage FROM tasks WHERE id = ?")
      .get(queued.task.id);

    assert.equal(result.result, "failure");
    assert.equal(taskRow.status, "review");
    assert.match(taskRow.errorMessage, /outside its workspace/);
    assert.match(taskRow.errorMessage, /root-leak\.txt/);
    assert.equal(fs.existsSync(path.join(workspaceDir, "root-leak.txt")), true);
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("client cron runs allow writes anywhere inside the selected client workspace", async () => {
  const workspaceDir = makeTempWorkspace();
  const clientId = "acme";
  const clientDir = path.join(workspaceDir, "clients", clientId);
  const safeOutputPath = path.join(clientDir, "projects", "safe-note.txt");
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;
  const scheduledFor = new Date().toISOString();

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# root workspace\n", "utf-8");
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, "AGENTS.md"), "# client workspace\n", "utf-8");
    writeCronJob(workspaceDir, clientId, "client-safe-job", "Write inside the workspace.");

    const wrapperPath = createFakeClaudeCommand(workspaceDir, "client-safe-claude", process.platform === "win32"
      ? [
          "@echo off",
          "setlocal",
          "if not exist projects mkdir projects",
          "> projects\\safe-note.txt echo safe",
          "exit /b 0",
          "",
        ]
      : [
          "set -e",
          "mkdir -p projects",
          "printf 'safe\\n' > projects/safe-note.txt",
          "exit 0",
        ]);
    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "client-safe-job", clientId);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "manual",
      dedupeByMinute: false,
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const taskRow = cronRuntime
      .getDb(workspaceDir)
      .prepare("SELECT status, errorMessage FROM tasks WHERE id = ?")
      .get(queued.task.id);

    assert.equal(result.result, "success");
    assert.equal(taskRow.status, "done");
    assert.equal(taskRow.errorMessage, null);
    assert.equal(fs.existsSync(safeOutputPath), true);
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("resolveWindowsClaudeLaunchPlan keeps plain claude and exe paths on the direct launch path", () => {
  const bashPath = path.join(os.tmpdir(), "cron-runtime-test-bash.exe");

  try {
    fs.writeFileSync(bashPath, "", "utf-8");
    cronRuntime.setCronRuntimeTestHooks({
      findCommandOnPath(command) {
        if (command === "claude" || command === "claude.exe") {
          return "C:\\Users\\test-user\\.local\\bin\\claude.exe";
        }
        if (command === "bash.exe" || command === "bash") {
          return bashPath;
        }
        return null;
      },
    });

    const plainPlan = cronRuntime.resolveWindowsClaudeLaunchPlan({
      claudeCommand: "claude",
      env: {},
    });
    const exePlan = cronRuntime.resolveWindowsClaudeLaunchPlan({
      claudeCommand: "C:\\Users\\test-user\\.local\\bin\\claude.exe",
      env: {},
    });

    assert.equal(plainPlan.mode, "direct");
    assert.equal(plainPlan.env.CLAUDE_CODE_GIT_BASH_PATH, bashPath);
    assert.equal(exePlan.mode, "direct");
    assert.equal(exePlan.command, "C:\\Users\\test-user\\.local\\bin\\claude.exe");
  } finally {
    cronRuntime.resetCronRuntimeTestHooks();
    fs.rmSync(bashPath, { force: true });
  }
});

test("resolveWindowsClaudeLaunchPlan uses the wrapper path for .cmd overrides", () => {
  const bashPath = path.join(os.tmpdir(), "cron-runtime-test-wrapper-bash.exe");

  try {
    fs.writeFileSync(bashPath, "", "utf-8");
    cronRuntime.setCronRuntimeTestHooks({
      findCommandOnPath(command) {
        if (command === "bash.exe" || command === "bash") {
          return bashPath;
        }
        return null;
      },
    });

    const launchPlan = cronRuntime.resolveWindowsClaudeLaunchPlan({
      claudeCommand: "C:\\tools\\fake-claude.cmd",
      env: {},
    });

    assert.equal(launchPlan.mode, "wrapper");
    assert.equal(launchPlan.extension, ".cmd");
    assert.equal(launchPlan.env.CLAUDE_CODE_GIT_BASH_PATH, bashPath);
  } finally {
    cronRuntime.resetCronRuntimeTestHooks();
    fs.rmSync(bashPath, { force: true });
  }
});

test("resolveGitBashPath preserves CLAUDE_CODE_GIT_BASH_PATH or discovers bash.exe", () => {
  const discoveredBashPath = path.join(os.tmpdir(), "cron-runtime-test-discovered-bash.exe");

  try {
    fs.writeFileSync(discoveredBashPath, "", "utf-8");
    cronRuntime.setCronRuntimeTestHooks({
      findCommandOnPath(command) {
        if (command === "bash.exe" || command === "bash") {
          return discoveredBashPath;
        }
        return null;
      },
    });

    assert.equal(
      cronRuntime.resolveGitBashPath({
        CLAUDE_CODE_GIT_BASH_PATH: "C:\\Custom\\Git\\bin\\bash.exe",
      }),
      "C:\\Custom\\Git\\bin\\bash.exe"
    );
    assert.equal(cronRuntime.resolveGitBashPath({}), discoveredBashPath);
  } finally {
    cronRuntime.resetCronRuntimeTestHooks();
    fs.rmSync(discoveredBashPath, { force: true });
  }
});

test("shouldSendCronNotification respects on_finish, on_failure, and silent", () => {
  const matrix = [
    ["on_finish", "success", true],
    ["on_finish", "failure", true],
    ["on_finish", "timeout", true],
    ["on_failure", "success", false],
    ["on_failure", "failure", true],
    ["on_failure", "timeout", true],
    ["silent", "success", false],
    ["silent", "failure", false],
    ["silent", "timeout", false],
  ];

  for (const [notifySetting, result, expected] of matrix) {
    assert.equal(
      cronRuntime.shouldSendCronNotification(notifySetting, result),
      expected,
      `${notifySetting} should ${expected ? "" : "not "}send for ${result}`
    );
  }
});

test("executeCronTask finalizes missing cron definitions through the shared failure path", async () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const taskId = "task-missing-cron-job";
  const startedAt = new Date().toISOString();
  const notifications = [];

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");

    db.prepare(
      `INSERT INTO tasks (
        id, title, description, status, level, parentId, columnOrder, createdAt, updatedAt,
        costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt,
        clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode
      ) VALUES (?, ?, ?, 'queued', 'task', NULL, 0, ?, ?, NULL, NULL, NULL, 'Queued', NULL, ?, NULL, NULL, 0, NULL, NULL, ?, 'default')`
    ).run(
      taskId,
      "Missing cron job",
      "Should fail through the shared finalizer",
      startedAt,
      startedAt,
      startedAt,
      "missing-job"
    );

    db.prepare(
      `INSERT INTO cron_runs (jobSlug, taskId, startedAt, result, trigger, clientId, scheduledFor)
       VALUES (?, ?, ?, 'running', 'scheduled', NULL, ?)`
    ).run("missing-job", taskId, startedAt, startedAt);

    cronRuntime.setCronRuntimeTestHooks({
      platform: () => "win32",
      notificationSender(_aiOsDir, notification) {
        notifications.push(notification);
        return Promise.resolve({ sent: true, event: notification.event });
      },
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, taskId);
    const updatedTask = db.prepare("SELECT status, errorMessage FROM tasks WHERE id = ?").get(taskId);
    const cronRun = db
      .prepare(
        `SELECT result, exitCode, trigger
         FROM cron_runs
         WHERE taskId = ?`
      )
      .get(taskId);

    assert.equal(result.result, "failure");
    assert.equal(updatedTask.status, "review");
    assert.match(updatedTask.errorMessage, /Cron job definition not found/);
    assert.equal(cronRun.result, "failure");
    assert.equal(cronRun.exitCode, 1);
    assert.equal(cronRun.trigger, "scheduled");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].event, "failure");
    assert.equal(notifications[0].context.jobName, "missing-job");
  } finally {
    cronRuntime.resetCronRuntimeTestHooks();
    cleanupTempWorkspace(workspaceDir);
  }
});

// --- AIOS-314: day-of-week filter coverage for the live-tick dispatch gate ---
// Dates use the LOCAL constructor new Date(year, monthIndex, day, h, m) on
// purpose — a UTC `Z` ISO string can shift the weekday and flake the assertions.
// 2026-06-29 is a Monday (local); 2026-06-30 is a Tuesday; 2026-07-01 Wednesday;
// 2026-07-04 Saturday; 2026-07-05 Sunday.
const MON_0745 = new Date(2026, 5, 29, 7, 45);
const MON_0746 = new Date(2026, 5, 29, 7, 46);
const TUE_0745 = new Date(2026, 5, 30, 7, 45);
const WED_0745 = new Date(2026, 6, 1, 7, 45);
const SAT_0745 = new Date(2026, 6, 4, 7, 45);
const SUN_0745 = new Date(2026, 6, 5, 7, 45);

test("matchesDays: single weekday token matches only that day", () => {
  assert.equal(cronRuntime.matchesDays(MON_0745, "mon"), true);
  assert.equal(cronRuntime.matchesDays(TUE_0745, "mon"), false);
  assert.equal(cronRuntime.matchesDays(WED_0745, "mon"), false);
  assert.equal(cronRuntime.matchesDays(SAT_0745, "mon"), false);
  assert.equal(cronRuntime.matchesDays(SUN_0745, "mon"), false);
});

test("matchesDays: daily is always true", () => {
  assert.equal(cronRuntime.matchesDays(MON_0745, "daily"), true);
  assert.equal(cronRuntime.matchesDays(SAT_0745, "daily"), true);
  assert.equal(cronRuntime.matchesDays(SUN_0745, "daily"), true);
});

test("matchesDays: weekdays true Mon-Fri, false on weekend", () => {
  assert.equal(cronRuntime.matchesDays(MON_0745, "weekdays"), true);
  assert.equal(cronRuntime.matchesDays(WED_0745, "weekdays"), true);
  assert.equal(cronRuntime.matchesDays(SAT_0745, "weekdays"), false);
  assert.equal(cronRuntime.matchesDays(SUN_0745, "weekdays"), false);
});

test("matchesDays: weekends is the inverse of weekdays", () => {
  assert.equal(cronRuntime.matchesDays(SAT_0745, "weekends"), true);
  assert.equal(cronRuntime.matchesDays(SUN_0745, "weekends"), true);
  assert.equal(cronRuntime.matchesDays(MON_0745, "weekends"), false);
  assert.equal(cronRuntime.matchesDays(WED_0745, "weekends"), false);
});

test("matchesDays: comma list matches any listed token", () => {
  assert.equal(cronRuntime.matchesDays(MON_0745, "mon,wed"), true);
  assert.equal(cronRuntime.matchesDays(WED_0745, "mon,wed"), true);
  assert.equal(cronRuntime.matchesDays(TUE_0745, "mon,wed"), false);
});

test("shouldDispatchNow: requires BOTH time and day to match", () => {
  const weeklyJob = { time: "07:45", days: "mon" };
  // Reporter's scenario: weekly job must NOT fire on a non-matching day.
  assert.equal(cronRuntime.shouldDispatchNow(TUE_0745, weeklyJob), false);
  // Right day + right time → fire.
  assert.equal(cronRuntime.shouldDispatchNow(MON_0745, weeklyJob), true);
  // Right day, wrong minute → time still gates.
  assert.equal(cronRuntime.shouldDispatchNow(MON_0746, weeklyJob), false);
  // daily job is unaffected — still fires on any day at the matching time.
  const dailyJob = { time: "07:45", days: "daily" };
  assert.equal(cronRuntime.shouldDispatchNow(MON_0745, dailyJob), true);
  assert.equal(cronRuntime.shouldDispatchNow(SAT_0745, dailyJob), true);
});

test("cron status warns when active jobs exist but no runtime owns scheduling", () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    const env = {
      ...process.env,
      AI_OS_DIR: workspaceDir,
      AI_OS_TEAM_CONFIG_DIR: path.join(workspaceDir, "team-config"),
    };
    const runStatus = () =>
      spawnSync(process.execPath, [cronDaemonPath, "status"], {
        cwd: workspaceDir,
        env,
        encoding: "utf-8",
      });

    const withoutJobs = runStatus();
    assert.equal(withoutJobs.status, 0, withoutJobs.stderr);
    assert.doesNotMatch(withoutJobs.stdout, /^warning: /m);

    writeCronJob(workspaceDir, null, "needs-runtime", "Do the thing.");
    const withJobs = runStatus();
    assert.equal(withJobs.status, 0, withJobs.stderr);
    assert.match(withJobs.stdout, /leaderState: absent/);
    assert.match(withJobs.stdout, /^warning: active cron jobs exist but no live runtime owns scheduling/m);

    cronRuntime.claimRuntimeLeadership(workspaceDir, {
      runtime: "daemon",
      identifier: "daemon-test",
      pid: process.pid,
    });
    const withLeader = runStatus();
    assert.equal(withLeader.status, 0, withLeader.stderr);
    assert.match(withLeader.stdout, /leaderState: active/);
    assert.doesNotMatch(withLeader.stdout, /^warning: /m);
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});
