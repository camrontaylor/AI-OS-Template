const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "chat-attachment-policy.ts");
const policy = loadTsModule(modulePath);

test("attachment policy accepts supported file types and normalizes extensions", () => {
  assert.equal(policy.getChatAttachmentExtension("Screenshot.JPG"), "jpg");
  assert.equal(policy.getChatAttachmentValidationError({ name: "notes.md", size: 1200 }), null);
  assert.equal(policy.getChatAttachmentValidationError({ name: "component.tsx", size: 1200 }), null);
});

test("attachment policy rejects unsupported or extensionless files", () => {
  assert.equal(
    policy.getChatAttachmentValidationError({ name: "archive.zip", size: 1200 }),
    "File type .zip is not allowed",
  );
  assert.equal(
    policy.getChatAttachmentValidationError({ name: "README", size: 1200 }),
    "That file type is not allowed",
  );
});

test("attachment policy rejects files above the size limit", () => {
  assert.equal(
    policy.getChatAttachmentValidationError({
      name: "large.pdf",
      size: policy.CHAT_ATTACHMENT_MAX_BYTES + 1,
    }),
    "File too large (max 10MB)",
  );
});

test("attachment accept attribute exposes image uploads plus the allowlist", () => {
  assert.match(policy.CHAT_ATTACHMENT_ACCEPT_ATTR, /image\/\*/);
  assert.match(policy.CHAT_ATTACHMENT_ACCEPT_ATTR, /\.pdf/);
  assert.match(policy.CHAT_ATTACHMENT_ACCEPT_ATTR, /\.tsx/);
});
