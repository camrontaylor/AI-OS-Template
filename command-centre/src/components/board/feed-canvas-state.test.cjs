const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const canvas = loadTsModule(path.resolve(__dirname, "feed-canvas-state.ts"));

test("uses the concept drop hit area and indicator thickness", () => {
  assert.equal(canvas.FEED_CANVAS_DROP_HIT_SIZE, 52);
  assert.equal(canvas.FEED_CANVAS_DROP_INDICATOR_SIZE, 6);
});

function panel(id, type = "chat", taskId) {
  return {
    id,
    type,
    label: type === "terminal" ? "Terminal" : id,
    heightWeight: 1,
    resource: taskId ? { taskId } : undefined,
  };
}

function panelCount(layout) {
  return layout.columns.flatMap((column) => column.panels).length;
}

test("new Goals start with one primary Chat panel", () => {
  const layout = canvas.createDefaultFeedCanvasLayout("goal-1", "Ship Team OS");
  assert.equal(layout.version, 1);
  assert.equal(layout.columns.length, 1);
  assert.equal(layout.columns[0].panels[0].id, "main-chat");
  assert.equal(layout.columns[0].panels[0].resource.taskId, "goal-1");
});

test("migrates horizontal legacy panes and removes Terminal", () => {
  const layout = canvas.migrateLegacyPaneState({
    layout: "horizontal",
    visiblePaneIds: ["main-chat", "chat-1", "terminal-1"],
    activePaneId: "terminal-1",
    openPanes: [
      { id: "chat-1", type: "chat", label: "Research", taskId: "task-1" },
      { id: "terminal-1", type: "terminal", label: "Terminal" },
      { id: "hidden", type: "chat", label: "Hidden", taskId: "task-hidden" },
    ],
  }, "goal-1", "Main");
  assert.equal(layout.columns.length, 2);
  assert.equal(panelCount(layout), 2);
  assert.equal(layout.activePanelId, "main-chat");
  assert.ok(layout.columns.every((column) => Math.abs(column.widthWeight - 1 / 2) < 0.0001));
});

test("migrates a two-pane grid into one stacked column", () => {
  const layout = canvas.migrateLegacyPaneState({
    layout: "grid",
    visiblePaneIds: ["main-chat", "chat-1"],
    openPanes: [{ id: "chat-1", type: "chat", label: "Draft", taskId: "task-1" }],
  }, "goal-1");
  assert.equal(layout.columns.length, 1);
  assert.deepEqual(layout.columns[0].panels.map((item) => item.id), ["main-chat", "chat-1"]);
  assert.ok(layout.columns[0].panels.every((item) => item.heightWeight === 0.5));
});

test("migrates a four-pane grid without its legacy Terminal", () => {
  const layout = canvas.migrateLegacyPaneState({
    layout: "grid",
    visiblePaneIds: ["main-chat", "chat-1", "terminal-1", "chat-2"],
    openPanes: [
      { id: "chat-1", type: "chat" },
      { id: "terminal-1", type: "terminal" },
      { id: "chat-2", type: "chat" },
    ],
  }, "goal-1");
  assert.equal(layout.columns.length, 2);
  assert.deepEqual(layout.columns[0].panels.map((item) => item.id), ["main-chat", "chat-2"]);
  assert.deepEqual(layout.columns[1].panels.map((item) => item.id), ["chat-1"]);
});

test("supports more than four panels without eviction", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
  for (let index = 0; index < 8; index += 1) {
    layout = canvas.feedCanvasReducer(layout, {
      type: "add-panel",
      panel: panel(`chat-${index}`),
    });
  }
  assert.equal(panelCount(layout), 9);
  assert.equal(layout.columns.length, 9);
  assert.ok(layout.columns.every((column) => column.widthWeight > 0.08));

  assert.ok(Math.abs(layout.columns.reduce((sum, column) => sum + column.widthWeight, 0) - 1) < 1e-9);
});

test("moves panels between stacks and new columns", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("chat-1") });
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("terminal-1", "terminal") });
  layout = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "terminal-1",
    target: { kind: "stack", columnId: "column-chat-1", index: 1 },
  });
  assert.equal(layout.columns.length, 2);
  assert.deepEqual(layout.columns[1].panels.map((item) => item.id), ["chat-1", "terminal-1"]);

  layout = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "terminal-1",
    target: { kind: "column", index: 0 },
  });
  assert.equal(layout.columns.length, 3);
  assert.equal(layout.columns[0].panels[0].id, "terminal-1");
});

