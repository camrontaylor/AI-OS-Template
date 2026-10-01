const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "chat-message-content.ts");
const content = loadTsModule(modulePath, {
  stubs: {
    "@/lib/pasted-text": {
      appendPendingPastedText(value, blocks) {
        const base = value.trim();
        const appended = blocks
          .map((block) => block.text)
          .filter(Boolean)
          .join("\n\n---\n\n");
        if (!appended) return base;
        return base ? `${base}\n\n${appended}` : appended;
      },
    },
    "@/types/chat-composer": {},
  },
});

test("expandComposerPastedBlocks appends captured pasted text before send", () => {
  const expanded = content.expandComposerPastedBlocks(
    "Please review",
    [{ id: "abc123", label: "[Pasted text +12 lines abc123]", text: "line 1\nline 2" }],
  );

  assert.equal(expanded, "Please review\n\nline 1\nline 2");
});

test("composeMessageWithAttachments appends relative file paths in Claude-friendly format", () => {
  const composed = content.composeMessageWithAttachments("Check these files", [
    { fileName: "notes.md", relativePath: ".tmp/chat-drafts/sent/task/t-1/r-1/notes.md" },
    { fileName: "plan.pdf", relativePath: ".tmp/chat-drafts/sent/task/t-1/r-1/plan.pdf" },
  ]);

  assert.equal(
    composed,
    "Check these files\n\nAttached files:\n- .tmp/chat-drafts/sent/task/t-1/r-1/notes.md\n- .tmp/chat-drafts/sent/task/t-1/r-1/plan.pdf",
  );
});

test("composeMessageWithAttachments supports attachment-only messages", () => {
  assert.equal(
    content.composeMessageWithAttachments("", [
      { fileName: "notes.md", relativePath: ".tmp/chat-drafts/sent/task/t-1/r-1/notes.md" },
    ]),
    "Attached files:\n- .tmp/chat-drafts/sent/task/t-1/r-1/notes.md",
  );
});

test("getMessageTitleSource falls back to attachment names when message text is empty", () => {
  assert.equal(content.getMessageTitleSource("  ", [{ fileName: "design.png" }]), "Attached design.png");
  assert.equal(
    content.getMessageTitleSource("  ", [{ fileName: "a.txt" }, { fileName: "b.txt" }]),
    "Attached 2 files",
  );
  assert.equal(content.hasComposerContent("  ", []), false);
  assert.equal(content.hasComposerContent("  ", [{ fileName: "a.txt" }]), true);
});
