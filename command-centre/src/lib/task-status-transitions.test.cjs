const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "task-status-transitions.ts");

test("buildReopenTaskUpdate returns review state without stale completion fields", () => {
  const { buildReopenTaskUpdate } = loadTsModule(modulePath);

  assert.deepEqual(buildReopenTaskUpdate(), {
    status: "review",
    completedAt: null,
    activityLabel: null,
    errorMessage: null,
    needsInput: false,
  });
});

test("getGsdSyncedTaskStatus never maps automatic sync to done", () => {
  const { getGsdSyncedTaskStatus } = loadTsModule(modulePath);

  assert.equal(getGsdSyncedTaskStatus("complete", "verify", false), "review");
  assert.equal(getGsdSyncedTaskStatus("in-progress", "discuss", true), "review");
  assert.equal(getGsdSyncedTaskStatus("in-progress", "plan", true), "review");
  assert.equal(getGsdSyncedTaskStatus("in-progress", "discuss", false), "queued");
  assert.equal(getGsdSyncedTaskStatus("in-progress", "execute", false), "backlog");
  assert.equal(getGsdSyncedTaskStatus("not-started", "discuss", false), "backlog");
});

test("shouldApplySyncedTaskStatus preserves manual and active states", () => {
  const { shouldApplySyncedTaskStatus } = loadTsModule(modulePath);

  assert.equal(shouldApplySyncedTaskStatus("backlog", "review"), true);
  assert.equal(shouldApplySyncedTaskStatus("queued", "review"), true);
  assert.equal(shouldApplySyncedTaskStatus("done", "review"), false);
  assert.equal(shouldApplySyncedTaskStatus("review", "backlog"), false);
  assert.equal(shouldApplySyncedTaskStatus("running", "review"), false);
  assert.equal(shouldApplySyncedTaskStatus("review", "review"), false);
});
