const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "task-branch.ts");

function loadTaskBranchModule() {
  return loadTsModule(modulePath, {
    stubs: {
      "@/types/task": {},
      "./identity/work-scope": {
        inheritWorkScope(row) {
          const scope = row.workScope
            ? JSON.parse(row.workScope)
            : { mode: "solo", version: 1, clientId: row.clientId ?? null };
          return { scope, serialized: JSON.stringify(scope), clientId: row.clientId ?? null };
        },
        normalizeWorkScopedRow(row) {
          return {
            ...row,
            workScope: row.workScope
              ? JSON.parse(row.workScope)
              : { mode: "solo", version: 1, clientId: row.clientId ?? null },
          };
        },
      },
    },
  });
}

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      status TEXT,
      level TEXT,
      parentId TEXT,
      projectSlug TEXT,
      columnOrder INTEGER,
      createdAt TEXT,
      updatedAt TEXT,
      costUsd REAL,
      tokensUsed INTEGER,
      durationMs INTEGER,
      activityLabel TEXT,
      errorMessage TEXT,
      startedAt TEXT,
      completedAt TEXT,
      clientId TEXT,
      needsInput INTEGER,
      phaseNumber INTEGER,
      gsdStep TEXT,
      contextSources TEXT,
      cronJobSlug TEXT,
      claudeSessionId TEXT,
      claudePid INTEGER,
      permissionMode TEXT,
      executionPermissionMode TEXT,
      model TEXT,
      thinkingEffort TEXT,
      lastReplyAt TEXT,
      conversationId TEXT,
      originMessageId TEXT,
      teamId TEXT,
      coordinationLevel TEXT,
      goalGroup TEXT,
      tag TEXT,
      pinnedAt TEXT,
      dependsOnTaskIds TEXT,
      startSnapshot TEXT,
      forkedFromTaskId TEXT,
      forkedFromLogId TEXT,
      forkedFromClaudeSessionId TEXT
      ,workScope TEXT
    );
    CREATE TABLE task_logs (
      id TEXT PRIMARY KEY,
      taskId TEXT,
      type TEXT,
      timestamp TEXT,
      content TEXT,
      toolName TEXT,
      toolArgs TEXT,
      toolResult TEXT,
      toolUseId TEXT,
      parentToolUseId TEXT,
      isCollapsed INTEGER,
      questionSpec TEXT,
      questionAnswers TEXT,
      permissionMode TEXT
    );
  `);
  return db;
}

function insertTask(db, overrides = {}) {
  const now = "2026-07-09T10:00:00.000Z";
  const task = {
    id: "source-task",
    title: "Source task",
    description: "Original task description",
    status: "review",
    level: "task",
    parentId: null,
    projectSlug: "project-one",
    columnOrder: 10,
    createdAt: now,
    updatedAt: now,
    costUsd: 12.5,
    tokensUsed: 1000,
    durationMs: 2000,
    activityLabel: "Done",
    errorMessage: "old error",
    startedAt: now,
    completedAt: now,
    clientId: "client-a",
    needsInput: 1,
    phaseNumber: null,
    gsdStep: null,
    contextSources: "[]",
    cronJobSlug: null,
    claudeSessionId: "old-session",
    claudePid: 123,
    permissionMode: "default",
    executionPermissionMode: "default",
    model: "sonnet",
    thinkingEffort: "high",
    lastReplyAt: now,
    conversationId: "conv-old",
    originMessageId: "msg-old",
    teamId: "team-a",
    coordinationLevel: "team",
    goalGroup: "goal",
    tag: "tag-a",
    pinnedAt: now,
    dependsOnTaskIds: JSON.stringify(["dep"]),
    startSnapshot: "{}",
    forkedFromTaskId: null,
    forkedFromLogId: null,
    forkedFromClaudeSessionId: null,
    workScope: JSON.stringify({
      mode: "team",
      scope: { version: 1, serverId: "server-1", userId: "user-1", teamId: "team-a", clientId: "client-a" },
    }),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO tasks (
      id, title, description, status, level, parentId, projectSlug, columnOrder,
      createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel,
      errorMessage, startedAt, completedAt, clientId, needsInput, phaseNumber,
      gsdStep, contextSources, cronJobSlug, claudeSessionId, claudePid,
      permissionMode, executionPermissionMode, model, thinkingEffort, lastReplyAt,
      conversationId, originMessageId, teamId, coordinationLevel, goalGroup, tag,
      pinnedAt, dependsOnTaskIds, startSnapshot, forkedFromTaskId, forkedFromLogId,
      forkedFromClaudeSessionId, workScope
    ) VALUES (
      @id, @title, @description, @status, @level, @parentId, @projectSlug, @columnOrder,
      @createdAt, @updatedAt, @costUsd, @tokensUsed, @durationMs, @activityLabel,
      @errorMessage, @startedAt, @completedAt, @clientId, @needsInput, @phaseNumber,
      @gsdStep, @contextSources, @cronJobSlug, @claudeSessionId, @claudePid,
      @permissionMode, @executionPermissionMode, @model, @thinkingEffort, @lastReplyAt,
      @conversationId, @originMessageId, @teamId, @coordinationLevel, @goalGroup, @tag,
      @pinnedAt, @dependsOnTaskIds, @startSnapshot, @forkedFromTaskId, @forkedFromLogId,
      @forkedFromClaudeSessionId, @workScope
    )
  `).run(task);
  return task;
}

