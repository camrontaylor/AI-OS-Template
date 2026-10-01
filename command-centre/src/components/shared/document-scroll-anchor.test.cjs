const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const anchors = loadTsModule(path.resolve(__dirname, "document-scroll-anchor.ts"));

test("line 57 and its visual offset survive edit, save, and cancel conversions", () => {
  const lineHeight = 19.2;
  const original = { line: 57, offset: -7.5 };
  const editorScroll = anchors.textareaScrollForAnchor(original, lineHeight);
  const afterEdit = anchors.textareaAnchorFromScroll(editorScroll, lineHeight);
  assert.equal(afterEdit.line, 57);
  assert.ok(Math.abs(afterEdit.offset - original.offset) < 0.001);

  const afterSaveScroll = anchors.textareaScrollForAnchor(afterEdit, lineHeight);
  const afterCancel = anchors.textareaAnchorFromScroll(afterSaveScroll, lineHeight);
  assert.deepEqual(afterCancel, afterEdit);
});
