const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../../../lib/test-utils/load-ts-module.cjs");

function createHarness() {
  const task = {
    id: "task-1",
    status: "running",
    clientId: null,
    needsInput: 1,
    permissionMode: "default",
    executionPermissionMode: "default",
  };
  const approval = {
    id: "approval-1",
    taskId: task.id,
    kind: "permission",
    status: "pending",
    title: "Needs permission",
    description: "Run command",
    toolName: "Bash",
    inputJson: JSON.stringify({ command: "npm run test" }),
    decision: null,
    decisionMessage: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  const rule = {
    id: "rule-1",
    taskId: task.id,
    sourceApprovalRequestId: approval.id,
    toolName: "Bash",
    matcherType: "bash_exact",
    matcherValue: "npm run test",
    workspacePath: "workspace",
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  let createRuleCalls = 0;

  const db = {
    prepare(sql) {
      return {
        get(id) {
          if (sql.includes("SELECT * FROM tasks WHERE id = ?")) {
            return id === task.id ? { ...task } : undefined;
          }
          throw new Error(`Unhandled get SQL: ${sql}`);
        },
        run(...args) {
          if (sql.includes("UPDATE tasks SET updatedAt = ?")) {
            const [updatedAt, activityLabel, needsInputOrId, maybeId] = args;
            const id = maybeId ?? needsInputOrId;
            if (id === task.id) {
              task.updatedAt = updatedAt;
              task.activityLabel = activityLabel;
              task.needsInput = maybeId ? needsInputOrId : 1;
            }
            return { changes: 1 };
          }
          throw new Error(`Unhandled run SQL: ${sql}`);
        },
      };
    },
    transaction(fn) {
      return (...args) => fn(...args);
    },
  };

  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "@/lib/db": { getDb: () => db },
      "@/lib/event-bus": { emitTaskEvent: () => {} },
      "@/lib/approval-requests": {
        getApprovalRequest: () => ({ ...approval }),
        getPendingApprovalCount: () => 0,
        resolveApprovalRequest: (_taskId, _requestId, decision) => {
          if (approval.status !== "pending") return { ...approval };
          approval.status = decision === "deny" ? "denied" : "approved";
          approval.decision = decision;
          approval.resolvedAt = new Date().toISOString();
          return { ...approval };
        },
      },
      "@/lib/config": { getClientAiOsDir: () => "workspace" },
      "@/lib/task-permission-rules": {
        createTaskPermissionRule: () => {
          createRuleCalls += 1;
          return rule;
        },
        getRuleForApprovalRequest: () => rule,
      },
      "@/lib/task-permissions": {
        PERMISSION_DENIED_ACTIVITY_LABEL: "Permission denied",
        PERMISSION_RESUMING_ACTIVITY_LABEL: "Resuming after approval",
      },
      "@/lib/task-archive": { isTaskArchived: () => false },
      "@/lib/identity/work-scope": {
        isWorkScopeError: () => false,
        normalizeWorkScopedRow: (row) => ({
          ...row,
          workScope: { mode: "solo", version: 1, clientId: row.clientId ?? null },
        }),
        readWorkScopeFromRow: (row) => ({
          mode: "solo",
          version: 1,
          clientId: row.clientId ?? null,
        }),
        workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
      },
    },
  });

  return { route, task, approval, rule, getCreateRuleCalls: () => createRuleCalls };
}

async function post(route, decision) {
  return route.POST(
    new Request("http://localhost/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }),
    { params: Promise.resolve({ id: "task-1", requestId: "approval-1" }) },
  );
}

test("allow for subchat grants a scoped rule without enabling Full access", async () => {
  const harness = createHarness();
  const response = await post(harness.route, "allow_for_task");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.grantedRule.matcherType, "bash_exact");
  assert.equal(harness.task.permissionMode, "default");
  assert.equal(harness.task.executionPermissionMode, "default");
  assert.equal(harness.getCreateRuleCalls(), 1);

  const repeated = await post(harness.route, "allow_for_task");
  assert.equal(repeated.status, 200);
  assert.equal(harness.getCreateRuleCalls(), 1);

  const conflicting = await post(harness.route, "deny");
  assert.equal(conflicting.status, 409);
});

test("allow once resolves only the current request", async () => {
  const harness = createHarness();
  const response = await post(harness.route, "allow_once");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.grantedRule, null);
  assert.equal(harness.getCreateRuleCalls(), 0);
});
