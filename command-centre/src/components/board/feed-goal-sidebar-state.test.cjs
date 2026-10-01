const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const sidebar = loadTsModule(path.resolve(__dirname, "feed-goal-sidebar-state.ts"));

function goal(id, overrides = {}) {
  return {
    id,
    title: id,
    description: null,
    clientId: null,
    pinnedAt: null,
    columnOrder: 0,
    updatedAt: "2026-07-12T10:00:00.000Z",
    ...overrides,
  };
}

const clients = [
  { slug: "acme", name: "Acme" },
  { slug: "north", name: "Northwind" },
];

test("groups active Goals by AI-OS and client with pinned Goals first", () => {
  const groups = sidebar.groupFeedGoals([
    goal("root"),
    goal("acme-old", { clientId: "acme", updatedAt: "2026-07-10T10:00:00.000Z" }),
    goal("acme-pinned", { clientId: "acme", pinnedAt: "2026-07-12T09:00:00.000Z" }),
  ], clients, null);

  assert.deepEqual(groups.map((group) => group.name), ["AI-OS", "Acme"]);
  assert.deepEqual(groups[1].goals.map((item) => item.id), ["acme-pinned", "acme-old"]);
});

test("workspace selection isolates active and archived client Goals", () => {
  const goals = [goal("root"), goal("acme", { clientId: "acme" }), goal("north", { clientId: "north" })];
  assert.deepEqual(
    sidebar.groupFeedGoals(goals, clients, "acme").flatMap((group) => group.goals.map((item) => item.id)),
    ["acme"],
  );
  assert.deepEqual(
    sidebar.searchArchivedFeedGoals({ goals, clients, rootName: "AI-OS", selectedClientId: "north", query: "" }).map((item) => item.id),
    ["north"],
  );
});

test("archived search matches title, description, workspace slug, and client name", () => {
  const goals = [
    goal("launch", { title: "Launch campaign", description: "Prepare partner assets", clientId: "acme" }),
    goal("report", { title: "Quarterly report", clientId: "north" }),
  ];

  for (const query of ["launch", "partner", "acme"]) {
    assert.deepEqual(
      sidebar.searchArchivedFeedGoals({ goals, clients, rootName: "AI-OS", selectedClientId: null, query }).map((item) => item.id),
      ["launch"],
    );
  }
  assert.deepEqual(
    sidebar.searchArchivedFeedGoals({ goals, clients, rootName: "AI-OS", selectedClientId: null, query: "northwind" }).map((item) => item.id),
    ["report"],
  );
});

test("groups drafts before active Goals in their workspace and sorts newest first", () => {
  const clients = [{ slug: "acme", name: "Acme" }];
  const drafts = [
    { id: "draft-old", clientId: "acme", title: "Older", updatedAt: "2026-07-10T10:00:00.000Z" },
    { id: "draft-new", clientId: "acme", title: "Newer", updatedAt: "2026-07-12T10:00:00.000Z" },
  ];
  const goals = [{ id: "goal-1", clientId: "acme", title: "Goal", updatedAt: "2026-07-11T10:00:00.000Z", createdAt: "2026-07-11T10:00:00.000Z", columnOrder: 0 }];

  const groups = sidebar.groupFeedGoalSidebarItems(goals, drafts, clients, "acme");
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].drafts.map((draft) => draft.id), ["draft-new", "draft-old"]);
  assert.deepEqual(groups[0].goals.map((goal) => goal.id), ["goal-1"]);
});

test("sidebar width follows its UX limits across viewport sizes", () => {
  assert.equal(sidebar.clampFeedSidebarWidth(100, 1280), 220);
  assert.equal(sidebar.clampFeedSidebarWidth(280, 1280), 280);
  assert.equal(sidebar.clampFeedSidebarWidth(500, 1280), 360);
  assert.equal(sidebar.clampFeedSidebarWidth(500, 700), 280);
  assert.equal(sidebar.clampFeedSidebarWidth(244.4, 1103), 244);
});
