const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const { loadTsModule: loadNestedTsModule } = require("./test-utils/load-ts-module.cjs");

const projectRoot = path.resolve(__dirname, "..");
const permissionModeSourcePath = path.resolve(projectRoot, "lib", "permission-mode.ts");
const planBriefSourcePath = path.resolve(projectRoot, "lib", "plan-brief.ts");
const taskPermissionsSourcePath = path.resolve(projectRoot, "lib", "task-permissions.ts");
const approvalRequestFormatSourcePath = path.resolve(projectRoot, "lib", "approval-request-format.ts");
const tasksCollectionRouteSourcePath = path.resolve(projectRoot, "app", "api", "tasks", "route.ts");
const workScopeSourcePath = path.resolve(projectRoot, "lib", "identity", "work-scope.ts");
const taskRouteSourcePath = path.resolve(projectRoot, "app", "api", "tasks", "[id]", "route.ts");
const replyRouteSourcePath = path.resolve(projectRoot, "app", "api", "tasks", "[id]", "reply", "route.ts");
const claudeOptionsStub = {
  VALID_CLAUDE_MODELS: ["haiku", "sonnet", "opus", "fable"],
  VALID_CLAUDE_THINKING_EFFORTS: ["auto", "low", "medium", "high", "xhigh", "max"],
  isClaudeThinkingEffort: (value) => ["auto", "low", "medium", "high", "xhigh", "max"].includes(value),
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
const approvalDecisionRouteSourcePath = path.resolve(
  projectRoot,
  "app",
  "api",
  "tasks",
  "[id]",
  "approval-requests",
  "[requestId]",
  "route.ts",
);

class TestRequestPrincipalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const defaultRouteStubs = {
  "@/lib/claude-capabilities.server": {
    getAutoModeUnavailability: async () => null,
  },
  "@/lib/process-manager": {
    PermissionModeControlError: class PermissionModeControlError extends Error {},
    processManager: {
      applyPermissionState: async (_taskId, _state, options = {}) => {
        options.persistAdditional?.();
      },
      hasActiveSession: () => false,
      killSession: async () => {},
    },
  },
  "@/lib/identity/request-principal": {
    RequestPrincipalError: TestRequestPrincipalError,
  },
  "@/lib/identity/skill-authorization": {
    requireSkillUseForRequest: async () => [],
  },
  "@/lib/task-list-scope": {
    validateTaskListScope: () => null,
  },
  "@/lib/task-main-chat": {
    resolveTaskHasMainChat: () => true,
  },
  "@/lib/identity/work-scope": {
    WorkScopeError: class WorkScopeError extends Error {
      constructor(code, status, message) {
        super(message);
        this.code = code;
        this.status = status;
      }
    },
    assertNoWorkScopeInput() {},
    captureNewWorkScope: async (clientId) => {
      const scope = { mode: "solo", version: 1, clientId: clientId ?? null };
      return { scope, serialized: JSON.stringify(scope), clientId: clientId ?? null };
    },
    createSoloStoredWorkScope: (clientId) => ({ mode: "solo", version: 1, clientId: clientId ?? null }),
    inheritWorkScope: (row) => {
      const scope = row.workScope && typeof row.workScope === "object"
        ? row.workScope
        : { mode: "solo", version: 1, clientId: row.clientId ?? null };
      return { scope, serialized: JSON.stringify(scope), clientId: row.clientId ?? null };
    },
    isWorkScopeError: () => false,
    normalizeWorkScopedRow: (row) => ({
      ...row,
      workScope: row.workScope && typeof row.workScope === "object"
        ? row.workScope
        : { mode: "solo", version: 1, clientId: row.clientId ?? null },
    }),
    readWorkScopeFromRow: (row) => row.workScope && typeof row.workScope === "object"
      ? row.workScope
      : { mode: "solo", version: 1, clientId: row.clientId ?? null },
    requestWithWorkScope: (request) => request,
    serializeStoredWorkScope: (scope) => JSON.stringify(scope),
    workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
  },
  "@/lib/task-archive": {
    isTaskArchived: () => false,
    isTaskTreeReadOnlyError: () => false,
  },
  "@/lib/task-permission-rules": {
    revokeTaskPermissionRules: () => 0,
    createTaskPermissionRule: () => null,
    getRuleForApprovalRequest: () => undefined,
  },
  "@/lib/config": {
    detectClientIdFromCwd: () => null,
    getClientAiOsDir: () => process.cwd(),
  },
};

function loadTsModule(sourcePath, stubs = {}) {
  const source = fs.readFileSync(sourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const module = { exports: {} };
  const mergedStubs = { ...defaultRouteStubs, ...stubs };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(mergedStubs, request)) {
      return mergedStubs[request];
    }
    if (request.startsWith("./") || request.startsWith("../")) {
      return require(path.resolve(path.dirname(sourcePath), request));
    }
    throw new Error(`Missing stub for ${request} while loading ${sourcePath}`);
  };

  const compiled = new Function("require", "module", "exports", "__dirname", "__filename", outputText);
  compiled(localRequire, module, module.exports, path.dirname(sourcePath), sourcePath);
  return module.exports;
}

function createNextServerStub() {
  class NextResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status ?? 200;
    }

    static json(body, init = {}) {
      return { body, status: init.status ?? 200 };
    }
  }

  return {
    NextResponse,
    NextRequest: class {},
  };
}

