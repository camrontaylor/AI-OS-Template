const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function task(overrides) {
  return {
    id: "task",
    title: "Task",
    description: "Description",
    status: "review",
    level: "task",
    parentId: null,
    projectSlug: "project",
    columnOrder: 10,
    createdAt: "2026-07-09T10:00:00.000Z",
    updatedAt: "2026-07-09T10:00:00.000Z",
    clientId: "client-a",
    phaseNumber: null,
    gsdStep: null,
    goalGroup: "goal-a",
    tag: "tag-a",
    pinnedAt: null,
    forkedFromTaskId: null,
    forkedFromLogId: null,
    forkedFromClaudeSessionId: null,
    ...overrides,
  };
}

test("resolveBranchSurface replaces an existing pane for the source task", () => {
  const { resolveBranchSurface } = loadTsModule(path.resolve(__dirname, "task-branch-ui.ts"));

  const result = resolveBranchSurface("source-task", [
    { id: "pane-1", taskId: "other-task" },
    { id: "pane-2", taskId: "source-task" },
  ]);

  assert.deepEqual(result, { kind: "pane", paneId: "pane-2" });
});

test("resolveBranchSurface falls back to the main chat surface", () => {
  const { resolveBranchSurface } = loadTsModule(path.resolve(__dirname, "task-branch-ui.ts"));

  const result = resolveBranchSurface("source-task", [
    { id: "pane-1", taskId: "other-task" },
  ]);

  assert.deepEqual(result, { kind: "main" });
});

test("visible edited tasks replace the source task with the latest edited task", () => {
  const { getVisibleEditedTasks, resolveEditedTaskId } = loadTsModule(path.resolve(__dirname, "task-branch-ui.ts"));
  const tasks = [
    task({
      id: "source-task",
      title: "Original title",
      description: "Original description",
      columnOrder: 40,
      createdAt: "2026-07-09T10:00:00.000Z",
    }),
    task({
      id: "edited-task",
      title: "Internal edited task",
      description: "Edited content",
      status: "running",
      columnOrder: -1,
      createdAt: "2026-07-09T10:05:00.000Z",
      forkedFromTaskId: "source-task",
      forkedFromLogId: "log-1",
    }),
  ];

  const visible = getVisibleEditedTasks(tasks);

  assert.equal(resolveEditedTaskId("source-task", tasks), "edited-task");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "edited-task");
  assert.equal(visible[0].status, "running");
  assert.equal(visible[0].title, "Original title");
  assert.equal(visible[0].description, "Original description");
  assert.equal(visible[0].columnOrder, 40);
  assert.equal(visible[0].createdAt, "2026-07-09T10:00:00.000Z");
  assert.equal(visible[0].forkedFromTaskId, null);
});

test("newest edited task wins across chained edits", () => {
  const { getVisibleEditedTasks, resolveEditedTaskId } = loadTsModule(path.resolve(__dirname, "task-branch-ui.ts"));
  const tasks = [
    task({ id: "source-task", title: "Source", createdAt: "2026-07-09T10:00:00.000Z" }),
    task({
      id: "first-edit",
      createdAt: "2026-07-09T10:05:00.000Z",
      forkedFromTaskId: "source-task",
      forkedFromLogId: "log-1",
    }),
    task({
      id: "second-edit",
      createdAt: "2026-07-09T10:10:00.000Z",
      forkedFromTaskId: "first-edit",
      forkedFromLogId: "log-2",
    }),
  ];

  const visible = getVisibleEditedTasks(tasks);

  assert.equal(resolveEditedTaskId("source-task", tasks), "second-edit");
  assert.equal(resolveEditedTaskId("first-edit", tasks), "second-edit");
  assert.deepEqual(visible.map((item) => item.id), ["second-edit"]);
});

test("sub-chat lists show the edited replacement without adding a second child", () => {
  const { getVisibleEditedTasks } = loadTsModule(path.resolve(__dirname, "task-branch-ui.ts"));
  const tasks = [
    task({ id: "parent-task", level: "project", title: "Goal", projectSlug: "project" }),
    task({ id: "child-task", title: "Child", parentId: "parent-task", columnOrder: 1 }),
    task({
      id: "child-edit",
      title: "Internal child edit",
      parentId: "parent-task",
      columnOrder: 100,
      createdAt: "2026-07-09T10:05:00.000Z",
      forkedFromTaskId: "child-task",
      forkedFromLogId: "log-1",
    }),
  ];

  const visibleChildren = getVisibleEditedTasks(tasks)
    .filter((item) => item.parentId === "parent-task");

  assert.deepEqual(visibleChildren.map((item) => item.id), ["child-edit"]);
  assert.equal(visibleChildren[0].title, "Child");
  assert.equal(visibleChildren[0].columnOrder, 1);
});