test("normalizes column and panel weights after resizing", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("chat-1") });
  layout = canvas.feedCanvasReducer(layout, {
    type: "set-column-weights",
    firstColumnId: layout.columns[0].id,
    firstWeight: 3,
    secondColumnId: layout.columns[1].id,
    secondWeight: 1,
  });
  assert.ok(Math.abs(layout.columns[0].widthWeight - 0.75) < 0.0001);
  assert.ok(Math.abs(layout.columns[1].widthWeight - 0.25) < 0.0001);

  layout = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "chat-1",
    target: { kind: "stack", columnId: "column-main", index: 1 },
  });
  layout = canvas.feedCanvasReducer(layout, {
    type: "set-panel-weights",
    columnId: layout.columns[0].id,
    firstPanelId: "main-chat",
    firstWeight: 1,
    secondPanelId: "chat-1",
    secondWeight: 3,
  });
  assert.ok(Math.abs(layout.columns[0].panels[0].heightWeight - 0.25) < 0.0001);
  assert.ok(Math.abs(layout.columns[0].panels[1].heightWeight - 0.75) < 0.0001);

  assert.equal(layout.columns[0].panels.reduce((sum, item) => sum + item.heightWeight, 0), 1);
});

test("sanitizes corrupt layouts, missing tasks, and unsafe paths", () => {
  const layout = canvas.sanitizeFeedCanvasLayout({
    version: 1,
    goalId: "goal-1",
    activePanelId: "missing-task",
    columns: [{
      id: "column-1",
      widthWeight: -2,
      panels: [
        panel("valid", "chat", "task-1"),
        panel("missing-task", "chat", "task-missing"),
        { ...panel("unsafe", "file"), resource: { relativePath: "../secret.txt" } },
      ],
    }],
  }, "goal-1", ["goal-1", "task-1"]);
  assert.deepEqual(layout.columns[0].panels.map((item) => item.id), ["valid"]);
  assert.equal(layout.activePanelId, "valid");
  assert.equal(layout.columns[0].widthWeight, 1);
});

test("rejects unsafe layout identifiers and strips unknown resource fields", () => {
  const layout = canvas.sanitizeFeedCanvasLayout({
    version: 1,
    goalId: "goal-1",
    activePanelId: "files-safe",
    columns: [
      {
        id: "column-safe",
        widthWeight: 1,
        panels: [
          {
            ...panel("files-safe", "files"),
            resource: { clientId: "client-a", unexpected: "not-persisted" },
          },
          panel("bad\"selector", "chat"),
        ],
      },
      {
        id: "bad column",
        widthWeight: 1,
        panels: [panel("ignored")],
      },
    ],
  }, "goal-1", ["goal-1"]);

  assert.deepEqual(layout.columns.map((column) => column.id), ["column-safe"]);
  assert.deepEqual(layout.columns[0].panels.map((item) => item.id), ["files-safe"]);
  assert.deepEqual(layout.columns[0].panels[0].resource, { clientId: "client-a" });
});

test("persists only safe relative file paths, navigation keys, and plan version identifiers", () => {
  const layout = canvas.sanitizeFeedCanvasLayout({
    version: 1,
    goalId: "goal-1",
    activePanelId: "plan-safe",
    columns: [{
      id: "column-safe",
      widthWeight: 1,
      panels: [
        { ...panel("plan-safe", "plan"), resource: { planVersionId: "plan-2" } },
        { ...panel("file-safe", "file"), resource: { relativePath: "projects/briefs/demo/brief.md", navigationKey: "nav-123" } },
        { ...panel("changes-unsafe", "changes"), resource: { planVersionId: "bad version" } },
      ],
    }],
  }, "goal-1", ["goal-1"]);

  assert.deepEqual(layout.columns[0].panels[0].resource, { planVersionId: "plan-2" });
  assert.deepEqual(layout.columns[0].panels[1].resource, { relativePath: "projects/briefs/demo/brief.md", navigationKey: "nav-123" });
  assert.deepEqual(layout.columns[0].panels[2].resource, {});
});

test("deduplicates persisted column and panel identifiers", () => {
  const layout = canvas.sanitizeFeedCanvasLayout({
    version: 1,
    goalId: "goal-1",
    activePanelId: "chat-1",
    columns: [
      { id: "column-1", widthWeight: 1, panels: [panel("chat-1", "chat", "task-1")] },
      { id: "column-1", widthWeight: 1, panels: [panel("chat-2", "chat", "task-2")] },
      { id: "column-2", widthWeight: 1, panels: [panel("chat-1", "chat", "task-1"), panel("changes-1", "changes")] },
    ],
  }, "goal-1", ["goal-1", "task-1", "task-2"]);

  assert.deepEqual(layout.columns.map((column) => column.id), ["column-1", "column-2"]);
  assert.deepEqual(
    layout.columns.flatMap((column) => column.panels.map((item) => item.id)),
    ["chat-1", "changes-1"],
  );
});

