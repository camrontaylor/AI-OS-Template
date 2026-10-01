const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const pastedTextSourcePath = path.resolve(__dirname, "pasted-text.ts");

function loadPastedTextModule() {
  const source = fs.readFileSync(pastedTextSourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const compiled = new Function(
    "require",
    "module",
    "exports",
    "__dirname",
    "__filename",
    outputText,
  );
  compiled(require, module, module.exports, path.dirname(pastedTextSourcePath), pastedTextSourcePath);
  return module.exports;
}

const {
  shouldCapturePastedText,
  getPastedTextSummary,
  appendPendingPastedText,
  insertPastedTextAtSelection,
  removePendingPastedText,
} = loadPastedTextModule();

test("shouldCapturePastedText uses both line and character thresholds", () => {
  assert.equal(shouldCapturePastedText("short text"), false);
  assert.equal(shouldCapturePastedText(Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join("\n")), true);
  assert.equal(shouldCapturePastedText("x".repeat(321)), true);
});

test("getPastedTextSummary returns readable labels and previews", () => {
  const summary = getPastedTextSummary("alpha\nbeta\ngamma");
  assert.equal(summary.label, "3 lines · 16 chars");
  assert.equal(summary.preview, "alpha\nbeta\ngamma");
});

test("appendPendingPastedText preserves original paste order", () => {
  const message = appendPendingPastedText("Draft reply", [
    { id: "one", text: "First block" },
    { id: "two", text: "Second block" },
  ]);
  assert.equal(message, "Draft reply\n\nFirst block\n\n---\n\nSecond block");
});

test("insertPastedTextAtSelection injects text at the current cursor", () => {
  const result = insertPastedTextAtSelection("Hello world", " brave", 5, 5);
  assert.deepEqual(result, {
    value: "Hello brave world",
    selectionStart: 11,
    selectionEnd: 11,
  });
});

test("removePendingPastedText drops only the selected block", () => {
  const blocks = removePendingPastedText([
    { id: "one", text: "First block" },
    { id: "two", text: "Second block" },
  ], "one");

  assert.deepEqual(blocks, [{ id: "two", text: "Second block" }]);
});
