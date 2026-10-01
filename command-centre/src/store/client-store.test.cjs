const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../lib/test-utils/load-ts-module.cjs");

function loadStore() {
  return loadTsModule(path.resolve(__dirname, "client-store.ts"));
}

function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("latest client refresh wins when team responses finish out of order", async () => {
  const previousFetch = global.fetch;
  const pending = [];
  try {
    global.fetch = () => new Promise((resolve) => pending.push(resolve));
    const { useClientStore } = loadStore();

    const first = useClientStore.getState().fetchClients();
    const second = useClientStore.getState().fetchClients();
    pending[1](response({
      clients: [{ id: "beta", slug: "beta", name: "Beta" }],
      rootName: "Root",
      workspaceId: null,
    }));
    await second;
    pending[0](response({
      clients: [{ id: "alpha", slug: "alpha", name: "Alpha" }],
      rootName: "Root",
      workspaceId: null,
    }));
    await first;

    assert.deepEqual(useClientStore.getState().clients.map((client) => client.slug), ["beta"]);
  } finally {
    global.fetch = previousFetch;
  }
});

test("client refresh resets a selection that is unavailable in the confirmed team", async () => {
  const previousFetch = global.fetch;
  const previousWindow = global.window;
  const storage = new Map([
    ["command-centre-client:workspace-1", JSON.stringify({
      selectedClientId: "alpha",
      activeClientSlugs: ["alpha"],
    })],
  ]);
  try {
    global.window = {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    };
    global.fetch = async () => response({
      clients: [{ id: "beta", slug: "beta", name: "Beta" }],
      rootName: "Root",
      workspaceId: "workspace-1",
    });
    const { useClientStore } = loadStore();

    await useClientStore.getState().fetchClients();

    assert.equal(useClientStore.getState().selectedClientId, null);
    assert.equal(useClientStore.getState().activeClientSlugs, null);
    const saved = JSON.parse(storage.get("command-centre-client:workspace-1"));
    assert.equal(saved.selectedClientId, null);
  } finally {
    global.fetch = previousFetch;
    global.window = previousWindow;
  }
});
