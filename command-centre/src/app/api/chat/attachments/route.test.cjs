const assert = require("node:assert/strict");
const { File } = require("node:buffer");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

function createNextServerStub() {
  return {
    NextRequest: class {},
    NextResponse: {
      json(body, init = {}) {
        return {
          status: init.status ?? 200,
          body,
          async json() {
            return body;
          },
        };
      },
    },
  };
}

function createFormData(entries) {
  return {
    get(key) {
      const values = entries[key];
      return Array.isArray(values) ? values[0] ?? null : values ?? null;
    },
    getAll(key) {
      const values = entries[key];
      if (Array.isArray(values)) return values;
      return values == null ? [] : [values];
    },
  };
}

test("chat attachments POST uploads multiple files and runs cleanup", async () => {
  const calls = [];
  const modulePath = path.resolve(__dirname, "route.ts");
  const route = loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/chat-attachment-service": {
        async storeChatDraftFiles(args) {
          calls.push(["store", args]);
          return args.files.map((file, index) => ({
            id: `attachment-${index + 1}`,
            fileName: file.name,
            relativePath: `.tmp/chat-drafts/drafts/${args.surface}/${args.scopeId}/${args.draftKey}/${file.name}`,
            surface: args.surface,
            scopeId: args.scopeId,
            draftKey: args.draftKey,
            state: "draft",
          }));
        },
        cleanupChatAttachmentStorage(args) {
          calls.push(["cleanup", args]);
        },
        clearChatDraftScope() {
          throw new Error("clear should not run in POST");
        },
        deleteChatDraftAttachment() {
          throw new Error("delete should not run in POST");
        },
      },
      "@/types/chat-composer": {},
    },
  });

  const request = {
    async formData() {
      return createFormData({
        surface: "conversation",
        scopeId: "conv-1",
        draftKey: "draft-1",
        files: [
          new File(["one"], "one.txt", { type: "text/plain" }),
          new File(["two"], "two.png", { type: "image/png" }),
        ],
      });
    },
  };

  const response = await route.POST(request);

  assert.equal(response.status, 201);
  assert.equal(response.body.attachments.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "store");
  assert.equal(calls[0][1].surface, "conversation");
  assert.equal(calls[0][1].scopeId, "conv-1");
  assert.equal(calls[0][1].draftKey, "draft-1");
  assert.deepEqual(
    calls[0][1].files.map((file) => ({ name: file.name, type: file.type })),
    [
      { name: "one.txt", type: "text/plain" },
      { name: "two.png", type: "image/png" },
    ],
  );
  assert.deepEqual(calls[1], ["cleanup", { surface: "conversation", scopeId: "conv-1" }]);
});

test("chat attachments POST rejects missing scope data", async () => {
  const modulePath = path.resolve(__dirname, "route.ts");
  const route = loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/chat-attachment-service": {
        async storeChatDraftFiles() {
          throw new Error("should not upload");
        },
        cleanupChatAttachmentStorage() {},
        clearChatDraftScope() {},
        deleteChatDraftAttachment() {},
      },
      "@/types/chat-composer": {},
    },
  });

  const response = await route.POST({
    async formData() {
      return createFormData({
        surface: "conversation",
        files: [new File(["x"], "x.txt", { type: "text/plain" })],
      });
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "surface, scopeId, and draftKey are required");
});

test("chat attachments DELETE removes either one file or the whole draft scope", async () => {
  const deleteCalls = [];
  const clearCalls = [];
  const cleanupCalls = [];
  const modulePath = path.resolve(__dirname, "route.ts");
  const route = loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/chat-attachment-service": {
        async storeChatDraftFiles() {
          throw new Error("should not upload");
        },
        deleteChatDraftAttachment(args) {
          deleteCalls.push(args);
        },
        clearChatDraftScope(args) {
          clearCalls.push(args);
        },
        cleanupChatAttachmentStorage(args) {
          cleanupCalls.push(args);
        },
      },
      "@/types/chat-composer": {},
    },
  });

  const singleResponse = await route.DELETE({
    async json() {
      return {
        surface: "task",
        scopeId: "task-1",
        draftKey: "draft-1",
        relativePath: ".tmp/chat-drafts/drafts/task/task-1/draft-1/notes.md",
      };
    },
  });

  const clearResponse = await route.DELETE({
    async json() {
      return {
        surface: "task",
        scopeId: "task-1",
        draftKey: "draft-1",
      };
    },
  });

  assert.equal(singleResponse.status, 200);
  assert.equal(clearResponse.status, 200);
  assert.deepEqual(deleteCalls, [{
    surface: "task",
    scopeId: "task-1",
    draftKey: "draft-1",
    relativePath: ".tmp/chat-drafts/drafts/task/task-1/draft-1/notes.md",
  }]);
  assert.deepEqual(clearCalls, [{
    surface: "task",
    scopeId: "task-1",
    draftKey: "draft-1",
  }]);
  assert.deepEqual(cleanupCalls, [
    { surface: "task", scopeId: "task-1" },
    { surface: "task", scopeId: "task-1" },
  ]);
});