test("removes legacy blank Chats and keeps one of every singleton panel", () => {
  const layout = canvas.sanitizeFeedCanvasLayout({
    version: 1,
    goalId: "goal-1",
    activePanelId: "legacy-chat",
    columns: [
      { id: "column-main", widthWeight: 1, panels: [{ ...panel("main-chat", "chat", "goal-1"), resource: { taskId: "goal-1", primary: true } }] },
      { id: "column-legacy", widthWeight: 1, panels: [panel("legacy-chat", "chat")] },
      { id: "column-files-a", widthWeight: 1, panels: [panel("files-a", "files")] },
      { id: "column-files-b", widthWeight: 1, panels: [panel("files-b", "files")] },
      { id: "column-viewer-a", widthWeight: 1, panels: [{ ...panel("viewer-a", "file"), resource: { relativePath: "README.md" } }] },
      { id: "column-viewer-b", widthWeight: 1, panels: [{ ...panel("viewer-b", "file"), resource: { relativePath: "AGENTS.md" } }] },
      { id: "column-plan-a", widthWeight: 1, panels: [panel("plan-a", "plan")] },
      { id: "column-plan-b", widthWeight: 1, panels: [panel("plan-b", "plan")] },
      { id: "column-changes-a", widthWeight: 1, panels: [panel("changes-a", "changes")] },
      { id: "column-changes-b", widthWeight: 1, panels: [panel("changes-b", "changes")] },
      { id: "column-subchats-a", widthWeight: 1, panels: [panel("subchats-a", "subchats")] },
      { id: "column-subchats-b", widthWeight: 1, panels: [panel("subchats-b", "subchats")] },
      { id: "column-terminal", widthWeight: 1, panels: [panel("terminal-old", "terminal")] },
    ],
  }, "goal-1", ["goal-1"]);

  const panels = layout.columns.flatMap((column) => column.panels);
  assert.deepEqual(panels.map((item) => item.id), ["main-chat", "files-a", "viewer-a", "plan-a", "changes-a", "subchats-a"]);
  assert.equal(layout.activePanelId, "main-chat");
});

test("repairs edited Goal duplicates while preserving subchats and resource panels", () => {
  const layout = canvas.sanitizeFeedCanvasLayout({
    version: 1,
    goalId: "goal-original",
    activePanelId: "duplicate-goal",
    columns: [
      {
        id: "column-main",
        widthWeight: 1,
        panels: [{
          ...panel("main-chat", "chat", "goal-original"),
          resource: { taskId: "goal-original", primary: true },
        }],
      },
      { id: "column-duplicate", widthWeight: 1, panels: [panel("duplicate-goal", "chat", "goal-edited")] },
      {
        id: "column-second-primary",
        widthWeight: 1,
        panels: [{
          ...panel("second-primary", "chat", "goal-edited"),
          resource: { taskId: "goal-edited", primary: true },
        }],
      },
      { id: "column-child-original", widthWeight: 1, panels: [panel("child-original-panel", "chat", "child-original")] },
      { id: "column-child-edited", widthWeight: 1, panels: [panel("child-edited-panel", "chat", "child-edited")] },
      { id: "column-files", widthWeight: 1, panels: [panel("files-1", "files")] },
      { id: "column-plan", widthWeight: 1, panels: [panel("plan-1", "plan")] },
    ],
  }, "goal-original", [
    "goal-original",
    "goal-edited",
    "child-original",
    "child-edited",
  ], "Main chat", ["goal-original", "goal-edited"], {
    "goal-original": "goal-edited",
    "goal-edited": "goal-edited",
    "child-original": "child-edited",
    "child-edited": "child-edited",
  });

  const panels = layout.columns.flatMap((column) => column.panels);
  assert.deepEqual(
    panels.map((item) => item.id),
    ["main-chat", "child-original-panel", "files-1", "plan-1"],
  );
  assert.deepEqual(panels[0].resource, { taskId: "goal-original", primary: true });
  assert.equal(panels[1].resource.taskId, "child-edited");
  assert.equal(layout.activePanelId, "main-chat");
});

test("adding singleton panels focuses the existing panel instead of duplicating it", () => {
  for (const type of ["files", "file", "plan", "changes", "subchats"]) {
    let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
    layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel(`${type}-a`, type) });
    layout = canvas.feedCanvasReducer(layout, { type: "focus-panel", panelId: "main-chat" });
    layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel(`${type}-b`, type) });
    assert.equal(layout.columns.flatMap((column) => column.panels).filter((item) => item.type === type).length, 1);
    assert.equal(layout.activePanelId, `${type}-a`);
  }
});

test("keeps the original layout when a stack target no longer exists", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("chat-1") });

  const result = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "chat-1",
    target: { kind: "stack", columnId: "missing", index: 0 },
  });

  assert.strictEqual(result, layout);
});

