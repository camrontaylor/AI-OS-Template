const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const registry = loadTsModule(path.resolve(__dirname, "feed-panel-registry.ts"));

test("the panel menu excludes generic Chat while keeping internal Chat support", () => {
  assert.equal(registry.FEED_PANEL_REGISTRY.chat.enabled, true);
  assert.equal(registry.FEED_PANEL_REGISTRY.chat.addable, false);
  assert.equal(registry.AVAILABLE_FEED_PANELS.some((panel) => panel.type === "chat"), false);
});

test("singleton and availability metadata match the panel menu rules", () => {
  for (const type of ["plan", "changes", "files", "file", "subchats"]) {
    assert.equal(registry.FEED_PANEL_REGISTRY[type].singleton, true);
    assert.equal(registry.FEED_PANEL_REGISTRY[type].availability, "available");
  }
  assert.equal(registry.FEED_PANEL_REGISTRY.terminal.availability, "coming-soon");
  assert.equal(registry.FEED_PANEL_REGISTRY.terminal.singleton, false);
});

test("addable panels keep Terminal last in the menu", () => {
  assert.deepEqual(
    registry.AVAILABLE_FEED_PANELS.map((panel) => panel.type),
    ["subchats", "file", "files", "plan", "changes", "terminal"],
  );
});

test("coming-soon panels are disabled and labeled in the menu", () => {
  const menuSource = fs.readFileSync(path.resolve(__dirname, "feed-panel-menu.tsx"), "utf8");
  assert.match(menuSource, /disabled=\{comingSoon\}/);
  assert.match(menuSource, />Coming soon<\/span>/);
});
