const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule: loadTsModuleRaw } = require("./test-utils/load-ts-module.cjs");

const claudeOptionsStub = {
  VALID_CLAUDE_MODELS: ["haiku", "sonnet", "opus", "fable"],
  normalizeClaudeModel: (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || /\s/.test(trimmed)) return null;
    const lower = trimmed.toLowerCase();
    return ["haiku", "sonnet", "opus", "fable"].includes(lower) ? lower : trimmed;
  },
  isClaudeModel: (value) => claudeOptionsStub.normalizeClaudeModel(value) !== null,
  isNullableClaudeThinkingEffort: (value) => value === null || ["auto", "low", "medium", "high", "xhigh", "max"].includes(value),
  normalizeClaudeThinkingEffortForModel: (model, effort) => {
    if (effort == null) return null;
    if (model === "haiku") return "auto";
    if (model === "sonnet" && effort === "xhigh") return "high";
    return effort;
  },
};

function createNextServerStub() {
  return {
    NextRequest: class {},
    NextResponse: {
      json(body, init = {}) {
        return {
          status: init.status ?? 200,
          body,
          async json() {
            return body;
          },
        };
      },
    },
  };
}

function createDb(task, logRows) {
  return {
    prepare(sql) {
      return {
        get(id) {
          if (sql.includes("SELECT * FROM tasks WHERE id = ?")) {
            return id === task.id ? task : undefined;
          }
          throw new Error(`Unhandled get SQL: ${sql}`);
        },
        run(...args) {
          if (sql.startsWith("INSERT INTO task_logs")) {
            logRows.push({
              id: args[0],
              taskId: args[1],
              type: args[2],
              content: args[4],
              permissionMode: args[11],
            });
            return;
          }
          if (sql.startsWith("UPDATE tasks SET permissionMode = ?, executionPermissionMode = ? WHERE id = ?")) {
            task.permissionMode = args[0];
            task.executionPermissionMode = args[1];
            return;
          }
          if (sql.startsWith("UPDATE tasks SET status = 'running'")) {
            task.status = "running";
            task.updatedAt = args[0];
            task.lastReplyAt = args[1];
            task.activityLabel = args[2];
            task.startedAt = task.startedAt ?? args[3];
            task.needsInput = 0;
            task.errorMessage = null;
            return;
          }
          throw new Error(`Unhandled run SQL: ${sql}`);
        },
      };
    },
  };
}

const taskArchiveStub = {
  isTaskArchived(db, taskId) {
    const visited = new Set();
    let task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    while (task?.parentId && !visited.has(task.id)) {
      visited.add(task.id);
      task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.parentId);
    }
    return Boolean(task?.archivedAt);
  },
};

function loadTsModule(modulePath, options = {}) {
  return loadTsModuleRaw(modulePath, {
    ...options,
    stubs: {
      "@/lib/task-permission-rules": { revokeTaskPermissionRules: () => 0 },
      "@/lib/identity/work-scope": {
        isWorkScopeError: () => false,
        readWorkScopeFromRow: (row) => ({
          mode: "solo",
          version: 1,
          clientId: row?.clientId ?? null,
        }),
        requestWithWorkScope: (request) => request,
        workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
      },
      ...(options.stubs ?? {}),
    },
  });
}