function createQuestionSpecStubs() {
  return {
    parseQuestionSpecs: (spec) => spec,
    extractQuestionSpecsFromText: (text) => {
      const match = String(text).match(/```ask-user-questions\s*\r?\n([\s\S]*?)\r?\n```/i);
      if (!match) return null;
      try {
        return { specs: JSON.parse(match[1]), matchedText: match[0] };
      } catch {
        return null;
      }
    },
    stripQuestionSpecsFromText: (text, matchedText) =>
      String(text).replace(matchedText || "", "").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function cloneTask(task) {
  return JSON.parse(JSON.stringify(task));
}

function createPatchRouteDb(task) {
  const state = { task: cloneTask(task) };

  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      return {
        get(id) {
          if (normalized.includes("SELECT * FROM tasks WHERE id = ?")) {
            return id === state.task.id ? cloneTask(state.task) : undefined;
          }
          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
        run(...args) {
          if (normalized.startsWith("UPDATE tasks SET")) {
            const taskId = args[args.length - 1];
            if (taskId !== state.task.id) return { changes: 0 };
            const setClause = normalized.slice("UPDATE tasks SET ".length, normalized.lastIndexOf(" WHERE id = ?"));
            const assignments = setClause.split(", ").map((segment) => segment.split(" = ")[0]);
            assignments.forEach((field, index) => {
              state.task[field] = args[index];
            });
            return { changes: 1 };
          }
          throw new Error(`Unhandled run SQL: ${normalized}`);
        },
        all() {
          return [];
        },
      };
    },
  };
}

function createCreateTaskRouteDb() {
  const state = { inserted: null };

  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      return {
        get() {
          if (normalized.includes("SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE status = 'queued'")) {
            return { minOrder: 1 };
          }
          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
        run(...args) {
          if (normalized.startsWith("INSERT INTO tasks")) {
            state.inserted = {
              id: args[0],
              title: args[1],
              description: args[2],
              status: args[3],
              level: args[4],
              clientId: args[17],
              workScope: args[18],
              permissionMode: args[23],
              executionPermissionMode: args[24],
              model: args[25],
              thinkingEffort: args[26],
            };
            return { changes: 1 };
          }
          throw new Error(`Unhandled run SQL: ${normalized}`);
        },
        all() {
          return [];
        },
      };
    },
  };
}

function createReplyRouteDb(task, pendingQuestionSpec = null) {
  const state = {
    task: cloneTask(task),
    pendingQuestionSpec,
    logs: [],
    answeredQuestions: [],
  };

  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      return {
        get(...args) {
          if (normalized.includes("SELECT * FROM tasks WHERE id = ?")) {
            return args[0] === state.task.id ? cloneTask(state.task) : undefined;
          }
          if (
            normalized.includes("SELECT id, questionSpec FROM task_logs") &&
            normalized.includes("LIMIT 1")
          ) {
            return state.pendingQuestionSpec
              ? { id: "pending-question", questionSpec: JSON.stringify(state.pendingQuestionSpec) }
              : undefined;
          }
          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
        run(...args) {
          if (normalized === "UPDATE task_logs SET questionAnswers = ? WHERE id = ?") {
            state.answeredQuestions.push({ answers: args[0], id: args[1] });
            return { changes: 1 };
          }

          if (normalized.startsWith("INSERT INTO task_logs")) {
            state.logs.push(args);
            return { changes: 1 };
          }

          if (normalized === "UPDATE tasks SET model = NULL WHERE id = ?") {
            state.task.model = null;
            return { changes: 1 };
          }

          if (normalized === "UPDATE tasks SET model = ? WHERE id = ?") {
            state.task.model = args[0];
            return { changes: 1 };
          }

          if (normalized === "UPDATE tasks SET thinkingEffort = NULL WHERE id = ?") {
            state.task.thinkingEffort = null;
            return { changes: 1 };
          }

          if (normalized === "UPDATE tasks SET thinkingEffort = ? WHERE id = ?") {
            state.task.thinkingEffort = args[0];
            return { changes: 1 };
          }

          if (normalized === "UPDATE tasks SET permissionMode = ?, executionPermissionMode = ? WHERE id = ?") {
            state.task.permissionMode = args[0];
            state.task.executionPermissionMode = args[1];
            return { changes: 1 };
          }

          if (normalized === "UPDATE tasks SET executionPermissionMode = ? WHERE id = ?") {
            state.task.executionPermissionMode = args[0];
            return { changes: 1 };
          }

          if (
            normalized ===
            "UPDATE tasks SET status = 'review', permissionMode = ?, executionPermissionMode = ?, updatedAt = ?, lastReplyAt = ?, activityLabel = ?, needsInput = 0 WHERE id = ?"
          ) {
            state.task.status = "review";
            state.task.permissionMode = args[0];
            state.task.executionPermissionMode = args[1];
            state.task.updatedAt = args[2];
            state.task.lastReplyAt = args[3];
            state.task.activityLabel = args[4];
            state.task.needsInput = 0;
            return { changes: 1 };
          }

          if (
            normalized ===
            "UPDATE tasks SET status = 'review', updatedAt = ?, lastReplyAt = ?, activityLabel = ?, needsInput = 0 WHERE id = ?"
          ) {
            state.task.status = "review";
            state.task.updatedAt = args[0];
            state.task.lastReplyAt = args[1];
            state.task.activityLabel = args[2];
            state.task.needsInput = 0;
            return { changes: 1 };
          }

          if (
            normalized ===
            "UPDATE tasks SET status = 'running', updatedAt = ?, lastReplyAt = ?, activityLabel = ?, needsInput = 0, errorMessage = NULL, startedAt = COALESCE(startedAt, ?) WHERE id = ?"
          ) {
            state.task.status = "running";
            state.task.updatedAt = args[0];
            state.task.lastReplyAt = args[1];
            state.task.activityLabel = args[2];
            state.task.needsInput = 0;
            state.task.errorMessage = null;
            state.task.startedAt = state.task.startedAt ?? args[3];
            return { changes: 1 };
          }

          throw new Error(`Unhandled run SQL: ${normalized}`);
        },
      };
    },
  };
}

