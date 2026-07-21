const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "chat-drafts.ts");
const drafts = loadTsModule(modulePath, {
  stubs: {
    "@/types/chat-composer": {},
  },
});

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

test("draft storage saves and restores the same composer payload", () => {
  const storage = createStorage();
  const draft = {
    version: 1,
    surface: "conversation",
    scopeId: "conv-1",
    draftKey: "draft-1",
    message: "Unsaved message",
    attachments: [{ id: "a-1", fileName: "notes.md" }],
    pastedBlocks: [{ id: "p-1", label: "[paste]", text: "full text" }],
    updatedAt: "2026-04-20T10:00:00.000Z",
  };

  drafts.saveChatDraft(draft, storage);

  assert.deepEqual(drafts.loadChatDraft("conversation", "conv-1", storage), draft);
});

test("draft storage clears matching drafts", () => {
  const storage = createStorage();
  drafts.saveChatDraft({
    version: 1,
    surface: "task",
    scopeId: "task-1",
    draftKey: "draft-1",
    message: "reply",
    attachments: [],
    pastedBlocks: [],
    updatedAt: "2026-04-20T10:00:00.000Z",
  }, storage);

  drafts.clearChatDraft("task", "task-1", storage);

  assert.equal(drafts.loadChatDraft("task", "task-1", storage), null);
});

test("draft cleanup removes stale, invalid, and wrong-version entries", () => {
  const oldNow = Date.now;
  Date.now = () => new Date("2026-04-20T12:00:00.000Z").getTime();

  const storage = createStorage({
    [drafts.buildChatDraftStorageKey("conversation", "fresh")]: JSON.stringify({
      version: 1,
      surface: "conversation",
      scopeId: "fresh",
      draftKey: "draft-fresh",
      message: "keep me",
      attachments: [],
      pastedBlocks: [],
      updatedAt: "2026-04-20T11:59:00.000Z",
    }),
    [drafts.buildChatDraftStorageKey("conversation", "stale")]: JSON.stringify({
      version: 1,
      surface: "conversation",
      scopeId: "stale",
      draftKey: "draft-stale",
      message: "old",
      attachments: [],
      pastedBlocks: [],
      updatedAt: "2026-04-10T11:59:00.000Z",
    }),
    [drafts.buildChatDraftStorageKey("task", "bad-version")]: JSON.stringify({
      version: 2,
      surface: "task",
      scopeId: "bad-version",
      draftKey: "draft-bad",
      message: "bad",
      attachments: [],
      pastedBlocks: [],
      updatedAt: "2026-04-20T11:59:00.000Z",
    }),
    [drafts.buildChatDraftStorageKey("task", "broken")]: "{not-json",
  });

  try {
    drafts.cleanupExpiredChatDrafts(storage);
  } finally {
    Date.now = oldNow;
  }

  const remainingKeys = Object.keys(storage.dump());
  assert.deepEqual(remainingKeys, [drafts.buildChatDraftStorageKey("conversation", "fresh")]);
});

test("loadChatDraft removes mismatched entries instead of restoring them", () => {
  const storage = createStorage({
    [drafts.buildChatDraftStorageKey("question", "msg-1")]: JSON.stringify({
      version: 1,
      surface: "task",
      scopeId: "task-1",
      draftKey: "draft-1",
      message: "wrong scope",
      attachments: [],
      pastedBlocks: [],
      updatedAt: "2026-04-20T11:59:00.000Z",
    }),
  });

  assert.equal(drafts.loadChatDraft("question", "msg-1", storage), null);
  assert.deepEqual(storage.dump(), {});
});

test("touchChatDraft refreshes the updatedAt timestamp", () => {
  const storage = createStorage();
  drafts.saveChatDraft({
    version: 1,
    surface: "conversation",
    scopeId: "conv-1",
    draftKey: "draft-1",
    message: "hello",
    attachments: [],
    pastedBlocks: [],
    updatedAt: "2026-04-20T10:00:00.000Z",
  }, storage);

  const touched = drafts.touchChatDraft("conversation", "conv-1", storage);

  assert.equal(touched?.scopeId, "conv-1");
  assert.notEqual(touched?.updatedAt, "2026-04-20T10:00:00.000Z");
  assert.equal(
    drafts.loadChatDraft("conversation", "conv-1", storage)?.updatedAt,
    touched?.updatedAt,
  );
});

test("chat draft persistence skips clearing during the initial restore pass", () => {
  assert.equal(
    drafts.getChatDraftPersistenceDecision({
      hydratedScopeKey: null,
      surface: "task",
      scopeId: "task-1",
      message: "",
      attachmentsCount: 0,
      pastedBlocksCount: 0,
    }),
    "skip",
  );
});

test("chat draft persistence only clears an empty draft after hydration is complete", () => {
  const scopeKey = drafts.buildChatDraftScopeKey("question", "msg-1");

  assert.equal(
    drafts.getChatDraftPersistenceDecision({
      hydratedScopeKey: scopeKey,
      surface: "question",
      scopeId: "msg-1",
      message: "",
      attachmentsCount: 0,
      pastedBlocksCount: 0,
    }),
    "clear",
  );
});

test("chat draft persistence saves restored content once the scope is hydrated", () => {
  const scopeKey = drafts.buildChatDraftScopeKey("conversation", "conv-1");

  assert.equal(
    drafts.getChatDraftPersistenceDecision({
      hydratedScopeKey: scopeKey,
      surface: "conversation",
      scopeId: "conv-1",
      message: "Recovered message",
      attachmentsCount: 0,
      pastedBlocksCount: 0,
    }),
    "save",
  );
});
