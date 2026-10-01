const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

const routePath = path.resolve(__dirname, "route.ts");

function loadRoute(teamStatus, localClients = []) {
  let localDetectCalls = 0;
  const route = loadTsModule(routePath, {
    stubs: {
      "../../../lib/clients": {
        detectClients: () => {
          localDetectCalls += 1;
          return localClients;
        },
        getRootName: () => "AIOS",
        getWorkspaceId: () => "workspace-1",
      },
      "../../../lib/team-api-context": {
        fetchTeamStatus: async () => teamStatus,
      },
    },
  });
  return { route, localDetectCalls: () => localDetectCalls };
}

test("clients route falls back to local folders when signed out", async () => {
  const { route, localDetectCalls } = loadRoute(
    { status: "signed_out", signedIn: false, clients: [] },
    [{ slug: "local-only", name: "Local Only", path: "clients/local-only", color: "local" }],
  );

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "local");
  assert.equal(body.rootName, "AIOS");
  assert.deepEqual(body.clients.map((client) => client.slug), ["local-only"]);
  assert.equal(localDetectCalls(), 1);
});

test("clients route only shows local folders granted by the Team API", async () => {
  const { route, localDetectCalls } = loadRoute(
    {
      status: "connected",
      signedIn: true,
      apiUrl: "http://127.0.0.1:8787",
      savedAt: "2026-06-24T00:00:00.000Z",
      health: { ok: true },
      team: { id: "team-1", slug: "demo", name: "Demo" },
      clients: [
        { id: "client-1", slug: "acme", name: "Acme", access: "read" },
        { id: "client-2", slug: "globex", name: "Globex", access: "write" },
      ],
    },
    [{ slug: "globex", name: "Globex", path: "clients/globex", color: "local" }],
  );

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "team");
  assert.deepEqual(body.clients, [
    { slug: "globex", name: "Globex", path: "clients/globex", color: "local" },
  ]);
  assert.equal(body.team.slug, "demo");
  assert.equal(localDetectCalls(), 1);
});

test("clients route hides server clients that have not been synced locally", async () => {
  const { route, localDetectCalls } = loadRoute(
    {
      status: "connected",
      signedIn: true,
      apiUrl: "http://127.0.0.1:8787",
      savedAt: "2026-06-24T00:00:00.000Z",
      health: { ok: true },
      team: { id: "team-1", slug: "demo", name: "Demo" },
      clients: [
        { id: "client-1", slug: "acme", name: "Acme", access: "read" },
      ],
    },
    [],
  );

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "team");
  assert.deepEqual(body.clients, []);
  assert.equal(localDetectCalls(), 1);
});

test("clients route does not reveal local folders when access is blocked", async () => {
  const { route, localDetectCalls } = loadRoute(
    {
      status: "blocked",
      signedIn: true,
      apiUrl: "http://127.0.0.1:8787",
      savedAt: "2026-06-24T00:00:00.000Z",
      clients: [],
      error: "active team membership is required",
    },
    [{ slug: "globex", name: "Globex", path: "clients/globex", color: "local" }],
  );

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.source, "team");
  assert.deepEqual(body.clients, []);
  assert.equal(body.error, "active team membership is required");
  assert.equal(localDetectCalls(), 0);
});

test("clients route does not reveal local folders when a signed-in Team API is unavailable", async () => {
  const { route, localDetectCalls } = loadRoute(
    {
      status: "unavailable",
      signedIn: true,
      apiUrl: "http://127.0.0.1:8787",
      savedAt: "2026-06-24T00:00:00.000Z",
      clients: [],
      error: "Team API unavailable",
    },
    [{ slug: "globex", name: "Globex", path: "clients/globex", color: "local" }],
  );

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.source, "team");
  assert.deepEqual(body.clients, []);
  assert.equal(body.error, "Team API unavailable");
  assert.equal(localDetectCalls(), 0);
});
