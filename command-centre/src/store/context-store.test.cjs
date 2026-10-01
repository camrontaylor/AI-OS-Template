const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../lib/test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "context-store.ts");
const contextStore = loadTsModule(modulePath);

test("brand context scope keys distinguish root and clients", () => {
  assert.equal(contextStore.getBrandContextScopeKey(null), "root");
  assert.equal(contextStore.getBrandContextScopeKey("root"), "root");
  assert.equal(contextStore.getBrandContextScopeKey("acme"), "client:acme");
});

test("brand context selector does not leak client status into root status", () => {
  const state = {
    hasBrandContext: true,
    brandContextByScope: {
      "client:acme": false,
      "client:globex": true,
    },
  };

  assert.equal(contextStore.selectHasBrandContextForScope(state, null), true);
  assert.equal(contextStore.selectHasBrandContextForScope(state, "acme"), false);
  assert.equal(contextStore.selectHasBrandContextForScope(state, "globex"), true);
  assert.equal(contextStore.selectHasBrandContextForScope(state, "missing"), null);
});
