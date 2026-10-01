const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cronRuntime = require("../../../../lib/cron-runtime.js");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

function jsonRequest(body) {
  return new Request("http://localhost/api/tasks/sync-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDbStub({ existing = null, recentRunning = null } = {}) {
  const runs = [];
  const events = [];
  const updatedTask = existing || recentRunning || {
    id: "task-existing",
    status: "running",
    needsInput: 0,
    clientId: null,
  };

  const db = {
    prepare(sql) {
      return {
        get(...args) {
          if (sql.includes("WHERE claudeSessionId = ?")) return existing;
          if (sql.includes("julianday(?) - julianday(startedAt)")) return recentRunning;
          if (sql.includes("SELECT COALESCE(MIN(columnOrder)")) return { minOrder: 1 };
          if (sql.includes("SELECT * FROM tasks WHERE id = ?")) {
            return {
              ...updatedTask,
              id: args[0],
              status: "running",
              needsInput: 0,
            };
          }
          throw new Error(`Unhandled get SQL: ${sql}`);
        },
        run(...args) {
          runs.push({ sql, args });
          return { changes: 1 };
        },
      };
    },
  };

  return { db, runs, events };
}

function loadRoute({ db, events, activeSessionIds = [], alivePids = [] }) {
  return loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "@/lib/db": { getDb: () => db },
      "@/lib/subprocess": {
        isProcessAlive: (pid) => alivePids.includes(pid),
      },
      "@/lib/process-manager": {
        processManager: {
          hasActiveSession: (taskId) => activeSessionIds.includes(taskId),
        },
      },
      "@/lib/event-bus": {
        emitTaskEvent: (event) => events.push(event),
      },
      "@/lib/config": {
        detectClientIdFromCwd: (cwd) =>
          typeof cwd === "string" && cwd.replace(/\\/g, "/").includes("/clients/acme")
            ? "acme"
            : null,
      },
      "@/lib/identity/work-scope": {
        assertNoWorkScopeInput() {},
        createSoloStoredWorkScope(clientId) {
          return { mode: "solo", version: 1, clientId: clientId ?? null };
        },
        isWorkScopeError() {
          return false;
        },
        readWorkScopeFromRow(row) {
          return row.workScope == null
            ? { mode: "solo", version: 1, clientId: row.clientId ?? null }
            : row.workScope;
        },
        serializeStoredWorkScope(scope) {
          return JSON.stringify(scope);
        },
        workScopeErrorBody(error) {
          return { code: error.code, error: error.message };
        },
      },
    },
  });
}

test("sync-session creates terminal tasks with clientId detected from cwd", async () => {
  const { db, runs, events } = createDbStub();
  const route = loadRoute({ db, events });

  const response = await route.POST(jsonRequest({
    sessionId: "session-1",
    cwd: "C:/workspace/clients/acme/context",
    claudePid: 123,
  }));
  const body = await response.json();
  const insert = runs.find((run) => run.sql.includes("INSERT INTO tasks"));

  assert.equal(response.status, 201);
  assert.equal(body.isNew, true);
  assert.ok(insert, "task insert should run");
  assert.equal(insert.args[17], "acme");
  assert.deepEqual(JSON.parse(insert.args[18]), { mode: "solo", version: 1, clientId: "acme" });
  assert.equal(events[0].task.clientId, "acme");
});

test("sync-session keeps root terminal tasks unscoped", async () => {
  const { db, runs } = createDbStub();
  const route = loadRoute({ db, events: [] });

  const response = await route.POST(jsonRequest({
    sessionId: "session-root",
    cwd: "C:/workspace",
  }));
  const insert = runs.find((run) => run.sql.includes("INSERT INTO tasks"));

  assert.equal(response.status, 201);
  assert.ok(insert, "task insert should run");
  assert.equal(insert.args[17], null);
});

test("sync-session never infers a client for an existing legacy task", async () => {
  const { db, runs } = createDbStub({
    recentRunning: {
      id: "task-recent",
      status: "running",
      startedAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      needsInput: 0,
      clientId: null,
    },
  });
  const route = loadRoute({ db, events: [] });

  const response = await route.POST(jsonRequest({
    sessionId: "session-attach",
    cwd: "C:/workspace/clients/acme",
  }));
  const update = runs.find((run) => run.sql.includes("SET claudeSessionId = ?"));

  assert.equal(response.status, 200);
  assert.ok(update, "recent-running update should run");
  assert.equal(update.args.length, 4);
  assert.equal(update.args[3], "task-recent");
});

function withTaskDb(callback) {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "command-centre-sync-session-"));
  const db = cronRuntime.getDb(workspaceDir);
  return Promise.resolve()
    .then(() => callback(db))
    .finally(() => {
      db.close();
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    });
}

