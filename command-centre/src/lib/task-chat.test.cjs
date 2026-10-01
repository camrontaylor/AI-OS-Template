const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const taskChatSourcePath = path.resolve(__dirname, "task-chat.ts");

function loadTaskChatModule() {
  const source = fs.readFileSync(taskChatSourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === "@/types/task") {
      return {};
    }
    return require(request);
  };
  const compiled = new Function(
    "require",
    "module",
    "exports",
    "__dirname",
    "__filename",
    outputText,
  );
  compiled(localRequire, module, module.exports, path.dirname(taskChatSourcePath), taskChatSourcePath);
  return module.exports;
}

const {
  hasVisibleAssistantResponse,
  shouldShowCompletedTaskMarker,
  shouldShowInitialTaskSpinner,
} = loadTaskChatModule();

test("hasVisibleAssistantResponse ignores pure tool activity and system noise", () => {
  assert.equal(
    hasVisibleAssistantResponse([
      { id: "1", type: "system", content: "Queued", timestamp: "2026-04-17T12:00:00.000Z" },
      { id: "2", type: "tool_use", content: "Read file", timestamp: "2026-04-17T12:00:01.000Z" },
      { id: "3", type: "tool_result", content: "Done", timestamp: "2026-04-17T12:00:02.000Z" },
    ]),
    false,
  );
});

test("hasVisibleAssistantResponse returns true once visible assistant content exists", () => {
  assert.equal(
    hasVisibleAssistantResponse([
      { id: "1", type: "tool_use", content: "Read file", timestamp: "2026-04-17T12:00:00.000Z" },
      { id: "2", type: "text", content: "Here is the plan.", timestamp: "2026-04-17T12:00:01.000Z" },
    ]),
    true,
  );
});

test("shouldShowInitialTaskSpinner covers queued first-turn state", () => {
  assert.equal(
    shouldShowInitialTaskSpinner({
      status: "queued",
      isRunning: false,
      needsInput: false,
      hasVisibleResponse: false,
    }),
    true,
  );
});

test("shouldShowInitialTaskSpinner stops once a visible response exists or input is needed", () => {
  assert.equal(
    shouldShowInitialTaskSpinner({
      status: "running",
      isRunning: true,
      needsInput: false,
      hasVisibleResponse: true,
    }),
    false,
  );
  assert.equal(
    shouldShowInitialTaskSpinner({
      status: "running",
      isRunning: true,
      needsInput: true,
      hasVisibleResponse: false,
    }),
    false,
  );
});

test("shouldShowCompletedTaskMarker is suppressed while subagents are active", () => {
  assert.equal(
    shouldShowCompletedTaskMarker({
      status: "review",
      isRunning: false,
      activeSubagentCount: 1,
      totalWorkSeconds: 19,
    }),
    false,
  );
  assert.equal(
    shouldShowCompletedTaskMarker({
      status: "review",
      isRunning: false,
      activeSubagentCount: 0,
      totalWorkSeconds: 19,
    }),
    true,
  );
});
