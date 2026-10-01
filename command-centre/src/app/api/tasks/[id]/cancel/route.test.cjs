const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../../lib/test-utils/load-ts-module.cjs");

class TestTaskCancellationError extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}

function createDbStub({ task, updatedTask = task }) {
  let taskSelectCount = 0;

  return {
    prepare(sql) {
      return {
        get(taskId) {
          if (sql.includes("SELECT * FROM tasks WHERE id = ?")) {
            if (taskId !== task.id) return undefined;
            taskSelectCount += 1;
            return { ...(taskSelectCount === 1 ? task : updatedTask) };
          }
          throw new Error(`Unhandled get SQL: ${sql}`);
        },
      };
    },
  };
}

function loadRoute({ db, cancelTask }) {
  return loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "@/lib/db": { getDb: () => db },
      "@/lib/process-manager": {
        TaskCancellationError: TestTaskCancellationError,
        processManager: {
          cancelTask,
        },
      },
      "@/lib/task-archive": {
        isTaskArchived: () => false,
      },
      "@/lib/identity/work-scope": {
        isWorkScopeError: () => false,
        normalizeWorkScopedRow: (row) => ({
          ...row,
          workScope: { mode: "solo", version: 1, clientId: row.clientId ?? null },
        }),
        workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
      },
    },
  });
}

test("cancel route stops a running task and returns the updated review task", async () => {
  const task = { id: "task-running", status: "running", needsInput: 0 };
  const updatedTask = {
    id: "task-running",
    status: "review",
    needsInput: 0,
    activityLabel: "Stopped by user",
  };
  const db = createDbStub({ task, updatedTask });
  const calls = [];
  const route = loadRoute({
    db,
    cancelTask: async (taskId) => calls.push(taskId),
  });

  const response = await route.POST(new Request("http://localhost/api/tasks/task-running/cancel"), {
    params: Promise.resolve({ id: task.id }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [task.id]);
  assert.equal(body.status, "review");
  assert.equal(body.needsInput, false);
  assert.equal(body.activityLabel, "Stopped by user");
});

test("cancel route can stop a task before its process starts", async () => {
  const task = { id: "task-queued", status: "queued", needsInput: 0 };
  const updatedTask = { id: "task-queued", status: "review", needsInput: 0, activityLabel: "Stopped by user" };
  const db = createDbStub({ task, updatedTask });
  const calls = [];
  const route = loadRoute({ db, cancelTask: async (taskId) => calls.push(taskId) });

  const response = await route.POST(new Request("http://localhost/api/tasks/task-queued/cancel"), {
    params: Promise.resolve({ id: task.id }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [task.id]);
  assert.equal((await response.json()).status, "review");
});

test("cancel route reports an unconfirmed stop instead of claiming success", async () => {
  const task = { id: "task-stuck", status: "running", needsInput: 0 };
  const db = createDbStub({ task });
  const route = loadRoute({
    db,
    cancelTask: async () => {
      throw new TestTaskCancellationError("The process tree is still running.");
    },
  });

  const response = await route.POST(new Request("http://localhost/api/tasks/task-stuck/cancel"), {
    params: Promise.resolve({ id: task.id }),
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "task_stop_failed");
  assert.match(body.error, /still running/i);
});

test("cancel route treats an already-finished stale stop request as harmless", async () => {
  const task = { id: "task-done", status: "done", needsInput: 0 };
  const db = createDbStub({ task });
  const calls = [];
  const route = loadRoute({
    db,
    cancelTask: async (taskId) => calls.push(taskId),
  });

  const response = await route.POST(new Request("http://localhost/api/tasks/task-done/cancel"), {
    params: Promise.resolve({ id: task.id }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, []);
  assert.equal(body.status, "done");
  assert.equal(body.needsInput, false);
});
