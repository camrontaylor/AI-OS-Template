const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const readState = loadTsModule(path.resolve(__dirname, "feed-read-state.ts"));

function task(overrides = {}) {
  return {
    id: "task-1",
    status: "review",
    needsInput: false,
    errorMessage: null,
    activityLabel: "Finished",
    completedAt: null,
    tokensUsed: 100,
    durationMs: 5000,
    costUsd: 0.01,
    title: "Result",
    pinnedAt: null,
    ...overrides,
  };
}

test("read results stay read across unrelated title and pin changes", () => {
  const result = task();
  const empty = readState.createEmptyFeedReadState();
  assert.equal(readState.isFeedTaskUnread(result, empty), true);
  const seen = readState.markFeedTasksRead(empty, [result]);
  assert.equal(readState.isFeedTaskUnread(result, seen), false);
  assert.equal(readState.isFeedTaskUnread(task({ title: "Renamed", pinnedAt: "2026-07-13T00:00:00.000Z" }), seen), false);
  assert.equal(readState.isFeedTaskUnread(task({ tokensUsed: 140 }), seen), true);
});

test("read revisions persist in versioned browser storage", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  const seen = readState.markFeedTasksRead(readState.createEmptyFeedReadState(), [task()]);
  readState.saveFeedReadState(seen, storage);
  const restored = readState.loadFeedReadState(storage);
  assert.deepEqual(restored, seen);
});
