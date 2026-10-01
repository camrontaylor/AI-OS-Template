"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function loadEventBus(profileKey) {
  return loadTsModule(path.join(__dirname, "event-bus.ts"), {
    stubs: {
      "@/lib/db": {
        getActiveLocalProfileDescriptor: () => ({ profileKey }),
      },
      "@/lib/identity/work-scope": {
        normalizeWorkScopedRow: (task) => task,
      },
      "@/types/task": {},
      "@/types/chat": {},
    },
  });
}

test("task and chat events inherit the active local profile", () => {
  const eventBus = loadEventBus("profile-a");
  const received = [];
  const taskHandler = (event) => received.push(event);
  const chatHandler = (event) => received.push(event);
  eventBus.onTaskEvent(taskHandler);
  eventBus.onChatEvent(chatHandler);
  try {
    eventBus.emitTaskEvent({
      type: "task:status",
      task: { id: "task-1" },
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    eventBus.emitChatEvent({
      type: "chat:typing",
      conversationId: "conversation-1",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  } finally {
    eventBus.offTaskEvent(taskHandler);
    eventBus.offChatEvent(chatHandler);
  }
  assert.deepEqual(received.map((event) => event.profileKey), ["profile-a", "profile-a"]);
});

test("an explicitly pinned event profile is preserved", () => {
  const eventBus = loadEventBus("profile-b");
  let received = null;
  const handler = (event) => { received = event; };
  eventBus.onTaskEvent(handler);
  try {
    eventBus.emitTaskEvent({
      type: "task:status",
      profileKey: "profile-a",
      task: { id: "task-2" },
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  } finally {
    eventBus.offTaskEvent(handler);
  }
  assert.equal(received.profileKey, "profile-a");
});
