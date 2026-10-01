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

function loadRoute({ restoreGoal, events = [] }) {
  const db = {};
  return {
    db,
    events,
    route: loadTsModule(path.resolve(__dirname, "route.ts"), {
      stubs: {
        "@/lib/db": { getDb: () => db },
        "@/lib/event-bus": { emitTaskEvent: (event) => events.push(event) },
        "@/lib/task-archive": {
          restoreGoal,
          TaskArchiveError: TestTaskArchiveError,
        },
        "@/lib/identity/work-scope": {
          isWorkScopeError: () => false,
          workScopeErrorBody: (error) => ({ code: error.code, error: error.message }),
        },
      },
    }),
  };
}

test("restore route returns a paused chat and emits the persisted root update", async () => {
  const root = {
    id: "goal",
    status: "review",
    needsInput: true,
    claudeSessionId: "session-before-archive",
    updatedAt: "2026-07-22T16:00:00.000Z",
    archivedAt: null,
    workScope: { mode: "solo", version: 1, clientId: null },
  };
  const child = {
    ...root,
    id: "child",
    status: "done",
    needsInput: false,
  };
  const calls = [];
  const { route, db, events } = loadRoute({
    restoreGoal: (options) => {
      calls.push(options);
      return [root, child];
    },
  });

  const response = await route.POST(new Request("http://localhost/api/tasks/goal/restore"), {
    params: Promise.resolve({ id: "goal" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ db, goalId: "goal" }]);
  assert.deepEqual(await response.json(), { tasks: [root, child] });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: "task:updated",
    task: root,
    timestamp: root.updatedAt,
  });
});
