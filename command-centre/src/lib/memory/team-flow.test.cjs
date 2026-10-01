/**
 * Real-flow test — drives the actual HTTP server against the real identity
 * store and real memory store, simulating a genuine multi-user Team OS
 * session end to end: team creation, a client grant, a private capture that
 * must never leak into the team review queue or another user's recall, a
 * team capture that goes through staging + consolidation and IS shared, and
 * a client grant revoke that must block the very next request. This is the
 * single scenario proving AIOS-327's acceptance checklist items together,
 * rather than one assertion at a time.
 *
 * Authentication itself is simulated (bearer token -> fixed principal) so the
 * test isn't also exercising Better Auth's login handshake; every membership
 * and grant check downstream of that runs against the real identity store.
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");

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
const DEV_TOKEN = "dev-token-unused-in-this-test";

let sharedStore = null;
let sharedIdentityStore = null;

test.before(async () => {
  sharedStore = await openMemoryTestStore(store, { embedDim: EMBED_DIM });
  sharedIdentityStore = await identityStoreModule.openIdentityStore({ client: sharedStore.client });
});

test.after(async () => {
  await sharedIdentityStore?.close();
  await sharedStore?.close();
  sharedIdentityStore = null;
  sharedStore = null;
});

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function embeddingForText(text) {
  const digest = crypto.createHash("sha256").update(String(text)).digest();
  const vector = [];
  for (let i = 0; i < EMBED_DIM; i += 1) vector.push((digest[i] + 1) / 256);
  return vector;
}

function preparedMemoryPayload(content, sourcePath) {
  const chunks = chunker.chunkMarkdown(content);
  return {
    contentSha256: sha256(content),
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

async function post(baseUrl, pathname, body, token) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function get(baseUrl, pathname, token) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

/**
 * Starts the real HTTP server against the shared real store + real identity
 * store. `tokenPrincipals` maps a bearer token straight to a principal — this
 * is the only simulated part; everything past auth uses live DB state.
 */
async function withRealServer(tokenPrincipals, fn) {
  const httpServer = server.createMemoryApiServer({
    deps: {
      store: sharedStore,
      identityStore: sharedIdentityStore,
      expectedEmbeddingModel: EMBED_MODEL,
      expectedEmbeddingDim: EMBED_DIM,
    },
    token: DEV_TOKEN,
    backendKind: "pglite",
    logError: () => {},
    resolvePrincipal: async ({ token }) => tokenPrincipals[token] ?? null,
  });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
}

