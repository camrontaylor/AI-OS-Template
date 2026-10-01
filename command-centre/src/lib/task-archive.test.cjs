const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const archive = loadTsModule(path.resolve(__dirname, "task-archive.ts"), {
  stubs: {
    "@/lib/identity/work-scope": {
      normalizeWorkScopedRow(row) {
        const workScope = row.workScope == null
          ? { mode: "solo", version: 1, clientId: row.clientId ?? null }
          : typeof row.workScope === "string" ? JSON.parse(row.workScope) : row.workScope;
        return { ...row, workScope };
      },
    },
  },
});

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      parentId TEXT,
      status TEXT NOT NULL,
      archivedAt TEXT,
      archivingAt TEXT,
      clientId TEXT,
      workScope TEXT,
      needsInput INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT 'created',
      errorMessage TEXT,
      activityLabel TEXT,
      claudePid INTEGER,
      claudeSessionId TEXT,
      cancelRequestedAt TEXT,
      costUsd REAL,
      tokensUsed INTEGER,
      durationMs INTEGER,
      contextSources TEXT,
      startedAt TEXT,
      lastReplyAt TEXT,
      updatedAt TEXT NOT NULL,
      completedAt TEXT
    );
    CREATE TABLE task_outputs (id TEXT PRIMARY KEY, taskId TEXT, relativePath TEXT);
    CREATE TABLE task_logs (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE task_permission_rules (taskId TEXT NOT NULL, revokedAt TEXT);
    CREATE TABLE approval_requests (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      status TEXT NOT NULL,
      decision TEXT,
      decisionMessage TEXT,
      resolvedAt TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO tasks (id, title, parentId, status, archivedAt, needsInput, errorMessage, activityLabel, claudePid, updatedAt, completedAt)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'old', NULL)
  `);
  insert.run("goal", "Goal", null, "running", 1, "stale", "Working", 10);
  insert.run("running-child", "Running child", "goal", "running", 1, "stale", "Working", 11);
  insert.run("brief-child", "Unstarted brief", "goal", "backlog", 0, null, null, null);
  db.prepare("INSERT INTO task_outputs VALUES (?, ?, ?)").run("output", "running-child", "projects/result.md");
  return db;
}

test("archives a Goal tree after stopping active work and preserves unstarted tasks and artifacts", async () => {
  const db = createDb();
  const stopped = [];
  const tasks = await archive.archiveGoal({
    db,
    goalId: "goal",
    now: "2026-07-12T12:00:00.000Z",
    stopTask: async (id) => stopped.push(id),
  });

  assert.deepEqual(stopped.sort(), ["brief-child", "goal", "running-child"]);
  assert.equal(tasks.find((task) => task.id === "goal").archivedAt, "2026-07-12T12:00:00.000Z");
  assert.equal(tasks.find((task) => task.id === "goal").status, "done");
  assert.equal(tasks.find((task) => task.id === "running-child").status, "done");
  assert.equal(tasks.find((task) => task.id === "brief-child").status, "backlog");
  assert.equal(tasks.every((task) => task.needsInput === false && task.errorMessage == null), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_outputs").get().count, 1);
  db.close();
});

test("does not persist archive state when stopping a process fails", async () => {
  const db = createDb();
  await assert.rejects(() => archive.archiveGoal({
    db,
    goalId: "goal",
    stopTask: async (id) => {
      if (id === "running-child") throw new Error("stop failed");
    },
  }), /stop failed/);

  const root = db.prepare("SELECT * FROM tasks WHERE id = 'goal'").get();
  assert.equal(root.archivedAt, null);
  assert.ok(root.archivingAt);
  assert.ok(root.cancelRequestedAt);
  assert.equal(root.status, "running");
  assert.equal(root.errorMessage, "stale");
  db.close();
});

test("all-settled shutdown attempts every task and a retry repairs an interrupted archive", async () => {
  const db = createDb();
  const firstAttempt = [];
  await assert.rejects(() => archive.archiveGoal({
    db,
    goalId: "goal",
    stopTask: async (id) => {
      firstAttempt.push(id);
      if (id === "running-child") throw new Error("process still alive");
    },
  }), (error) => error.code === "task_stop_failed" && error.status === 503);

  assert.deepEqual(firstAttempt.sort(), ["brief-child", "goal", "running-child"]);
  assert.equal(db.prepare("SELECT archivedAt FROM tasks WHERE id = 'goal'").get().archivedAt, null);

  const retried = [];
  const tasks = await archive.archiveGoal({
    db,
    goalId: "goal",
    now: "repair-time",
    stopTask: async (id) => retried.push(id),
  });
  assert.deepEqual(retried.sort(), ["brief-child", "goal", "running-child"]);
  assert.equal(tasks.find((task) => task.id === "goal").archivedAt, "repair-time");
  assert.equal(db.prepare("SELECT archivingAt FROM tasks WHERE id = 'goal'").get().archivingAt, null);
  db.close();
});

test("re-queries the tree and quiesces a child discovered during shutdown", async () => {
  const db = createDb();
  const stopped = [];
  await archive.archiveGoal({
    db,
    goalId: "goal",
    now: "archive-time",
    stopTask: async (id) => {
      stopped.push(id);
      if (id === "goal") {
        db.prepare(`
          INSERT INTO tasks (
            id, title, parentId, status, archivedAt, needsInput, errorMessage,
            activityLabel, claudePid, updatedAt, completedAt
          ) VALUES ('late-child', 'Late child', 'goal', 'queued', NULL, 0, NULL, NULL, NULL, 'old', NULL)
        `).run();
      }
    },
  });

  assert.ok(stopped.includes("late-child"));
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id = 'late-child'").get().status, "done");
  db.close();
});

test("uses a final timestamp after asynchronous shutdown completes", async () => {
  const db = createDb();
  let stoppedAt = 0;
  const tasks = await archive.archiveGoal({
    db,
    goalId: "goal",
    stopTask: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      stoppedAt = Date.now();
    },
  });

  const root = tasks.find((task) => task.id === "goal");
  assert.ok(Date.parse(root.updatedAt) >= stoppedAt);
  assert.equal(root.archivedAt, root.updatedAt);
  db.close();
});

test("returns canonical Solo work scope for legacy NULL and serialized rows", () => {
  const db = createDb();
  db.prepare("UPDATE tasks SET workScope = ? WHERE id = ?").run(
    JSON.stringify({ mode: "solo", version: 1, clientId: null }),
    "running-child",
  );
  const tasks = archive.getTaskTree(db, "goal");
  assert.deepEqual(tasks.find((task) => task.id === "goal").workScope, {
    mode: "solo",
    version: 1,
    clientId: null,
  });
  assert.deepEqual(tasks.find((task) => task.id === "running-child").workScope, {
    mode: "solo",
    version: 1,
    clientId: null,
  });
  db.close();
});

test("already archived Goals are quiesced again and repaired idempotently", async () => {
  const db = createDb();
  db.prepare("UPDATE tasks SET archivedAt = 'original-archive', status = 'done' WHERE id = 'goal'").run();
  db.prepare("INSERT INTO task_permission_rules VALUES ('running-child', NULL)").run();
  db.prepare("INSERT INTO approval_requests VALUES ('approval', 'running-child', 'pending', NULL, NULL, NULL)").run();
  const stopped = [];

  const tasks = await archive.archiveGoal({
    db,
    goalId: "goal",
    now: "repair-time",
    stopTask: async (id) => stopped.push(id),
  });

  assert.deepEqual(stopped.sort(), ["brief-child", "goal", "running-child"]);
  assert.equal(tasks.find((task) => task.id === "goal").archivedAt, "original-archive");
  assert.deepEqual(db.prepare("SELECT revokedAt FROM task_permission_rules").get(), { revokedAt: "repair-time" });
  assert.deepEqual(db.prepare("SELECT status, decision, decisionMessage, resolvedAt FROM approval_requests").get(), {
    status: "denied",
    decision: "deny",
    decisionMessage: "Goal archived",
    resolvedAt: "repair-time",
  });
  db.close();
});

test("restores only the Goal root to paused review without restarting or changing children", async () => {
  const db = createDb();
  await archive.archiveGoal({ db, goalId: "goal", stopTask: async () => {}, now: "archive-time" });
  const tasks = archive.restoreGoal({ db, goalId: "goal", now: "restore-time" });
  const root = tasks.find((task) => task.id === "goal");
  assert.equal(root.archivedAt, null);
  assert.equal(root.status, "review");
  assert.equal(root.completedAt, null);
  assert.equal(root.needsInput, true);
  assert.equal(tasks.find((task) => task.id === "running-child").status, "done");
  assert.equal(tasks.find((task) => task.id === "brief-child").status, "backlog");
  db.close();
});

test("restore preserves conversation history, artifacts, session, context, metrics, and conversation dates", async () => {
  const db = createDb();
  const contextSources = JSON.stringify([
    { type: "file", label: "AGENTS.md", path: "AGENTS.md", status: "loaded" },
  ]);
  db.prepare(`
    UPDATE tasks
    SET title = 'Existing chat',
        description = 'Original prompt',
        claudeSessionId = 'session-original',
        costUsd = 1.25,
        tokensUsed = 321,
        durationMs = 4567,
        contextSources = ?,
        createdAt = 'created-time',
        startedAt = 'started-time',
        lastReplyAt = 'last-reply-time'
    WHERE id = 'goal'
  `).run(contextSources);
  db.prepare("INSERT INTO task_logs VALUES (?, ?, ?, ?, ?)")
    .run("user-log", "goal", "user_reply", "message-time", "Continue this chat");
  db.prepare("INSERT INTO task_logs VALUES (?, ?, ?, ?, ?)")
    .run("assistant-log", "goal", "text", "answer-time", "Existing answer");
  db.prepare("INSERT INTO task_outputs VALUES (?, ?, ?)")
    .run("goal-output", "goal", "projects/chat-result.md");

  await archive.archiveGoal({ db, goalId: "goal", stopTask: async () => {}, now: "archive-time" });
  const logsBeforeRestore = db.prepare("SELECT * FROM task_logs ORDER BY id").all();
  const outputsBeforeRestore = db.prepare("SELECT * FROM task_outputs ORDER BY id").all();

  archive.restoreGoal({ db, goalId: "goal", now: "restore-time" });

  const restored = db.prepare(`
    SELECT title, description, claudeSessionId, costUsd, tokensUsed, durationMs,
           contextSources, createdAt, startedAt, lastReplyAt, status, needsInput,
           archivedAt, cancelRequestedAt, archivingAt
    FROM tasks WHERE id = 'goal'
  `).get();
  assert.deepEqual(restored, {
    title: "Existing chat",
    description: "Original prompt",
    claudeSessionId: "session-original",
    costUsd: 1.25,
    tokensUsed: 321,
    durationMs: 4567,
    contextSources,
    createdAt: "created-time",
    startedAt: "started-time",
    lastReplyAt: "last-reply-time",
    status: "review",
    needsInput: 1,
    archivedAt: null,
    cancelRequestedAt: null,
    archivingAt: null,
  });
  assert.deepEqual(db.prepare("SELECT * FROM task_logs ORDER BY id").all(), logsBeforeRestore);
  assert.deepEqual(db.prepare("SELECT * FROM task_outputs ORDER BY id").all(), outputsBeforeRestore);
  db.close();
});

test("repeated archive and restore cycles never duplicate or erase history", async () => {
  const db = createDb();
  db.prepare("UPDATE tasks SET claudeSessionId = 'stable-session' WHERE id = 'goal'").run();
  db.prepare("INSERT INTO task_logs VALUES (?, ?, ?, ?, ?)")
    .run("original-prompt", "goal", "user_reply", "prompt-time", "Original prompt");
  db.prepare("INSERT INTO task_logs VALUES (?, ?, ?, ?, ?)")
    .run("original-answer", "goal", "text", "answer-time", "Original answer");

  for (const cycle of [1, 2]) {
    await archive.archiveGoal({
      db,
      goalId: "goal",
      stopTask: async () => {},
      now: `archive-${cycle}`,
    });
    const tasks = archive.restoreGoal({ db, goalId: "goal", now: `restore-${cycle}` });
    const root = tasks.find((task) => task.id === "goal");
    assert.equal(root.status, "review");
    assert.equal(root.needsInput, true);
    assert.equal(root.claudeSessionId, "stable-session");
    assert.equal(tasks.find((task) => task.id === "running-child").status, "done");
    assert.equal(tasks.find((task) => task.id === "brief-child").status, "backlog");
  }

  assert.deepEqual(
    db.prepare("SELECT id, content FROM task_logs ORDER BY rowid").all(),
    [
      { id: "original-prompt", content: "Original prompt" },
      { id: "original-answer", content: "Original answer" },
    ],
  );
  db.close();
});

test("selectors separate root Goals and children inherit read-only state", () => {
  const tasks = [
    { id: "active", parentId: null, archivedAt: null },
    { id: "archived", parentId: null, archivedAt: "now" },
    { id: "child", parentId: "archived", archivedAt: null },
    { id: "paused", parentId: null, archivedAt: null, archivingAt: "now" },
    { id: "paused-child", parentId: "paused", archivedAt: null },
  ];
  assert.deepEqual(archive.selectActiveGoals(tasks).map((task) => task.id), ["active", "paused"]);
  assert.deepEqual(archive.selectArchivedGoals(tasks).map((task) => task.id), ["archived"]);
  assert.equal(archive.isTaskReadOnly(tasks, "child"), true);
  assert.equal(archive.isTaskReadOnly(tasks, "paused-child"), true);
});

test("the persistent mutation guard blocks both an archived Goal and its children", async () => {
  const db = createDb();
  await archive.archiveGoal({ db, goalId: "goal", stopTask: async () => {} });
  assert.throws(() => archive.assertTaskMutable(db, "goal"), /Restore this Goal/);
  assert.throws(() => archive.assertTaskMutable(db, "running-child"), /Restore this Goal/);
  assert.doesNotThrow(() => archive.assertTaskMutable(db, "missing"));
  db.close();
});
