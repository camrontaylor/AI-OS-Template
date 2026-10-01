"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

test("the local task cache loads the complete active-profile history", () => {
  const taskStore = source("../store/task-store.ts");
  assert.match(taskStore, /fetch\("\/api\/tasks\?scope=profile"\)/);
});

test("opening a historical task selects the Workspace client that makes it visible", () => {
  const page = source("../app/page.tsx");
  assert.match(
    page,
    /await fetchClients\(\);[\s\S]*setSelectedClient\(task\.clientId \?\? null\)/,
  );
});

test("the Feed hides history search controls while preserving tags and reusable filtering", () => {
  const feed = source("../components/board/feed-view.tsx");
  const history = source("chat-history.ts");
  assert.doesNotMatch(feed, /aria-label="Search chats"/);
  assert.doesNotMatch(feed, /aria-label="Filter chats by Team"/);
  assert.doesNotMatch(feed, /aria-label="Filter chats by client"/);
  assert.doesNotMatch(feed, /cc\.chat-history-filters:v1/);
  assert.match(feed, /<TagFilterBar/);
  assert.match(feed, /shouldShowTaskTeamBadge/);
  assert.match(history, /export function matchesChatHistoryFilters/);
});
