const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "terminal-output.ts");
const { cleanTerminalOutput, stripAnsi } = loadTsModule(modulePath);

test("stripAnsi removes terminal color codes", () => {
  assert.equal(stripAnsi("\u001b[0;32m\u2713 text\u001b[0m"), "\u2713 text");
});

test("cleanTerminalOutput normalizes carriage returns", () => {
  assert.equal(cleanTerminalOutput("\u001b[0;36mLine one\u001b[0m\r\nLine two\r"), "Line one\nLine two\n");
});