function insertLog(db, log) {
  db.prepare(`
    INSERT INTO task_logs (
      id, taskId, type, timestamp, content, toolName, toolArgs, toolResult,
      toolUseId, parentToolUseId, isCollapsed, questionSpec, questionAnswers,
      permissionMode
    ) VALUES (
      @id, @taskId, @type, @timestamp, @content, @toolName, @toolArgs, @toolResult,
      @toolUseId, @parentToolUseId, @isCollapsed, @questionSpec, @questionAnswers,
      @permissionMode
    )
  `).run({
    toolName: null,
    toolArgs: null,
    toolResult: null,
    toolUseId: null,
    parentToolUseId: null,
    isCollapsed: 0,
    questionSpec: null,
    questionAnswers: null,
    permissionMode: null,
    ...log,
  });
}

test("createTaskBranch copies logs through the selected user message and clears runtime fields", () => {
  const { createTaskBranch } = loadTaskBranchModule();
  const db = createDb();
  insertTask(db, { permissionMode: "auto", executionPermissionMode: "auto" });
  insertLog(db, {
    id: "log-1",
    taskId: "source-task",
    type: "user_reply",
    timestamp: "2026-07-09T10:00:01.000Z",
    content: "First message",
    permissionMode: "auto",
  });
  insertLog(db, {
    id: "log-2",
    taskId: "source-task",
    type: "text",
    timestamp: "2026-07-09T10:00:02.000Z",
    content: "Assistant answer",
  });
  insertLog(db, {
    id: "log-3",
    taskId: "source-task",
    type: "user_reply",
    timestamp: "2026-07-09T10:00:03.000Z",
    content: "Original second message",
    permissionMode: "auto",
  });
  insertLog(db, {
    id: "log-4",
    taskId: "source-task",
    type: "text",
    timestamp: "2026-07-09T10:00:04.000Z",
    content: "Later answer that must not copy",
  });

  const result = createTaskBranch(db, "source-task", "log-3", "Edited second message");

  assert.equal(result.task.status, "queued");
  assert.equal(result.task.title, "Source task");
  assert.equal(result.task.description, "Original task description");
  assert.equal(result.task.activityLabel, "Edited message queued");
  assert.equal(result.task.columnOrder, 10);
  assert.equal(result.task.goalGroup, "goal");
  assert.equal(result.task.tag, "tag-a");
  assert.equal(result.task.pinnedAt, "2026-07-09T10:00:00.000Z");
  assert.doesNotMatch(result.task.title, /branch/i);
  assert.doesNotMatch(result.task.activityLabel, /branch/i);
  assert.equal(result.task.claudeSessionId, null);
  assert.equal(result.task.claudePid, null);
  assert.equal(result.task.costUsd, null);
  assert.equal(result.task.tokensUsed, null);
  assert.equal(result.task.durationMs, null);
  assert.equal(result.task.conversationId, null);
  assert.equal(result.task.originMessageId, null);
  assert.equal(result.task.forkedFromTaskId, "source-task");
  assert.equal(result.task.forkedFromLogId, "log-3");
  assert.equal(result.task.forkedFromClaudeSessionId, "old-session");
  assert.equal(result.task.permissionMode, "auto");
  assert.equal(result.task.executionPermissionMode, "auto");
  assert.equal(result.task.workScope.mode, "team");
  assert.equal(result.task.workScope.scope.teamId, "team-a");
  assert.equal(result.task.workScope.scope.clientId, "client-a");
  assert.equal(result.copiedLogCount, 3);

  const copiedLogs = db
    .prepare("SELECT type, content, permissionMode FROM task_logs WHERE taskId = ? ORDER BY rowid ASC")
    .all(result.task.id);
  assert.deepEqual(copiedLogs, [
    { type: "user_reply", content: "First message", permissionMode: "auto" },
    { type: "text", content: "Assistant answer", permissionMode: null },
    { type: "user_reply", content: "Edited second message", permissionMode: "auto" },
  ]);

  const original = db.prepare("SELECT content FROM task_logs WHERE id = ?").get("log-3");
  assert.equal(original.content, "Original second message");
});