test("task reply route composes attachment paths into the Claude message and cleans up drafts", async () => {
  const insertedLogs = [];
  const emittedEvents = [];
  const copyCalls = [];
  const deleteCalls = [];
  const cleanupCalls = [];
  const replyCalls = [];
  const task = {
    id: "task-1",
    status: "review",
    needsInput: 0,
    permissionMode: "bypassPermissions",
    executionPermissionMode: "bypassPermissions",
    startedAt: null,
    updatedAt: "2026-04-20T10:00:00.000Z",
    lastReplyAt: null,
    activityLabel: null,
    errorMessage: null,
  };

  const incomingAttachments = [{
    id: "draft-1",
    fileName: "notes.md",
    relativePath: ".tmp/chat-drafts/drafts/conversation/conv-1/draft-1/notes.md",
    surface: "conversation",
    scopeId: "conv-1",
    draftKey: "draft-1",
    state: "draft",
  }];
  const sentAttachments = [{
    ...incomingAttachments[0],
    relativePath: ".tmp/chat-drafts/sent/task/task-1/reply-1/notes.md",
    surface: "task",
    scopeId: "task-1",
    draftKey: null,
    state: "sent",
  }];

  const routePath = path.resolve(__dirname, "../app/api/tasks/[id]/reply/route.ts");
  const route = loadTsModule(routePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/db": { getDb: () => createDb(task, insertedLogs) },
      "@/lib/event-bus": { emitTaskEvent: (event) => emittedEvents.push(event) },
      "@/lib/chat-attachment-service": {
        cleanupChatAttachmentStorage: (args) => cleanupCalls.push(args),
        copyChatAttachmentsToSent: (args) => {
          copyCalls.push(args);
          return sentAttachments;
        },
        deleteSourceDraftAttachments: (args) => deleteCalls.push(args),
      },
      "@/lib/chat-message-content": {
        composeMessageWithAttachments: (message, attachments) => {
          const trimmed = (message || "").trim();
          const lines = attachments.map((attachment) => `- ${attachment.relativePath}`).join("\n");
          return trimmed ? `${trimmed}\n\nAttached files:\n${lines}` : `Attached files:\n${lines}`;
        },
      },
      "@/lib/plan-brief.server": {
        saveApprovedPlanToBrief: () => null,
      },
      "@/lib/task-archive": taskArchiveStub,
      "@/lib/identity/request-principal": {
        RequestPrincipalError: class RequestPrincipalError extends Error {},
      },
      "@/lib/identity/skill-authorization": {
        requireSkillUseForRequest: async () => {},
      },
      "@/lib/permission-mode": {
        getActivePermissionMode: (requested, fallback) => requested ?? fallback,
        getExecutionPermissionMode: (requested, fallback) => requested ?? fallback,
        VALID_PERMISSION_MODES: ["bypassPermissions", "default", "plan"],
      },
      "@/lib/claude-options": claudeOptionsStub,
      "@/lib/claude-capabilities.server": { getAutoModeUnavailability: async () => null },
      "@/lib/process-manager": {
        processManager: {
          async applyPermissionState(_id, state) {
            task.permissionMode = state.permissionMode;
            task.executionPermissionMode = state.executionPermissionMode;
            return task;
          },
          async replyToTask(id, message) {
            replyCalls.push({ id, message });
            return true;
          },
          async spawnContinueTurn() {
            throw new Error("spawnContinueTurn should not run when replyToTask succeeds");
          },
        },
      },
      "@/types/chat-composer": {},
      "@/types/task": {},
      "@/types/question-spec": {
        parseQuestionSpecs: () => [],
        serializeAnswersToProse: () => "",
      },
    },
  });

  const response = await route.POST(
    {
      async json() {
        return {
          message: "Please use the attached notes",
          attachments: incomingAttachments,
          permissionMode: "default",
        };
      },
    },
    { params: Promise.resolve({ id: "task-1" }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(copyCalls, [{
    surface: "task",
    scopeId: "task-1",
    referenceId: insertedLogs[0].id,
    attachments: incomingAttachments,
  }]);
  assert.equal(
    insertedLogs[0].content,
    "Please use the attached notes\n\nAttached files:\n- .tmp/chat-drafts/sent/task/task-1/reply-1/notes.md",
  );
  assert.deepEqual(replyCalls, [{
    id: "task-1",
    message: "Please use the attached notes\n\nAttached files:\n- .tmp/chat-drafts/sent/task/task-1/reply-1/notes.md",
  }]);
  assert.deepEqual(deleteCalls, [incomingAttachments]);
  assert.deepEqual(cleanupCalls, [{ surface: "task", scopeId: "task-1" }]);
  assert.equal(task.status, "running");
  assert.equal(task.needsInput, 0);
  assert.equal(emittedEvents.length >= 2, true);
});

test("restored task reply appends history and resumes the saved conversation", async () => {
  const existingLogs = [
    {
      id: "original-user",
      taskId: "restored-task-1",
      type: "user_reply",
      content: "Original prompt",
      permissionMode: "bypassPermissions",
    },
    {
      id: "original-assistant",
      taskId: "restored-task-1",
      type: "text",
      content: "Original response",
      permissionMode: "bypassPermissions",
    },
  ];
  const logRows = existingLogs.map((entry) => ({ ...entry }));
  const replyCalls = [];
  const continueCalls = [];
  const task = {
    id: "restored-task-1",
    status: "review",
    parentId: null,
    archivedAt: null,
    needsInput: 1,
    permissionMode: "bypassPermissions",
    executionPermissionMode: "bypassPermissions",
    claudeSessionId: "session-before-archive",
    startedAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T11:00:00.000Z",
    lastReplyAt: "2026-07-22T10:05:00.000Z",
    activityLabel: null,
    errorMessage: null,
  };

  const routePath = path.resolve(__dirname, "../app/api/tasks/[id]/reply/route.ts");
  const route = loadTsModule(routePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/db": { getDb: () => createDb(task, logRows) },
      "@/lib/event-bus": { emitTaskEvent: () => {} },
      "@/lib/chat-attachment-service": {
        cleanupChatAttachmentStorage: () => {},
        copyChatAttachmentsToSent: () => [],
        deleteSourceDraftAttachments: () => {},
      },
      "@/lib/chat-message-content": {
        composeMessageWithAttachments: (message) => (message || "").trim(),
      },
      "@/lib/plan-brief.server": { saveApprovedPlanToBrief: () => null },
      "@/lib/task-archive": taskArchiveStub,
      "@/lib/identity/request-principal": {
        RequestPrincipalError: class RequestPrincipalError extends Error {},
      },
      "@/lib/identity/skill-authorization": {
        requireSkillUseForRequest: async () => {},
      },
      "@/lib/permission-mode": {
        getActivePermissionMode: (requested, fallback) => requested ?? fallback,
        getExecutionPermissionMode: (requested, fallback) => requested ?? fallback,
        VALID_PERMISSION_MODES: ["bypassPermissions", "default", "plan"],
      },
      "@/lib/claude-options": claudeOptionsStub,
      "@/lib/claude-capabilities.server": { getAutoModeUnavailability: async () => null },
      "@/lib/process-manager": {
        processManager: {
          async replyToTask(id, message) {
            replyCalls.push({ id, message });
            return false;
          },
          async spawnContinueTurn(id, message, resume) {
            continueCalls.push({ id, message, resume });
          },
        },
      },
      "@/types/chat-composer": {},
      "@/types/task": {},
      "@/types/question-spec": {
        parseQuestionSpecs: () => [],
        serializeAnswersToProse: () => "",
      },
    },
  });

  const response = await route.POST(
    {
      async json() {
        return { message: "Continue after restore" };
      },
    },
    { params: Promise.resolve({ id: task.id }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.deepEqual(logRows.slice(0, existingLogs.length), existingLogs);
  assert.equal(logRows.length, existingLogs.length + 1);
  assert.deepEqual(
    logRows.filter((entry) => entry.type === "user_reply" && entry.content === "Continue after restore"),
    [{
      id: logRows.at(-1).id,
      taskId: task.id,
      type: "user_reply",
      content: "Continue after restore",
      permissionMode: "bypassPermissions",
    }],
  );
  assert.equal(task.status, "running");
  assert.equal(task.needsInput, 0);
  assert.deepEqual(replyCalls, [{ id: task.id, message: "Continue after restore" }]);
  assert.deepEqual(continueCalls, [{
    id: task.id,
    message: "Continue after restore",
    resume: true,
  }]);
});

test("task reply route starts a backlog child task from its first chat reply", async () => {
  const insertedLogs = [];
  const cleanupCalls = [];
  const deleteCalls = [];
  const startCalls = [];
  const task = {
    id: "child-task-1",
    status: "backlog",
    parentId: "parent-task-1",
    needsInput: 0,
    permissionMode: "bypassPermissions",
    executionPermissionMode: "bypassPermissions",
    startedAt: null,
    updatedAt: "2026-06-18T20:00:00.000Z",
    lastReplyAt: null,
    activityLabel: null,
    errorMessage: null,
  };

  const routePath = path.resolve(__dirname, "../app/api/tasks/[id]/reply/route.ts");
  const route = loadTsModule(routePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/db": { getDb: () => createDb(task, insertedLogs) },
      "@/lib/event-bus": { emitTaskEvent: () => {} },
      "@/lib/chat-attachment-service": {
        cleanupChatAttachmentStorage: (args) => cleanupCalls.push(args),
        copyChatAttachmentsToSent: () => [],
        deleteSourceDraftAttachments: (args) => deleteCalls.push(args),
      },
      "@/lib/chat-message-content": {
        composeMessageWithAttachments: (message) => (message || "").trim(),
      },
      "@/lib/plan-brief.server": {
        saveApprovedPlanToBrief: () => null,
      },
      "@/lib/task-archive": taskArchiveStub,
      "@/lib/identity/request-principal": {
        RequestPrincipalError: class RequestPrincipalError extends Error {},
      },
      "@/lib/identity/skill-authorization": {
        requireSkillUseForRequest: async () => {},
      },
      "@/lib/permission-mode": {
        getActivePermissionMode: (requested, fallback) => requested ?? fallback,
        getExecutionPermissionMode: (requested, fallback) => requested ?? fallback,
        VALID_PERMISSION_MODES: ["bypassPermissions", "default", "plan"],
      },
      "@/lib/claude-options": claudeOptionsStub,
      "@/lib/claude-capabilities.server": { getAutoModeUnavailability: async () => null },
      "@/lib/process-manager": {
        processManager: {
          async applyPermissionState(_id, state) {
            task.permissionMode = state.permissionMode;
            task.executionPermissionMode = state.executionPermissionMode;
            return task;
          },
          async startBacklogTaskFromReply(id, message, options) {
            startCalls.push({ id, message, options });
            return true;
          },
          async replyToTask() {
            throw new Error("replyToTask should not run for backlog child first replies");
          },
          async spawnContinueTurn() {
            throw new Error("spawnContinueTurn should not run for backlog child first replies");
          },
        },
      },
      "@/types/chat-composer": {},
      "@/types/task": {},
      "@/types/question-spec": {
        parseQuestionSpecs: () => [],
        serializeAnswersToProse: () => "",
      },
    },
  });

  const response = await route.POST(
    {
      async json() {
        return {
          message: "Please start the HTML guide here",
          permissionMode: "default",
        };
      },
    },
    { params: Promise.resolve({ id: "child-task-1" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.action, "started");
  assert.equal(insertedLogs.length, 0);
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].id, "child-task-1");
  assert.equal(startCalls[0].message, "Please start the HTML guide here");
  assert.equal(typeof startCalls[0].options.logEntryId, "string");
  assert.equal(startCalls[0].options.permissionMode, "default");
  assert.deepEqual(deleteCalls, [[]]);
  assert.deepEqual(cleanupCalls, [{ surface: "task", scopeId: "child-task-1" }]);
});

test("task reply route still rejects top-level backlog tasks", async () => {
  const insertedLogs = [];
  const startCalls = [];
  const task = {
    id: "top-level-task-1",
    status: "backlog",
    parentId: null,
    needsInput: 0,
    permissionMode: "bypassPermissions",
    executionPermissionMode: "bypassPermissions",
  };

  const routePath = path.resolve(__dirname, "../app/api/tasks/[id]/reply/route.ts");
  const route = loadTsModule(routePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/db": { getDb: () => createDb(task, insertedLogs) },
      "@/lib/event-bus": { emitTaskEvent: () => {} },
      "@/lib/chat-attachment-service": {
        cleanupChatAttachmentStorage: () => {},
        copyChatAttachmentsToSent: () => [],
        deleteSourceDraftAttachments: () => {},
      },
      "@/lib/chat-message-content": {
        composeMessageWithAttachments: (message) => (message || "").trim(),
      },
      "@/lib/plan-brief.server": {
        saveApprovedPlanToBrief: () => null,
      },
      "@/lib/task-archive": taskArchiveStub,
      "@/lib/identity/request-principal": {
        RequestPrincipalError: class RequestPrincipalError extends Error {},
      },
      "@/lib/identity/skill-authorization": {
        requireSkillUseForRequest: async () => {},
      },
      "@/lib/permission-mode": {
        getActivePermissionMode: (requested, fallback) => requested ?? fallback,
        getExecutionPermissionMode: (requested, fallback) => requested ?? fallback,
        VALID_PERMISSION_MODES: ["bypassPermissions", "default", "plan"],
      },
      "@/lib/claude-options": claudeOptionsStub,
      "@/lib/claude-capabilities.server": { getAutoModeUnavailability: async () => null },
      "@/lib/process-manager": {
        processManager: {
          async startBacklogTaskFromReply(...args) {
            startCalls.push(args);
            return true;
          },
          async replyToTask() {
            throw new Error("replyToTask should not run for rejected backlog tasks");
          },
          async spawnContinueTurn() {
            throw new Error("spawnContinueTurn should not run for rejected backlog tasks");
          },
        },
      },
      "@/types/chat-composer": {},
      "@/types/task": {},
      "@/types/question-spec": {
        parseQuestionSpecs: () => [],
        serializeAnswersToProse: () => "",
      },
    },
  });

  const response = await route.POST(
    {
      async json() {
        return { message: "This should still be rejected" };
      },
    },
    { params: Promise.resolve({ id: "top-level-task-1" }) },
  );

  assert.equal(response.status, 409);
  assert.equal(insertedLogs.length, 0);
  assert.equal(startCalls.length, 0);
});