function createApprovalDecisionDb(task) {
  const state = { task: cloneTask(task) };

  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      return {
        get(id) {
          if (normalized.includes("SELECT * FROM tasks WHERE id = ?")) {
            return id === state.task.id ? cloneTask(state.task) : undefined;
          }
          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
        run(...args) {
          if (
            normalized ===
            "UPDATE tasks SET permissionMode = 'bypassPermissions', executionPermissionMode = 'bypassPermissions', updatedAt = ?, activityLabel = ?, needsInput = 0, errorMessage = NULL WHERE id = ?"
          ) {
            state.task.permissionMode = "bypassPermissions";
            state.task.executionPermissionMode = "bypassPermissions";
            state.task.updatedAt = args[0];
            state.task.activityLabel = args[1];
            state.task.needsInput = 0;
            state.task.errorMessage = null;
            return { changes: 1 };
          }

          if (
            normalized ===
            "UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 0, errorMessage = NULL WHERE id = ?"
          ) {
            state.task.updatedAt = args[0];
            state.task.activityLabel = args[1];
            state.task.needsInput = 0;
            state.task.errorMessage = null;
            return { changes: 1 };
          }

          if (
            normalized ===
            "UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = ?, errorMessage = NULL WHERE id = ?"
          ) {
            state.task.updatedAt = args[0];
            state.task.activityLabel = args[1];
            state.task.needsInput = args[2];
            state.task.errorMessage = null;
            return { changes: 1 };
          }

          if (
            normalized ===
            "UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 1 WHERE id = ?"
          ) {
            state.task.updatedAt = args[0];
            state.task.activityLabel = args[1];
            state.task.needsInput = 1;
            return { changes: 1 };
          }

          throw new Error(`Unhandled run SQL: ${normalized}`);
        },
        all() {
          return [];
        },
      };
    },
  };
}

test("stripApprovedBriefBlockFromText hides the raw brief block but keeps the summary text", () => {
  const planBrief = loadTsModule(planBriefSourcePath, {
    "@/types/question-spec": createQuestionSpecStubs(),
  });

  const cleaned = planBrief.stripApprovedBriefBlockFromText(
    "Here is the plan summary.\n\n```approved-brief\n---\nproject: demo\n---\n# Real plan\n```\n\nTell me what to change.",
  );

  assert.equal(cleaned, "Here is the plan summary.\n\nTell me what to change.");
});

test("extractApprovedBriefBlockFromLogs keeps nested triple-backtick sections inside approved-brief", () => {
  const planBrief = loadTsModule(planBriefSourcePath, {
    "@/types/question-spec": createQuestionSpecStubs(),
  });

  const logEntries = [
    {
      id: "text-nested",
      type: "text",
      timestamp: "2026-04-17T18:00:00.000Z",
      content:
        "Summary first.\n\n```approved-brief\n# Test File Edit — Mock Plan\n\n## Current Content\n```\n# Test File\n\nHello\n```\n\n## Proposed New Content\n```markdown\n# Test File\n\nUpdated\n```\n\n## Steps\n1. Read\n2. Edit\n3. Verify\n```",
    },
  ];

  assert.equal(
    planBrief.extractApprovedBriefBlockFromLogs(logEntries),
    "# Test File Edit — Mock Plan\n\n## Current Content\n```\n# Test File\n\nHello\n```\n\n## Proposed New Content\n```markdown\n# Test File\n\nUpdated\n```\n\n## Steps\n1. Read\n2. Edit\n3. Verify",
  );
});

test("getPendingPlanReviewData reconstructs a streamed approved brief across multiple text entries", () => {
  const planBrief = loadTsModule(planBriefSourcePath, {
    "@/types/question-spec": createQuestionSpecStubs(),
  });

  const logEntries = [
    { id: "user-1", type: "user_reply", timestamp: "2026-04-17T18:00:00.000Z", content: "Plan this out" },
    {
      id: "text-1",
      type: "text",
      timestamp: "2026-04-17T18:00:01.000Z",
      content: "Here is the plan summary.\n\n```approved-brief",
    },
    {
      id: "text-2",
      type: "text",
      timestamp: "2026-04-17T18:00:02.000Z",
      content: "---\nproject: demo\nstatus: active",
    },
    {
      id: "text-3",
      type: "text",
      timestamp: "2026-04-17T18:00:03.000Z",
      content: "---\n# Real plan\n\n## Deliverables\n- first item\n```",
    },
    {
      id: "question-1",
      type: "structured_question",
      timestamp: "2026-04-17T18:00:04.000Z",
      content: "",
      questionSpec: JSON.stringify([
        {
          id: "plan_action",
          prompt: "The plan is ready. What should I do next?",
          type: "select",
          options: ["Approve and start", "Ask for changes", "Cancel"],
          intent: "plan_approval",
        },
      ]),
    },
  ];

  const review = planBrief.getPendingPlanReviewData(logEntries);

  assert.equal(
    review.briefContent,
    "---\nproject: demo\nstatus: active\n---\n# Real plan\n\n## Deliverables\n- first item",
  );
  assert.equal(review.summaryText, "Here is the plan summary.");
  assert.deepEqual(review.turnTextEntryIds, ["text-1", "text-2", "text-3"]);
});

