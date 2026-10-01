const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const terminalOutput = loadTsModule(path.resolve(__dirname, "terminal-output.ts"));
const display = loadTsModule(path.resolve(__dirname, "script-runner-display.ts"), {
  stubs: {
    "./terminal-output": terminalOutput,
  },
});

test("update runs hide terminal details by default", () => {
  const state = display.getScriptRunnerViewState({
    scriptId: "update",
    status: "running",
    needsUpdateToken: false,
    output: "",
    lineCount: 1,
    showOutput: display.getInitialShowOutput("update"),
  });

  assert.equal(state.showUpdateStatus, true);
  assert.equal(state.terminalVisible, false);
  assert.equal(state.detailsToggleVisible, true);
  assert.equal(state.detailsToggleLabel, "Show details");
});

test("show details reveals cleaned terminal output", () => {
  const state = display.getScriptRunnerViewState({
    scriptId: "update",
    status: "running",
    needsUpdateToken: false,
    output: "\u001b[0;32m\u2713 No local skill modifications detected.\u001b[0m",
    lineCount: 1,
    showOutput: true,
  });

  assert.equal(state.terminalVisible, true);
  assert.equal(state.detailsToggleLabel, "Hide details");
  assert.equal(
    display.cleanScriptOutput("\u001b[0;32m\u2713 No local skill modifications detected.\u001b[0m"),
    "\u2713 No local skill modifications detected.",
  );
});

test("token-required update failure shows retry state", () => {
  const state = display.getScriptRunnerViewState({
    scriptId: "update",
    status: "error",
    needsUpdateToken: true,
    output: "AI_OS_UPDATE_TOKEN_REQUIRED",
    lineCount: 2,
    showOutput: false,
  });

  assert.equal(state.showUpdateStatus, true);
  assert.equal(state.terminalVisible, false);
  assert.equal(state.updateStatus.title, "New access token required");
  assert.equal(state.updateStatus.tone, "warning");
});

test("other scripts keep terminal visible by default", () => {
  const state = display.getScriptRunnerViewState({
    scriptId: "memory-setup",
    status: "running",
    needsUpdateToken: false,
    output: "",
    lineCount: 0,
    showOutput: display.getInitialShowOutput("memory-setup"),
  });

  assert.equal(state.showUpdateStatus, false);
  assert.equal(state.terminalVisible, true);
  assert.equal(state.detailsToggleVisible, false);
});
