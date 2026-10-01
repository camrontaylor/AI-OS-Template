const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const resize = loadTsModule(path.resolve(__dirname, "feed-canvas-resize.ts"));

test("resize pair preserves combined weight and clamps both sides", () => {
  const moved = resize.computeFeedCanvasResizePair({
    startFirstSize: 300,
    combinedSize: 600,
    combinedWeight: 0.75,
    delta: 120,
  });
  assert.equal(moved.firstSize, 420);
  assert.equal(moved.secondSize, 180);
  assert.ok(Math.abs(moved.firstWeight + moved.secondWeight - 0.75) < 1e-9);

  const clamped = resize.computeFeedCanvasResizePair({
    startFirstSize: 300,
    combinedSize: 600,
    combinedWeight: 1,
    delta: -1000,
    minSize: 24,
  });
  assert.equal(clamped.firstSize, 24);
  assert.equal(clamped.secondSize, 576);
});

test("canvas resize commits React weights only from its finish paths", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "feed-canvas.tsx"), "utf8");
  assert.equal((source.match(/onSetColumnWeights\(/g) ?? []).length, 1);
  assert.equal((source.match(/onSetPanelWeights\(/g) ?? []).length, 1);
  assert.match(source, /requestAnimationFrame\(paint\)/);
  assert.match(source, /freezeColumnDocuments/);
});