test("getPendingPlanReviewData excludes an inline ask-user-questions block from the brief body", () => {
  const planBrief = loadTsModule(planBriefSourcePath, {
    "@/types/question-spec": createQuestionSpecStubs(),
  });

  const logEntries = [
    { id: "user-1", type: "user_reply", timestamp: "2026-04-17T18:00:00.000Z", content: "Plan this out" },
    {
      id: "text-1",
      type: "text",
      timestamp: "2026-04-17T18:00:01.000Z",
      content:
        "Summary.\n\n```approved-brief\n# Plan body\n\n```markdown\nhello\n```\n```\n\n```ask-user-questions\n[{\"id\":\"plan_action\",\"prompt\":\"Next?\",\"type\":\"select\",\"options\":[\"Approve and start\"],\"intent\":\"plan_approval\"}]\n```",
    },
    {
      id: "question-1",
      type: "structured_question",
      timestamp: "2026-04-17T18:00:02.000Z",
      content: "",
      questionSpec: JSON.stringify([
        {
          id: "plan_action",
          prompt: "Next?",
          type: "select",
          options: ["Approve and start"],
          intent: "plan_approval",
        },
      ]),
    },
  ];

  const review = planBrief.getPendingPlanReviewData(logEntries);

  assert.equal(review.briefContent, "# Plan body\n\n```markdown\nhello\n```");
  assert.equal(review.summaryText, "Summary.");
});

test("extractPendingApprovedBriefFromLogs stays inside the latest pending plan turn", () => {
  const planBrief = loadTsModule(planBriefSourcePath, {
    "@/types/question-spec": createQuestionSpecStubs(),
  });

  const logEntries = [
    { id: "user-old", type: "user_reply", timestamp: "2026-04-17T17:00:00.000Z", content: "Old request" },
    {
      id: "text-old",
      type: "text",
      timestamp: "2026-04-17T17:00:01.000Z",
      content: "Old summary\n\n```approved-brief\n# Old plan\n```",
    },
    {
      id: "question-old",
      type: "structured_question",
      timestamp: "2026-04-17T17:00:02.000Z",
      content: "",
      questionSpec: JSON.stringify([
        {
          id: "plan_action",
          prompt: "The old plan is ready.",
          type: "select",
          options: ["Approve and start"],
          intent: "plan_approval",
        },
      ]),
      questionAnswers: JSON.stringify({ plan_action: "Ask for changes" }),
    },
    { id: "user-new", type: "user_reply", timestamp: "2026-04-17T18:00:00.000Z", content: "New request" },
    {
      id: "text-new-1",
      type: "text",
      timestamp: "2026-04-17T18:00:01.000Z",
      content: "New summary\n\n```approved-brief",
    },
    {
      id: "text-new-2",
      type: "text",
      timestamp: "2026-04-17T18:00:02.000Z",
      content: "# New plan\n```",
    },
    {
      id: "question-new",
      type: "structured_question",
      timestamp: "2026-04-17T18:00:03.000Z",
      content: "",
      questionSpec: JSON.stringify([
        {
          id: "plan_action",
          prompt: "The new plan is ready.",
          type: "select",
          options: ["Approve and start"],
          intent: "plan_approval",
        },
      ]),
    },
  ];

  assert.equal(planBrief.extractPendingApprovedBriefFromLogs(logEntries), "# New plan");
});

test("getPermissionStateForPickerChange exits plan mode immediately", () => {
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });

  const nextState = permissionMode.getPermissionStateForPickerChange(
    "default",
    "plan",
    "bypassPermissions",
    "bypassPermissions",
  );

  assert.deepEqual(nextState, {
    permissionMode: "default",
    executionPermissionMode: "default",
  });
});

test("isTaskWaitingOnPermission only treats real pending permission states as waiting", () => {
  const taskPermissions = loadTsModule(taskPermissionsSourcePath);

  assert.equal(
    taskPermissions.isTaskWaitingOnPermission({
      needsInput: true,
      activityLabel: "Permission approved",
      errorMessage: null,
    }),
    false,
  );

  assert.equal(
    taskPermissions.isTaskWaitingOnPermission({
      needsInput: true,
      activityLabel: "Needs permission",
      errorMessage: null,
    }),
    true,
  );
});

test("getApprovalRequestDisplay keeps a compact summary and a full Bash command", () => {
  const approvalRequestFormat = loadTsModule(approvalRequestFormatSourcePath);
  const display = approvalRequestFormat.getApprovalRequestDisplay({
    toolName: "Bash",
    inputJson: JSON.stringify({
      command: "pnpm exec node scripts/run-something-with-a-very-long-command-name.js --flag alpha --flag beta --flag gamma",
    }),
  });

  assert.equal(display.detailLabel, "full command");
  assert.match(display.summary, /^Claude wants to run a command:/);
  assert.match(display.detailText, /very-long-command-name/);
  assert.match(display.detailText, /--flag gamma/);
});

