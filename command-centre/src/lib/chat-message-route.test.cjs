const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

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

function createDb() {
  const state = {
    conversation: {
      id: "conversation-1",
      title: null,
      status: "active",
      clientId: null,
      workScope: JSON.stringify({
        mode: "team",
        scope: { version: 1, serverId: "server-1", userId: "user-1", teamId: "team-a", clientId: null },
      }),
    },
    messages: [],
    insertedTask: null,
  };

  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      return {
        get(...args) {
          if (normalized === "SELECT * FROM conversations WHERE id = ?") {
            return args[0] === state.conversation.id ? state.conversation : undefined;
          }
          if (normalized === "SELECT COUNT(*) as count FROM messages WHERE conversationId = ? AND role = 'user'") {
            return { count: 1 };
          }
          if (normalized.startsWith("SELECT * FROM tasks WHERE conversationId = ?")) {
            return undefined;
          }
          throw new Error(`Unhandled get SQL: ${normalized}`);
        },
        run(...args) {
          if (normalized.startsWith("INSERT INTO messages")) {
            state.messages.push(args);
            return { changes: 1 };
          }
          if (normalized === "UPDATE conversations SET title = ?, updatedAt = ? WHERE id = ?") {
            state.conversation.title = args[0];
            state.conversation.updatedAt = args[1];
            return { changes: 1 };
          }
          if (normalized === "UPDATE conversations SET updatedAt = ? WHERE id = ?") {
            state.conversation.updatedAt = args[0];
            return { changes: 1 };
          }
          if (normalized.startsWith("INSERT INTO tasks")) {
            state.insertedTask = {
              id: args[0],
              title: args[1],
              description: args[2],
              status: args[3],
              clientId: args[10],
              workScope: args[11],
              permissionMode: args[13],
              executionPermissionMode: args[14],
              model: args[15],
              thinkingEffort: args[16],
              conversationId: args[17],
              originMessageId: args[18],
            };
            return { changes: 1 };
          }
          throw new Error(`Unhandled run SQL: ${normalized}`);
        },
      };
    },
  };
}

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

function loadRoute(db = createDb(), getAutoModeUnavailability = async () => null) {
  const routePath = path.resolve(__dirname, "../app/api/chat/message/route.ts");
  return {
    db,
    route: loadTsModule(routePath, {
      stubs: {
        "next/server": createNextServerStub(),
        "@/lib/db": { getDb: () => db },
        "@/lib/event-bus": { emitTaskEvent: () => {} },
        "@/lib/chat-attachment-service": {
          cleanupChatAttachmentStorage: () => {},
          copyChatAttachmentsToSent: () => [],
          deleteSourceDraftAttachments: () => {},
        },
        "@/lib/chat-message-content": {
          composeMessageWithAttachments: (message) => message,
          getMessageTitleSource: (message) => message,
        },
        "@/lib/permission-mode": {
          getActivePermissionMode: (requested, fallback) => requested ?? fallback,
          getExecutionPermissionMode: (requested, fallback) => requested ?? fallback,
        },
        "@/lib/claude-capabilities.server": {
          getAutoModeUnavailability,
        },
        "@/lib/claude-options": claudeOptionsStub,
        "@/lib/identity/work-scope": {
          WorkScopeError: class WorkScopeError extends Error {
            constructor(code, status, message) {
              super(message);
              this.code = code;
              this.status = status;
            }
          },
          assertNoWorkScopeInput() {},
          getTeamIdForWorkScope: (scope) => scope.mode === "team" ? scope.scope.teamId : null,
          inheritWorkScope(row) {
            const scope = typeof row.workScope === "string" ? JSON.parse(row.workScope) : row.workScope;
            const clientId = scope.mode === "team" ? scope.scope.clientId : scope.clientId;
            return { scope, serialized: JSON.stringify(scope), clientId };
          },
          isWorkScopeError: () => false,
          readWorkScopeFromRow(row) {
            return typeof row.workScope === "string" ? JSON.parse(row.workScope) : row.workScope;
          },
          workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
        },
        "@/types/chat": {},
        "@/types/chat-composer": {},
        "@/types/task": {},
      },
    }),
  };
}

test("POST /api/chat/message persists valid thinking effort on created task", async () => {
  const { db, route } = loadRoute();

  const response = await route.POST({
    url: "http://localhost/api/chat/message",
    json: async () => ({
      conversationId: "conversation-1",
      content: "Build the thing",
      model: "sonnet",
      thinkingEffort: "high",
    }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.task.thinkingEffort, "high");
  assert.equal(db.state.insertedTask.thinkingEffort, "high");
  assert.equal(JSON.parse(db.state.insertedTask.workScope).scope.teamId, "team-a");
});

test("POST /api/chat/message normalizes effort for the selected model", async () => {
  const { db, route } = loadRoute();

  const response = await route.POST({
    url: "http://localhost/api/chat/message",
    json: async () => ({
      conversationId: "conversation-1",
      content: "Build the thing",
      model: "sonnet",
      thinkingEffort: "xhigh",
    }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.task.model, "sonnet");
  assert.equal(response.body.task.thinkingEffort, "high");
  assert.equal(db.state.insertedTask.thinkingEffort, "high");
});

test("POST /api/chat/message rejects invalid thinking effort", async () => {
  const { route } = loadRoute();

  const response = await route.POST({
    url: "http://localhost/api/chat/message",
    json: async () => ({
      conversationId: "conversation-1",
      content: "Build the thing",
      thinkingEffort: "turbo",
    }),
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /thinkingEffort/);
});

test("POST /api/chat/message stores native Auto without rewriting it", async () => {
  const { db, route } = loadRoute();

  const response = await route.POST({
    url: "http://localhost/api/chat/message",
    json: async () => ({
      conversationId: "conversation-1",
      content: "Build the thing",
      permissionMode: "auto",
      model: "sonnet",
    }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.task.permissionMode, "auto");
  assert.equal(response.body.task.executionPermissionMode, "auto");
  assert.equal(db.state.insertedTask.permissionMode, "auto");
  assert.equal(db.state.insertedTask.executionPermissionMode, "auto");
});

test("POST /api/chat/message rejects only proven Auto incompatibility before writing", async () => {
  const db = createDb();
  const unavailable = {
    code: "auto_mode_unavailable",
    reason: "model_incompatible",
    error: "Auto is not available with Haiku. Choose a supported Sonnet or Opus model.",
  };
  const { route } = loadRoute(db, async () => unavailable);

  const response = await route.POST({
    url: "http://localhost/api/chat/message",
    json: async () => ({
      conversationId: "conversation-1",
      content: "Build the thing",
      permissionMode: "auto",
      model: "haiku",
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, unavailable);
  assert.equal(db.state.messages.length, 0);
  assert.equal(db.state.insertedTask, null);
});
