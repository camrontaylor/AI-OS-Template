const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const claudeOptions = loadTsModule(path.resolve(__dirname, "claude-options.ts"), {
  stubs: { "@/types/task": {} },
});
const autoMode = loadTsModule(path.resolve(__dirname, "claude-auto-mode.ts"), {
  stubs: {
    "@/lib/claude-options": claudeOptions,
    "@/types/task": {},
  },
});

test("Claude CLI versions use numeric comparison", () => {
  for (const [output, expected] of [
    ["2.1.82 (Claude Code)", -1],
    ["2.1.83 (Claude Code)", 0],
    ["2.1.100 (Claude Code)", 1],
    ["2.2.0 (Claude Code)", 1],
  ]) {
    const version = autoMode.parseClaudeCliVersion(output);
    assert.ok(version);
    assert.equal(autoMode.compareVersions(version, autoMode.AUTO_MODE_MINIMUM_CLI_VERSION), expected);
  }
  assert.equal(autoMode.parseClaudeCliVersion("unknown"), null);
});

test("Auto disables only models that are certainly incompatible", () => {
  assert.equal(autoMode.getAutoModeModelCompatibility("haiku"), "incompatible");
  assert.equal(autoMode.getAutoModeModelCompatibility("claude-3-opus-20240229"), "incompatible");
  assert.equal(autoMode.getAutoModeModelCompatibility("claude-sonnet-4-5-20250929"), "incompatible");
  assert.equal(autoMode.getAutoModeModelCompatibility("claude-sonnet-4-6"), "compatible");
  assert.equal(autoMode.getAutoModeModelCompatibility("opus"), "compatible");
  assert.equal(autoMode.getAutoModeModelCompatibility("fable"), "unknown");
  assert.equal(autoMode.getAutoModeModelCompatibility("gateway-future-model"), "unknown");
  assert.equal(autoMode.getAutoModeModelCompatibility(null), "unknown");
});

test("Auto state includes a staged execution mode", () => {
  assert.equal(autoMode.permissionStateUsesAuto("plan", "auto"), true);
  assert.equal(autoMode.permissionStateUsesAuto("auto", "auto"), true);
  assert.equal(autoMode.permissionStateUsesAuto("default", "default"), false);
});
