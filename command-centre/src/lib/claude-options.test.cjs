const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const {
  CLAUDE_MODEL_OPTIONS,
  getSupportedClaudeThinkingEfforts,
  isClaudeModel,
  normalizeClaudeModel,
  normalizeClaudeThinkingEffortForModel,
} = loadTsModule(path.resolve(__dirname, "claude-options.ts"));

test("Claude model options include only default visible model names", () => {
  assert.deepEqual(
    CLAUDE_MODEL_OPTIONS.map((option) => option.value),
    ["haiku", "sonnet", "opus", "fable"],
  );
});

test("Claude model validation accepts safe aliases and custom IDs", () => {
  assert.equal(normalizeClaudeModel(" Fable "), "fable");
  assert.equal(normalizeClaudeModel("best"), "best");
  assert.equal(normalizeClaudeModel("opus[1m]"), "opus[1m]");
  assert.equal(normalizeClaudeModel("sonnet[1m]"), "sonnet[1m]");
  assert.equal(normalizeClaudeModel("claude-fable-5"), "claude-fable-5");
  assert.equal(normalizeClaudeModel("my-gateway/claude-opus-4-8"), "my-gateway/claude-opus-4-8");
  assert.equal(isClaudeModel("claude-fable-5"), true);
  assert.equal(isClaudeModel("bad model"), false);
  assert.equal(isClaudeModel(""), false);
});

test("thinking effort options are filtered by Claude model", () => {
  assert.deepEqual(
    getSupportedClaudeThinkingEfforts("fable"),
    ["auto", "low", "medium", "high", "xhigh", "max"],
  );
  assert.deepEqual(
    getSupportedClaudeThinkingEfforts("opus"),
    ["auto", "low", "medium", "high", "xhigh", "max"],
  );
  assert.deepEqual(
    getSupportedClaudeThinkingEfforts("sonnet"),
    ["auto", "low", "medium", "high", "max"],
  );
  assert.deepEqual(getSupportedClaudeThinkingEfforts("haiku"), ["auto"]);
  assert.deepEqual(
    getSupportedClaudeThinkingEfforts("claude-fable-5"),
    ["auto", "low", "medium", "high", "xhigh", "max"],
  );
});

test("thinking effort is normalized when switching models", () => {
  assert.equal(normalizeClaudeThinkingEffortForModel("sonnet", "xhigh"), "high");
  assert.equal(normalizeClaudeThinkingEffortForModel("haiku", "high"), "auto");
  assert.equal(normalizeClaudeThinkingEffortForModel("opus", "xhigh"), "xhigh");
  assert.equal(normalizeClaudeThinkingEffortForModel("fable", "xhigh"), "xhigh");
  assert.equal(normalizeClaudeThinkingEffortForModel("claude-fable-5", "xhigh"), "xhigh");
  assert.equal(normalizeClaudeThinkingEffortForModel("sonnet", null), null);
});
