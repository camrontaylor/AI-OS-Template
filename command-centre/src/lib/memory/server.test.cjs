/**
 * server.ts tests — the node:http transport of the hosted memory API.
 *
 * Real HTTP round trips against a server on port 0 (ephemeral): auth
 * (fail-closed construction, 401s, constant-time check), routing (404/405),
 * body handling (bad JSON → 400, oversized → 413), and the happy paths
 * (health, ingest → search). Handler-level contract details live in
 * api.test.cjs; this file pins the transport.
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");
const memoryApiRunner = require("../../../scripts/memory-api.cjs");

// Leaf-first loading — the api.test.cjs graph plus server.ts on top.
const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
const embedding = loadTsModule(path.resolve(__dirname, "embedding.ts"));
const scope = loadTsModule(path.resolve(__dirname, "scope.ts"), {
  stubs: { "./types": types },
});
const migrate = loadTsModule(path.resolve(__dirname, "migrate.ts"));
const adapter = loadTsModule(path.resolve(__dirname, "pglite-adapter.ts"));
const postgresAdapter = loadTsModule(path.resolve(__dirname, "postgres-adapter.ts"));
const backend = loadTsModule(path.resolve(__dirname, "backend.ts"));
const rowMappers = loadTsModule(path.resolve(__dirname, "row-mappers.ts"), {
  stubs: { "./types": types, "./embedding": embedding },
});
const store = loadTsModule(path.resolve(__dirname, "store.ts"), {
  stubs: {
    "./types": types,
    "./migrate": migrate,
    "./scope": scope,
    "./embedding": embedding,
    "./row-mappers": rowMappers,
    "./pglite-adapter": adapter,
    "./postgres-adapter": postgresAdapter,
    "./backend": backend,
  },
});
const chunker = loadTsModule(path.resolve(__dirname, "chunker.ts"));
const connectors = loadTsModule(path.resolve(__dirname, "connectors.ts"));
const ingest = loadTsModule(path.resolve(__dirname, "ingest.ts"), {
  stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
});
const reranker = loadTsModule(path.resolve(__dirname, "reranker.ts"));
const search = loadTsModule(path.resolve(__dirname, "search.ts"), {
  stubs: { "./types": types, "./reranker": reranker, "./row-mappers": rowMappers },
});
const scopedAccess = loadTsModule(path.resolve(__dirname, "scoped-access.ts"), {
  stubs: { "./scope": scope, "./row-mappers": rowMappers },
});
const expand = loadTsModule(path.resolve(__dirname, "expand.ts"), {
  stubs: { "./scoped-access": scopedAccess },
});
const identityPermissions = loadTsModule(path.resolve(__dirname, "../identity/permissions.ts"));
const identityInvites = loadTsModule(path.resolve(__dirname, "../identity/invites.ts"), {
  stubs: { "./permissions": identityPermissions },
});
const identityRowMappers = loadTsModule(path.resolve(__dirname, "../identity/row-mappers.ts"));
const identityStoreModule = loadTsModule(path.resolve(__dirname, "../identity/store.ts"), {
  stubs: {
    "../memory/migrate": migrate,
    "../memory/pglite-adapter": adapter,
    "../memory/postgres-adapter": postgresAdapter,
    "../memory/backend": backend,
    "./row-mappers": identityRowMappers,
  },
});
const identityTeamAuth = loadTsModule(path.resolve(__dirname, "../identity/team-auth.ts"), {
  stubs: {
    "./permissions": identityPermissions,
    "./store": identityStoreModule,
  },
});
const api = loadTsModule(path.resolve(__dirname, "api.ts"), {
  stubs: {
    "./types": types,
    "./search": search,
    "./expand": expand,
    "./ingest": ingest,
    "./connectors": connectors,
    "./scope": scope,
    "../identity/invites": identityInvites,
    "../identity/permissions": identityPermissions,
    "../identity/team-auth": identityTeamAuth,
  },
});
const server = loadTsModule(path.resolve(__dirname, "server.ts"), {
  stubs: { "./api": api },
});

const EMBED_DIM = 8;
const EMBED_MODEL = "test-embed";
const TOKEN = "test-token-153";
let sharedStore = null;

test.before(async () => {
  sharedStore = await openMemoryTestStore(store, { embedDim: EMBED_DIM });
});

test.after(async () => {
  await sharedStore?.close();
  sharedStore = null;
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-srv-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function withStore(fn) {
  if (!sharedStore) throw new Error("shared memory test store was not initialized");
  await resetMemoryTestStore(sharedStore);
  return fn(sharedStore);
}

/** Start a server on port 0 with a reset in-memory PGLite store; run fn(baseUrl). */
async function withServer(fn, serverOverrides = {}) {
  if (!sharedStore) throw new Error("shared memory test store was not initialized");
  await resetMemoryTestStore(sharedStore);
  const baseDeps = {
    store: sharedStore,
    expectedEmbeddingModel: EMBED_MODEL,
    expectedEmbeddingDim: EMBED_DIM,
  };
  const { deps: overrideDeps, ...restOverrides } = serverOverrides;
  const httpServer = server.createMemoryApiServer({
    deps: { ...baseDeps, ...(overrideDeps || {}) },
    token: TOKEN,
    backendKind: "pglite",
    logError: () => {}, // keep expected-failure tests quiet
    ...restOverrides,
  });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
}

