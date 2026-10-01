const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

const modalSource = read("composer-editor-modal.tsx");
const modalStyles = read("composer-editor-modal.module.css");
const replySource = read("../modal/reply-input.tsx");
const newGoalSource = read("../board/new-goal-panel.tsx");
const editMessageSource = read("../modal/chat-entry.tsx");
const themeSource = read("../../design-system/theme.css");
const tokensSource = read("../../design-system/tokens.ts");

test("composer modal keeps its backdrop separate from the dialog", () => {
  const backdropIndex = modalSource.indexOf("className={styles.backdrop}");
  const dialogIndex = modalSource.indexOf('role="dialog"');
  const backdropSource = modalSource.slice(backdropIndex, dialogIndex);

  assert.ok(backdropIndex >= 0);
  assert.ok(dialogIndex > backdropIndex);
  assert.match(modalSource, /pointerStartedOnBackdrop\.current = true/);
  assert.match(backdropSource, /onMouseDown=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\)/);
  assert.match(backdropSource, /onClick=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\)/);
  assert.match(modalSource, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(modalSource, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(modalSource, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(modalStyles, /\.backdrop\s*\{[\s\S]*background: var\(--cc-canvas-overlay-focus\)/);
});

test("Goal composers omit the footer close action while message editing keeps Cancel", () => {
  assert.match(modalSource, /closeLabel\?: string/);
  assert.match(modalSource, /\{closeLabel \? \(/);
  assert.doesNotMatch(replySource, /closeLabel="Close"/);
  assert.doesNotMatch(newGoalSource, /closeLabel="Close"/);
  assert.match(editMessageSource, /closeLabel="Cancel"/);
});

test("collapsed editor keeps a full 180px writing area with scrollbar clearance", () => {
  assert.match(modalStyles, /flex: 0 0 180px/);
  assert.match(modalStyles, /\.editorContent\s*\{[\s\S]*height: 100%/);
  assert.match(modalStyles, /\.expandButton\s*\{[\s\S]*right: 20px/);
  assert.match(replySource, /12px 56px 12px 12px/);
  assert.match(newGoalSource, /12px 56px 12px 12px/);
  assert.match(editMessageSource, /12px 56px 12px 12px/);
});

test("focus overlay is theme-aware and remains translucent enough to show blur", () => {
  assert.match(themeSource, /--cc-canvas-overlay-focus: rgba\(252, 249, 247, 0\.42\)/);
  assert.match(themeSource, /--cc-canvas-overlay-focus: rgba\(20, 21, 24, 0\.42\)/);
  assert.match(tokensSource, /canvasOverlayFocus: cssVar\("--cc-canvas-overlay-focus"\)/);
  assert.match(modalSource, /backdropFilter: "blur\(12px\)"/);
});

test("portalled composer pickers share a layer above the modal", () => {
  const pickerSources = [
    read("model-picker.tsx"),
    read("thinking-effort-picker.tsx"),
    read("permission-picker.tsx"),
    read("tag-picker.tsx"),
  ];

  for (const source of pickerSources) {
    assert.match(source, /POPOVER_LAYER_Z_INDEX/);
    assert.match(source, /zIndex: POPOVER_LAYER_Z_INDEX/);
  }
  assert.match(read("popover-position.ts"), /POPOVER_LAYER_Z_INDEX = 1100/);
});

test("Escape closes an open picker without also closing the composer modal", () => {
  assert.match(modalSource, /event\.defaultPrevented/);
  assert.match(modalSource, /data-composer-popover-open/);

  for (const source of [
    read("model-picker.tsx"),
    read("permission-picker.tsx"),
    read("thinking-effort-picker.tsx"),
    read("tag-picker.tsx"),
    read("slash-command-menu.tsx"),
    read("tasks-popover.tsx"),
  ]) {
    assert.match(source, /data-composer-popover-open="true"/);
  }
});

test("expanded reply shortcut closes only when the message can be submitted", () => {
  assert.match(replySource, /if \(!canSubmit \|\| isSending \|\| isStopAction\) return;/);
  assert.match(replySource, /\[canSubmit, closeComposerModal, handleSubmit, isSending, isStopAction/);
});
