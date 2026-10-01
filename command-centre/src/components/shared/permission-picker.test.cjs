const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.resolve(__dirname, "permission-picker.tsx"), "utf8");

test("permission picker presents the four canonical modes in the approved order", () => {
  const ask = source.indexOf('value: "default"');
  const auto = source.indexOf('value: "auto"');
  const fullAccess = source.indexOf('value: "bypassPermissions"');
  const plan = source.indexOf('value: "plan"');

  assert.ok(ask >= 0 && ask < auto && auto < fullAccess && fullAccess < plan);
  assert.match(source, /Claude asks before actions that need permission\./);
  assert.match(source, /Works independently, with background checks for unsafe actions\./);
  assert.match(source, /Runs without asking or permission checks\./);
  assert.match(source, /Creates a plan first, then waits for your approval\./);
});

test("permission picker keeps legacy Auto-edit contextual and Full access warning-only", () => {
  assert.match(source, /value === "acceptEdits" \? \[LEGACY_OPTION, \.\.\.OPTIONS\] : OPTIONS/);
  assert.match(source, /Auto-edit \(legacy\)/);
  assert.match(source, /--cc-status-warning-bg/);
  assert.doesNotMatch(source, /--cc-status-danger/);
});

test("permission picker is portalled, responsive, and keyboard accessible", () => {
  assert.match(source, /createPortal/);
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitemradio"/);
  assert.match(source, /aria-checked/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /Home/);
  assert.match(source, /End/);
  assert.match(source, /Escape/);
  assert.match(source, /VIEWPORT_PADDING = 8/);
  assert.match(source, /DROPDOWN_WIDTH = 320/);
});
