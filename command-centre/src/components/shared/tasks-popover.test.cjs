const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const { resolvePopoverPosition } = loadTsModule(path.resolve(__dirname, "popover-position.ts"));
const source = fs.readFileSync(path.resolve(__dirname, "tasks-popover.tsx"), "utf8");

test("tasks popover stays inside a 1280 by 720 viewport near the right edge", () => {
  const position = resolvePopoverPosition({
    anchor: { top: 650, bottom: 676, left: 1200, width: 64 },
    viewportWidth: 1280,
    viewportHeight: 720,
    popoverWidth: 340,
    contentHeight: 400,
    maxHeight: 400,
    preferredPlacement: "above",
    gap: 6,
    viewportPadding: 8,
  });

  assert.equal(position.placement, "above");
  assert.ok(position.left >= 8);
  assert.ok(position.left + position.width <= 1272);
  assert.ok(position.top >= 8);
  assert.ok(position.top + position.maxHeight <= 712);
});

test("tasks popover uses the shared portal layer and viewport resolver", () => {
  assert.match(source, /createPortal/);
  assert.match(source, /resolvePopoverPosition/);
  assert.match(source, /zIndex: POPOVER_LAYER_Z_INDEX/);
  assert.doesNotMatch(source, /zIndex: 9999/);
});

test("subtask rows can be opened with click, Enter, and Space", () => {
  assert.match(source, /role=\{interactive \? "button" : undefined\}/);
  assert.match(source, /tabIndex=\{interactive \? 0 : undefined\}/);
  assert.match(source, /aria-label=\{interactive \? `Open \$\{st\.title\}` : undefined\}/);
  assert.match(source, /shouldActivateSubtaskRowKey\(event\.key, event\.target === event\.currentTarget\)/);
  assert.match(source, /onSelectSubtask\(st\.id\);[\s\S]*setOpen\(false\);/);
});

test("keyboard events from the internal status button do not open the row", () => {
  assert.match(source, /aria-label=\{done \? `Mark \$\{st\.title\} incomplete` : `Mark \$\{st\.title\} done`\}/);
  assert.match(source, /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);/);
});

test("interactive rows expose a visible keyboard focus outline", () => {
  assert.match(source, /onFocus=\{\(event\) => \{/);
  assert.match(source, /2px solid var\(--cc-brand-primary\)/);
  assert.match(source, /onBlur=\{\(event\) => \{/);
});