test("read markers use the visible edited Goal and its visible subchats", () => {
  const { getVisibleEditedGoalTaskIds, getVisibleEditedTasks } = loadTsModule(
    path.resolve(__dirname, "task-branch-ui.ts"),
  );
  const tasks = [
    task({ id: "source-goal", level: "project", title: "Goal" }),
    task({
      id: "edited-goal",
      level: "project",
      title: "Internal edited Goal",
      createdAt: "2026-07-09T10:05:00.000Z",
      forkedFromTaskId: "source-goal",
      forkedFromLogId: "log-1",
    }),
    task({ id: "source-child", parentId: "source-goal", title: "Subchat" }),
    task({
      id: "edited-child",
      parentId: "source-goal",
      title: "Internal edited subchat",
      createdAt: "2026-07-09T10:06:00.000Z",
      forkedFromTaskId: "source-child",
      forkedFromLogId: "log-2",
    }),
  ];
  const visible = getVisibleEditedTasks(tasks);

  assert.deepEqual(
    getVisibleEditedGoalTaskIds("source-goal", tasks, visible),
    ["edited-goal", "edited-child"],
  );
  assert.deepEqual(
    getVisibleEditedGoalTaskIds("edited-child", tasks, visible),
    ["edited-goal", "edited-child"],
  );
});

test("persisted pane task ids resolve to the latest edited task", () => {
  const { resolveBranchSurface, resolveEditedPaneTasks } = loadTsModule(path.resolve(__dirname, "task-branch-ui.ts"));
  const tasks = [
    task({ id: "source-task", createdAt: "2026-07-09T10:00:00.000Z" }),
    task({
      id: "edited-task",
      createdAt: "2026-07-09T10:05:00.000Z",
      forkedFromTaskId: "source-task",
      forkedFromLogId: "log-1",
    }),
  ];

  const panes = [{ id: "pane-1", type: "chat", label: "Original label", taskId: "source-task" }];

  assert.deepEqual(resolveEditedPaneTasks(panes, tasks), [
    { id: "pane-1", type: "chat", label: "Original label", taskId: "edited-task" },
  ]);
  assert.deepEqual(resolveBranchSurface("edited-task", panes, tasks), { kind: "pane", paneId: "pane-1" });
});

test("forked tasks are not visible goal children", () => {
  const { isVisibleGoalChildTask } = loadTsModule(path.resolve(__dirname, "task-branch-ui.ts"));

  assert.equal(isVisibleGoalChildTask({ id: "normal-task", forkedFromTaskId: null }), true);
  assert.equal(isVisibleGoalChildTask({ id: "branch-task", forkedFromTaskId: "source-task" }), false);
});

test("replacePaneTaskInState updates the existing pane without adding another pane", () => {
  const { replacePaneTaskInState, removeUnavailableTerminalPanes } = loadTsModule(path.resolve(__dirname, "../hooks/use-pane-state.ts"), {
    stubs: {
      "@/lib/profile-storage": { profileStorageKey: (key) => key },
    },
  });
  const state = {
    openPanes: [
      { id: "pane-1", type: "chat", label: "Old task", taskId: "old-task" },
      { id: "pane-2", type: "chat", label: "Other task", taskId: "other-task" },
    ],
    visiblePaneIds: ["main-chat", "pane-1"],
    activePaneId: "pane-2",
    layout: "horizontal",
    sidebarCollapsed: true,
  };

  const next = replacePaneTaskInState(state, "pane-1", {
    id: "branch-task",
    title: "Edited message",
  });

  assert.equal(next.openPanes.length, 2);
  assert.deepEqual(next.visiblePaneIds, ["main-chat", "pane-1"]);
  assert.equal(next.activePaneId, "pane-1");
  assert.equal(next.sidebarCollapsed, false);
  assert.deepEqual(next.openPanes[0], {
    id: "pane-1",
    type: "chat",
    label: "Old task",
    taskId: "branch-task",
  });

  const withoutTerminal = removeUnavailableTerminalPanes({
    ...state,
    openPanes: [...state.openPanes, { id: "terminal-1", type: "terminal", label: "Terminal" }],
    visiblePaneIds: ["main-chat", "terminal-1"],
    activePaneId: "terminal-1",
  });
  assert.deepEqual(withoutTerminal.openPanes, state.openPanes);
  assert.deepEqual(withoutTerminal.visiblePaneIds, ["main-chat"]);
  assert.equal(withoutTerminal.activePaneId, "main-chat");
});

test("edit dialog uses send wording and no branch copy", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../components/modal/chat-entry.tsx"),
    "utf-8",
  );

  assert.match(source, /Sending\.\.\./);
  assert.match(source, /"Send"/);
  assert.doesNotMatch(source, /Create branch/);
  assert.doesNotMatch(source, /Edit and branch/);
  assert.doesNotMatch(source, /Could not create branch/);
});
