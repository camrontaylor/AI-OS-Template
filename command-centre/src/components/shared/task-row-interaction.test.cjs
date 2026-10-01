const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const { shouldActivateSubtaskRowKey } = loadTsModule(path.resolve(__dirname, "task-row-interaction.ts"));

test("Enter and Space activate a focused subtask row", () => {
  assert.equal(shouldActivateSubtaskRowKey("Enter", true), true);
  assert.equal(shouldActivateSubtaskRowKey(" ", true), true);
  assert.equal(shouldActivateSubtaskRowKey("ArrowDown", true), false);
});

test("keys from an internal control never activate the parent row", () => {
  assert.equal(shouldActivateSubtaskRowKey("Enter", false), false);
  assert.equal(shouldActivateSubtaskRowKey(" ", false), false);
});
