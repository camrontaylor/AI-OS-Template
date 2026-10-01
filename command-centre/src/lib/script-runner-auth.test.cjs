const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const terminalOutput = loadTsModule(path.resolve(__dirname, "terminal-output.ts"));
const modulePath = path.resolve(__dirname, "script-runner-auth.ts");
const {
  UPDATE_TOKEN_REQUIRED_MARKER,
  shouldRequestUpdateToken,
} = loadTsModule(modulePath, {
  stubs: {
    "./terminal-output": terminalOutput,
  },
});

test("detects update token request from marker", () => {
  assert.equal(
    shouldRequestUpdateToken({
      scriptId: "update",
      exitCode: 1,
      output: `before\n${UPDATE_TOKEN_REQUIRED_MARKER}\nafter`,
    }),
    true,
  );
});

test("detects update token request when marker has terminal color codes", () => {
  assert.equal(
    shouldRequestUpdateToken({
      scriptId: "update",
      exitCode: 1,
      output: `before\n\u001b[1;33m${UPDATE_TOKEN_REQUIRED_MARKER}\u001b[0m\nafter`,
    }),
    true,
  );
});

test("detects update token request from exit code 20", () => {
  assert.equal(
    shouldRequestUpdateToken({
      scriptId: "update",
      exitCode: 20,
      output: "",
    }),
    true,
  );
});

test("does not request token for other scripts", () => {
  assert.equal(
    shouldRequestUpdateToken({
      scriptId: "memory-setup",
      exitCode: 20,
      output: UPDATE_TOKEN_REQUIRED_MARKER,
    }),
    false,
  );
});
