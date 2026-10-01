"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const history = loadTsModule(path.join(__dirname, "chat-history.ts"), {
  stubs: {
    "@/types/task": {},
    "@/store/team-navigation-store": {},
  },
});

function teamTask(teamId, clientId = null) {
  return {
    title: `Task ${teamId}`,
    description: "Campaign plan",
    clientId,
    workScope: {
      mode: "team",
      scope: { version: 1, serverId: "server", userId: "user", teamId, clientId },
    },
  };
}

test("history filters keep duplicate client slugs isolated by Team", () => {
  const a = teamTask("team-a", "shared");
  const b = teamTask("team-b", "shared");
  const key = history.taskClientFilterKey(a);
  assert.equal(history.matchesChatHistoryFilters(a, { query: "", teamId: "__all__", clientKey: key }), true);
  assert.equal(history.matchesChatHistoryFilters(b, { query: "", teamId: "__all__", clientKey: key }), false);
});

test("history resolves active labels before retained former-Team labels", () => {
  const task = teamTask("team-a");
  const labels = {
    version: 1,
    teams: [{ id: "team-a", name: "Former Alpha", slug: "alpha", lastSeenAt: "now" }],
    clients: [],
  };
  assert.equal(history.resolveTaskTeamLabel(task, labels, [{ id: "team-a", name: "Current Alpha", slug: "alpha" }]), "Current Alpha");
  assert.equal(history.resolveTaskTeamLabel(task, labels, []), "Former Alpha");
});

test("Team badge is conditional on the selected Team and Solo has none", () => {
  const task = teamTask("team-a");
  assert.equal(history.shouldShowTaskTeamBadge(task, "team-a"), false);
  assert.equal(history.shouldShowTaskTeamBadge(task, "team-b"), true);
  assert.equal(history.shouldShowTaskTeamBadge(task, "team-a", []), true);
  assert.equal(history.shouldShowTaskTeamBadge({ workScope: { mode: "solo", version: 1, clientId: null } }, "team-b"), false);
});

test("legacy chats with a missing work scope are treated as Solo", () => {
  assert.equal(history.taskTeamId({ workScope: null }), null);
  assert.equal(history.shouldShowTaskTeamBadge({ workScope: null }, "team-a"), false);
});