test("POST /api/tasks normalizes thinking effort for the selected model on first create", async () => {
  const db = createCreateTaskRouteDb();
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const route = loadTsModule(tasksCollectionRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/config": { detectClientIdFromCwd: () => null },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": {
      PermissionModeControlError: class PermissionModeControlError extends Error {},
      processManager: {
        hasActiveSession: () => false,
        killSession: async () => {},
        applyPermissionState: async (_taskId, state) => {
          db.state.task.permissionMode = state.permissionMode;
          db.state.task.executionPermissionMode = state.executionPermissionMode;
          return db.state.task;
        },
      },
    },
  });

  const response = await route.POST({
    json: async () => ({
      title: "Test task",
      description: "Keep haiku selected",
      level: "task",
      model: "haiku",
      thinkingEffort: "high",
    }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.model, "haiku");
  assert.equal(response.body.thinkingEffort, "auto");
  assert.equal(db.state.inserted.model, "haiku");
  assert.equal(db.state.inserted.thinkingEffort, "auto");
});

test("POST /api/tasks creates Team work after consuming the incoming request body", async () => {
  const db = createCreateTaskRouteDb();
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const teamProfile = {
    version: 1,
    mode: "team",
    profileKey: "profile-a",
    identity: { version: 1, serverId: "server-1", userId: "user-1" },
    dataDir: "C:/profiles/a",
    stateDir: "C:/profiles/a",
    tempDir: "C:/profiles/a/tmp",
    dbPath: "C:/profiles/a/command-centre.db",
  };
  const workScope = loadNestedTsModule(workScopeSourcePath, {
    stubs: {
      "next/server": { NextRequest },
      "@/lib/clients": {
        normalizeClientId: (value) => value == null || value === "" || value === "root" ? null : value,
      },
      "@/lib/db": {
        getActiveLocalProfileDescriptor: () => teamProfile,
      },
      "@/lib/local-profile": {},
      "@/lib/team-api-context": {
        readTeamContext: async () => ({
          serverId: "server-1",
          user: { id: "user-1" },
          selectedTeamId: "team-a",
          teams: [{ id: "team-a" }],
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      },
    },
  });
  let authorizationRequest = null;
  const route = loadTsModule(tasksCollectionRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/config": { detectClientIdFromCwd: () => null },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/identity/work-scope": workScope,
    "@/lib/identity/skill-authorization": {
      requireSkillUseForRequest: async (request) => {
        authorizationRequest = request;
        return [];
      },
    },
    "@/lib/process-manager": {
      PermissionModeControlError: class PermissionModeControlError extends Error {},
      processManager: {
        hasActiveSession: () => false,
        killSession: async () => {},
        applyPermissionState: async (_taskId, state) => {
          db.state.task.permissionMode = state.permissionMode;
          db.state.task.executionPermissionMode = state.executionPermissionMode;
          return db.state.task;
        },
      },
    },
  });
  const request = new NextRequest("http://localhost:3001/api/tasks?source=new-goal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "team-session=active",
      "x-ai-team-id": "browser-forged-team",
    },
    body: JSON.stringify({
      title: "Team goal",
      description: "Create this goal in Team mode",
      level: "task",
    }),
  });

  const response = await route.POST(request);

  assert.equal(response.status, 201);
  assert.equal(request.bodyUsed, true);
  assert.ok(authorizationRequest);
  assert.equal(authorizationRequest.url, request.url);
  assert.equal(authorizationRequest.method, "POST");
  assert.equal(authorizationRequest.headers.get("cookie"), "team-session=active");
  assert.equal(authorizationRequest.headers.get("x-ai-team-id"), "team-a");
  assert.equal(authorizationRequest.body, null);
  assert.equal(db.state.inserted.title, "Team goal");
  assert.deepEqual(JSON.parse(db.state.inserted.workScope), {
    mode: "team",
    scope: {
      version: 1,
      serverId: "server-1",
      userId: "user-1",
      teamId: "team-a",
      clientId: null,
    },
  });
});

test("POST /api/tasks can infer client scope from cwd", async () => {
  const db = createCreateTaskRouteDb();
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const route = loadTsModule(tasksCollectionRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/config": {
      detectClientIdFromCwd: (cwd) => String(cwd).includes("clients/acme") ? "acme" : null,
    },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": {
      PermissionModeControlError: class PermissionModeControlError extends Error {},
      processManager: {
        hasActiveSession: () => false,
        killSession: async () => {},
        applyPermissionState: async (_taskId, state) => {
          db.state.task.permissionMode = state.permissionMode;
          db.state.task.executionPermissionMode = state.executionPermissionMode;
          return db.state.task;
        },
      },
    },
  });

  const response = await route.POST({
    json: async () => ({
      title: "Client task",
      description: "Created from inside a client folder",
      level: "task",
      cwd: "workspace/clients/acme/context",
    }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.clientId, "acme");
  assert.equal(db.state.inserted.clientId, "acme");
});