test("treats the boundaries around a single-panel source column as no-ops", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("chat-1") });

  const beforeOwnColumn = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "chat-1",
    target: { kind: "column", index: 1 },
  });
  const afterOwnColumn = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "chat-1",
    target: { kind: "column", index: 2 },
  });

  assert.strictEqual(beforeOwnColumn, layout);
  assert.strictEqual(afterOwnColumn, layout);
});

test("adjusts column boundary indexes after removing the source column", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("chat-1") });
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("chat-2") });

  layout = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "main-chat",
    target: { kind: "column", index: 3 },
  });

  assert.deepEqual(layout.columns.map((column) => column.panels[0].id), ["chat-1", "chat-2", "main-chat"]);
  assert.equal(layout.columns[2].id, "column-main");
});

test("inserts and reorders panels by stack boundary index", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("chat-1") });
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("terminal-1", "terminal") });
  layout = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "chat-1",
    target: { kind: "stack", columnId: "column-main", index: 1 },
  });
  layout = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "terminal-1",
    target: { kind: "stack", columnId: "column-main", index: 2 },
  });
  layout = canvas.feedCanvasReducer(layout, {
    type: "move-panel",
    panelId: "main-chat",
    target: { kind: "stack", columnId: "column-main", index: 3 },
  });

  assert.deepEqual(layout.columns[0].panels.map((item) => item.id), ["chat-1", "terminal-1", "main-chat"]);
  assert.ok(layout.columns[0].panels.every((item) => item.heightWeight > 0));
  assert.ok(Math.abs(layout.columns[0].panels.reduce((sum, item) => sum + item.heightWeight, 0) - 1) < 1e-9);
});

test("closing the active panel selects a deterministic remaining panel", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("chat-1") });
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("terminal-1", "terminal") });
  assert.equal(layout.activePanelId, "terminal-1");

  layout = canvas.feedCanvasReducer(layout, { type: "remove-panel", panelId: "terminal-1" });
  assert.equal(layout.activePanelId, "main-chat");
});

test("closing the final panel restores the main Chat", () => {
  const initial = canvas.createDefaultFeedCanvasLayout("goal-1", "Main Goal");
  const layout = canvas.feedCanvasReducer(initial, {
    type: "remove-panel",
    panelId: "main-chat",
    mainLabel: "Main Goal",
  });
  assert.equal(panelCount(layout), 1);
  assert.equal(layout.columns[0].panels[0].id, "main-chat");
  assert.equal(layout.columns[0].panels[0].label, "Main Goal");
});

test("a closed primary Chat can be restored once without duplicating it", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1", "Main chat");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("files-1", "files") });
  layout = canvas.feedCanvasReducer(layout, { type: "remove-panel", panelId: "main-chat" });
  assert.equal(layout.columns.flatMap((column) => column.panels).some((item) => item.resource?.primary), false);

  const main = canvas.createMainChatPanel("goal-1", "Main chat");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: main });
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: main });
  assert.equal(layout.columns.flatMap((column) => column.panels).filter((item) => item.resource?.primary).length, 1);
  assert.equal(layout.activePanelId, "main-chat");
});

test("a differently identified primary Chat focuses the existing Main Chat", () => {
  let layout = canvas.createDefaultFeedCanvasLayout("goal-1", "Main chat");
  layout = canvas.feedCanvasReducer(layout, { type: "add-panel", panel: panel("files-1", "files") });
  layout = canvas.feedCanvasReducer(layout, {
    type: "add-panel",
    panel: {
      ...panel("another-main", "chat", "goal-edited"),
      resource: { taskId: "goal-edited", primary: true },
    },
  });

  const primaryPanels = layout.columns
    .flatMap((column) => column.panels)
    .filter((item) => item.type === "chat" && item.resource?.primary);
  assert.deepEqual(primaryPanels.map((item) => item.id), ["main-chat"]);
  assert.equal(layout.activePanelId, "main-chat");
});

test("sanitizing keeps a primary Chat on its edited child conversation", () => {
  const layout = canvas.sanitizeFeedCanvasLayout({
    version: 1,
    goalId: "goal-1",
    activePanelId: "main-chat",
    columns: [{
      id: "column-main",
      widthWeight: 1,
      panels: [{
        ...panel("main-chat", "chat", "child-original"),
        resource: { taskId: "child-original", primary: true },
      }],
    }],
  }, "goal-1", ["goal-1", "child-original", "child-edited"], "Main chat", ["goal-1"], {
    "child-original": "child-edited",
    "child-edited": "child-edited",
  });

  assert.deepEqual(layout.columns[0].panels[0].resource, {
    taskId: "child-edited",
    primary: true,
  });
});