test("createTaskBranch blocks running source tasks", () => {
  const { createTaskBranch, TaskBranchError } = loadTaskBranchModule();
  const db = createDb();
  insertTask(db, { status: "running" });
  insertLog(db, {
    id: "log-1",
    taskId: "source-task",
    type: "user_reply",
    timestamp: "2026-07-09T10:00:01.000Z",
    content: "First message",
  });

  assert.throws(
    () => createTaskBranch(db, "source-task", "log-1", "Edited"),
    (error) => error instanceof TaskBranchError && error.status === 409,
  );
});

test("createTaskBranch allows running parent container tasks with active children", () => {
  const { createTaskBranch } = loadTaskBranchModule();
  const db = createDb();
  insertTask(db, {
    status: "running",
    level: "project",
    parentId: null,
    claudePid: 9999,
    activityLabel: "0/1 subtasks done - first task queued",
  });
  insertTask(db, {
    id: "child-task",
    title: "Child task",
    status: "running",
    parentId: "source-task",
    claudePid: 4321,
  });
  insertLog(db, {
    id: "log-1",
    taskId: "source-task",
    type: "user_reply",
    timestamp: "2026-07-09T10:00:01.000Z",
    content: "Main goal message",
  });

  const result = createTaskBranch(db, "source-task", "log-1", "Edited main goal message");

  assert.equal(result.task.status, "queued");
  assert.equal(result.task.forkedFromTaskId, "source-task");
});

test("createTaskBranch allows branched parent containers whose children remain on the root task", () => {
  const { createTaskBranch } = loadTaskBranchModule();
  const db = createDb();
  insertTask(db, {
    id: "root-task",
    title: "Root goal",
    status: "review",
    level: "project",
    parentId: null,
    claudePid: null,
  });
  insertTask(db, {
    id: "child-task",
    title: "Root child",
    status: "running",
    parentId: "root-task",
    claudePid: 5678,
  });
  insertTask(db, {
    id: "edited-parent",
    title: "Edited parent",
    status: "running",
    level: "project",
    parentId: null,
    claudePid: null,
    forkedFromTaskId: "root-task",
    forkedFromLogId: "root-log",
  });
  insertLog(db, {
    id: "log-1",
    taskId: "edited-parent",
    type: "user_reply",
    timestamp: "2026-07-09T10:00:01.000Z",
    content: "Edited parent message",
  });

  const result = createTaskBranch(db, "edited-parent", "log-1", "Edited again");

  assert.equal(result.task.status, "queued");
  assert.equal(result.task.forkedFromTaskId, "edited-parent");
});

test("createTaskBranch blocks queued source tasks", () => {
  const { createTaskBranch, TaskBranchError } = loadTaskBranchModule();
  const db = createDb();
  insertTask(db, { status: "queued" });
  insertLog(db, {
    id: "log-1",
    taskId: "source-task",
    type: "user_reply",
    timestamp: "2026-07-09T10:00:01.000Z",
    content: "First message",
  });

  assert.throws(
    () => createTaskBranch(db, "source-task", "log-1", "Edited"),
    (error) => error instanceof TaskBranchError && error.status === 409,
  );
});

test("createTaskBranch rejects non-user logs", () => {
  const { createTaskBranch, TaskBranchError } = loadTaskBranchModule();
  const db = createDb();
  insertTask(db);
  insertLog(db, {
    id: "log-1",
    taskId: "source-task",
    type: "text",
    timestamp: "2026-07-09T10:00:01.000Z",
    content: "Assistant message",
  });

  assert.throws(
    () => createTaskBranch(db, "source-task", "log-1", "Edited"),
    (error) => error instanceof TaskBranchError && error.status === 400,
  );
});

test("buildTaskBranchPrompt describes an edited message without branch wording", () => {
  const { buildTaskBranchPrompt } = loadTaskBranchModule();
  const prompt = buildTaskBranchPrompt(
    {
      id: "edited-task",
      title: "Source task",
      description: "Original description",
      forkedFromTaskId: "source-task",
      forkedFromLogId: "log-1",
    },
    [
      {
        id: "log-1",
        type: "user_reply",
        timestamp: "2026-07-09T10:00:00.000Z",
        content: "Edited message",
      },
    ],
  );

  assert.match(prompt, /edited user message/i);
  assert.doesNotMatch(prompt, /branch/i);
});