function post(baseUrl, pathname, body, headers = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function embeddingForText(text) {
  const digest = crypto.createHash("sha256").update(String(text)).digest();
  const vector = [];
  for (let i = 0; i < EMBED_DIM; i += 1) {
    vector.push((digest[i] + 1) / 256);
  }
  return vector;
}

function fixedServerEmbedder() {
  return {
    model: EMBED_MODEL,
    dim: EMBED_DIM,
    embed: async (texts) => texts.map(embeddingForText),
  };
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function preparedMemoryPayload(content, sourcePath) {
  const chunks = chunker.chunkMarkdown(content);
  return {
    contentSha256: crypto.createHash("sha256").update(content).digest("hex"),
    byteSize: Buffer.byteLength(content, "utf-8"),
    embeddingModel: EMBED_MODEL,
    embeddingDim: EMBED_DIM,
    chunks: chunks.map((chunk) => ({
      ...chunk,
      chunkKey: ingest.buildChunkKey({
        sourcePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        contentHash: chunk.contentHash,
        embeddingModel: EMBED_MODEL,
      }),
      embedding: embeddingForText(chunk.content),
    })),
  };
}

function searchBody(overrides = {}) {
  const query = typeof overrides.query === "string" ? overrides.query : "q";
  return {
    query,
    queryEmbedding: embeddingForText(query),
    embeddingModel: EMBED_MODEL,
    embeddingDim: EMBED_DIM,
    scope: {},
    ...overrides,
  };
}

function put(baseUrl, pathname, body, headers = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function workspaceServer(root, access = "read", events = []) {
  const fakeIdentityStore = {
    getMembership: async () => ({ id: "membership-1", status: "active", role: "member" }),
    getTeam: async () => ({ id: "team-http", slug: "demo", name: "Demo Team" }),
    getUserById: async () => ({
      id: "user-http",
      email: "member@example.com",
      displayName: "Member",
      status: "active",
    }),
    listClients: async () => [
      { id: "client-1", slug: "acme", name: "Acme", status: "active" },
      { id: "client-2", slug: "globex", name: "Globex", status: "active" },
    ],
    getClientBySlug: async (_teamId, slug) =>
      slug === "acme"
        ? { id: "client-1", slug: "acme", name: "Acme", status: "active" }
        : slug === "globex"
          ? { id: "client-2", slug: "globex", name: "Globex", status: "active" }
          : null,
    getActiveGrant: async (_teamId, clientId) =>
      clientId === "client-1" ? { access, status: "active" } : null,
    recordAuditEvent: async (event) => {
      events.push(event);
      return event;
    },
  };
  return {
    deps: {
      identityStore: fakeIdentityStore,
      workspaceRoot: root,
    },
    resolvePrincipal: async () => ({
      teamId: "team-http",
      userId: "user-http",
      authSource: "test",
    }),
  };
}

function ingestBody(overrides = {}) {
  const body = {
    scope: { teamId: null, clientId: null, userId: null, visibility: "system" },
    sourcePath: "context/memory/2026-06-10.md",
    sourceType: "memory",
    content: "# Release\n\nThe release process uses tagged dev builds.",
    ...overrides,
  };
  if (typeof body.content === "string" && typeof body.sourcePath === "string") {
    Object.assign(body, preparedMemoryPayload(body.content, body.sourcePath));
  }
  return body;
}

const INGEST_BODY = ingestBody();

// ---------------------------------------------------------------------------
// fail-closed construction
// ---------------------------------------------------------------------------

test("createMemoryApiServer refuses to build without a token", async () => {
  await withStore(async (s) => {
    const deps = {
      store: s,
      expectedEmbeddingModel: EMBED_MODEL,
      expectedEmbeddingDim: EMBED_DIM,
    };
    assert.throws(() => server.createMemoryApiServer({ deps, token: "" }), /MEMORY_API_TOKEN/);
    assert.throws(() => server.createMemoryApiServer({ deps, token: "   " }), /MEMORY_API_TOKEN/);
  });
});

test("memory-api startup warms server-side search embedder when enabled", async () => {
  const logs = [];
  let calls = 0;

  const emb = await memoryApiRunner.warmServerSideSearchEmbedder({
    enabled: true,
    serverEmbedder: async () => {
      calls += 1;
      return fixedServerEmbedder();
    },
    log: (line) => logs.push(line),
  });

  assert.equal(calls, 1);
  assert.equal(emb.model, EMBED_MODEL);
  assert.deepEqual(logs, [
    "  embedder: warming server-side bge-m3 model...",
    `  embedder: server-side ${EMBED_MODEL} ready`,
  ]);
});

test("memory-api startup skips server embedder warmup when disabled", async () => {
  const logs = [];
  let calls = 0;

  const emb = await memoryApiRunner.warmServerSideSearchEmbedder({
    enabled: false,
    serverEmbedder: async () => {
      calls += 1;
      return fixedServerEmbedder();
    },
    log: (line) => logs.push(line),
  });

  assert.equal(emb, null);
  assert.equal(calls, 0);
  assert.deepEqual(logs, []);
});

test("memory-api startup fails clearly when server embedder warmup fails", async () => {
  const logs = [];

  await assert.rejects(
    () => memoryApiRunner.warmServerSideSearchEmbedder({
      enabled: true,
      serverEmbedder: async () => {
        throw new Error("network unavailable");
      },
      log: (line) => logs.push(line),
    }),
    /server-side embedding warmup failed: .*disable MEMORY_API_SERVER_EMBEDDINGS=1/,
  );

  assert.deepEqual(logs, ["  embedder: warming server-side bge-m3 model..."]);
});

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

test("memory routes 401 without a token, with a wrong token, and with a non-Bearer header", async () => {
  await withServer(async (baseUrl) => {
    for (const headers of [
      { authorization: "" },
      { authorization: "Bearer wrong-token" },
      { authorization: `Basic ${TOKEN}` },
    ]) {
      const res = await post(baseUrl, "/v1/memory/search", { query: "q", scope: {} }, headers);
      assert.equal(res.status, 401, JSON.stringify(headers));
      const body = await res.json();
      assert.equal(body.error.code, "unauthorized");
    }
  });
});

test("a suspended session is blocked on protected routes but can still log out", async () => {
  const blockedToken = "suspended-member-token";
  const resolvePrincipal = async ({ token }) => token === blockedToken
    ? {
        status: "blocked",
        code: "forbidden",
        message: "active team membership is required",
      }
    : null;

  await withServer(async (baseUrl) => {
    const protectedResponse = await fetch(`${baseUrl}/v1/team/whoami`, {
      headers: { authorization: `Bearer ${blockedToken}` },
    });
    assert.equal(protectedResponse.status, 403);
    assert.deepEqual(await protectedResponse.json(), {
      error: {
        code: "forbidden",
        message: "active team membership is required",
      },
    });

    const invalidResponse = await fetch(`${baseUrl}/v1/team/whoami`, {
      headers: { authorization: "Bearer invalid-token" },
    });
    assert.equal(invalidResponse.status, 401);

    const logoutResponse = await post(
      baseUrl,
      "/v1/auth/logout",
      {},
      { authorization: `Bearer ${blockedToken}` },
    );
    assert.equal(logoutResponse.status, 200);
    assert.deepEqual(await logoutResponse.json(), { ok: true });
  }, { resolvePrincipal });
});

test("configured dev token principal is locked to its configured team", () => {
  const teamId = "11111111-1111-4111-8111-111111111111";
  const otherTeamId = "33333333-3333-4333-8333-333333333333";
  const principal = { teamId, userId: "user-dev" };
  assert.equal(memoryApiRunner.resolveLockedDevPrincipal(principal, teamId).teamId, teamId);
  assert.deepEqual(memoryApiRunner.resolveLockedDevPrincipal(principal, otherTeamId), {
    status: "blocked",
    statusCode: 403,
    code: "credential_team_mismatch",
    message: "this credential is locked to a different team",
  });
});

test("request team headers isolate one user across two teams and auth/teams stays user-scoped", async () => {
  const teamA = "11111111-1111-4111-8111-111111111111";
  const teamB = "33333333-3333-4333-8333-333333333333";
  const userId = "22222222-2222-4222-8222-222222222222";
  const requested = [];
  const memberships = [teamA, teamB].map((teamId, index) => ({
    id: `membership-${index + 1}`,
    teamId,
    userId,
    role: index === 0 ? "owner" : "member",
    status: "active",
    createdAt: `2026-07-11T00:00:0${index}.000Z`,
  }));
  const identityStore = {
    getServerIdentity: async () => ({ serverId: "44444444-4444-4444-8444-444444444444" }),
    getUserById: async () => ({ id: userId, email: "member@example.com", displayName: "Member", status: "active" }),
    listMembershipsForUser: async () => memberships,
    getMembership: async (teamId) => memberships.find((item) => item.teamId === teamId) ?? null,
    getTeam: async (teamId) => ({
      id: teamId,
      slug: teamId === teamA ? "alpha" : "beta",
      name: teamId === teamA ? "Alpha" : "Beta",
      status: "active",
    }),
    listClients: async () => [],
    getActiveGrant: async () => null,
  };
  const resolveUser = async ({ token }) => token === "multi-team-token"
    ? { userId, authSource: "cli-device-token", credentialKind: "better-auth-session", legacyTeamId: teamA }
    : null;
  const resolvePrincipal = async ({ token, requestedTeamId }) => {
    if (token !== "multi-team-token") return null;
    requested.push(requestedTeamId);
    const teamId = requestedTeamId || teamA;
    return {
      teamId,
      userId,
      authSource: "cli-device-token",
      teamScopeSource: requestedTeamId ? "explicit-header" : "legacy-session",
    };
  };

  await withServer(async (baseUrl) => {
    const teamsResponse = await fetch(`${baseUrl}/v1/auth/teams`, {
      headers: { authorization: "Bearer multi-team-token" },
    });
    assert.equal(teamsResponse.status, 200);
    const teamsBody = await teamsResponse.json();
    assert.equal(teamsBody.server.id, "44444444-4444-4444-8444-444444444444");
    assert.deepEqual(teamsBody.teams.map((team) => team.id), [teamA, teamB]);
    assert.equal(teamsBody.defaultTeamId, teamA);

    const [alpha, beta] = await Promise.all([teamA, teamB].map(async (teamId) => {
      const response = await fetch(`${baseUrl}/v1/team/whoami`, {
        headers: {
          authorization: "Bearer multi-team-token",
          "x-ai-team-id": teamId,
        },
      });
      assert.equal(response.status, 200);
      return response.json();
    }));
    assert.equal(alpha.team.id, teamA);
    assert.equal(beta.team.id, teamB);
    assert.equal(alpha.teamScopeSource, "explicit-header");
    assert.deepEqual(requested, [teamA, teamB]);

    const invalid = await fetch(`${baseUrl}/v1/team/whoami`, {
      headers: {
        authorization: "Bearer multi-team-token",
        "x-ai-team-id": `${teamA},${teamB}`,
      },
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "invalid_team_scope");

    memberships.splice(0, memberships.length);
    const noTeams = await fetch(`${baseUrl}/v1/auth/teams`, {
      headers: { authorization: "Bearer multi-team-token" },
    });
    assert.equal(noTeams.status, 200);
    assert.deepEqual((await noTeams.json()).teams, []);
  }, { deps: { identityStore }, resolveUser, resolvePrincipal });
});

test("Company routes are user-scoped and the Company invite page is public", async () => {
  const userId = "22222222-2222-4222-8222-222222222222";
  const identityStore = {
    getServerIdentity: async () => ({ serverId: "44444444-4444-4444-8444-444444444444" }),
    getUserById: async () => ({
      id: userId,
      email: "owner@example.com",
      displayName: "Company Owner",
      status: "active",
    }),
    getCompanyMembership: async () => ({
      id: "company-owner-1",
      userId,
      role: "owner",
      status: "active",
    }),
    listTeams: async () => [],
    listUsers: async () => [{
      id: userId,
      email: "owner@example.com",
      displayName: "Company Owner",
      status: "active",
    }],
    listCompanyAccessRequests: async () => [],
  };
  await withServer(async (baseUrl) => {
    const page = await fetch(`${baseUrl}/company/join`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /\/v1\/company\/invitations\/accept/);

    const response = await fetch(`${baseUrl}/v1/company/teams`, {
      headers: { authorization: "Bearer company-owner-token" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.companyMembership.role, "owner");
    assert.deepEqual(body.teams, []);
    assert.equal(body.eligibleOwners[0].email, "owner@example.com");
  }, {
    deps: { identityStore },
    resolveUser: async ({ token }) => token === "company-owner-token"
      ? { userId, authSource: "browser-session", credentialKind: "better-auth-session", legacyTeamId: null }
      : null,
    resolvePrincipal: async () => {
      throw new Error("Company routes must not resolve a Team principal");
    },
  });
});

test("server passes the resolved principal into memory handlers", async () => {
  await withStore(async (s) => {
  const fakeIdentityStore = {
    getMembership: async () => ({ status: "active", role: "admin" }),
    getClientBySlug: async () => null,
    getActiveGrant: async () => null,
    recordAuditEvent: async () => null,
  };
  const httpServer = server.createMemoryApiServer({
    deps: {
      store: s,
      expectedEmbeddingModel: EMBED_MODEL,
      expectedEmbeddingDim: EMBED_DIM,
      identityStore: fakeIdentityStore,
    },
    token: TOKEN,
    backendKind: "pglite",
    resolvePrincipal: async () => ({
      teamId: "team-http",
      userId: "user-http",
      authSource: "test",
    }),
  });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();

  try {
    const res = await post(`http://127.0.0.1:${port}`, "/v1/memory/ingest", ingestBody({
      scope: { teamId: "forged-team", clientId: null, userId: null, visibility: "system" },
      sourcePath: "context/memory/http-principal.md",
    }));
    assert.equal(res.status, 200);

    const stored = await s.client.query(
      "SELECT team_id, user_id FROM memory_sources WHERE source_path = $1",
      ["context/memory/http-principal.md"],
    );
    assert.equal(stored.rows[0].team_id, "team-http");
    assert.equal(stored.rows[0].user_id, null);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  });
});

test("team routes return whoami and grant-filtered clients", async () => {
  await withStore(async (s) => {
  const fakeIdentityStore = {
    getMembership: async () => ({ id: "membership-1", status: "active", role: "member" }),
    getTeam: async () => ({ id: "team-http", slug: "demo", name: "Demo Team" }),
    getUserById: async () => ({
      id: "user-http",
      email: "member@example.com",
      displayName: "Member",
      status: "active",
    }),
    listClients: async () => [
      { id: "client-1", slug: "acme", name: "Acme", status: "active" },
      { id: "client-2", slug: "globex", name: "Globex", status: "active" },
    ],
    getClientBySlug: async () => null,
    getActiveGrant: async (_teamId, clientId) =>
      clientId === "client-1" ? { access: "read", status: "active" } : null,
    recordAuditEvent: async () => null,
  };
  const httpServer = server.createMemoryApiServer({
    deps: {
      store: s,
      expectedEmbeddingModel: EMBED_MODEL,
      expectedEmbeddingDim: EMBED_DIM,
      identityStore: fakeIdentityStore,
    },
    token: TOKEN,
    backendKind: "pglite",
    resolvePrincipal: async () => ({
      teamId: "team-http",
      userId: "user-http",
      authSource: "test",
    }),
  });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const whoami = await fetch(`${baseUrl}/v1/team/whoami`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(whoami.status, 200);
    const whoamiBody = await whoami.json();
    assert.equal(whoamiBody.user.email, "member@example.com");
    assert.equal(whoamiBody.team.slug, "demo");
    assert.equal(whoamiBody.membership.role, "member");

    const clients = await fetch(`${baseUrl}/v1/team/clients`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(clients.status, 200);
    const clientsBody = await clients.json();
    assert.deepEqual(
      clientsBody.clients.map((client) => client.slug),
      ["acme"],
    );
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  });
});

test("GET /v1/memory/status reports local memory and indexing status", async () => {
  await withServer(async (baseUrl) => {
    const ingest = await post(baseUrl, "/v1/memory/ingest", INGEST_BODY);
    assert.equal(ingest.status, 200);

    const status = await fetch(`${baseUrl}/v1/memory/status`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(status.status, 200);
    const body = await status.json();

    assert.equal(body.storeReady, true);
    assert.equal(body.scope.mode, "local");
    assert.equal(body.sources, 1);
    assert.ok(body.chunks >= 1);
    assert.equal(body.jobsByStatus.succeeded, 1);
    assert.ok(body.lastIndexedAt);
  });
});

test("capture staging route stores raw captures without exposing them to recall", async () => {
  const root = tempDir();
  const events = [];
  try {
    await withServer(async (baseUrl) => {
      const content = "# HTTP Capture\n\nStaged-only capture needle.";
      const captured = await post(baseUrl, "/v1/memory/captures", {
        scope: { teamId: "forged-team", clientId: null, userId: null, visibility: "team" },
        sessionId: "http-session",
        sourceHash: sha256("http-turn"),
        sourcePath: "context/memory/2026-06-30.aos.md#session-http",
        sourceType: "session",
        content,
        contentSha256: sha256(content),
        byteSize: Buffer.byteLength(content, "utf-8"),
        eligibleAfter: "2000-01-01T00:00:00.000Z",
      });
      assert.equal(captured.status, 200);
      const capturedBody = await captured.json();
      assert.equal(capturedBody.capture.status, "pending");

      const status = await fetch(`${baseUrl}/v1/memory/status`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(status.status, 200);
      const statusBody = await status.json();
      assert.equal(statusBody.captureEvents, 1);
      assert.equal(statusBody.captureEventsByStatus.pending, 1);
      assert.equal(statusBody.sources ?? 0, 0);

      const searched = await post(baseUrl, "/v1/memory/search", searchBody({
        query: "Staged-only capture needle",
        scope: { include: ["team"] },
      }));
      assert.equal(searched.status, 200);
      assert.equal((await searched.json()).results.length, 0);
    }, workspaceServer(root, "write", events));
  } finally {
    rmDir(root);
  }
});

test("memory management route lists and accepts review items over HTTP", async () => {
  const root = tempDir();
  const events = [];
  try {
    const overrides = workspaceServer(root, "write", events);
    overrides.deps.identityStore.getMembership = async () => ({
      id: "membership-1",
      status: "active",
      role: "admin",
    });
    await withServer(async (baseUrl) => {
      const content = "# HTTP Review\n\nMemory route review needle.";
      const captured = await post(baseUrl, "/v1/memory/captures", {
        scope: { teamId: "forged-team", clientId: null, userId: null, visibility: "team" },
        sessionId: "http-review-session",
        sourceHash: sha256("http-review-turn"),
        sourcePath: "context/memory/2026-06-30.aos.md#http-review",
        sourceType: "session",
        title: "HTTP Review",
        content,
        contentSha256: sha256(content),
        byteSize: Buffer.byteLength(content, "utf-8"),
        eligibleAfter: "2000-01-01T00:00:00.000Z",
      });
      assert.equal(captured.status, 200);
      const capturedBody = await captured.json();

      const claimed = await post(baseUrl, "/v1/memory/consolidation/claim", {
        scope: { teamId: "forged-team", clientId: null, userId: null, visibility: "team" },
      });
      assert.equal(claimed.status, 200);
      const claimedBody = await claimed.json();
      assert.ok(claimedBody.batch);

      const completed = await post(baseUrl, "/v1/memory/consolidation/complete", {
        batchId: claimedBody.batch.id,
        claimToken: claimedBody.batch.claimToken,
        items: [
          {
            disposition: "review",
            captureIds: [capturedBody.capture.id],
            reviewReason: "needs_admin",
            confidence: 0.4,
          },
        ],
      });
      assert.equal(completed.status, 200);

      const listed = await fetch(`${baseUrl}/v1/memory/memories`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(listed.status, 200);
      const listedBody = await listed.json();
      assert.equal(listedBody.review.length, 1);
      assert.equal(listedBody.review[0].id, capturedBody.capture.id);

      const acceptedContent = "# HTTP Accepted\n\nMemory route review needle is accepted.";
      const accepted = await post(baseUrl, "/v1/memory/memories", {
        action: "accept",
        captureId: capturedBody.capture.id,
        title: "HTTP Accepted",
        content: acceptedContent,
        ...preparedMemoryPayload(acceptedContent, "reviewed/pending/http-accepted.md"),
      });
      assert.equal(accepted.status, 200);
      const acceptedBody = await accepted.json();
      assert.ok(acceptedBody.accepted.sourceId);

      const updatedContent = "# HTTP Updated\n\nMemory route review needle was updated over HTTP.";
      const updated = await post(baseUrl, "/v1/memory/memories", {
        action: "update",
        sourceId: acceptedBody.accepted.sourceId,
        title: "HTTP Updated",
        content: updatedContent,
        ...preparedMemoryPayload(updatedContent, acceptedBody.accepted.sourcePath),
      });
      assert.equal(updated.status, 200);
      const updatedBody = await updated.json();
      assert.equal(updatedBody.updated.sourceId, acceptedBody.accepted.sourceId);

      const after = await fetch(`${baseUrl}/v1/memory/memories`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(after.status, 200);
      const afterBody = await after.json();
      assert.equal(afterBody.review.length, 0);
      assert.ok(afterBody.published.some((memory) => memory.id === acceptedBody.accepted.sourceId));
      const updatedMemory = afterBody.published.find((memory) => memory.id === acceptedBody.accepted.sourceId);
      assert.match(updatedMemory.content, /updated over HTTP/);
    }, overrides);
  } finally {
    rmDir(root);
  }
});

test("manual import routes create, list, and retry imports over HTTP", async () => {
  await withServer(async (baseUrl) => {
    const imported = await post(baseUrl, "/v1/memory/imports", {
      scope: { teamId: null, clientId: "acme", userId: null, visibility: "client" },
      sourcePath: "manual/http-import.md",
      content: "# HTTP Import\n\nManual import route needle.",
      ...preparedMemoryPayload(
        "# HTTP Import\n\nManual import route needle.",
        "manual/http-import.md",
      ),
    });
    assert.equal(imported.status, 200);
    const importedBody = await imported.json();
    assert.equal(importedBody.import.status, "indexed");
    assert.ok(importedBody.import.id);

    const listed = await fetch(`${baseUrl}/v1/memory/imports`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    assert.ok(listedBody.imports.some((row) => row.sourcePath === "manual/http-import.md"));

    const retried = await post(baseUrl, "/v1/memory/imports/retry", {
      importId: importedBody.import.id,
    });
    assert.equal(retried.status, 200);
    const retriedBody = await retried.json();
    assert.equal(retriedBody.import.attempts, 2);
  });
});

test("workspace manifest and file read only expose granted client files", async () => {
  const root = tempDir();
  const events = [];
  try {
    fs.mkdirSync(path.join(root, "clients", "acme", "context"), { recursive: true });
    fs.mkdirSync(path.join(root, "clients", "globex"), { recursive: true });
    fs.writeFileSync(path.join(root, "clients", "acme", "AGENTS.md"), "# Acme\n", "utf-8");
    fs.writeFileSync(path.join(root, "clients", "acme", ".env"), "SECRET=value\n", "utf-8");
    fs.writeFileSync(path.join(root, "clients", "globex", "AGENTS.md"), "# Globex\n", "utf-8");

    await withServer(async (baseUrl) => {
      const manifest = await fetch(`${baseUrl}/v1/workspace/manifest`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(manifest.status, 200);
      const manifestBody = await manifest.json();
      assert.deepEqual(
        manifestBody.clients.map((client) => client.slug),
        ["acme"],
      );
      assert.deepEqual(
        manifestBody.files.map((file) => file.path),
        ["clients/acme/AGENTS.md"],
      );
      assert.equal(manifestBody.files[0].writable, false);

      const acme = await fetch(
        `${baseUrl}/v1/workspace/file?path=${encodeURIComponent("clients/acme/AGENTS.md")}`,
        { headers: { authorization: `Bearer ${TOKEN}` } },
      );
      assert.equal(acme.status, 200);
      assert.equal((await acme.json()).content, "# Acme\n");

      const secret = await fetch(
        `${baseUrl}/v1/workspace/file?path=${encodeURIComponent("clients/acme/.env")}`,
        { headers: { authorization: `Bearer ${TOKEN}` } },
      );
      assert.equal(secret.status, 404);

      const globex = await fetch(
        `${baseUrl}/v1/workspace/file?path=${encodeURIComponent("clients/globex/AGENTS.md")}`,
        { headers: { authorization: `Bearer ${TOKEN}` } },
      );
      assert.equal(globex.status, 404);
    }, workspaceServer(root, "read", events));

    assert.ok(events.some((event) => event.action === "sync.pull"));
    assert.ok(events.some((event) => event.action === "sync.denied"));
  } finally {
    rmDir(root);
  }
});

test("workspace file write requires write access and stays inside the client folder", async () => {
  const root = tempDir();
  const readEvents = [];
  const writeEvents = [];
  try {
    fs.mkdirSync(path.join(root, "clients", "acme"), { recursive: true });
    fs.writeFileSync(path.join(root, "clients", "acme", "AGENTS.md"), "# Old\n", "utf-8");

    await withServer(async (baseUrl) => {
      const denied = await put(
        baseUrl,
        `/v1/workspace/file?path=${encodeURIComponent("clients/acme/AGENTS.md")}`,
        { content: "# Denied\n" },
      );
      assert.equal(denied.status, 404);
      assert.equal(
        fs.readFileSync(path.join(root, "clients", "acme", "AGENTS.md"), "utf-8"),
        "# Old\n",
      );
    }, workspaceServer(root, "read", readEvents));
    assert.ok(readEvents.some((event) => event.action === "sync.denied"));

    await withServer(async (baseUrl) => {
      const conflict = await put(
        baseUrl,
        `/v1/workspace/file?path=${encodeURIComponent("clients/acme/AGENTS.md")}`,
        { content: "# Conflict\n", expectedSha256: "not-the-current-hash" },
      );
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).error.code, "conflict");

      const written = await put(
        baseUrl,
        `/v1/workspace/file?path=${encodeURIComponent("clients/acme/context/MEMORY.md")}`,
        { content: "# New memory\n" },
      );
      assert.equal(written.status, 200);
      assert.equal((await written.json()).path, "clients/acme/context/MEMORY.md");
      assert.equal(
        fs.readFileSync(path.join(root, "clients", "acme", "context", "MEMORY.md"), "utf-8"),
        "# New memory\n",
      );

      const traversal = await put(
        baseUrl,
        `/v1/workspace/file?path=${encodeURIComponent("clients/acme/../globex/AGENTS.md")}`,
        { content: "bad" },
      );
      assert.equal(traversal.status, 400);
    }, workspaceServer(root, "write", writeEvents));
    assert.ok(writeEvents.some((event) => event.action === "sync.conflict"));
    assert.ok(writeEvents.some((event) => event.action === "sync.push"));
  } finally {
    rmDir(root);
  }
});

test("workspace access is denied on the very next request after revoke, distinct from a client that was never granted", async () => {
  const root = tempDir();
  const events = [];
  try {
    fs.mkdirSync(path.join(root, "clients", "acme"), { recursive: true });
    fs.mkdirSync(path.join(root, "clients", "globex"), { recursive: true });
    fs.writeFileSync(path.join(root, "clients", "acme", "AGENTS.md"), "# Acme\n", "utf-8");
    fs.writeFileSync(path.join(root, "clients", "globex", "AGENTS.md"), "# Globex\n", "utf-8");

    let revoked = false;
    const identityStore = {
      getMembership: async () => ({ id: "membership-1", status: "active", role: "member" }),
      getTeam: async () => ({ id: "team-http", slug: "demo", name: "Demo Team" }),
      getClientBySlug: async (_teamId, slug) =>
        slug === "acme"
          ? { id: "client-1", slug: "acme", name: "Acme", status: "active" }
          : slug === "globex"
            ? { id: "client-2", slug: "globex", name: "Globex", status: "active" }
            : null,
      getActiveGrant: async (_teamId, clientId) =>
        clientId === "client-1" && !revoked ? { access: "read", status: "active" } : null,
      listGrants: async (filter) =>
        filter.clientId === "client-1"
          ? [{
              id: "grant-1",
              teamId: "team-http",
              clientId: "client-1",
              userId: "user-http",
              access: "read",
              status: revoked ? "revoked" : "active",
            }]
          : [],
      recordAuditEvent: async (event) => {
        events.push(event);
        return event;
      },
    };

    await withServer(async (baseUrl) => {
      const before = await fetch(
        `${baseUrl}/v1/workspace/file?path=${encodeURIComponent("clients/acme/AGENTS.md")}`,
        { headers: { authorization: `Bearer ${TOKEN}` } },
      );
      assert.equal(before.status, 200);
      assert.equal((await before.json()).content, "# Acme\n");

      revoked = true;

      const afterRevoke = await fetch(
        `${baseUrl}/v1/workspace/file?path=${encodeURIComponent("clients/acme/AGENTS.md")}`,
        { headers: { authorization: `Bearer ${TOKEN}` } },
      );
      assert.equal(afterRevoke.status, 403);
      assert.equal((await afterRevoke.json()).error.code, "access_revoked");

      const neverGranted = await fetch(
        `${baseUrl}/v1/workspace/file?path=${encodeURIComponent("clients/globex/AGENTS.md")}`,
        { headers: { authorization: `Bearer ${TOKEN}` } },
      );
      assert.equal(neverGranted.status, 404);
      assert.equal((await neverGranted.json()).error.code, "not_found");
    }, {
      deps: { identityStore, workspaceRoot: root },
      resolvePrincipal: async () => ({ teamId: "team-http", userId: "user-http", authSource: "test" }),
    });

    assert.ok(events.some((event) => event.action === "sync.pull"));
    assert.ok(events.some((event) => (
      event.action === "sync.denied" && event.metadata?.reason === "revoked_client_grant"
    )));
    assert.ok(events.some((event) => (
      event.action === "sync.denied" && event.metadata?.reason === "missing_client_grant"
    )));
  } finally {
    rmDir(root);
  }
});

// ---------------------------------------------------------------------------
// routing + body handling
// ---------------------------------------------------------------------------

test("unknown routes 404; wrong methods 405", async () => {
  await withServer(async (baseUrl) => {
    const missing = await post(baseUrl, "/v1/memory/nope", {});
    assert.equal(missing.status, 404);

    const get = await fetch(`${baseUrl}/v1/memory/search`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(get.status, 405);

    const postHealth = await post(baseUrl, "/v1/health", {});
    assert.equal(postHealth.status, 405);
  });
});

test("bad JSON → 400; oversized body → 413", async () => {
  await withServer(
    async (baseUrl) => {
      const badJson = await post(baseUrl, "/v1/memory/search", "{not json");
      assert.equal(badJson.status, 400);
      assert.equal((await badJson.json()).error.code, "invalid_request");

      const huge = await post(baseUrl, "/v1/memory/ingest", {
        ...INGEST_BODY,
        content: "x".repeat(4096),
      });
      assert.equal(huge.status, 413);
    },
    { maxBodyBytes: 1024 },
  );
});

// ---------------------------------------------------------------------------
// happy paths
// ---------------------------------------------------------------------------

test("GET /v1/health reports backend + client-provided embedder contract without auth", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.backend, "pglite");
    assert.equal(body.embedder.mode, "client-provided");
    assert.equal(body.embedder.model, EMBED_MODEL);
    assert.equal(body.embedder.dim, EMBED_DIM);
    assert.equal(body.embedder.serverModeEnabled, false);
  });
});

test("GET /v1/health reports when server-side search embeddings are enabled", async () => {
  await withServer(
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.embedder.serverModeEnabled, true);
    },
    { deps: { serverEmbedder: async () => fixedServerEmbedder() } },
  );
});

test("ingest → search round trip over real HTTP", async () => {
  await withServer(async (baseUrl) => {
    const ingested = await post(baseUrl, "/v1/memory/ingest", INGEST_BODY);
    assert.equal(ingested.status, 200);
    const ingestBody = await ingested.json();
    assert.ok(ingestBody.sourceId);
    assert.ok(ingestBody.chunksInserted >= 1);

    const searched = await post(baseUrl, "/v1/memory/search", searchBody({
      query: "release process tagged builds",
      scope: {},
    }));
    assert.equal(searched.status, 200);
    const searchedBody = await searched.json();
    assert.ok(searchedBody.results.length >= 1);
    assert.equal(searchedBody.results[0].sourcePath, INGEST_BODY.sourcePath);
    assert.ok(searchedBody.eventId, "audit event must be recorded");

    // Scope is still required over HTTP.
    const noScope = await post(baseUrl, "/v1/memory/search", searchBody({ query: "q", scope: undefined }));
    assert.equal(noScope.status, 400);
    assert.equal((await noScope.json()).error.code, "invalid_scope");
  });
});

test("ingest → server-side embedding search round trip over real HTTP", async () => {
  await withServer(
    async (baseUrl) => {
      const ingested = await post(baseUrl, "/v1/memory/ingest", INGEST_BODY);
      assert.equal(ingested.status, 200);

      const searched = await post(baseUrl, "/v1/memory/search", {
        query: "release process tagged builds",
        embeddingMode: "server",
        scope: {},
      });
      assert.equal(searched.status, 200);
      const searchedBody = await searched.json();
      assert.ok(searchedBody.results.length >= 1);
      assert.equal(searchedBody.results[0].sourcePath, INGEST_BODY.sourcePath);
    },
    { deps: { serverEmbedder: async () => fixedServerEmbedder() } },
  );
});

test("ingest → expand round trip over real HTTP", async () => {
  await withServer(async (baseUrl) => {
    const ingested = await post(baseUrl, "/v1/memory/ingest", INGEST_BODY);
    assert.equal(ingested.status, 200);

    const searched = await post(baseUrl, "/v1/memory/search", searchBody({
      query: "release process tagged builds",
      scope: {},
    }));
    assert.equal(searched.status, 200);
    const searchedBody = await searched.json();
    assert.ok(searchedBody.results.length >= 1);

    const expanded = await post(baseUrl, "/v1/memory/expand", {
      chunkId: searchedBody.results[0].chunkId,
      scope: {},
      radius: 1,
    });
    assert.equal(expanded.status, 200);
    const expandedBody = await expanded.json();
    assert.ok(expandedBody.expansion);
    assert.equal(expandedBody.expansion.sourcePath, INGEST_BODY.sourcePath);
    assert.match(expandedBody.expansion.content, /release process/);
  });
});
