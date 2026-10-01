const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const cronRuntime = require("./cron-runtime.js");

const queueWatcherSourcePath = path.resolve(__dirname, "queue-watcher.ts");

class LocalProfileLockedError extends Error {}
class LocalProfileRequestError extends Error {}

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "command-centre-queue-watcher-"));
}

function cleanupTempWorkspace(workspaceDir) {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
}

function insertQueuedTask(db, id) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
      id, title, description, status, level, parentId, columnOrder, createdAt, updatedAt,
      costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt,
      clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode
    ) VALUES (?, ?, ?, 'queued', 'task', NULL, 0, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, 'default')`
  ).run(id, id, "Queue watcher profile recovery test", now, now);
}

function loadQueueWatcherModule(stubs = {}) {
  const source = fs.readFileSync(queueWatcherSourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }

    if (request === "./subprocess") {
      return { killProcessTreeByPid: () => {}, isProcessAlive: () => false };
    }

    if (request === "./cron-runtime.js") {
      return cronRuntime;
    }

    if (request === "./local-profile") {
      return { LocalProfileLockedError };
    }

    if (request === "./local-profile-lifecycle") {
      return {
        LocalProfileRequestError,
        assertLocalProfileActive: () => {},
        getLocalProfileRuntimeSession: (profile) => ({
          version: 1,
          profileKey: profile.profileKey,
          sessionId: "test-session",
          state: "active",
        }),
      };
    }

    if (request.startsWith("./") || request.startsWith("../")) {
      return require(path.resolve(path.dirname(queueWatcherSourcePath), request));
    }

    return require(request);
  };

  const compiled = new Function("require", "module", "exports", "__dirname", "__filename", outputText);
  compiled(localRequire, module, module.exports, path.dirname(queueWatcherSourcePath), queueWatcherSourcePath);
  return module.exports;
}

test("initQueueWatcher skips queued cron tasks when the daemon is already the leader", async () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const cronExecuteCalls = [];
  const processExecuteCalls = [];
  const listeners = [];
  const originalSetInterval = global.setInterval;

  try {
    global.setInterval = () => ({ unref() {} });

    const { initQueueWatcher } = loadQueueWatcherModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        onTaskEvent: (listener) => {
          listeners.push(listener);
        },
      },
      "./process-manager": {
        processManager: {
          executeTask: async (taskId) => {
            processExecuteCalls.push(taskId);
          },
          hasActiveSession: () => false,
        },
      },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
      },
      "./cron-runtime.js": {
        executeCronTask: async (aiOsDir, taskId) => {
          cronExecuteCalls.push({ aiOsDir, taskId });
        },
        buildRecoveredCronRunUpdate: cronRuntime.buildRecoveredCronRunUpdate,
      },
      "./cron-system-status": {
        getCronSystemStatus: () => ({ runtime: "daemon" }),
      },
      "./cron-scheduler": {
        getInProcessCronRuntimeIdentifier: () => "in-process-test",
      },
    });

    initQueueWatcher();
    assert.equal(listeners.length, 1);

    listeners[0]({
      type: "task:status",
      timestamp: new Date().toISOString(),
      task: {
        id: "task-daemon-skip",
        status: "queued",
        cronJobSlug: "test-job",
      },
    });

    await Promise.resolve();

    assert.deepEqual(cronExecuteCalls, []);
    assert.deepEqual(processExecuteCalls, []);
  } finally {
    global.setInterval = originalSetInterval;
    db.close();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("initQueueWatcher routes queued cron tasks through cronRuntime exactly once when task:created and task:status both arrive", async () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const listeners = [];
  const cronExecuteCalls = [];
  const processExecuteCalls = [];
  let resolveCronExecution;
  const cronExecution = new Promise((resolve) => {
    resolveCronExecution = resolve;
  });
  const originalSetInterval = global.setInterval;

  try {
    global.setInterval = () => ({ unref() {} });

    const { initQueueWatcher } = loadQueueWatcherModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        onTaskEvent: (listener) => {
          listeners.push(listener);
        },
      },
      "./process-manager": {
        processManager: {
          executeTask: async (taskId) => {
            processExecuteCalls.push(taskId);
          },
          hasActiveSession: () => false,
        },
      },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
      },
      "./cron-runtime.js": {
        executeCronTask: async (aiOsDir, taskId) => {
          cronExecuteCalls.push({ aiOsDir, taskId });
          return cronExecution;
        },
        buildRecoveredCronRunUpdate: cronRuntime.buildRecoveredCronRunUpdate,
      },
      "./cron-system-status": {
        getCronSystemStatus: () => ({ runtime: "in-process" }),
      },
      "./cron-scheduler": {
        getInProcessCronRuntimeIdentifier: () => "in-process-test",
      },
    });

    initQueueWatcher();
    assert.equal(listeners.length, 1);

    const queuedTaskEvent = {
      timestamp: new Date().toISOString(),
      task: {
        id: "task-double-event",
        status: "queued",
        cronJobSlug: "test-job",
      },
    };

    listeners[0]({ type: "task:created", ...queuedTaskEvent });
    listeners[0]({ type: "task:status", ...queuedTaskEvent });

    await Promise.resolve();

    assert.deepEqual(cronExecuteCalls, [
      { aiOsDir: workspaceDir, taskId: "task-double-event" },
    ]);
    assert.deepEqual(processExecuteCalls, []);
    resolveCronExecution();
  } finally {
    global.setInterval = originalSetInterval;
    db.close();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("initQueueWatcher does not execute a restored task updated in review", async () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const listeners = [];
  const executeCalls = [];
  const originalSetInterval = global.setInterval;

  try {
    global.setInterval = () => ({ unref() {} });

    const { initQueueWatcher } = loadQueueWatcherModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        onTaskEvent: (listener) => listeners.push(listener),
      },
      "./process-manager": {
        processManager: {
          executeTask: async (taskId) => executeCalls.push(taskId),
          hasActiveSession: () => false,
        },
      },
      "./config": { getConfig: () => ({ aiOsDir: workspaceDir }) },
      "./cron-system-status": { getCronSystemStatus: () => ({ runtime: "in-process" }) },
      "./cron-scheduler": { getInProcessCronRuntimeIdentifier: () => "in-process-test" },
    });

    initQueueWatcher();
    assert.equal(listeners.length, 1);

    listeners[0]({
      type: "task:updated",
      timestamp: new Date().toISOString(),
      task: {
        id: "restored-review-task",
        status: "review",
        needsInput: true,
        claudeSessionId: "saved-session-id",
      },
    });
    await Promise.resolve();

    assert.deepEqual(executeCalls, []);

    listeners[0]({
      type: "task:updated",
      timestamp: new Date().toISOString(),
      task: { id: "ordinary-queued-task", status: "queued" },
    });
    await Promise.resolve();

    assert.deepEqual(executeCalls, ["ordinary-queued-task"]);
  } finally {
    global.setInterval = originalSetInterval;
    db.close();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("initQueueWatcher periodic queued-cron scan reuses the same in-process cron guard", async () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const listeners = [];
  const cronExecuteCalls = [];
  const processExecuteCalls = [];
  let intervalCallback = null;
  let resolveCronExecution;
  const cronExecution = new Promise((resolve) => {
    resolveCronExecution = resolve;
  });
  const originalSetInterval = global.setInterval;

  try {
    global.setInterval = (callback) => {
      intervalCallback = callback;
      return { unref() {} };
    };

    const { initQueueWatcher } = loadQueueWatcherModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        onTaskEvent: (listener) => {
          listeners.push(listener);
        },
      },
      "./process-manager": {
        processManager: {
          executeTask: async (taskId) => {
            processExecuteCalls.push(taskId);
          },
          hasActiveSession: () => false,
        },
      },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
      },
      "./cron-runtime.js": {
        executeCronTask: async (aiOsDir, taskId) => {
          cronExecuteCalls.push({ aiOsDir, taskId });
          return cronExecution;
        },
        buildRecoveredCronRunUpdate: cronRuntime.buildRecoveredCronRunUpdate,
      },
      "./cron-system-status": {
        getCronSystemStatus: () => ({ runtime: "in-process" }),
      },
      "./cron-scheduler": {
        getInProcessCronRuntimeIdentifier: () => "in-process-test",
      },
    });

    initQueueWatcher();
    assert.equal(listeners.length, 1);
    assert.equal(typeof intervalCallback, "function");

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (
        id, title, description, status, level, parentId, columnOrder, createdAt, updatedAt,
        costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt,
        clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode
      ) VALUES (?, ?, ?, 'queued', 'task', NULL, 0, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, ?, 'default')`
    ).run(
      "task-periodic-cron",
      "Periodic queued cron",
      "Should only dispatch once while already starting.",
      now,
      now,
      "periodic-job"
    );

    intervalCallback();
    intervalCallback();

    await Promise.resolve();

    assert.deepEqual(cronExecuteCalls, [
      { aiOsDir: workspaceDir, taskId: "task-periodic-cron" },
    ]);
    assert.deepEqual(processExecuteCalls, []);
    resolveCronExecution();
  } finally {
    global.setInterval = originalSetInterval;
    db.close();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("initQueueWatcher records inferred recovery for terminal cron rows instead of success", async () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const listeners = [];
  const originalSetInterval = global.setInterval;
  const now = new Date().toISOString();
  const taskId = "task-recovery";
  const cronRunId = db
    .prepare(
      `INSERT INTO cron_runs (jobSlug, taskId, startedAt, result, trigger, clientId, scheduledFor)
       VALUES (?, ?, ?, 'running', 'scheduled', NULL, ?)
       RETURNING id`
    )
    .get("test-job", taskId, now, now).id;

  db.prepare(
    `INSERT INTO tasks (
      id, title, description, status, level, parentId, columnOrder, createdAt, updatedAt,
      costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt,
      clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode
    ) VALUES (?, ?, ?, 'review', 'task', NULL, 0, ?, ?, ?, NULL, ?, ?, NULL, ?, NULL, NULL, 0, NULL, NULL, ?, 'default')`
  ).run(
    taskId,
    "Cron recovery test",
    "Repro for stuck input recovery",
    now,
    now,
    7.25,
    12_345,
    "Completed after restart",
    now,
    "test-job"
  );

  try {
    global.setInterval = () => ({ unref() {} });

    const { initQueueWatcher } = loadQueueWatcherModule({
      "./db": { getDb: () => db },
      "./event-bus": {
        emitTaskEvent: () => {},
        onTaskEvent: (listener) => {
          listeners.push(listener);
        },
      },
      "./process-manager": {
        processManager: {
          executeTask: async () => {},
          hasActiveSession: () => false,
        },
      },
      "./config": {
        getConfig: () => ({ aiOsDir: workspaceDir }),
      },
      "./cron-system-status": {
        getCronSystemStatus: () => ({ runtime: "in-process" }),
      },
      "./cron-scheduler": {
        getInProcessCronRuntimeIdentifier: () => "in-process-test",
      },
    });

    initQueueWatcher();

    const cronRun = db
      .prepare("SELECT result, resultSource, completionReason, exitCode FROM cron_runs WHERE id = ?")
      .get(cronRunId);
    const task = db.prepare("SELECT status, needsInput FROM tasks WHERE id = ?").get(taskId);

    assert.equal(cronRun.result, "failure");
    assert.equal(cronRun.resultSource, "inferred");
    assert.equal(cronRun.completionReason, "recovered_from_terminal_task_state");
    assert.equal(cronRun.exitCode, 1);
    assert.equal(task.status, "review");
    assert.equal(task.needsInput, 0);
  } finally {
    global.setInterval = originalSetInterval;
    db.close();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("initQueueWatcher quietly pauses, recovers each profile activation, and resumes work", async () => {
  const workspaceA = makeTempWorkspace();
  const workspaceB = makeTempWorkspace();
  const dbA = cronRuntime.getDb(workspaceA);
  const dbB = cronRuntime.getDb(workspaceB);
  const listeners = [];
  const executeCalls = [];
  const loggedErrors = [];
  const originalSetInterval = global.setInterval;
  const originalConsoleError = console.error;
  let reaper = null;
  let profileState = "locked";
  let currentProfileKey = "profile-a";
  let currentSessionId = "session-a-1";

  const profiles = {
    "profile-a": {
      version: 1,
      mode: "team",
      profileKey: "profile-a",
      dataDir: workspaceA,
      stateDir: workspaceA,
      tempDir: workspaceA,
      dbPath: path.join(workspaceA, "command-centre.db"),
    },
    "profile-b": {
      version: 1,
      mode: "team",
      profileKey: "profile-b",
      dataDir: workspaceB,
      stateDir: workspaceB,
      tempDir: workspaceB,
      dbPath: path.join(workspaceB, "command-centre.db"),
    },
  };

  try {
    global.setInterval = (callback) => {
      reaper = callback;
      return { unref() {} };
    };
    console.error = (...args) => loggedErrors.push(args);

    const { initQueueWatcher } = loadQueueWatcherModule({
      "./db": {
        getActiveLocalProfileDescriptor: () => {
          if (profileState === "locked") throw new LocalProfileLockedError("profile locked");
          return profiles[currentProfileKey];
        },
        getDb: () => currentProfileKey === "profile-a" ? dbA : dbB,
      },
      "./event-bus": {
        emitTaskEvent: () => {},
        onTaskEvent: (listener) => listeners.push(listener),
      },
      "./process-manager": {
        processManager: {
          executeTask: async (taskId) => executeCalls.push(taskId),
          hasActiveSession: () => false,
        },
      },
      "./config": { getConfig: () => ({ aiOsDir: workspaceA }) },
      "./cron-system-status": { getCronSystemStatus: () => ({ runtime: "in-process" }) },
      "./cron-scheduler": { getInProcessCronRuntimeIdentifier: () => "in-process-test" },
      "./local-profile": { LocalProfileLockedError },
      "./local-profile-lifecycle": {
        LocalProfileRequestError,
        assertLocalProfileActive: () => {
          if (profileState === "closing") throw new LocalProfileRequestError("profile closing");
        },
        getLocalProfileRuntimeSession: (profile) => ({
          version: 1,
          profileKey: profile.profileKey,
          sessionId: currentSessionId,
          state: "active",
        }),
      },
    });

    initQueueWatcher();
    assert.equal(typeof reaper, "function");
    assert.equal(listeners.length, 1);
    reaper();
    reaper();
    listeners[0]({ type: "task:created", profileKey: "profile-a", task: { id: "locked-event", status: "queued" } });
    assert.deepEqual(executeCalls, []);
    assert.deepEqual(loggedErrors, []);

    insertQueuedTask(dbA, "orphan-a");
    profileState = "active";
    reaper();
    assert.equal(dbA.prepare("SELECT status FROM tasks WHERE id = ?").get("orphan-a").status, "review");
    listeners[0]({ type: "task:created", profileKey: "profile-a", task: { id: "fresh-a", status: "queued" } });
    await Promise.resolve();
    assert.deepEqual(executeCalls, ["fresh-a"]);

    insertQueuedTask(dbB, "orphan-b");
    insertQueuedTask(dbB, "before-recovery-b");
    currentProfileKey = "profile-b";
    currentSessionId = "session-b-1";
    listeners[0]({ type: "task:created", profileKey: "profile-b", task: { id: "before-recovery-b", status: "queued" } });
    assert.deepEqual(executeCalls, ["fresh-a", "before-recovery-b"]);
    assert.equal(dbB.prepare("SELECT status FROM tasks WHERE id = ?").get("orphan-b").status, "review");
    assert.equal(dbB.prepare("SELECT status FROM tasks WHERE id = ?").get("before-recovery-b").status, "queued");

    insertQueuedTask(dbB, "orphan-b-activation-2");
    insertQueuedTask(dbB, "before-reactivation");
    currentSessionId = "session-b-2";
    listeners[0]({ type: "task:created", profileKey: "profile-b", task: { id: "before-reactivation", status: "queued" } });
    assert.deepEqual(executeCalls, ["fresh-a", "before-recovery-b", "before-reactivation"]);
    assert.equal(
      dbB.prepare("SELECT status FROM tasks WHERE id = ?").get("orphan-b-activation-2").status,
      "review",
    );
    assert.equal(dbB.prepare("SELECT status FROM tasks WHERE id = ?").get("before-reactivation").status, "queued");

    profileState = "locked";
    reaper();
    insertQueuedTask(dbB, "orphan-b-after-lock");
    insertQueuedTask(dbB, "before-unlock-recovery");
    profileState = "active";
    listeners[0]({ type: "task:created", profileKey: "profile-b", task: { id: "before-unlock-recovery", status: "queued" } });
    assert.deepEqual(executeCalls, [
      "fresh-a",
      "before-recovery-b",
      "before-reactivation",
      "before-unlock-recovery",
    ]);
    assert.equal(
      dbB.prepare("SELECT status FROM tasks WHERE id = ?").get("orphan-b-after-lock").status,
      "review",
    );
    assert.equal(dbB.prepare("SELECT status FROM tasks WHERE id = ?").get("before-unlock-recovery").status, "queued");

    profileState = "closing";
    reaper();
    listeners[0]({ type: "task:created", profileKey: "profile-b", task: { id: "closing-event", status: "queued" } });
    assert.deepEqual(executeCalls, [
      "fresh-a",
      "before-recovery-b",
      "before-reactivation",
      "before-unlock-recovery",
    ]);
    assert.deepEqual(loggedErrors, []);
  } finally {
    global.setInterval = originalSetInterval;
    console.error = originalConsoleError;
    dbA.close();
    dbB.close();
    cleanupTempWorkspace(workspaceA);
    cleanupTempWorkspace(workspaceB);
  }
});

function insertRunningTask(db, { id, claudePid = null, ownedClaudePid = null, cronJobSlug = null, startedAt }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
      id, title, description, status, level, parentId, columnOrder, createdAt, updatedAt,
      costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt,
      clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode, claudePid, ownedClaudePid
    ) VALUES (?, ?, ?, 'running', 'task', NULL, 0, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, 0, NULL, NULL, ?, 'default', ?, ?)`
  ).run(id, id, "Reaper ownership test", now, now, startedAt ?? now, cronJobSlug, claudePid, ownedClaudePid);
}

function insertRunningCronRun(db, taskId, jobSlug, startedAt = new Date().toISOString()) {
  const now = startedAt;
  return db
    .prepare(
      `INSERT INTO cron_runs (jobSlug, taskId, startedAt, result, trigger, clientId, scheduledFor)
       VALUES (?, ?, ?, 'running', 'scheduled', NULL, ?)
       RETURNING id`
    )
    .get(jobSlug, taskId, now, now).id;
}

// Runs the queue watcher against a real task database with process signals
// stubbed. `seedBeforeInit` rows exist at server start (startup recovery sees
// them); `seedAfterInit` rows only reach the periodic reaper.
// Mirrors subprocess.isProcessAlive on top of the stubbed process.kill.
function isProcessAliveViaKill(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function writeCronJobFile(workspaceDir, slug, { timeout, retry = 0 }) {
  const jobsDir = path.join(workspaceDir, "cron", "jobs");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobsDir, `${slug}.md`),
    ["---", `name: ${slug}`, "time: 03:33", "days: daily", "active: true", `timeout: ${timeout}`, `retry: ${retry}`, "---", "", "Reaper budget test.", ""].join("\n"),
    "utf-8"
  );
}

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

function runReaperScenario({
  seedBeforeInit = () => {},
  seedAfterInit = () => {},
  alivePids = [],
  epermPids = [],
  activeSessionIds = [],
  killThrowsFor = [],
}) {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const alive = new Set(alivePids);
  const signalProbes = [];
  const killCalls = [];
  let intervalCallback = null;
  const originalSetInterval = global.setInterval;
  const originalKill = process.kill;

  global.setInterval = (callback) => {
    intervalCallback = callback;
    return { unref() {} };
  };
  process.kill = (pid, signal) => {
    signalProbes.push({ pid, signal });
    if (alive.has(pid)) return true;
    const error = new Error(epermPids.includes(pid) ? "kill EPERM" : "kill ESRCH");
    error.code = epermPids.includes(pid) ? "EPERM" : "ESRCH";
    throw error;
  };

  const cleanup = () => {
    global.setInterval = originalSetInterval;
    process.kill = originalKill;
    db.close();
    cleanupTempWorkspace(workspaceDir);
  };

  try {
    seedBeforeInit(db, workspaceDir);
    const { initQueueWatcher } = loadQueueWatcherModule({
      "./db": { getDb: () => db },
      "./event-bus": { emitTaskEvent: () => {}, onTaskEvent: () => {} },
      "./subprocess": {
        killProcessTreeByPid: (pid, signal) => {
          killCalls.push({ pid, signal });
          if (killThrowsFor.includes(pid)) {
            const error = new Error("kill EPERM");
            error.code = "EPERM";
            throw error;
          }
        },
        isProcessAlive: isProcessAliveViaKill,
      },
      "./process-manager": {
        processManager: {
          executeTask: async () => {},
          hasActiveSession: (taskId) => activeSessionIds.includes(taskId),
        },
      },
      "./config": {
        getConfig: () => ({
          aiOsDir: workspaceDir,
          dataDir: path.join(workspaceDir, ".command-centre"),
          dbPath: path.join(workspaceDir, ".command-centre", "data.db"),
        }),
      },
      "./cron-system-status": { getCronSystemStatus: () => ({ runtime: "daemon" }) },
      "./cron-scheduler": { getInProcessCronRuntimeIdentifier: () => "in-process-test" },
    });
    initQueueWatcher();
    seedAfterInit(db, workspaceDir);
    intervalCallback();
  } catch (error) {
    cleanup();
    throw error;
  }

  const task = (id) => db.prepare("SELECT status, claudePid, errorMessage FROM tasks WHERE id = ?").get(id);
  return { db, task, signalProbes, killCalls, cleanup };
}

test("reaper leaves a live cron-runtime Claude process running", () => {
  const scenario = runReaperScenario({
    alivePids: [4242],
    seedAfterInit: (db) => insertRunningTask(db, { id: "task-cron-live", claudePid: 4242, cronJobSlug: "daily-memory-distill" }),
  });
  try {
    assert.deepEqual(scenario.killCalls, []);
    assert.equal(scenario.task("task-cron-live").status, "running");
    assert.equal(scenario.task("task-cron-live").claudePid, 4242);
  } finally {
    scenario.cleanup();
  }
});

test("reaper leaves a live external session registered through sync-session running", () => {
  const scenario = runReaperScenario({
    alivePids: [5151],
    seedAfterInit: (db) => insertRunningTask(db, { id: "task-terminal-live", claudePid: 5151 }),
  });
  try {
    assert.deepEqual(scenario.killCalls, []);
    assert.equal(scenario.task("task-terminal-live").status, "running");
    assert.equal(scenario.task("task-terminal-live").claudePid, 5151);
  } finally {
    scenario.cleanup();
  }
});

test("reaper does not kill a live process after ownership moved to another PID", () => {
  const scenario = runReaperScenario({
    alivePids: [2222],
    seedAfterInit: (db) => insertRunningTask(db, { id: "task-handoff", claudePid: 2222, ownedClaudePid: 1111 }),
  });
  try {
    assert.deepEqual(scenario.killCalls, []);
    assert.equal(scenario.task("task-handoff").status, "running");
  } finally {
    scenario.cleanup();
  }
});

test("reaper still stops a live orphan whose exact PID Command Centre spawned", () => {
  const scenario = runReaperScenario({
    alivePids: [3333],
    seedAfterInit: (db) => insertRunningTask(db, { id: "task-owned-orphan", claudePid: 3333, ownedClaudePid: 3333 }),
  });
  try {
    assert.deepEqual(scenario.killCalls, [{ pid: 3333, signal: "SIGTERM" }]);
    assert.equal(scenario.task("task-owned-orphan").status, "review");
    assert.equal(scenario.task("task-owned-orphan").claudePid, null);
  } finally {
    scenario.cleanup();
  }
});

test("reaper skips owned sessions that are still active in the process manager", () => {
  const scenario = runReaperScenario({
    alivePids: [3434],
    activeSessionIds: ["task-owned-active"],
    seedAfterInit: (db) => insertRunningTask(db, { id: "task-owned-active", claudePid: 3434, ownedClaudePid: 3434 }),
  });
  try {
    assert.deepEqual(scenario.killCalls, []);
    assert.equal(scenario.task("task-owned-active").status, "running");
  } finally {
    scenario.cleanup();
  }
});

test("reaper never signals invalid PIDs and treats them as ended sessions", () => {
  const scenario = runReaperScenario({
    alivePids: [-1, 0],
    seedAfterInit: (db) => {
      insertRunningTask(db, { id: "task-pid-sentinel", claudePid: -1, ownedClaudePid: -1 });
      insertRunningTask(db, { id: "task-pid-zero", claudePid: 0, ownedClaudePid: 0 });
      insertRunningTask(db, { id: "task-pid-fraction", claudePid: 1.5, ownedClaudePid: 1.5 });
    },
  });
  try {
    assert.deepEqual(scenario.signalProbes, []);
    assert.deepEqual(scenario.killCalls, []);
    for (const id of ["task-pid-sentinel", "task-pid-zero", "task-pid-fraction"]) {
      assert.equal(scenario.task(id).status, "review", id);
      assert.equal(scenario.task(id).claudePid, null, id);
    }
  } finally {
    scenario.cleanup();
  }
});

test("reaper still finalizes external and cron tasks whose process has exited", () => {
  const scenario = runReaperScenario({
    seedAfterInit: (db) => {
      insertRunningTask(db, { id: "task-terminal-dead", claudePid: 6161 });
      insertRunningTask(db, { id: "task-cron-dead", claudePid: 6262, cronJobSlug: "nightly-memory-index" });
    },
  });
  try {
    assert.deepEqual(scenario.killCalls, []);
    assert.equal(scenario.task("task-terminal-dead").status, "review");
    assert.equal(scenario.task("task-cron-dead").status, "done");
  } finally {
    scenario.cleanup();
  }
});

test("startup recovery keeps live cron and external sessions running and only reviews Command Centre tasks", () => {
  let cronRunId = null;
  const scenario = runReaperScenario({
    alivePids: [7171, 7272, 7373],
    seedBeforeInit: (db) => {
      insertRunningTask(db, { id: "task-restart-cron", claudePid: 7171, cronJobSlug: "daily-memory-distill" });
      cronRunId = insertRunningCronRun(db, "task-restart-cron", "daily-memory-distill");
      insertRunningTask(db, { id: "task-restart-terminal", claudePid: 7272 });
      insertRunningTask(db, { id: "task-restart-owned", claudePid: 7373, ownedClaudePid: 7373 });
    },
  });
  try {
    assert.deepEqual(scenario.killCalls, []);
    assert.equal(scenario.task("task-restart-cron").status, "running");
    assert.equal(scenario.task("task-restart-terminal").status, "running");
    assert.equal(scenario.task("task-restart-owned").status, "review");
    const cronRun = scenario.db.prepare("SELECT result FROM cron_runs WHERE id = ?").get(cronRunId);
    assert.equal(cronRun.result, "running");
  } finally {
    scenario.cleanup();
  }
});

test("reaper does not finalize a cron task with a null PID while its cron run is open", () => {
  const scenario = runReaperScenario({
    seedAfterInit: (db) => {
      insertRunningTask(db, { id: "task-cron-spawning", cronJobSlug: "daily-memory-distill" });
      insertRunningCronRun(db, "task-cron-spawning", "daily-memory-distill");
    },
  });
  try {
    assert.equal(scenario.task("task-cron-spawning").status, "running");
  } finally {
    scenario.cleanup();
  }
});

test("reaper does not finalize a cron task with a dead PID while its cron run is open", () => {
  // Covers the gap between retry attempts and a nested Claude that registered first and exited.
  const scenario = runReaperScenario({
    seedAfterInit: (db) => {
      insertRunningTask(db, { id: "task-cron-between-attempts", claudePid: 8181, cronJobSlug: "daily-memory-distill" });
      insertRunningCronRun(db, "task-cron-between-attempts", "daily-memory-distill");
    },
  });
  try {
    assert.deepEqual(scenario.killCalls, []);
    assert.equal(scenario.task("task-cron-between-attempts").status, "running");
    assert.equal(scenario.task("task-cron-between-attempts").claudePid, 8181);
  } finally {
    scenario.cleanup();
  }
});

test("reaper still finalizes null-PID tasks that no cron run is tracking", () => {
  const scenario = runReaperScenario({
    seedAfterInit: (db) => {
      insertRunningTask(db, { id: "task-cron-closed-run", cronJobSlug: "nightly-memory-index" });
      insertRunningTask(db, { id: "task-interactive-lost" });
    },
  });
  try {
    assert.equal(scenario.task("task-cron-closed-run").status, "done");
    assert.equal(scenario.task("task-interactive-lost").status, "review");
  } finally {
    scenario.cleanup();
  }
});

test("reaper treats a process it may not signal (EPERM) as alive and foreign", () => {
  const scenario = runReaperScenario({
    epermPids: [9191],
    seedAfterInit: (db) => insertRunningTask(db, { id: "task-other-user", claudePid: 9191 }),
  });
  try {
    assert.deepEqual(scenario.killCalls, []);
    assert.equal(scenario.task("task-other-user").status, "running");
  } finally {
    scenario.cleanup();
  }
});

test("reaper stops waiting on an open cron run once it outlives the job's timeout budget", () => {
  const scenario = runReaperScenario({
    seedAfterInit: (db, workspaceDir) => {
      // timeout 1m, no retries: budget is 1m + 10m margin.
      writeCronJobFile(workspaceDir, "short-job", { timeout: "1m" });
      insertRunningTask(db, { id: "task-overdue-null-pid", cronJobSlug: "short-job", startedAt: minutesAgo(20) });
      insertRunningCronRun(db, "task-overdue-null-pid", "short-job", minutesAgo(20));
      insertRunningTask(db, { id: "task-overdue-dead-pid", claudePid: 8282, cronJobSlug: "short-job", startedAt: minutesAgo(20) });
      insertRunningCronRun(db, "task-overdue-dead-pid", "short-job", minutesAgo(20));
      insertRunningTask(db, { id: "task-within-budget", cronJobSlug: "short-job" });
      insertRunningCronRun(db, "task-within-budget", "short-job", minutesAgo(5));
    },
  });
  try {
    assert.equal(scenario.task("task-overdue-null-pid").status, "done");
    assert.equal(scenario.task("task-overdue-dead-pid").status, "done");
    assert.equal(scenario.task("task-within-budget").status, "running");
    const runs = scenario.db
      .prepare("SELECT taskId, result, completionReason FROM cron_runs ORDER BY taskId")
      .all();
    assert.deepEqual(
      runs.map((run) => [run.taskId, run.result === "running" ? "running" : run.completionReason]),
      [
        ["task-overdue-dead-pid", "recovered_orphaned_task"],
        ["task-overdue-null-pid", "recovered_orphaned_task"],
        ["task-within-budget", "running"],
      ]
    );
  } finally {
    scenario.cleanup();
  }
});

test("reaper counts every retry attempt in the cron run budget", () => {
  const scenario = runReaperScenario({
    seedAfterInit: (db, workspaceDir) => {
      // timeout 10m with 2 retries: budget is 3 x 10m + 10m margin = 40m.
      writeCronJobFile(workspaceDir, "retrying-job", { timeout: "10m", retry: 2 });
      insertRunningTask(db, { id: "task-retrying", cronJobSlug: "retrying-job" });
      insertRunningCronRun(db, "task-retrying", "retrying-job", minutesAgo(35));
    },
  });
  try {
    assert.equal(scenario.task("task-retrying").status, "running");
  } finally {
    scenario.cleanup();
  }
});

test("reaper waits up to 24h on an open cron run whose job definition is gone", () => {
  const scenario = runReaperScenario({
    seedAfterInit: (db) => {
      insertRunningTask(db, { id: "task-deleted-job-old", cronJobSlug: "deleted-job", startedAt: minutesAgo(25 * 60) });
      insertRunningCronRun(db, "task-deleted-job-old", "deleted-job", minutesAgo(25 * 60));
      insertRunningTask(db, { id: "task-deleted-job-recent", cronJobSlug: "deleted-job" });
      insertRunningCronRun(db, "task-deleted-job-recent", "deleted-job", minutesAgo(23 * 60));
    },
  });
  try {
    assert.equal(scenario.task("task-deleted-job-old").status, "done");
    assert.equal(scenario.task("task-deleted-job-recent").status, "running");
  } finally {
    scenario.cleanup();
  }
});

test("reaper keeps processing other tasks when stopping an owned PID fails with EPERM", () => {
  const scenario = runReaperScenario({
    epermPids: [3535],
    killThrowsFor: [3535],
    seedAfterInit: (db) => {
      insertRunningTask(db, { id: "task-owned-eperm", claudePid: 3535, ownedClaudePid: 3535 });
      insertRunningTask(db, { id: "task-after-eperm", claudePid: 6363 });
    },
  });
  try {
    assert.deepEqual(scenario.killCalls, [{ pid: 3535, signal: "SIGTERM" }]);
    assert.equal(scenario.task("task-owned-eperm").status, "review");
    assert.equal(scenario.task("task-after-eperm").status, "review");
  } finally {
    scenario.cleanup();
  }
});

test("reaper counts the cron budget from when the task started running, not from when it was queued", () => {
  const scenario = runReaperScenario({
    seedAfterInit: (db, workspaceDir) => {
      // timeout 1m, no retries: budget is 11m. Queued 20m ago behind other
      // jobs, claimed just now, hook has not reported the Claude PID yet.
      writeCronJobFile(workspaceDir, "late-start-job", { timeout: "1m" });
      insertRunningTask(db, { id: "task-late-start", cronJobSlug: "late-start-job", startedAt: new Date().toISOString() });
      insertRunningCronRun(db, "task-late-start", "late-start-job", minutesAgo(20));
    },
  });
  try {
    assert.equal(scenario.task("task-late-start").status, "running");
    const run = scenario.db.prepare("SELECT result FROM cron_runs WHERE taskId = ?").get("task-late-start");
    assert.equal(run.result, "running");
  } finally {
    scenario.cleanup();
  }
});