function insertTask(db, {
  id,
  status = "running",
  startedAt = new Date().toISOString(),
  claudeSessionId = null,
  claudePid = null,
  ownedClaudePid = null,
  cronJobSlug = null,
}) {
  db.prepare(
    `INSERT INTO tasks (
      id, title, status, level, columnOrder, createdAt, updatedAt, startedAt,
      needsInput, cronJobSlug, claudeSessionId, claudePid, ownedClaudePid
    ) VALUES (?, ?, ?, 'task', 0, ?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(id, id, status, startedAt, startedAt, startedAt, cronJobSlug, claudeSessionId, claudePid, ownedClaudePid);
}

function readTask(db, id) {
  return db.prepare("SELECT status, claudeSessionId, claudePid, ownedClaudePid FROM tasks WHERE id = ?").get(id);
}

test("sync-session attaches to the explicit taskId even when another task started more recently", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, {
      id: "task-cron",
      cronJobSlug: "daily-memory-distill",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
    });
    insertTask(db, { id: "task-newer" });
    const route = loadRoute({ db, events: [] });

    const response = await route.POST(jsonRequest({
      sessionId: "cron-session",
      cwd: "C:/workspace",
      claudePid: 900,
      taskId: "task-cron",
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.taskId, "task-cron");
    assert.deepEqual(readTask(db, "task-cron"), {
      status: "running",
      claudeSessionId: "cron-session",
      claudePid: 900,
      ownedClaudePid: null,
    });
    assert.equal(readTask(db, "task-newer").claudeSessionId, null);
  });
});

test("sync-session keeps the spawned PID and session of an active Command Centre task", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, {
      id: "task-owned",
      claudeSessionId: "cc-session",
      claudePid: 1000,
      ownedClaudePid: 1000,
    });
    const route = loadRoute({ db, events: [], activeSessionIds: ["task-owned"] });

    const response = await route.POST(jsonRequest({
      sessionId: "hook-session",
      cwd: "C:/workspace",
      claudePid: 1001,
      taskId: "task-owned",
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(readTask(db, "task-owned"), {
      status: "running",
      claudeSessionId: "cc-session",
      claudePid: 1000,
      ownedClaudePid: 1000,
    });
  });
});

test("sync-session drops Command Centre ownership when a terminal resumes one of its sessions", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, {
      id: "task-resumed",
      status: "review",
      claudeSessionId: "resumed-session",
      claudePid: 800,
      ownedClaudePid: 800,
    });
    const route = loadRoute({ db, events: [] });

    const response = await route.POST(jsonRequest({
      sessionId: "resumed-session",
      cwd: "C:/workspace",
      claudePid: 901,
      taskId: null,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(readTask(db, "task-resumed"), {
      status: "running",
      claudeSessionId: "resumed-session",
      claudePid: 901,
      ownedClaudePid: null,
    });
  });
});

test("sync-session creates a separate task for a terminal session instead of attaching to a recent running task", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, { id: "task-board", claudePid: 1100, ownedClaudePid: 1100 });
    const route = loadRoute({ db, events: [] });

    const response = await route.POST(jsonRequest({
      sessionId: "terminal-session",
      cwd: "C:/workspace",
      claudePid: 950,
      taskId: null,
    }));
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.isNew, true);
    assert.notEqual(body.taskId, "task-board");
    assert.deepEqual(readTask(db, body.taskId), {
      status: "running",
      claudeSessionId: "terminal-session",
      claudePid: 950,
      ownedClaudePid: null,
    });
    assert.deepEqual(readTask(db, "task-board"), {
      status: "running",
      claudeSessionId: null,
      claudePid: 1100,
      ownedClaudePid: 1100,
    });
  });
});

test("sync-session treats an unknown explicit taskId as an external session", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, { id: "task-board" });
    const route = loadRoute({ db, events: [] });

    const response = await route.POST(jsonRequest({
      sessionId: "stale-env-session",
      cwd: "C:/workspace",
      claudePid: 960,
      taskId: "task-deleted",
    }));
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.notEqual(body.taskId, "task-board");
    assert.equal(readTask(db, body.taskId).ownedClaudePid, null);
    assert.equal(readTask(db, "task-board").claudeSessionId, null);
  });
});

test("sync-session legacy payloads still use the recent-task fallback but never keep ownership", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, { id: "task-legacy", claudePid: 1200, ownedClaudePid: 1200 });
    const route = loadRoute({ db, events: [] });

    const response = await route.POST(jsonRequest({
      sessionId: "legacy-session",
      cwd: "C:/workspace",
      claudePid: 1300,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.taskId, "task-legacy");
    assert.deepEqual(readTask(db, "task-legacy"), {
      status: "running",
      claudeSessionId: "legacy-session",
      claudePid: 1300,
      ownedClaudePid: null,
    });
  });
});

test("sync-session legacy fallback leaves an active Command Centre task untouched", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, { id: "task-active", claudeSessionId: "cc-session", claudePid: 1400, ownedClaudePid: 1400 });
    const route = loadRoute({ db, events: [], activeSessionIds: ["task-active"] });

    const response = await route.POST(jsonRequest({
      sessionId: "legacy-hook-session",
      cwd: "C:/workspace",
      claudePid: 1401,
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(readTask(db, "task-active"), {
      status: "running",
      claudeSessionId: "cc-session",
      claudePid: 1400,
      ownedClaudePid: 1400,
    });
  });
});

async function captureLogs(callback) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    return { result: await callback(), lines };
  } finally {
    console.log = originalLog;
  }
}

test("sync-session ignores a nested Claude that inherited the task id while the cron Claude is alive", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, { id: "task-cron", cronJobSlug: "daily-memory-distill", claudeSessionId: "cron-session", claudePid: 900 });
    const route = loadRoute({ db, events: [], alivePids: [900, 901] });

    const { result: response, lines } = await captureLogs(() => route.POST(jsonRequest({
      sessionId: "memory-capture-session",
      cwd: "C:/workspace",
      claudePid: 901,
      taskId: "task-cron",
    })));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.taskId, "task-cron");
    assert.equal(body.syncMode, "managed");
    assert.deepEqual(readTask(db, "task-cron"), {
      status: "running",
      claudeSessionId: "cron-session",
      claudePid: 900,
      ownedClaudePid: null,
    });
    assert.ok(lines.some((line) => line.includes("Ignoring nested Claude session")));
  });
});

test("sync-session treats a hook without a PID as nested while the recorded Claude is alive", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, { id: "task-cron", cronJobSlug: "daily-memory-distill", claudeSessionId: "cron-session", claudePid: 900 });
    const route = loadRoute({ db, events: [], alivePids: [900] });

    await route.POST(jsonRequest({ sessionId: "pidless-session", cwd: "C:/workspace", claudePid: null, taskId: "task-cron" }));

    assert.equal(readTask(db, "task-cron").claudeSessionId, "cron-session");
    assert.equal(readTask(db, "task-cron").claudePid, 900);
  });
});

test("sync-session records a cron retry once the previous attempt's Claude has exited", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, { id: "task-cron", cronJobSlug: "daily-memory-distill", claudeSessionId: "attempt-1", claudePid: 900 });
    const route = loadRoute({ db, events: [], alivePids: [902] });

    const response = await route.POST(jsonRequest({
      sessionId: "attempt-2",
      cwd: "C:/workspace",
      claudePid: 902,
      taskId: "task-cron",
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(readTask(db, "task-cron"), {
      status: "running",
      claudeSessionId: "attempt-2",
      claudePid: 902,
      ownedClaudePid: null,
    });
  });
});

test("sync-session checks the active Command Centre session before the nested rule", async () => {
  await withTaskDb(async (db) => {
    // Windows: the process manager records the wrapper PID, the hook reports claude.exe.
    insertTask(db, { id: "task-owned", claudeSessionId: "cc-session", claudePid: 1000, ownedClaudePid: 1000 });
    const route = loadRoute({ db, events: [], activeSessionIds: ["task-owned"], alivePids: [1000, 1001] });

    const { result: response, lines } = await captureLogs(() => route.POST(jsonRequest({
      sessionId: "cc-session",
      cwd: "C:/workspace",
      claudePid: 1001,
      taskId: "task-owned",
    })));

    assert.equal(response.status, 200);
    assert.deepEqual(readTask(db, "task-owned"), {
      status: "running",
      claudeSessionId: "cc-session",
      claudePid: 1000,
      ownedClaudePid: 1000,
    });
    assert.equal(lines.some((line) => line.includes("Ignoring nested Claude session")), false);
  });
});

test("sync-session legacy fallback never overwrites a live cron Claude", async () => {
  await withTaskDb(async (db) => {
    insertTask(db, { id: "task-cron", cronJobSlug: "daily-memory-distill", claudeSessionId: "cron-session", claudePid: 900 });
    const route = loadRoute({ db, events: [], alivePids: [900, 950] });

    await route.POST(jsonRequest({ sessionId: "legacy-nested", cwd: "C:/workspace", claudePid: 950 }));

    assert.equal(readTask(db, "task-cron").claudeSessionId, "cron-session");
    assert.equal(readTask(db, "task-cron").claudePid, 900);
  });
});

test("sync-session keeps ownership when the hook reports the owned PID and the route cannot see the live session", async () => {
  await withTaskDb(async (db) => {
    // Production `next start`: the route may hold its own empty processManager,
    // so hasActiveSession is false for a task the Command Centre is running.
    insertTask(db, { id: "task-owned-prod", claudeSessionId: "cc-session", claudePid: 1000, ownedClaudePid: 1000 });
    const route = loadRoute({ db, events: [], activeSessionIds: [], alivePids: [1000] });

    const response = await route.POST(jsonRequest({
      sessionId: "hook-session",
      cwd: "/workspace",
      claudePid: 1000,
      taskId: "task-owned-prod",
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.syncMode, "managed");
    assert.deepEqual(readTask(db, "task-owned-prod"), {
      status: "running",
      claudeSessionId: "cc-session",
      claudePid: 1000,
      ownedClaudePid: 1000,
    });
  });
});
