const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "chat-session-memory.ts");
const memory = loadTsModule(modulePath);

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
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

test("chat session memory saves and restores per-client conversation ids", () => {
  const storage = createStorage();

  memory.rememberConversationId(null, "root-conv", storage);
  memory.rememberConversationId("client-1", "client-conv", storage);

  assert.equal(memory.loadRememberedConversationId(null, storage), "root-conv");
  assert.equal(memory.loadRememberedConversationId("client-1", storage), "client-conv");
  assert.equal(memory.loadRememberedConversationId("client-2", storage), null);
});

test("chat session memory clears remembered ids", () => {
  const storage = createStorage({
    [memory.buildChatSessionStorageKey("client-1")]: "conv-1",
  });

  memory.clearRememberedConversationId("client-1", storage);

  assert.deepEqual(storage.dump(), {});
});
