const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const { resolvePopoverPosition } = loadTsModule(path.resolve(__dirname, "popover-position.ts"));

const base = {
  viewportWidth: 1087,
  viewportHeight: 860,
  popoverWidth: 200,
  contentHeight: 80,
  maxHeight: 240,
  gap: 4,
  viewportPadding: 8,
};

test("flips above when the preferred space below is too small", () => {
  const position = resolvePopoverPosition({
    ...base,
    anchor: { top: 799, bottom: 823, left: 639, width: 53 },
    preferredPlacement: "below",
  });

  assert.equal(position.placement, "above");
  assert.equal(position.top, 715);
  assert.equal(position.maxHeight, 240);
});

test("keeps the preferred placement when the popover fits", () => {
  const below = resolvePopoverPosition({
    ...base,
    anchor: { top: 100, bottom: 124, left: 120, width: 80 },
    preferredPlacement: "below",
  });
  const above = resolvePopoverPosition({
    ...base,
    anchor: { top: 500, bottom: 524, left: 120, width: 80 },
    preferredPlacement: "above",
  });

  assert.equal(below.placement, "below");
  assert.equal(below.top, 128);
  assert.equal(above.placement, "above");
  assert.equal(above.top, 416);
});

test("uses the roomier side and constrains height when neither side fits", () => {
  const position = resolvePopoverPosition({
    viewportWidth: 500,
    viewportHeight: 300,
    anchor: { top: 120, bottom: 144, left: 80, width: 200 },
    popoverWidth: 200,
    contentHeight: 360,
    maxHeight: 360,
    preferredPlacement: "above",
  });

  assert.equal(position.placement, "below");
  assert.equal(position.maxHeight, 144);
  assert.equal(position.top, 148);
  assert.equal(position.top + position.maxHeight, 292);
});

test("clamps width and horizontal position inside the viewport", () => {
  const rightEdge = resolvePopoverPosition({
    ...base,
    anchor: { top: 100, bottom: 124, left: 980, width: 80 },
    preferredPlacement: "below",
  });
  const narrowViewport = resolvePopoverPosition({
    ...base,
    viewportWidth: 180,
    anchor: { top: 100, bottom: 124, left: -20, width: 80 },
    preferredPlacement: "below",
  });

  assert.equal(rightEdge.left, 879);
  assert.equal(rightEdge.left + rightEdge.width, 1079);
  assert.equal(narrowViewport.left, 8);
  assert.equal(narrowViewport.width, 164);
});

test("composer menus all use the shared viewport resolver", () => {
  const files = [
    "model-picker.tsx",
    "permission-picker.tsx",
    "thinking-effort-picker.tsx",
    "tag-picker.tsx",
    "slash-command-menu.tsx",
    "tasks-popover.tsx",
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.resolve(__dirname, file), "utf8");
    assert.match(source, /resolvePopoverPosition/, file);
  }

  const slashMenu = fs.readFileSync(path.resolve(__dirname, "slash-command-menu.tsx"), "utf8");
  assert.match(slashMenu, /createPortal/);
  assert.match(slashMenu, /zIndex: POPOVER_LAYER_Z_INDEX/);
  assert.match(slashMenu, /menuRef\.current\?\.contains\(target\)/);
  assert.match(slashMenu, /anchorRef\.current\?\.parentElement/);
  assert.match(slashMenu, /anchorContainer\?\.contains\(target\)/);
});
