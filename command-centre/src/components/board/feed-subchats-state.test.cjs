const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const state = loadTsModule(path.resolve(__dirname, "feed-subchats-state.ts"));

function task(id, overrides = {}) {
  return {
    id,
    title: id,
    status: "backlog",
    parentId: "goal",
    columnOrder: 0,
    createdAt: "2026-07-12T10:00:00.000Z",
    startedAt: null,
    claudeSessionId: null,
    conversationId: null,
    needsInput: false,
    ...overrides,
  };
}

test("separates started conversations from unstarted Brief tasks", () => {
  const root = task("goal", { parentId: null });
  const model = state.buildFeedSubchatModel({
    rootTask: root,
    tasks: [
      root,
      task("running", { status: "running" }),
      task("logged"),
      task("brief", { columnOrder: 2 }),
    ],
    panels: [{ id: "main", type: "chat", resource: { primary: true, taskId: "goal" } }],
    logCounts: { logged: 1 },
  });
  assert.deepEqual(model.active.map((item) => item.task.id), ["running", "logged"]);
  assert.deepEqual(model.fromBrief.map((item) => item.task.id), ["brief"]);
  assert.equal(model.mainCurrent, true);
});

test("tracks primary and pinned chats without treating the primary as pinned", () => {
  const root = task("goal", { parentId: null });
  const child = task("child", { status: "review", needsInput: true });
  const model = state.buildFeedSubchatModel({
    rootTask: root,
    tasks: [root, child],
    panels: [
      { id: "main", type: "chat", resource: { primary: true, taskId: "child" } },
      { id: "pin", type: "chat", resource: { taskId: "child" } },
    ],
    unreadTaskIds: new Set(["child"]),
  });
  assert.equal(model.active[0].current, true);
  assert.equal(model.active[0].pinnedPanelId, "pin");
  assert.equal(model.active[0].unseen, true);
});

test("read review conversations no longer show unseen attention", () => {
  const root = task("goal", { parentId: null });
  const child = task("child", { status: "review", needsInput: true });
  const model = state.buildFeedSubchatModel({
    rootTask: root,
    tasks: [root, child],
    panels: [{ id: "main", type: "chat", resource: { primary: true, taskId: "goal" } }],
    unreadTaskIds: new Set(),
  });
  assert.equal(model.active[0].unseen, false);
});