test("POST /api/tasks accepts Fable and custom Claude model IDs", async () => {
  const db = createCreateTaskRouteDb();
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const route = loadTsModule(tasksCollectionRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/config": { detectClientIdFromCwd: () => null },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": { processManager: { hasActiveSession: () => false, killSession: async () => {} } },
  });

  const fableResponse = await route.POST({
    json: async () => ({
      title: "Fable task",
      description: "Use Fable",
      level: "task",
      model: " Fable ",
      thinkingEffort: "xhigh",
    }),
  });

  assert.equal(fableResponse.status, 201);
  assert.equal(fableResponse.body.model, "fable");
  assert.equal(fableResponse.body.thinkingEffort, "xhigh");
  assert.equal(db.state.inserted.model, "fable");

  const customDb = createCreateTaskRouteDb();
  const customRoute = loadTsModule(tasksCollectionRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => customDb },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/config": { detectClientIdFromCwd: () => null },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": { processManager: { hasActiveSession: () => false, killSession: async () => {} } },
  });

  const customResponse = await customRoute.POST({
    json: async () => ({
      title: "Custom model task",
      description: "Use a full model ID",
      level: "task",
      model: "claude-fable-5",
      thinkingEffort: "xhigh",
    }),
  });

  assert.equal(customResponse.status, 201);
  assert.equal(customResponse.body.model, "claude-fable-5");
  assert.equal(customResponse.body.thinkingEffort, "xhigh");
  assert.equal(customDb.state.inserted.model, "claude-fable-5");
});

test("POST /api/tasks rejects invalid thinking effort", async () => {
  const db = createCreateTaskRouteDb();
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const route = loadTsModule(tasksCollectionRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/clients": { assertValidClientId: (value) => value ?? null },
    "@/lib/config": { detectClientIdFromCwd: () => null },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": { processManager: { hasActiveSession: () => false, killSession: async () => {} } },
  });

  const response = await route.POST({
    json: async () => ({
      title: "Test task",
      description: "Invalid effort",
      level: "task",
      thinkingEffort: "turbo",
    }),
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /thinkingEffort/);
  assert.equal(db.state.inserted, null);
});

