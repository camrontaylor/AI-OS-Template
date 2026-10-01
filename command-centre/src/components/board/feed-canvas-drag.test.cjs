const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const drag = loadTsModule(path.resolve(__dirname, "feed-canvas-drag.ts"));

const geometry = {
  boundaries: [0, 208, 416],
  columns: [
    { id: "left", left: 0, right: 204, top: 0, bottom: 400, panels: [
      { id: "a", top: 0, bottom: 196 },
      { id: "b", top: 204, bottom: 400 },
    ] },
    { id: "right", left: 212, right: 416, top: 0, bottom: 400, panels: [
      { id: "c", top: 0, bottom: 400 },
    ] },
  ],
};

const source = { columnId: "left", columnIndex: 0, panelIndex: 0, columnPanelCount: 2 };

test("vertical boundaries win anywhere inside the 26px intent radius", () => {
  assert.deepEqual(drag.computeFeedCanvasDropTarget({ x: 183, y: 390, geometry, source }), { kind: "column", index: 1 });
  assert.deepEqual(drag.computeFeedCanvasDropTarget({ x: 233, y: 10, geometry, source }), { kind: "column", index: 1 });
});

test("outside the boundary radius the panel midpoint chooses above or below", () => {
  assert.deepEqual(drag.computeFeedCanvasDropTarget({ x: 300, y: 100, geometry, source }), { kind: "stack", columnId: "right", index: 0 });
  assert.deepEqual(drag.computeFeedCanvasDropTarget({ x: 300, y: 300, geometry, source }), { kind: "stack", columnId: "right", index: 1 });
});

test("targets that keep the same layout are ignored", () => {
  assert.equal(drag.computeFeedCanvasDropTarget({ x: 100, y: 10, geometry, source }), null);
  assert.equal(drag.computeFeedCanvasDropTarget({ x: 100, y: 180, geometry, source }), null);
});

test("the two boundaries around a one-panel source column are no-ops", () => {
  const single = { columnId: "right", columnIndex: 1, panelIndex: 0, columnPanelCount: 1 };
  assert.equal(drag.computeFeedCanvasDropTarget({ x: 208, y: 200, geometry, source: single }), null);
  assert.equal(drag.computeFeedCanvasDropTarget({ x: 416, y: 200, geometry, source: single }), null);
});
