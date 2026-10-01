const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const workspaceState = loadTsModule(path.resolve(__dirname, "feed-workspace-state.ts"));

test("resolves a top-level Goal selection", () => {
  const selection = workspaceState.resolveFeedWorkspaceSelection("goal-1", [
    { id: "goal-1", clientId: "client-a" },
  ]);
  assert.deepEqual(selection, {
    goalId: "goal-1",
    activeTaskId: "goal-1",
    clientId: "client-a",
  });
});

test("resolves a child deep link to its root Goal without losing the active task", () => {
  const selection = workspaceState.resolveFeedWorkspaceSelection("task-2", [
    { id: "goal-1", clientId: "client-a" },
    { id: "task-1", parentId: "goal-1", clientId: "client-a" },
    { id: "task-2", parentId: "task-1", clientId: "client-a" },
  ]);
  assert.deepEqual(selection, {
    goalId: "goal-1",
    activeTaskId: "task-2",
    clientId: "client-a",
  });
});

test("uses the root client when the selected child has no client field", () => {
  const selection = workspaceState.resolveFeedWorkspaceSelection("task-1", [
    { id: "goal-1", clientId: "client-b" },
    { id: "task-1", parentId: "goal-1" },
  ]);
  assert.equal(selection.clientId, "client-b");
});

test("fails safely for missing tasks and cyclic parent data", () => {
  assert.equal(workspaceState.resolveFeedWorkspaceSelection("missing", []), null);
  const cyclic = workspaceState.resolveFeedWorkspaceSelection("task-a", [
    { id: "task-a", parentId: "task-b" },
    { id: "task-b", parentId: "task-a" },
  ]);
  assert.equal(cyclic.activeTaskId, "task-a");
  assert.ok(cyclic.goalId === "task-a" || cyclic.goalId === "task-b");
});

test("temporary tasks are not eligible for permanent sidebar actions", () => {
  assert.equal(workspaceState.isPermanentFeedTaskId("temp-123"), false);
  assert.equal(workspaceState.isPermanentFeedTaskId("goal-123"), true);
});

test("archive cleanup is alias-aware and preserves a newer user selection", () => {
  const affected = new Set(["edited-goal"]);
  const aliases = { "original-goal": "edited-goal" };
  assert.equal(
    workspaceState.clearAffectedFeedSelection("original-goal", affected, aliases),
    null,
  );
  assert.equal(
    workspaceState.clearAffectedFeedSelection("other-goal", affected, aliases),
    "other-goal",
  );
});
