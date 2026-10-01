const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../../lib/test-utils/load-ts-module.cjs");

class TestTaskArchiveError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

class TestTaskArchiveStopError extends TestTaskArchiveError {
  constructor(message) {
    super(message, 503);
    this.code = "task_stop_failed";
  }
}

function loadRoute({ archiveGoal, quiesceTaskForArchive, events = [] }) {
  return {
    events,
    route: loadTsModule(path.resolve(__dirname, "route.ts"), {
      stubs: {
        "@/lib/db": { getDb: () => ({}) },
        "@/lib/event-bus": { emitTaskEvent: (event) => events.push(event) },
        "@/lib/process-manager": {
          processManager: { quiesceTaskForArchive },
        },
        "@/lib/task-archive": {
          archiveGoal,
          TaskArchiveError: TestTaskArchiveError,
          TaskArchiveStopError: TestTaskArchiveStopError,
        },
        "@/lib/identity/work-scope": {
          isWorkScopeError: () => false,
          workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
        },
      },
    }),
  };
}

test("archive route uses archive-specific quiesce and emits the persisted final timestamp", async () => {
  const stopped = [];
  const task = {
    id: "goal",
    status: "done",
    updatedAt: "2026-07-22T15:00:00.000Z",
    archivedAt: "2026-07-22T15:00:00.000Z",
    workScope: { mode: "solo", version: 1, clientId: null },
  };
  const { route, events } = loadRoute({
    archiveGoal: async (options) => {
      await options.stopTask("goal");
      return [task];
    },
    quiesceTaskForArchive: async (taskId) => stopped.push(taskId),
  });

  const response = await route.POST(new Request("http://localhost/api/tasks/goal/archive"), {
    params: Promise.resolve({ id: "goal" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(stopped, ["goal"]);
  assert.deepEqual(await response.json(), { tasks: [task] });
  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, task.updatedAt);
});

test("archive route returns task_stop_failed with 503 when quiesce is not confirmed", async () => {
  const { route, events } = loadRoute({
    archiveGoal: async () => {
      throw new TestTaskArchiveStopError("The process tree is still running.");
    },
    quiesceTaskForArchive: async () => {},
  });

  const response = await route.POST(new Request("http://localhost/api/tasks/goal/archive"), {
    params: Promise.resolve({ id: "goal" }),
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "task_stop_failed");
  assert.match(body.error, /still running/i);
  assert.equal(events.length, 0);
});
