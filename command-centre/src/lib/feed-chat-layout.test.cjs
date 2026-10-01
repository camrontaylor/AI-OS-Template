const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const layout = loadTsModule(path.resolve(__dirname, "feed-chat-layout.ts"));

test("treats the last 48px as the sticky-to-latest zone", () => {
  assert.equal(layout.isFeedChatNearBottom({ scrollTop: 452, clientHeight: 500, scrollHeight: 1000 }), true);
  assert.equal(layout.isFeedChatNearBottom({ scrollTop: 451, clientHeight: 500, scrollHeight: 1000 }), false);
});

test("caps the Feed composer against the panel height", () => {
  assert.equal(layout.getFeedComposerTextareaMaxHeight(258), 41);
  assert.equal(layout.getFeedComposerTextareaMaxHeight(180), 36);
  assert.equal(layout.getFeedComposerTextareaMaxHeight(900), 220);
  assert.equal(layout.getFeedComposerTextareaMaxHeight(null), 220);
});
