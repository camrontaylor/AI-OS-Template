const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

function loadRoute() {
  const db = {
    prepare(sql) {
      return {
        get(taskId) {
          if (sql.includes("SELECT clientId, workScope FROM tasks")) {
            assert.equal(taskId, "goal");
            return { clientId: null, workScope: null };
          }
          if (sql.includes("SELECT COALESCE(MIN(columnOrder)")) {
            return { minOrder: 1 };
          }
          throw new Error(`Unhandled get SQL: ${sql}`);
        },
        run() {
          if (sql.includes("INSERT INTO tasks")) {
            throw new Error("task_tree_read_only");
          }
          throw new Error(`Unhandled run SQL: ${sql}`);
        },
      };
    },
  };

  return loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "@/lib/db": { getDb: () => db },
      "@/lib/event-bus": { emitTaskEvent: () => {} },
      "@/lib/clients": { assertValidClientId: (value) => value ?? null },
      "@/lib/config": { detectClientIdFromCwd: () => null },
      "@/lib/identity/request-principal": {
        RequestPrincipalError: class RequestPrincipalError extends Error {},
      },
      "@/lib/identity/skill-authorization": { requireSkillUseForRequest: async () => {} },
      "@/lib/identity/work-scope": {
        WorkScopeError: class WorkScopeError extends Error {},
        assertNoWorkScopeInput: () => {},
        captureNewWorkScope: async () => ({
          scope: { mode: "solo", version: 1, clientId: null },
          serialized: JSON.stringify({ mode: "solo", version: 1, clientId: null }),
          clientId: null,
        }),
        inheritWorkScope: () => ({
          scope: { mode: "solo", version: 1, clientId: null },
          serialized: JSON.stringify({ mode: "solo", version: 1, clientId: null }),
          clientId: null,
        }),
        isWorkScopeError: () => false,
        normalizeWorkScopedRow: (row) => row,
        requestWithWorkScope: (request) => request,
        workScopeErrorBody: (error) => ({ error: error.message }),
      },
      "@/lib/permission-mode": {
        getActivePermissionMode: (value, fallback) => value ?? fallback,
        getExecutionPermissionMode: (value, fallback) => value ?? fallback,
      },
      "@/lib/claude-capabilities.server": { getAutoModeUnavailability: async () => null },
      "@/lib/claude-options": {
        isClaudeModel: () => true,
        isNullableClaudeThinkingEffort: () => true,
        normalizeClaudeModel: (value) => value ?? null,
        normalizeClaudeThinkingEffortForModel: (_model, value) => value ?? null,
      },
      "@/lib/task-list-scope": { validateTaskListScope: () => null },
      "@/lib/task-archive": {
        isTaskArchived: () => false,
        isTaskTreeReadOnlyError: (error) => /task_tree_read_only/.test(error?.message ?? ""),
      },
      "@/lib/task-main-chat": { resolveTaskHasMainChat: () => true },
    },
  });
}

test("task creation maps an archive barrier race to 409", async () => {
  const route = loadRoute();
  const response = await route.POST(new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Late child", level: "task", parentId: "goal" }),
  }));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Restore this Goal/);
});