test("real flow: team setup, private no-leak, team sharing, and grant revoke all hold under real HTTP + real identity", async () => {
  await resetMemoryTestStore(sharedStore);

  // -- Team setup: an admin, a member, and a client the member is granted write on.
  const team = await sharedIdentityStore.createTeam({ slug: "flow-team", name: "Flow Team" });
  const admin = await sharedIdentityStore.upsertUser({ email: "flow-admin@example.com" });
  await sharedIdentityStore.upsertMembership({ teamId: team.id, userId: admin.id, role: "admin", status: "active" });
  const member = await sharedIdentityStore.upsertUser({ email: "flow-member@example.com" });
  await sharedIdentityStore.upsertMembership({ teamId: team.id, userId: member.id, role: "member", status: "active" });
  const client = await sharedIdentityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
  await sharedIdentityStore.grantClientAccess({ teamId: team.id, clientId: client.id, userId: member.id, access: "write" });

  const ADMIN_TOKEN = "token-admin";
  const MEMBER_TOKEN = "token-member";
  const tokenPrincipals = {
    [ADMIN_TOKEN]: { teamId: team.id, userId: admin.id, authSource: "test" },
    [MEMBER_TOKEN]: { teamId: team.id, userId: member.id, authSource: "test" },
  };

  await withRealServer(tokenPrincipals, async (baseUrl) => {
    // -- 1. Member captures something explicitly private (the AIOS-327 core fix:
    //    this must ingest directly, never touch team staging or the review queue).
    const privateContent = "# Private note\n\nOnly the member should ever see PRIVATE_FLOW_TOKEN.";
    const privateIngest = await post(baseUrl, "/v1/memory/ingest", {
      // teamId/userId are forged placeholders — the server ignores them and
      // binds the real principal instead; only the shape needs to validate.
      scope: { teamId: "forged", clientId: null, userId: "forged", visibility: "private" },
      sourcePath: "context/memory/private-flow.md",
      sourceType: "session",
      title: "Private flow note",
      content: privateContent,
      ...preparedMemoryPayload(privateContent, "context/memory/private-flow.md"),
    }, MEMBER_TOKEN);
    assert.equal(privateIngest.status, 200, JSON.stringify(privateIngest.body));

    // Never entered the staging table, so it can never surface in the admin review queue.
    const reviewQueue = await get(baseUrl, "/v1/memory/memories", ADMIN_TOKEN);
    assert.equal(reviewQueue.status, 200);
    assert.equal(reviewQueue.body.review.length, 0);

    // Only the member can recall it — the admin's search (even including "private") finds nothing.
    const memberFindsPrivate = await post(baseUrl, "/v1/memory/search", searchBody({
      query: "PRIVATE_FLOW_TOKEN",
      scope: { include: ["private"] },
    }), MEMBER_TOKEN);
    assert.equal(memberFindsPrivate.status, 200);
    assert.ok(memberFindsPrivate.body.results.some((r) => r.sourcePath === "context/memory/private-flow.md"));

    const adminSearchesPrivate = await post(baseUrl, "/v1/memory/search", searchBody({
      query: "PRIVATE_FLOW_TOKEN",
      scope: { include: ["private"] },
    }), ADMIN_TOKEN);
    assert.equal(adminSearchesPrivate.status, 200);
    assert.equal(adminSearchesPrivate.body.results.length, 0);

    // -- 2. Admin captures team memory the normal staged way: stage -> claim -> publish.
    const teamContent = "Team decided to route captures through staging before recall.";
    const staged = await post(baseUrl, "/v1/memory/captures", {
      scope: { teamId: "forged", clientId: null, userId: null, visibility: "team" },
      sessionId: "flow-session",
      sourceHash: sha256("flow-turn"),
      sourcePath: "context/memory/2026-07-09.aos.md#session-flow",
      sourceType: "session",
      content: teamContent,
      contentSha256: sha256(teamContent),
      byteSize: Buffer.byteLength(teamContent, "utf-8"),
      eligibleAfter: "2000-01-01T00:00:00.000Z",
    }, ADMIN_TOKEN);
    assert.equal(staged.status, 200, JSON.stringify(staged.body));

    const claimed = await post(baseUrl, "/v1/memory/consolidation/claim", {
      scope: { teamId: "forged", clientId: null, userId: null, visibility: "team" },
    }, ADMIN_TOKEN);
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.captures.length, 1);

    const publishedContent = "# Team memory\n\nCaptures are staged, then consolidated, then recallable.";
    const completed = await post(baseUrl, "/v1/memory/consolidation/complete", {
      batchId: claimed.body.batch.id,
      claimToken: claimed.body.batch.claimToken,
      items: [{
        disposition: "publish",
        captureIds: [staged.body.capture.id],
        scope: { teamId: "forged", clientId: null, userId: null, visibility: "team" },
        sourcePath: "consolidated/team/flow-memory.md",
        sourceType: "memory",
        title: "Flow team memory",
        content: publishedContent,
        ...preparedMemoryPayload(publishedContent, "consolidated/team/flow-memory.md"),
      }],
    }, ADMIN_TOKEN);
    assert.equal(completed.status, 200, JSON.stringify(completed.body));

    // The member (not the admin who wrote it) can recall the published team memory.
    const memberFindsTeam = await post(baseUrl, "/v1/memory/search", searchBody({
      query: "staged, then consolidated, then recallable",
      scope: { include: ["team"] },
    }), MEMBER_TOKEN);
    assert.equal(memberFindsTeam.status, 200);
    assert.ok(memberFindsTeam.body.results.some((r) => r.sourcePath === "consolidated/team/flow-memory.md"));

    // -- 3. Member ingests into their granted client, then the grant is revoked —
    //    the very next request must be blocked, not silently succeed.
    const clientContent = "# Acme notes\n\nClient-scoped memory while the grant is active.";
    const clientIngestBody = {
      scope: { teamId: "forged", clientId: "acme", userId: null, visibility: "client" },
      sourcePath: "clients/acme/context/memory/flow-notes.md",
      sourceType: "memory",
      title: "Acme flow notes",
      content: clientContent,
      ...preparedMemoryPayload(clientContent, "clients/acme/context/memory/flow-notes.md"),
    };
    const clientIngest = await post(baseUrl, "/v1/memory/ingest", clientIngestBody, MEMBER_TOKEN);
    assert.equal(clientIngest.status, 200, JSON.stringify(clientIngest.body));

    const memberFindsClient = await post(baseUrl, "/v1/memory/search", searchBody({
      query: "Client-scoped memory while the grant is active",
      scope: { clientId: "acme", include: ["client"] },
    }), MEMBER_TOKEN);
    assert.equal(memberFindsClient.status, 200);
    assert.ok(memberFindsClient.body.results.some((r) => r.sourcePath === "clients/acme/context/memory/flow-notes.md"));

    await sharedIdentityStore.revokeClientAccess({ teamId: team.id, clientId: client.id, userId: member.id, revokedBy: admin.id });

    const deniedIngestAfterRevoke = await post(baseUrl, "/v1/memory/ingest", {
      ...clientIngestBody,
      sourcePath: "clients/acme/context/memory/flow-notes-2.md",
    }, MEMBER_TOKEN);
    assert.equal(deniedIngestAfterRevoke.status, 403);
    assert.equal(deniedIngestAfterRevoke.body.error.code, "access_revoked");

    const memberSearchesClientAfterRevoke = await post(baseUrl, "/v1/memory/search", searchBody({
      query: "Client-scoped memory while the grant is active",
      scope: { clientId: "acme", include: ["client"] },
    }), MEMBER_TOKEN);
    assert.equal(memberSearchesClientAfterRevoke.status, 403);
    assert.equal(memberSearchesClientAfterRevoke.body.error.code, "access_revoked");
  });
});