test("PATCH /api/tasks/[id] normalizes thinking effort when model changes and exits plan mode cleanly", async () => {
  const db = createPatchRouteDb({
    id: "task-patch",
    status: "review",
    permissionMode: "plan",
    executionPermissionMode: "bypassPermissions",
    model: null,
    updatedAt: "2026-04-17T00:00:00.000Z",
  });
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const route = loadTsModule(taskRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": {
      PermissionModeControlError: class PermissionModeControlError extends Error {},
      processManager: {
        hasActiveSession: () => false,
        killSession: async () => {},
        applyPermissionState: async (_taskId, state) => {
          db.state.task.permissionMode = state.permissionMode;
          db.state.task.executionPermissionMode = state.executionPermissionMode;
          return db.state.task;
        },
      },
    },
  });

  const response = await route.PATCH(
    { json: async () => ({ permissionMode: "default", model: "haiku", thinkingEffort: "high" }) },
    { params: Promise.resolve({ id: "task-patch" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(db.state.task.permissionMode, "default");
  assert.equal(db.state.task.executionPermissionMode, "default");
  assert.equal(db.state.task.model, "haiku");
  assert.equal(db.state.task.thinkingEffort, "auto");
});

test("PATCH /api/tasks/[id] clears stale input state when marking done", async () => {
  const db = createPatchRouteDb({
    id: "task-done-cleanup",
    status: "review",
    permissionMode: "default",
    executionPermissionMode: "default",
    model: null,
    thinkingEffort: null,
    needsInput: 1,
    errorMessage: "Claude needs your input",
    activityLabel: "Waiting for your answer",
    startedAt: null,
    completedAt: null,
    parentId: null,
    projectSlug: null,
    updatedAt: "2026-04-17T00:00:00.000Z",
  });
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  let emittedEvent = null;
  const route = loadTsModule(taskRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/event-bus": { emitTaskEvent: (event) => { emittedEvent = event; } },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": { processManager: { hasActiveSession: () => false, killSession: async () => {} } },
  });

  const response = await route.PATCH(
    { json: async () => ({ status: "done" }) },
    { params: Promise.resolve({ id: "task-done-cleanup" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(db.state.task.status, "done");
  assert.equal(db.state.task.needsInput, 0);
  assert.equal(db.state.task.errorMessage, null);
  assert.equal(db.state.task.activityLabel, null);
  assert.ok(db.state.task.startedAt);
  assert.ok(db.state.task.completedAt);
  assert.equal(response.body.needsInput, false);
  assert.equal(response.body.errorMessage, null);
  assert.equal(response.body.activityLabel, null);
  assert.equal(emittedEvent.task.needsInput, false);
});

test("PATCH /api/tasks/[id] rejects invalid thinking effort", async () => {
  const db = createPatchRouteDb({
    id: "task-invalid-effort",
    status: "review",
    permissionMode: "default",
    executionPermissionMode: "default",
    thinkingEffort: null,
    updatedAt: "2026-04-17T00:00:00.000Z",
  });
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const route = loadTsModule(taskRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": { processManager: { hasActiveSession: () => false, killSession: async () => {} } },
  });

  const response = await route.PATCH(
    { json: async () => ({ thinkingEffort: "turbo" }) },
    { params: Promise.resolve({ id: "task-invalid-effort" }) },
  );

  assert.equal(response.status, 400);
  assert.match(response.body.error, /thinkingEffort/);
});

test("POST /api/tasks/[id]/approval-requests/[requestId] clears needsInput after approval", async () => {
  const db = createApprovalDecisionDb({
    id: "task-approval",
    status: "running",
    permissionMode: "default",
    executionPermissionMode: "default",
    needsInput: 1,
    activityLabel: "Needs permission",
    errorMessage: null,
    updatedAt: "2026-04-17T00:00:00.000Z",
  });
  const nextServer = createNextServerStub();
  const taskPermissions = loadTsModule(taskPermissionsSourcePath);
  const route = loadTsModule(approvalDecisionRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/approval-requests": {
      getApprovalRequest: () => ({ id: "request-1", taskId: "task-approval", status: "pending" }),
      resolveApprovalRequest: () => ({ id: "request-1", taskId: "task-approval", status: "approved" }),
      getPendingApprovalCount: () => 0,
    },
    "@/lib/task-permissions": taskPermissions,
  });

  const response = await route.POST(
    { json: async () => ({ decision: "allow_once" }) },
    { params: Promise.resolve({ id: "task-approval", requestId: "request-1" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(db.state.task.needsInput, 0);
  assert.equal(db.state.task.activityLabel, taskPermissions.PERMISSION_RESUMING_ACTIVITY_LABEL);
  assert.equal(response.body.task.needsInput, false);
});

test("POST /api/tasks/[id]/reply normalizes thinking effort with model changes and resumes the task", async () => {
  const db = createReplyRouteDb({
    id: "task-reply-model",
    status: "review",
    permissionMode: "default",
    executionPermissionMode: "default",
    model: null,
    thinkingEffort: null,
    needsInput: 1,
    updatedAt: "2026-04-17T00:00:00.000Z",
    lastReplyAt: null,
    startedAt: null,
    errorMessage: null,
  });
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  let replyMessage = null;
  const route = loadTsModule(replyRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/chat-attachment-service": {
      cleanupChatAttachmentStorage: () => {},
      copyChatAttachmentsToSent: () => [],
      deleteSourceDraftAttachments: () => {},
    },
    "@/lib/chat-message-content": { composeMessageWithAttachments: (message) => message },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/plan-brief.server": { saveApprovedPlanToBrief: () => null },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": {
      processManager: {
        replyToTask: async (_taskId, message) => {
          replyMessage = message;
          return true;
        },
        spawnContinueTurn: async () => {},
      },
    },
    "@/types/question-spec": {
      parseQuestionSpecs: (spec) => spec,
      serializeAnswersToProse: () => "",
    },
  });

  const response = await route.POST(
    { json: async () => ({ message: "Keep going", model: "haiku", thinkingEffort: "high" }) },
    { params: Promise.resolve({ id: "task-reply-model" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(db.state.task.model, "haiku");
  assert.equal(db.state.task.thinkingEffort, "auto");
  assert.equal(db.state.task.status, "running");
  assert.equal(replyMessage, "Keep going");
});

test("POST /api/tasks/[id]/reply ignores duplicate structured answer prose supplied as message", async () => {
  const structuredText = "Here are my answers:\n\n1. Pick a color\n   → Blue";
  const db = createReplyRouteDb(
    {
      id: "task-structured-duplicate",
      status: "review",
      permissionMode: "default",
      executionPermissionMode: "default",
      model: null,
      thinkingEffort: null,
      needsInput: 1,
      updatedAt: "2026-04-17T00:00:00.000Z",
      lastReplyAt: null,
      startedAt: null,
      errorMessage: null,
    },
    [
      {
        id: "color",
        prompt: "Pick a color",
        type: "text",
        required: true,
      },
    ],
  );
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  let replyMessage = null;
  const route = loadTsModule(replyRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/chat-attachment-service": {
      cleanupChatAttachmentStorage: () => {},
      copyChatAttachmentsToSent: () => [],
      deleteSourceDraftAttachments: () => {},
    },
    "@/lib/chat-message-content": { composeMessageWithAttachments: (message) => message },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/plan-brief.server": { saveApprovedPlanToBrief: () => null },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": {
      processManager: {
        replyToTask: async (_taskId, message) => {
          replyMessage = message;
          return true;
        },
        spawnContinueTurn: async () => {},
      },
    },
    "@/types/question-spec": {
      parseQuestionSpecs: (spec) => spec,
      serializeAnswersToProse: () => structuredText,
    },
  });

  const response = await route.POST(
    {
      json: async () => ({
        message: structuredText,
        structuredAnswers: { color: "Blue" },
      }),
    },
    { params: Promise.resolve({ id: "task-structured-duplicate" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(replyMessage, structuredText);
  assert.equal(db.state.logs[0][4], structuredText);
  assert.deepEqual(db.state.answeredQuestions, [
    { answers: JSON.stringify({ color: "Blue" }), id: "pending-question" },
  ]);
});

test("POST /api/tasks/[id]/reply keeps real notes with structured answers", async () => {
  const structuredText = "Here are my answers:\n\n1. Pick a color\n   → Blue";
  const note = "Please keep it short.";
  const expected = `${structuredText}\n\nAdditional note:\n${note}`;
  const db = createReplyRouteDb(
    {
      id: "task-structured-note",
      status: "review",
      permissionMode: "default",
      executionPermissionMode: "default",
      model: null,
      thinkingEffort: null,
      needsInput: 1,
      updatedAt: "2026-04-17T00:00:00.000Z",
      lastReplyAt: null,
      startedAt: null,
      errorMessage: null,
    },
    [
      {
        id: "color",
        prompt: "Pick a color",
        type: "text",
        required: true,
      },
    ],
  );
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  let replyMessage = null;
  const route = loadTsModule(replyRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/chat-attachment-service": {
      cleanupChatAttachmentStorage: () => {},
      copyChatAttachmentsToSent: () => [],
      deleteSourceDraftAttachments: () => {},
    },
    "@/lib/chat-message-content": { composeMessageWithAttachments: (message) => message },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/plan-brief.server": { saveApprovedPlanToBrief: () => null },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": {
      processManager: {
        replyToTask: async (_taskId, message) => {
          replyMessage = message;
          return true;
        },
        spawnContinueTurn: async () => {},
      },
    },
    "@/types/question-spec": {
      parseQuestionSpecs: (spec) => spec,
      serializeAnswersToProse: () => structuredText,
    },
  });

  const response = await route.POST(
    {
      json: async () => ({
        message: note,
        structuredAnswers: { color: "Blue" },
      }),
    },
    { params: Promise.resolve({ id: "task-structured-note" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(replyMessage, expected);
  assert.equal(db.state.logs[0][4], expected);
});

test("POST /api/tasks/[id]/reply rejects invalid thinking effort", async () => {
  const db = createReplyRouteDb({
    id: "task-reply-invalid-effort",
    status: "review",
    permissionMode: "default",
    executionPermissionMode: "default",
    model: null,
    thinkingEffort: null,
    needsInput: 1,
    updatedAt: "2026-04-17T00:00:00.000Z",
    lastReplyAt: null,
    startedAt: null,
    errorMessage: null,
  });
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const route = loadTsModule(replyRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/chat-attachment-service": {
      cleanupChatAttachmentStorage: () => {},
      copyChatAttachmentsToSent: () => [],
      deleteSourceDraftAttachments: () => {},
    },
    "@/lib/chat-message-content": { composeMessageWithAttachments: (message) => message },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/plan-brief.server": { saveApprovedPlanToBrief: () => null },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": {
      PermissionModeControlError: class PermissionModeControlError extends Error {},
      processManager: {
        applyPermissionState: async (_taskId, state) => {
          db.state.task.permissionMode = state.permissionMode;
          db.state.task.executionPermissionMode = state.executionPermissionMode;
          return db.state.task;
        },
        replyToTask: async () => true,
        spawnContinueTurn: async () => {},
      },
    },
    "@/types/question-spec": {
      parseQuestionSpecs: (spec) => spec,
      serializeAnswersToProse: () => "",
    },
  });

  const response = await route.POST(
    { json: async () => ({ message: "Keep going", thinkingEffort: "turbo" }) },
    { params: Promise.resolve({ id: "task-reply-invalid-effort" }) },
  );

  assert.equal(response.status, 400);
  assert.match(response.body.error, /thinkingEffort/);
  assert.equal(db.state.logs.length, 0);
});

test("POST /api/tasks/[id]/reply cancel exits plan mode and restores the staged execution mode", async () => {
  const db = createReplyRouteDb(
    {
      id: "task-plan-cancel",
      status: "review",
      permissionMode: "plan",
      executionPermissionMode: "default",
      model: "haiku",
      needsInput: 1,
      updatedAt: "2026-04-17T00:00:00.000Z",
      lastReplyAt: null,
      startedAt: null,
      errorMessage: null,
    },
    [
      {
        id: "plan_action",
        prompt: "The plan is ready. What should I do next?",
        type: "select",
        options: ["Approve and start", "Ask for changes", "Cancel"],
        required: true,
        intent: "plan_approval",
      },
    ],
  );
  const nextServer = createNextServerStub();
  const permissionMode = loadTsModule(permissionModeSourcePath, {
    "@/types/task": {},
  });
  const route = loadTsModule(replyRouteSourcePath, {
    "next/server": nextServer,
    "@/lib/db": { getDb: () => db },
    "@/lib/chat-attachment-service": {
      cleanupChatAttachmentStorage: () => {},
      copyChatAttachmentsToSent: () => [],
      deleteSourceDraftAttachments: () => {},
    },
    "@/lib/chat-message-content": { composeMessageWithAttachments: (message) => message },
    "@/lib/event-bus": { emitTaskEvent: () => {} },
    "@/lib/plan-brief.server": { saveApprovedPlanToBrief: () => null },
    "@/lib/permission-mode": permissionMode,
    "@/lib/claude-options": claudeOptionsStub,
    "@/lib/process-manager": {
      PermissionModeControlError: class PermissionModeControlError extends Error {},
      processManager: {
        applyPermissionState: async (_taskId, state) => {
          db.state.task.permissionMode = state.permissionMode;
          db.state.task.executionPermissionMode = state.executionPermissionMode;
          return db.state.task;
        },
        replyToTask: async () => true,
        spawnContinueTurn: async () => {},
      },
    },
    "@/types/question-spec": {
      parseQuestionSpecs: (spec) => spec,
      serializeAnswersToProse: () => "plan_action: Cancel",
    },
  });

  const response = await route.POST(
    { json: async () => ({ structuredAnswers: { plan_action: "Cancel" } }) },
    { params: Promise.resolve({ id: "task-plan-cancel" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.action, "canceled");
  assert.equal(db.state.task.status, "review");
  assert.equal(db.state.task.permissionMode, "default");
  assert.equal(db.state.task.executionPermissionMode, "default");
});
