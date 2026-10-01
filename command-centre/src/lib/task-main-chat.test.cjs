const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const mainChat = loadTsModule(path.resolve(__dirname, "task-main-chat.ts"), {
  stubs: { "@/types/task": {} },
});

const evidence = (logs = [], conversations = []) => ({
  directLogTaskIds: new Set(logs),
  conversationIdsWithMessages: new Set(conversations),
});

function task(overrides = {}) {
  return {
    id: "goal",
    level: "task",
    status: "review",
    startedAt: null,
    conversationId: null,
    claudeSessionId: null,
    ...overrides,
  };
}

test("ordinary Goals remain visible even when their Chat is empty", () => {
  assert.equal(mainChat.resolveTaskHasMainChat(task(), evidence()), true);
  assert.equal(mainChat.shouldShowTaskInChatFeed({ level: "task", hasMainChat: false }), true);
});

test("project and GSD shells require evidence of a displayable main Chat", () => {
  assert.equal(mainChat.resolveTaskHasMainChat(task({ level: "project" }), evidence()), false);
  assert.equal(mainChat.resolveTaskHasMainChat(task({ level: "gsd" }), evidence()), false);
  assert.equal(mainChat.resolveTaskHasMainChat(task({ level: "project" }), evidence(["child-chat"])), false);
  assert.equal(mainChat.shouldShowTaskInChatFeed({ level: "project", hasMainChat: false }), false);
});

test("active or evidenced project Chats remain visible", () => {
  assert.equal(mainChat.resolveTaskHasMainChat(task({ level: "project", status: "queued" }), evidence()), true);
  assert.equal(mainChat.resolveTaskHasMainChat(task({ level: "gsd", status: "running" }), evidence()), false);
  assert.equal(mainChat.resolveTaskHasMainChat(
    task({ level: "gsd", status: "running", startedAt: "2026-07-22T12:00:00.000Z" }),
    evidence(),
  ), false);
  assert.equal(mainChat.resolveTaskHasMainChat(task({ level: "project" }), evidence(["goal"])), true);
  assert.equal(mainChat.resolveTaskHasMainChat(
    task({ level: "project", conversationId: "conversation" }),
    evidence([], ["conversation"]),
  ), true);
  assert.equal(mainChat.resolveTaskHasMainChat(
    task({ level: "gsd", claudeSessionId: "session" }),
    evidence(),
  ), true);
});
