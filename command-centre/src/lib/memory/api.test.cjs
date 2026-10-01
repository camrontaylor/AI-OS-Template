/**
 * api.ts tests — the hosted memory API handlers.
 *
 * The handlers are transport-agnostic, so these tests exercise the full
 * contract WITHOUT a network: scope rejection (requests that do not carry
 * enough scope information are refused), citation metadata + audit event in
 * the search response, ingest validation, and — critically — the no-leak
 * guarantee through the API surface: what the CLI no-leak tests pin for the
 * store, these pin end-to-end for the HTTP contract.
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");

// Leaf-first loading — the union of the search graph and the ingest graph.
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
let resetTokenCalls = [];
const apiWithStubbedTeamAuth = loadTsModule(path.resolve(__dirname, "api.ts"), {
  stubs: {
    "./types": types,
    "./search": search,
    "./expand": expand,
    "./ingest": ingest,
    "./connectors": connectors,
    "./scope": scope,
    "../identity/invites": identityInvites,
    "../identity/permissions": identityPermissions,
    "../identity/team-auth": {
      ...identityTeamAuth,
      createPasswordResetTokenForUser: async (_store, user) => {
        resetTokenCalls.push(user.email);
        return { token: "reset-token-for-test", expiresAt: "2026-06-25T12:00:00.000Z" };
      },
      resetPasswordWithToken: async () => {},
    },
  },
});
let companyPasswordSetCalls = 0;
let companyPasswordSetError = null;
let companyPasswordSetHook = null;
const apiWithCompanyTeamAuth = loadTsModule(path.resolve(__dirname, "api.ts"), {
  stubs: {
    "./types": types,
    "./search": search,
    "./expand": expand,
    "./ingest": ingest,
    "./connectors": connectors,
    "./scope": scope,
    "../identity/invites": identityInvites,
    "../identity/permissions": identityPermissions,
    "../identity/team-auth": {
      ...identityTeamAuth,
      hasUsableBetterAuthAccount: async (email) => email.startsWith("existing-"),
      hasUsablePlatformCredential: async (identityStore, email) => {
        if (email.startsWith("existing-")) return true;
        const user = await identityStore.getUserByEmail(email);
        const legacy = user?.metadata?.teamOsPassword;
        return Boolean(
          legacy &&
          legacy.algo === "scrypt-sha256" &&
          typeof legacy.salt === "string" &&
          typeof legacy.hash === "string",
        );
      },
      setUserPassword: async (identityStore, user) => {
        companyPasswordSetCalls += 1;
        if (companyPasswordSetError) throw companyPasswordSetError;
        if (companyPasswordSetHook) await companyPasswordSetHook(identityStore, user);
        return user;
      },
      createCompanySessionForUser: async (_store, input) => ({
        token: "company-session-token",
        expiresAt: "2026-07-20T00:00:00.000Z",
        authSource: input.authSource,
        user: input.user,
        team: null,
        membership: null,
        companyMembership: input.companyMembership,
        access: null,
      }),
      createTeamSessionForUser: async (_store, input) => ({
        token: "team-session-token",
        expiresAt: "2026-07-20T00:00:00.000Z",
        authSource: input.authSource,
        user: input.user,
        team: input.team,
        membership: input.membership,
        companyMembership: null,
        access: null,
      }),
    },
  },
});

test.beforeEach(() => {
  companyPasswordSetCalls = 0;
  companyPasswordSetError = null;
  companyPasswordSetHook = null;
});

const EMBED_DIM = 8;
const EMBED_MODEL = "test-embed";
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

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-api-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function legacyPasswordRecord(password = "legacy-password-123", salt = "legacy-test-salt") {
  return {
    algo: "scrypt-sha256",
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString("base64url"),
  };
}

function normalizedTextSha256(content) {
  const text = Buffer.isBuffer(content) ? content.toString("utf-8") : String(content);
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const withLf = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return sha256(withLf.endsWith("\n") ? withLf.slice(0, -1) : withLf);
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

async function withDeps(fn) {
  if (!sharedStore) throw new Error("shared memory test store was not initialized");
  await resetMemoryTestStore(sharedStore);
  const deps = {
    store: sharedStore,
    expectedEmbeddingModel: EMBED_MODEL,
    expectedEmbeddingDim: EMBED_DIM,
  };
  await fn(deps);
}

async function withIdentityDeps(fn) {
  if (!sharedStore || !sharedIdentityStore) {
    throw new Error("shared identity test store was not initialized");
  }
  await resetMemoryTestStore(sharedStore);
  const deps = {
    store: sharedStore,
    expectedEmbeddingModel: EMBED_MODEL,
    expectedEmbeddingDim: EMBED_DIM,
    identityStore: sharedIdentityStore,
  };
  await fn(deps, sharedIdentityStore);
}

async function seedTeam(identityStore, slug) {
  const team = await identityStore.createTeam({ slug, name: slug });
  const user = await identityStore.upsertUser({ email: `${slug}@example.com` });
  await identityStore.upsertMembership({
    teamId: team.id,
    userId: user.id,
    role: "member",
    status: "active",
  });
  return { team, user };
}

async function seedAdminTeam(identityStore, slug) {
  const team = await identityStore.createTeam({ slug, name: slug });
  const admin = await identityStore.upsertUser({ email: `${slug}-admin@example.com`, displayName: "Admin User" });
  await identityStore.upsertMembership({
    teamId: team.id,
    userId: admin.id,
    role: "admin",
    status: "active",
  });
  return { team, admin };
}

async function seedCompanyOwner(identityStore, email = "company-owner@example.com") {
  const owner = await identityStore.upsertUser({ email, displayName: "Company Owner" });
  const companyMembership = await identityStore.recoverCompanyOwner({ userId: owner.id });
  return { owner, companyMembership };
}

async function withSecretCryptoEnv(fn) {
  const oldKeys = process.env.TEAM_OS_SECRETS_KEYS;
  const oldActive = process.env.TEAM_OS_SECRETS_ACTIVE_KEY_ID;
  process.env.TEAM_OS_SECRETS_KEYS = `test:${crypto.randomBytes(32).toString("base64url")}`;
  process.env.TEAM_OS_SECRETS_ACTIVE_KEY_ID = "test";
  try {
    await fn();
  } finally {
    if (oldKeys === undefined) delete process.env.TEAM_OS_SECRETS_KEYS;
    else process.env.TEAM_OS_SECRETS_KEYS = oldKeys;
    if (oldActive === undefined) delete process.env.TEAM_OS_SECRETS_ACTIVE_KEY_ID;
    else process.env.TEAM_OS_SECRETS_ACTIVE_KEY_ID = oldActive;
  }
}

function ingestBody(overrides = {}) {
  const body = {
    scope: { teamId: null, clientId: null, userId: null, visibility: "system" },
    sourcePath: "context/memory/2026-06-10.md",
    sourceType: "memory",
    contentDate: "2026-06-10",
    content: "# Release\n\nThe release process uses tagged dev builds.",
    ...overrides,
  };
  if (
    typeof body.content === "string" &&
    body.content.trim() !== "" &&
    typeof body.sourcePath === "string" &&
    body.sourcePath.trim() !== ""
  ) {
    Object.assign(body, preparedMemoryPayload(body.content, body.sourcePath));
  }
  return body;
}

async function stageReviewCapture(deps, principal, options = {}) {
  const content = options.content ?? "Possible team memory needs admin review.";
  const sessionId = options.sessionId ?? `review-${sha256(content).slice(0, 8)}`;
  const scope = options.scope ?? { teamId: principal.teamId, clientId: null, userId: null, visibility: "team" };
  const staged = await api.handleCaptureCreateRequest(
    deps,
    {
      scope,
      sessionId,
      sourceHash: sha256(`${sessionId}:${content}`),
      sourcePath: options.sourcePath ?? `context/memory/2026-06-30.aos.md#${sessionId}`,
      sourceType: "session",
      title: options.title ?? null,
      content,
      contentSha256: sha256(content),
      byteSize: Buffer.byteLength(content, "utf-8"),
      eligibleAfter: "2000-01-01T00:00:00.000Z",
    },
    { principal },
  );
  assert.equal(staged.status, 200);

  const claimed = await api.handleConsolidationClaimRequest(
    deps,
    { scope },
    { principal },
  );
  assert.equal(claimed.status, 200);
  assert.ok(claimed.body.batch);

  const completed = await api.handleConsolidationCompleteRequest(
    deps,
    {
      batchId: claimed.body.batch.id,
      claimToken: claimed.body.batch.claimToken,
      items: [
        {
          disposition: "review",
          captureIds: [staged.body.capture.id],
          reviewReason: options.reviewReason ?? "low_confidence",
          confidence: options.confidence ?? 0.42,
        },
      ],
    },
    { principal },
  );
  assert.equal(completed.status, 200);
  assert.equal(completed.body.review.length, 1);

  return {
    captureId: staged.body.capture.id,
    content,
    staged,
    claimed,
    completed,
  };
}

async function publishReviewedMemory(deps, principal, options = {}) {
  const staged = await stageReviewCapture(deps, principal, {
    content: options.reviewContent ?? "Possible team memory needs admin review.",
    scope: options.scope,
  });
  const content = options.content ?? "# Published Memory\n\nPublished memory needle.";
  const preparedSourcePath = options.preparedSourcePath ?? `reviewed/pending/${staged.captureId.slice(0, 8)}.md`;
  const accepted = await api.handleMemoryReviewActionRequest(
    deps,
    {
      action: "accept",
      captureId: staged.captureId,
      title: options.title ?? "Published Memory",
      content,
      ...preparedMemoryPayload(content, preparedSourcePath),
    },
    { principal },
  );
  assert.equal(accepted.status, 200);
  return {
    staged,
    accepted,
    sourceId: accepted.body.accepted.sourceId,
    sourcePath: accepted.body.accepted.sourcePath,
    content,
  };
}

// ---------------------------------------------------------------------------
// ingest — validation
// ---------------------------------------------------------------------------

test("ingest: rejects a body without a scope (400 invalid_scope)", async () => {
  await withDeps(async (deps) => {
    const res = await api.handleIngestRequest(deps, ingestBody({ scope: undefined }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "invalid_scope");
  });
});

test("ingest: rejects a scope that breaks the visibility invariants", async () => {
  await withDeps(async (deps) => {
    // private visibility with no userId — assertValidScope must trip, as 400.
    const res = await api.handleIngestRequest(
      deps,
      ingestBody({ scope: { teamId: null, clientId: null, userId: null, visibility: "private" } }),
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "invalid_scope");
    assert.match(res.body.error.message, /Invalid memory scope/);
  });
});

test("ingest: rejects missing/invalid fields with 400 invalid_request", async () => {
  await withDeps(async (deps) => {
    for (const bad of [
      ingestBody({ sourcePath: "" }),
      ingestBody({ content: "" }),
      ingestBody({ sourceType: "nope" }),
      ingestBody({ contentDate: "June 10" }),
      ingestBody({ authorityWeight: -1 }),
      ingestBody({ reason: "because" }),
      "not an object",
    ]) {
      const res = await api.handleIngestRequest(deps, bad);
      assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 60));
      assert.equal(res.body.error.code, "invalid_request");
    }
  });
});

test("ingest: inserts, skips unchanged, and forces re-embeds", async () => {
  await withDeps(async (deps) => {
    const first = await api.handleIngestRequest(deps, ingestBody());
    assert.equal(first.status, 200);
    assert.ok(first.body.sourceId);
    assert.equal(first.body.skipped, false);
    assert.ok(first.body.chunksInserted >= 1);

    const again = await api.handleIngestRequest(deps, ingestBody());
    assert.equal(again.status, 200);
    assert.equal(again.body.skipped, true);
    assert.equal(again.body.sourceId, first.body.sourceId);

    const forced = await api.handleIngestRequest(deps, ingestBody({ force: true }));
    assert.equal(forced.status, 200);
    assert.equal(forced.body.skipped, false);
  });
});

// ---------------------------------------------------------------------------
// search — scope rejection ("reject requests without enough scope information")
// ---------------------------------------------------------------------------

test("search: rejects a body without a scope (400 invalid_scope)", async () => {
  await withDeps(async (deps) => {
    const res = await api.handleSearchRequest(
      deps,
      searchBody({ query: "anything", scope: undefined }),
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "invalid_scope");
  });
});

test("search: rejects invalid include layers and identity types", async () => {
  await withDeps(async (deps) => {
    for (const badScope of [
      { include: [] },
      { include: ["everything"] },
      { teamId: 42 },
      "system",
    ]) {
      const res = await api.handleSearchRequest(deps, searchBody({ query: "q", scope: badScope }));
      assert.equal(res.status, 400, JSON.stringify(badScope));
      assert.equal(res.body.error.code, "invalid_scope");
    }
  });
});

test("search: rejects a missing query and an out-of-range topK", async () => {
  await withDeps(async (deps) => {
    const noQuery = await api.handleSearchRequest(deps, { scope: {} });
    assert.equal(noQuery.status, 400);
    assert.equal(noQuery.body.error.code, "invalid_request");

    const badTopK = await api.handleSearchRequest(deps, searchBody({
      query: "q",
      scope: {},
      topK: 0,
    }));
    assert.equal(badTopK.status, 400);
    assert.equal(badTopK.body.error.code, "invalid_request");
  });
});

test("search: accepts server-side embedding mode when the hosted API enables it", async () => {
  await withDeps(async (deps) => {
    await api.handleIngestRequest(deps, ingestBody());

    let embedCalls = 0;
    const res = await api.handleSearchRequest(
      {
        ...deps,
        serverEmbedder: async () => {
          embedCalls += 1;
          return fixedServerEmbedder();
        },
      },
      {
        query: "release process tagged builds",
        embeddingMode: "server",
        scope: {},
      },
    );

    assert.equal(res.status, 200);
    assert.equal(embedCalls, 1);
    assert.ok(res.body.results.length >= 1);
  });
});

test("search: rejects server-side embedding mode when it is disabled", async () => {
  await withDeps(async (deps) => {
    const res = await api.handleSearchRequest(deps, {
      query: "release process",
      embeddingMode: "server",
      scope: {},
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "server_embedding_disabled");
    assert.match(res.body.error.message, /MEMORY_API_SERVER_EMBEDDINGS=1/);
  });
});

// ---------------------------------------------------------------------------
// search — round trip with citation metadata + mandatory audit
// ---------------------------------------------------------------------------

test("search: returns citation-ready hits and records the audit event", async () => {
  await withDeps(async (deps) => {
    await api.handleIngestRequest(deps, ingestBody());

    const res = await api.handleSearchRequest(deps, searchBody({
      query: "release process tagged builds",
      scope: {}, // empty object = explicit system-baseline search
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.visibilitySet, ["system"]);
    assert.ok(res.body.results.length >= 1);
    assert.ok(typeof res.body.latencyMs === "number");

    // Citation metadata, field by field.
    const hit = res.body.results[0];
    assert.equal(hit.sourcePath, "context/memory/2026-06-10.md");
    assert.equal(hit.sourceType, "memory");
    assert.equal(hit.contentDate, "2026-06-10");
    assert.ok(hit.chunkId && hit.sourceId);
    assert.equal(hit.headingLevel, 1);
    assert.equal(hit.startLine, 3);
    assert.equal(hit.endLine, 3);
    assert.match(hit.contentHash, /^[0-9a-f]{64}$/);
    assert.match(hit.chunkKey, /^chunk:v1:[0-9a-f]{64}$/);
    assert.ok(hit.content.includes("release process"));
    assert.ok(typeof hit.score === "number" && typeof hit.finalScore === "number");

    // Audit is mandatory: the event exists and (by default) stores NO query text.
    assert.ok(res.body.eventId, "search must record a search_events row");
    const event = await deps.store.client.query(
      "SELECT query_text, result_count FROM search_events WHERE id = $1",
      [res.body.eventId],
    );
    assert.equal(event.rows[0].query_text, null, "max-privacy default");
    assert.equal(Number(event.rows[0].result_count), res.body.results.length);
  });
});

test("search: storeQueryText opts the query text into the audit row", async () => {
  await withDeps(async (deps) => {
    await api.handleIngestRequest(deps, ingestBody());
    const res = await api.handleSearchRequest(deps, searchBody({
      query: "release process",
      scope: {},
      storeQueryText: true,
    }));
    const event = await deps.store.client.query(
      "SELECT query_text FROM search_events WHERE id = $1",
      [res.body.eventId],
    );
    assert.equal(event.rows[0].query_text, "release process");
  });
});

// ---------------------------------------------------------------------------
// expand — server-side context around a scoped search result
// ---------------------------------------------------------------------------

test("expand: returns surrounding context for a scoped chunk", async () => {
  await withDeps(async (deps) => {
    await api.handleIngestRequest(
      deps,
      ingestBody({
        content: "# Release\n\nThe release process uses tagged dev builds.\n\n## Notes\n\nDeploy after review.",
      }),
    );
    const chunks = await deps.store.client.query(
      "SELECT id FROM memory_chunks WHERE source_path = $1 ORDER BY chunk_index ASC",
      ["context/memory/2026-06-10.md"],
    );
    assert.ok(chunks.rows.length >= 1);

    const res = await api.handleExpandRequest(
      deps,
      { chunkId: chunks.rows[0].id, scope: {}, radius: 1, maxChars: 1000 },
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.expansion);
    assert.equal(res.body.expansion.sourcePath, "context/memory/2026-06-10.md");
    assert.ok(res.body.expansion.content.includes("release process"));
    assert.deepEqual(res.body.expansion.chunkIds.includes(chunks.rows[0].id), true);
  });
});

test("no-leak (api expand): client A cannot expand client B memory", async () => {
  await withDeps(async (deps) => {
    const clientScope = (slug) => ({
      teamId: null,
      clientId: slug,
      userId: null,
      visibility: "client",
    });
    const content = "# Billing\n\nThe shared billing flow notes.";
    await api.handleIngestRequest(
      deps,
      ingestBody({ scope: clientScope("acme"), sourcePath: "clients/acme/notes.md", content }),
    );
    await api.handleIngestRequest(
      deps,
      ingestBody({ scope: clientScope("globex"), sourcePath: "clients/globex/notes.md", content }),
    );
    const globexChunk = await deps.store.client.query(
      "SELECT id FROM memory_chunks WHERE source_path = $1 LIMIT 1",
      ["clients/globex/notes.md"],
    );

    const denied = await api.handleExpandRequest(deps, {
      chunkId: globexChunk.rows[0].id,
      scope: { clientId: "acme", include: ["client"] },
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.body.expansion, null);
  });
});

// ---------------------------------------------------------------------------
// no-leak through the API surface
// ---------------------------------------------------------------------------

test("no-leak (api): client A search never returns client B memory", async () => {
  await withDeps(async (deps) => {
    const clientScope = (slug) => ({
      teamId: null,
      clientId: slug,
      userId: null,
      visibility: "client",
    });
    // Identical content for both tenants — only the scope filter can keep them
    // apart (similarity can't).
    const content = "# Billing\n\nThe shared billing flow notes.";
    await api.handleIngestRequest(
      deps,
      ingestBody({ scope: clientScope("acme"), sourcePath: "clients/acme/notes.md", content }),
    );
    await api.handleIngestRequest(
      deps,
      ingestBody({ scope: clientScope("globex"), sourcePath: "clients/globex/notes.md", content }),
    );

    const asAcme = await api.handleSearchRequest(deps, searchBody({
      query: "billing flow",
      scope: { clientId: "acme", include: ["client"] },
    }));
    assert.equal(asAcme.status, 200);
    assert.ok(asAcme.body.results.length >= 1, "acme must see its own memory");
    assert.ok(
      asAcme.body.results.every((r) => !r.sourcePath.includes("globex")),
      "acme must never see globex rows",
    );

    // A search that names no client gets NEITHER client's rows.
    const asSystem = await api.handleSearchRequest(
      deps,
      searchBody({ query: "billing flow", scope: {} }),
    );
    assert.equal(asSystem.body.results.length, 0);
  });
});

test("no-leak (api): team search omits other users' private memory", async () => {
  await withDeps(async (deps) => {
    const content = "# Plan\n\nQ3 hiring plan draft.";
    await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: "t1", clientId: null, userId: "alice", visibility: "private" },
        sourcePath: "private/alice.md",
        content,
      }),
    );

    // Bob searches the team — alice's private rows must not surface.
    const asBob = await api.handleSearchRequest(deps, searchBody({
      query: "hiring plan",
      scope: { teamId: "t1", userId: "bob" },
    }));
    assert.equal(asBob.status, 200);
    assert.deepEqual(asBob.body.visibilitySet, ["system", "team", "private"]);
    assert.ok(
      asBob.body.results.every((r) => r.sourcePath !== "private/alice.md"),
      "bob must never see alice's private memory",
    );

    // Alice herself does see it.
    const asAlice = await api.handleSearchRequest(deps, searchBody({
      query: "hiring plan",
      scope: { teamId: "t1", userId: "alice" },
    }));
    assert.ok(asAlice.body.results.some((r) => r.sourcePath === "private/alice.md"));
  });
});

// ---------------------------------------------------------------------------
// identity-backed API authorization
// ---------------------------------------------------------------------------

test("authz: private ingest/search use the principal, not body userId", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user: alice } = await seedTeam(identityStore, "authz-private");
    const bob = await identityStore.upsertUser({ email: "authz-bob@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: bob.id,
      role: "member",
      status: "active",
    });

    const alicePrincipal = { teamId: team.id, userId: alice.id, authSource: "test" };
    const bobPrincipal = { teamId: team.id, userId: bob.id, authSource: "test" };

    const ingestRes = await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: "forged-team", clientId: null, userId: bob.id, visibility: "private" },
        sourcePath: "private/alice-secret.md",
        content: "# Secret\n\nAlice launch secret zebra.",
      }),
      { principal: alicePrincipal },
    );
    assert.equal(ingestRes.status, 200);

    const stored = await deps.store.client.query(
      "SELECT team_id, user_id FROM memory_sources WHERE source_path = $1",
      ["private/alice-secret.md"],
    );
    assert.equal(stored.rows[0].team_id, team.id);
    assert.equal(stored.rows[0].user_id, alice.id);

    const bobSearch = await api.handleSearchRequest(
      deps,
      searchBody({
        query: "launch secret zebra",
        scope: { teamId: "forged-team", userId: alice.id, include: ["private"] },
      }),
      { principal: bobPrincipal },
    );
    assert.equal(bobSearch.status, 200);
    assert.equal(bobSearch.body.results.length, 0);

    const aliceSearch = await api.handleSearchRequest(
      deps,
      searchBody({
        query: "launch secret zebra",
        scope: { teamId: "forged-team", userId: bob.id, include: ["private"] },
      }),
      { principal: alicePrincipal },
    );
    assert.equal(aliceSearch.status, 200);
    assert.ok(aliceSearch.body.results.some((r) => r.sourcePath === "private/alice-secret.md"));
  });
});

test("authz: private expand uses the principal, not body userId", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user: alice } = await seedTeam(identityStore, "authz-expand-private");
    const bob = await identityStore.upsertUser({ email: "authz-expand-bob@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: bob.id,
      role: "member",
      status: "active",
    });

    const alicePrincipal = { teamId: team.id, userId: alice.id, authSource: "test" };
    const bobPrincipal = { teamId: team.id, userId: bob.id, authSource: "test" };
    const sourcePath = "private/alice-expand-secret.md";
    const ingestRes = await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: "forged-team", clientId: null, userId: bob.id, visibility: "private" },
        sourcePath,
        content: "# Secret\n\nAlice expand-only secret zebra.",
      }),
      { principal: alicePrincipal },
    );
    assert.equal(ingestRes.status, 200);
    const chunk = await deps.store.client.query(
      "SELECT id FROM memory_chunks WHERE source_path = $1 LIMIT 1",
      [sourcePath],
    );

    const bobExpand = await api.handleExpandRequest(
      deps,
      {
        chunkId: chunk.rows[0].id,
        scope: { teamId: "forged-team", userId: alice.id, include: ["private"] },
      },
      { principal: bobPrincipal },
    );
    assert.equal(bobExpand.status, 200);
    assert.equal(bobExpand.body.expansion, null);

    const aliceExpand = await api.handleExpandRequest(
      deps,
      {
        chunkId: chunk.rows[0].id,
        scope: { teamId: "forged-team", userId: bob.id, include: ["private"] },
      },
      { principal: alicePrincipal },
    );
    assert.equal(aliceExpand.status, 200);
    assert.match(aliceExpand.body.expansion.content, /expand-only secret/);
  });
});

test("status: reports only the authenticated team's memory and ingestion jobs", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team: acmeTeam, user: acmeUser } = await seedTeam(identityStore, "status-acme");
    const { team: otherTeam, user: otherUser } = await seedTeam(identityStore, "status-other");
    await identityStore.setRole(acmeTeam.id, acmeUser.id, "admin");
    await identityStore.setRole(otherTeam.id, otherUser.id, "admin");

    const acmePrincipal = { teamId: acmeTeam.id, userId: acmeUser.id, authSource: "test" };
    const otherPrincipal = { teamId: otherTeam.id, userId: otherUser.id, authSource: "test" };

    await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: acmeTeam.id, clientId: null, userId: null, visibility: "system" },
        sourcePath: "context/memory/acme.md",
        content: "# Acme\n\nAcme team status content.",
      }),
      { principal: acmePrincipal },
    );
    await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: otherTeam.id, clientId: null, userId: null, visibility: "system" },
        sourcePath: "context/memory/other.md",
        content: "# Other\n\nOther team status content.",
      }),
      { principal: otherPrincipal },
    );

    await deps.store.client.query(
      `INSERT INTO index_jobs (team_id, visibility, source_path, reason, status, error_message, finished_at)
       VALUES ($1, 'system', $2, 'manual', 'failed', 'bad import', now()),
              ($3, 'system', $4, 'manual', 'failed', 'other bad import', now())`,
      [acmeTeam.id, "context/memory/acme-failed.md", otherTeam.id, "context/memory/other-failed.md"],
    );

    const res = await api.handleMemoryStatusRequest(deps, { principal: acmePrincipal });

    assert.equal(res.status, 200);
    assert.equal(res.body.scope.teamId, acmeTeam.id);
    assert.equal(res.body.sources, 1);
    assert.ok(res.body.chunks >= 1);
    assert.equal(res.body.jobsByStatus.failed, 1);
    assert.equal(res.body.lastJob.errorMessage, "bad import");
  });
});

test("manual imports: admin imports client content that granted members can search", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user: admin } = await seedTeam(identityStore, "manual-import");
    await identityStore.setRole(team.id, admin.id, "admin");
    const member = await identityStore.upsertUser({ email: "manual-member@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: member.id,
      role: "member",
      status: "active",
    });
    const client = await identityStore.upsertClient({
      teamId: team.id,
      slug: "acme",
      name: "Acme",
    });
    await identityStore.grantClientAccess({
      teamId: team.id,
      clientId: client.id,
      userId: member.id,
      access: "read",
    });

    const imported = await api.handleManualImportRequest(
      deps,
      {
        scope: {
          teamId: "forged-team",
          clientId: "acme",
          userId: "forged-user",
          visibility: "client",
        },
        sourcePath: "manual/acme-shared.md",
        sourceType: "other",
        title: "Acme Shared Import",
        connector: { id: "manual", itemId: "acme-shared.md" },
        content: "# Acme\n\nShared launch codeword quartz.",
        ...preparedMemoryPayload(
          "# Acme\n\nShared launch codeword quartz.",
          "manual/acme-shared.md",
        ),
      },
      { principal: { teamId: team.id, userId: admin.id, authSource: "test" } },
    );
    assert.equal(imported.status, 200);
    assert.equal(imported.body.import.status, "indexed");
    assert.equal(imported.body.import.scope.teamId, team.id);
    assert.equal(imported.body.import.scope.clientId, "acme");
    assert.deepEqual(imported.body.import.metadata.connector, {
      id: "manual",
      sourcePath: "manual/acme-shared.md",
      itemId: "acme-shared.md",
    });

    const searchRes = await api.handleSearchRequest(
      deps,
      searchBody({
        query: "quartz",
        scope: { clientId: "acme", include: ["client"] },
      }),
      { principal: { teamId: team.id, userId: member.id, authSource: "test" } },
    );
    assert.equal(searchRes.status, 200);
    assert.ok(searchRes.body.results.some((r) => r.sourcePath === "manual/acme-shared.md"));

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((event) =>
      event.action === "memory.imported" &&
      event.targetType === "manual_import" &&
      event.metadata.sourcePath === "manual/acme-shared.md"
    ));
    assert.ok(events.some((event) =>
      event.action === "memory.published" &&
      event.targetType === "memory_source" &&
      event.targetId === imported.body.sourceId &&
      event.metadata.scope.clientId === "acme"
    ));
  });
});

test("manual imports: connector payloads can derive a stable source path", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "connector-import");
    await identityStore.setRole(team.id, user.id, "admin");

    const imported = await api.handleManualImportRequest(
      deps,
      {
        scope: { teamId: "forged-team", clientId: null, userId: null, visibility: "team" },
        sourcePath: "connectors/google_drive/folders/q3-plan",
        connector: {
          id: "google_drive",
          itemId: "folders/q3-plan",
          sourceUrl: "https://drive.google.com/file/d/q3-plan",
          displayName: "Q3 Plan",
        },
        content: "# Q3\n\nShared Drive content.",
        ...preparedMemoryPayload(
          "# Q3\n\nShared Drive content.",
          "connectors/google_drive/folders/q3-plan",
        ),
      },
      { principal: { teamId: team.id, userId: user.id, authSource: "test" } },
    );

    assert.equal(imported.status, 200);
    assert.equal(imported.body.import.sourcePath, "connectors/google_drive/folders/q3-plan");
    assert.equal(imported.body.import.title, "Q3 Plan");
    assert.deepEqual(imported.body.import.metadata.connector, {
      id: "google_drive",
      sourcePath: "connectors/google_drive/folders/q3-plan",
      itemId: "folders/q3-plan",
      sourceUrl: "https://drive.google.com/file/d/q3-plan",
      displayName: "Q3 Plan",
    });
  });
});

test("manual imports: failures can be inspected and retried", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "manual-retry");
    await identityStore.setRole(team.id, user.id, "admin");
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };
    const failingStore = Object.create(deps.store);
    failingStore.insertChunk = async () => {
      throw new Error("chunk store unavailable");
    };
    const failingDeps = {
      ...deps,
      store: failingStore,
    };

    const failed = await api.handleManualImportRequest(
      failingDeps,
      {
        scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" },
        sourcePath: "manual/team-failed.md",
        content: "# Failed\n\nRetryable team content.",
        ...preparedMemoryPayload(
          "# Failed\n\nRetryable team content.",
          "manual/team-failed.md",
        ),
      },
      { principal },
    );
    assert.equal(failed.status, 500);
    assert.equal(failed.body.error.code, "import_failed");
    assert.equal(failed.body.import.status, "failed");
    let events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((event) =>
      event.action === "memory.failed" &&
      event.targetType === "manual_import" &&
      event.targetId === failed.body.import.id &&
      /chunk store unavailable/.test(String(event.metadata.errorMessage))
    ));

    const listed = await api.handleManualImportsListRequest(
      deps,
      { status: "failed" },
      { principal },
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.imports.length, 1);
    assert.match(listed.body.imports[0].errorMessage, /chunk store unavailable/);

    const failedStatus = await api.handleMemoryStatusRequest(deps, { principal });
    assert.equal(failedStatus.status, 200);
    assert.equal(failedStatus.body.sourcesByStatus.failed, 1);
    assert.equal(failedStatus.body.failedSources[0].sourcePath, "manual/team-failed.md");
    assert.match(failedStatus.body.failedSources[0].errorMessage, /chunk store unavailable/);

    const retried = await api.handleManualImportRetryRequest(
      deps,
      { importId: failed.body.import.id },
      { principal },
    );
    assert.equal(retried.status, 200);
    assert.equal(retried.body.import.status, "indexed");
    assert.equal(retried.body.import.attempts, 2);

    const after = await api.handleManualImportsListRequest(
      deps,
      { status: "failed" },
      { principal },
    );
    assert.equal(after.status, 200);
    assert.equal(after.body.imports.length, 0);

    const recoveredStatus = await api.handleMemoryStatusRequest(deps, { principal });
    assert.equal(recoveredStatus.body.sourcesByStatus.failed ?? 0, 0);
    assert.equal(recoveredStatus.body.sourcesByStatus.indexed, 1);
    assert.equal(recoveredStatus.body.failedSources.length, 0);

    events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((event) =>
      event.action === "memory.retry" &&
      event.targetType === "manual_import" &&
      event.targetId === failed.body.import.id
    ));
    const reindexed = events.filter((event) =>
      event.action === "memory.reindexed" &&
      event.targetType === "memory_source" &&
      event.targetId === retried.body.sourceId
    );
    assert.equal(reindexed.length, 1);
  });
});

test("manual imports: non-admin members cannot publish shared imports", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "manual-denied");
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };

    const denied = await api.handleManualImportRequest(
      deps,
      {
        scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" },
        sourcePath: "manual/denied.md",
        content: "# Denied\n\nNo member publishing.",
        ...preparedMemoryPayload("# Denied\n\nNo member publishing.", "manual/denied.md"),
      },
      { principal },
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, "forbidden");

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((e) => e.metadata.reason === "manual_import_requires_admin"));
  });
});

test("manual imports: private visibility is not accepted by the publish route", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "manual-private");
    await identityStore.setRole(team.id, user.id, "admin");

    const denied = await api.handleManualImportRequest(
      deps,
      {
        scope: { teamId: team.id, clientId: null, userId: user.id, visibility: "private" },
        sourcePath: "manual/private.md",
        content: "# Private\n\nThis must stay out of the shared publish flow.",
        ...preparedMemoryPayload(
          "# Private\n\nThis must stay out of the shared publish flow.",
          "manual/private.md",
        ),
      },
      { principal: { teamId: team.id, userId: user.id, authSource: "test" } },
    );
    assert.equal(denied.status, 400);
    assert.equal(denied.body.error.code, "invalid_scope");
    assert.match(denied.body.error.message, /shared team or client/);

    const stored = await deps.store.client.query(
      "SELECT count(*)::int AS n FROM manual_imports WHERE source_path = $1",
      ["manual/private.md"],
    );
    assert.equal(Number(stored.rows[0].n), 0);
  });
});

test("team secrets: sync only returns granted secrets and normal lists never include values", async () => {
  await withSecretCryptoEnv(async () => {
    await withIdentityDeps(async (deps, identityStore) => {
      const { team, admin } = await seedAdminTeam(identityStore, "secret-sync");
      const member = await identityStore.upsertUser({ email: "secret-member@example.com" });
      await identityStore.upsertMembership({
        teamId: team.id,
        userId: member.id,
        role: "member",
        status: "active",
      });
      const client = await identityStore.upsertClient({
        teamId: team.id,
        slug: "acme",
        name: "Acme",
      });

      const adminPrincipal = { teamId: team.id, userId: admin.id, authSource: "session" };
      const memberApiKeyPrincipal = { teamId: team.id, userId: member.id, authSource: "api-key" };

      const createTeamSecret = await api.handleTeamSecretsActionRequest(
        deps,
        {
          action: "create-secret",
          name: "Shared Firecrawl",
          envKey: "FIRECRAWL_API_KEY",
          value: "fake-team-value",
          scope: "team",
        },
        { principal: adminPrincipal },
      );
      assert.equal(createTeamSecret.status, 200);
      assert.doesNotMatch(JSON.stringify(createTeamSecret.body), /fake-team-value/);

      const createClientSecret = await api.handleTeamSecretsActionRequest(
        deps,
        {
          action: "create-secret",
          name: "Acme API",
          envKey: "ACME_API_KEY",
          value: "fake-client-value",
          scope: "client",
          client: client.id,
        },
        { principal: adminPrincipal },
      );
      assert.equal(createClientSecret.status, 200);
      assert.doesNotMatch(JSON.stringify(createClientSecret.body), /fake-client-value/);

      const teamSecret = createClientSecret.body.secrets.find((secret) => secret.envKey === "FIRECRAWL_API_KEY");
      const clientSecret = createClientSecret.body.secrets.find((secret) => secret.envKey === "ACME_API_KEY");
      assert.ok(teamSecret?.id);
      assert.ok(clientSecret?.id);

      const noGrantList = await api.handleTeamSecretsListRequest(deps, {}, { principal: memberApiKeyPrincipal });
      assert.equal(noGrantList.status, 200);
      assert.deepEqual(noGrantList.body.secrets, []);

      const noGrantSync = await api.handleTeamSecretsSyncRequest(deps, {}, { principal: memberApiKeyPrincipal });
      assert.equal(noGrantSync.status, 200);
      assert.deepEqual(noGrantSync.body.team.secrets, []);
      assert.deepEqual(noGrantSync.body.clients, []);

      await api.handleTeamSecretsActionRequest(
        deps,
        { action: "grant-secret", secret: teamSecret.id, user: member.id },
        { principal: adminPrincipal },
      );
      await api.handleTeamSecretsActionRequest(
        deps,
        { action: "grant-secret", secret: clientSecret.id, user: member.id },
        { principal: adminPrincipal },
      );

      const syncWithoutClientAccess = await api.handleTeamSecretsSyncRequest(deps, {}, { principal: memberApiKeyPrincipal });
      assert.equal(syncWithoutClientAccess.status, 200);
      assert.deepEqual(syncWithoutClientAccess.body.team.secrets.map((secret) => secret.envKey), ["FIRECRAWL_API_KEY"]);
      assert.deepEqual(syncWithoutClientAccess.body.clients, []);
      assert.equal(syncWithoutClientAccess.body.team.secrets[0].value, "fake-team-value");

      await identityStore.grantClientAccess({
        teamId: team.id,
        clientId: client.id,
        userId: member.id,
        access: "read",
        grantedBy: admin.id,
      });

      const syncWithClientAccess = await api.handleTeamSecretsSyncRequest(deps, {}, { principal: memberApiKeyPrincipal });
      assert.equal(syncWithClientAccess.status, 200);
      assert.deepEqual(syncWithClientAccess.body.team.secrets.map((secret) => secret.envKey), ["FIRECRAWL_API_KEY"]);
      assert.equal(syncWithClientAccess.body.clients.length, 1);
      assert.equal(syncWithClientAccess.body.clients[0].slug, "acme");
      assert.deepEqual(syncWithClientAccess.body.clients[0].secrets.map((secret) => secret.envKey), ["ACME_API_KEY"]);
      assert.equal(syncWithClientAccess.body.clients[0].secrets[0].value, "fake-client-value");

      const syncSelectedClient = await api.handleTeamSecretsSyncRequest(
        deps,
        { client: "acme" },
        { principal: memberApiKeyPrincipal },
      );
      assert.equal(syncSelectedClient.status, 200);
      assert.deepEqual(syncSelectedClient.body.team.secrets.map((secret) => secret.envKey), ["FIRECRAWL_API_KEY"]);
      assert.deepEqual(syncSelectedClient.body.clients.map((group) => group.slug), ["acme"]);

      const listAfterGrant = await api.handleTeamSecretsListRequest(deps, {}, { principal: memberApiKeyPrincipal });
      assert.equal(listAfterGrant.status, 200);
      assert.doesNotMatch(JSON.stringify(listAfterGrant.body), /fake-team-value|fake-client-value/);

      await api.handleTeamSecretsActionRequest(
        deps,
        { action: "revoke-secret", secret: teamSecret.id, user: member.id },
        { principal: adminPrincipal },
      );
      const afterRevoke = await api.handleTeamSecretsSyncRequest(deps, {}, { principal: memberApiKeyPrincipal });
      assert.equal(afterRevoke.status, 200);
      assert.deepEqual(afterRevoke.body.team.secrets, []);
      assert.deepEqual(afterRevoke.body.clients[0].secrets.map((secret) => secret.envKey), ["ACME_API_KEY"]);

      const audit = await deps.store.client.query(
        "SELECT action, metadata FROM audit_events WHERE team_id = $1 AND action LIKE 'secret.%' ORDER BY created_at ASC",
        [team.id],
      );
      assert.ok(audit.rows.length >= 1);
      assert.doesNotMatch(JSON.stringify(audit.rows), /fake-team-value|fake-client-value/);
    });
  });
});

test("user config files: .mcp.json is encrypted, private, and conflict-protected", async () => {
  await withSecretCryptoEnv(async () => {
    await withIdentityDeps(async (deps, identityStore) => {
      const { team, user } = await seedTeam(identityStore, "mcp-config");
      const principal = { teamId: team.id, userId: user.id, authSource: "test" };
      const content = JSON.stringify({ mcpServers: { demo: { command: "node", args: ["server.js"] } } }, null, 2);

      const write = await api.handleUserConfigFileWriteRequest(
        deps,
        { path: ".mcp.json", content },
        { principal },
      );
      assert.equal(write.status, 200);
      assert.equal(write.body.file.path, ".mcp.json");
      assert.equal(typeof write.body.file.sha256, "string");
      assert.doesNotMatch(JSON.stringify(write.body), /server\.js/);

      const stored = await identityStore.getUserConfigFile(team.id, user.id, ".mcp.json");
      assert.ok(stored);
      assert.notEqual(stored.encryptedValue, content);
      assert.doesNotMatch(JSON.stringify(stored), /server\.js/);

      const read = await api.handleUserConfigFileReadRequest(
        deps,
        { path: ".mcp.json" },
        { principal },
      );
      assert.equal(read.status, 200);
      assert.equal(read.body.file.content, content);
      assert.equal(read.body.file.sha256, write.body.file.sha256);

      const conflict = await api.handleUserConfigFileWriteRequest(
        deps,
        { path: ".mcp.json", content: "{}", expectedSha256: "old" },
        { principal },
      );
      assert.equal(conflict.status, 409);

      const snapshot = await api.handleContextSnapshotRequest(deps, {}, { principal });
      assert.equal(snapshot.status, 200);
      assert.doesNotMatch(snapshot.body.snapshot.markdown, /\.mcp\.json|server\.js/);

      const deniedPath = await api.handleUserConfigFileWriteRequest(
        deps,
        { path: ".env", content: "{}" },
        { principal },
      );
      assert.equal(deniedPath.status, 400);
    });
  });
});

test("authz: shared hosted ingest requires admin or owner", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "authz-shared");
    const memberPrincipal = { teamId: team.id, userId: user.id, authSource: "test" };

    const denied = await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" },
        sourcePath: "context/memory/shared-denied.md",
        content: "# Shared\n\nA member should not publish this.",
      }),
      { principal: memberPrincipal },
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, "forbidden");

    await identityStore.setRole(team.id, user.id, "admin");
    const allowed = await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: "forged", clientId: null, userId: "forged", visibility: "team" },
        sourcePath: "context/memory/shared-allowed.md",
        content: "# Shared\n\nAn admin can publish team memory.",
      }),
      { principal: memberPrincipal },
    );
    assert.equal(allowed.status, 200);

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((e) => e.metadata.reason === "shared_scope_requires_admin"));
  });
});

test("captures: member stages team capture, then publishes consolidated memory with provenance", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "capture-stage");
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };

    const staged = await api.handleCaptureCreateRequest(
      deps,
      {
        scope: { teamId: "forged", clientId: null, userId: null, visibility: "team" },
        sessionId: "session-1",
        sourceHash: sha256("turn-1"),
        sourcePath: "context/memory/2026-06-30.aos.md#session-1",
        content: "Team decided to use staged memory before recall publication.",
        contentSha256: sha256("Team decided to use staged memory before recall publication."),
        eligibleAfter: "2000-01-01T00:00:00.000Z",
      },
      { principal },
    );
    assert.equal(staged.status, 200);
    assert.equal(staged.body.capture.actorUserId, user.id);

    const beforeSources = await deps.store.client.query(
      "SELECT count(*)::int AS n FROM memory_sources WHERE team_id = $1",
      [team.id],
    );
    assert.equal(beforeSources.rows[0].n, 0);

    const statusBeforeClaim = await api.handleMemoryStatusRequest(deps, { principal });
    assert.equal(statusBeforeClaim.status, 200);
    assert.equal(statusBeforeClaim.body.captureEventsByStatus.pending, 1);
    assert.equal(statusBeforeClaim.body.captureEligibility.pending, 1);
    assert.equal(statusBeforeClaim.body.captureEligibility.eligiblePending, 1);
    assert.equal(statusBeforeClaim.body.captureEligibility.waitingPending, 0);

    const claimed = await api.handleConsolidationClaimRequest(
      deps,
      {
        scope: { teamId: "forged", clientId: null, userId: null, visibility: "team" },
      },
      { principal },
    );
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.captures.length, 1);

    const captureId = staged.body.capture.id;
    const finalContent = "# Team memory\n\nTeam memory should be staged before recall publication.";
    const completed = await api.handleConsolidationCompleteRequest(
      deps,
      {
        batchId: claimed.body.batch.id,
        claimToken: claimed.body.batch.claimToken,
        items: [
          {
            disposition: "publish",
            captureIds: [captureId],
            scope: { teamId: "forged", clientId: null, userId: null, visibility: "team" },
            sourcePath: "consolidated/team/staged-memory.md",
            sourceType: "memory",
            title: "Team memory staging",
            content: finalContent,
            ...preparedMemoryPayload(finalContent, "consolidated/team/staged-memory.md"),
          },
        ],
      },
      { principal },
    );
    assert.equal(completed.status, 200);
    assert.equal(completed.body.published.length, 1);

    const source = await deps.store.client.query(
      "SELECT visibility, team_id, user_id, created_by_user_id FROM memory_sources WHERE source_path = $1",
      ["consolidated/team/staged-memory.md"],
    );
    assert.equal(source.rows[0].visibility, "team");
    assert.equal(source.rows[0].team_id, team.id);
    assert.equal(source.rows[0].user_id, null);
    assert.equal(source.rows[0].created_by_user_id, user.id);

    const provenance = await deps.store.client.query(
      "SELECT count(*)::int AS n FROM memory_source_provenance WHERE source_id = $1 AND capture_event_id = $2",
      [completed.body.published[0].sourceId, captureId],
    );
    assert.equal(provenance.rows[0].n, 1);

    const captureRow = await deps.store.client.query(
      "SELECT status FROM memory_capture_events WHERE id = $1",
      [captureId],
    );
    assert.equal(captureRow.rows[0].status, "processed");
  });
});

test("captures: review items stay out of recall and old raw content is redacted", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "capture-review");
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };

    const content = "Possible preference contains ambiguous private detail.";
    const staged = await api.handleCaptureCreateRequest(
      deps,
      {
        scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" },
        sessionId: "session-review",
        sourceHash: sha256("turn-review"),
        sourcePath: "context/memory/2026-06-30.aos.md#session-review",
        content,
        contentSha256: sha256(content),
        eligibleAfter: "2000-01-01T00:00:00.000Z",
      },
      { principal },
    );
    assert.equal(staged.status, 200);

    const claimed = await api.handleConsolidationClaimRequest(
      deps,
      { scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" } },
      { principal },
    );
    assert.equal(claimed.status, 200);

    const captureId = staged.body.capture.id;
    const completed = await api.handleConsolidationCompleteRequest(
      deps,
      {
        batchId: claimed.body.batch.id,
        claimToken: claimed.body.batch.claimToken,
        items: [
          {
            disposition: "review",
            captureIds: [captureId],
            reviewReason: "low_confidence",
            confidence: 0.31,
          },
        ],
      },
      { principal },
    );
    assert.equal(completed.status, 200);
    assert.equal(completed.body.published.length, 0);
    assert.equal(completed.body.review.length, 1);

    const sources = await deps.store.client.query(
      "SELECT count(*)::int AS n FROM memory_sources WHERE team_id = $1",
      [team.id],
    );
    assert.equal(sources.rows[0].n, 0);

    let captureRow = await deps.store.client.query(
      "SELECT status, content FROM memory_capture_events WHERE id = $1",
      [captureId],
    );
    assert.equal(captureRow.rows[0].status, "review");
    assert.match(captureRow.rows[0].content, /ambiguous private detail/);

    await deps.store.client.query(
      `UPDATE memory_capture_events
          SET processed_at = now() - interval '11 days',
              content = 'old raw content'
        WHERE id = $1`,
      [captureId],
    );
    const reclock = await api.handleConsolidationClaimRequest(
      deps,
      { scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" } },
      { principal },
    );
    assert.equal(reclock.status, 200);

    captureRow = await deps.store.client.query(
      "SELECT status, content, redacted_at FROM memory_capture_events WHERE id = $1",
      [captureId],
    );
    assert.equal(captureRow.rows[0].status, "review");
    assert.equal(captureRow.rows[0].content, "old raw content");
    assert.equal(captureRow.rows[0].redacted_at, null);

    await deps.store.client.query(
      `UPDATE memory_capture_events
          SET processed_at = now() - interval '31 days'
        WHERE id = $1`,
      [captureId],
    );
    const expired = await api.handleConsolidationClaimRequest(
      deps,
      { scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" } },
      { principal },
    );
    assert.equal(expired.status, 200);

    captureRow = await deps.store.client.query(
      "SELECT status, content, redacted_at FROM memory_capture_events WHERE id = $1",
      [captureId],
    );
    assert.equal(captureRow.rows[0].status, "redacted");
    assert.equal(captureRow.rows[0].content, "");
    assert.ok(captureRow.rows[0].redacted_at);
  });
});

test("memories: admin lists review items and accepts one into searchable memory", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "memory-review-accept");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const staged = await stageReviewCapture(deps, principal, {
      content: "Team should remember the blue-review-needle preference.",
      title: "Review candidate",
    });

    const listed = await api.handleMemoriesListRequest(deps, {}, { principal });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.admin, true);
    assert.equal(listed.body.review.length, 1);
    assert.equal(listed.body.review[0].id, staged.captureId);
    assert.match(listed.body.review[0].content, /blue-review-needle/);
    assert.equal(listed.body.published.length, 0);

    const acceptedContent = "# Reviewed Preference\n\nTeam remembers the blue-review-needle preference.";
    const accepted = await api.handleMemoryReviewActionRequest(
      deps,
      {
        action: "accept",
        captureId: staged.captureId,
        title: "Reviewed Preference",
        content: acceptedContent,
        ...preparedMemoryPayload(acceptedContent, "reviewed/pending/reviewed-preference.md"),
      },
      { principal },
    );
    assert.equal(accepted.status, 200);
    assert.match(accepted.body.accepted.sourcePath, /^reviewed\/team\/\d{4}-\d{2}-\d{2}-/);

    const provenance = await deps.store.client.query(
      "SELECT contribution_kind FROM memory_source_provenance WHERE source_id = $1 AND capture_event_id = $2",
      [accepted.body.accepted.sourceId, staged.captureId],
    );
    assert.equal(provenance.rows[0].contribution_kind, "review");

    const searched = await api.handleSearchRequest(
      deps,
      searchBody({ query: "blue-review-needle", scope: { include: ["team"] } }),
      { principal },
    );
    assert.equal(searched.status, 200);
    assert.ok(searched.body.results.some((result) => result.sourceId === accepted.body.accepted.sourceId));

    const captureRow = await deps.store.client.query(
      "SELECT status, metadata FROM memory_capture_events WHERE id = $1",
      [staged.captureId],
    );
    assert.equal(captureRow.rows[0].status, "processed");
    assert.equal(captureRow.rows[0].metadata.reviewDecision.action, "accepted");

    const after = await api.handleMemoriesListRequest(deps, {}, { principal });
    assert.equal(after.status, 200);
    assert.equal(after.body.review.length, 0);
    assert.ok(after.body.published.some((memory) => memory.id === accepted.body.accepted.sourceId));
  });
});

test("memories: admin review list shows cleaned AOS capture text", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "memory-review-clean-capture");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const staged = await stageReviewCapture(deps, principal, {
      title: "AI-OS session capture session-123",
      content: [
        "<!-- aos-capture session:session-123 source:abc turn:def -->",
        "### Session session-123 - 2026-07-01T02:48:06.691Z",
        "",
        "- Team should remember the clean-review-needle preference.",
        "- This is the useful memory text.",
        "",
        "Raw transcript: `context/transcripts/2026-07-01/session-123.jsonl`",
        "",
        "<!-- /aos-capture -->",
      ].join("\n"),
    });

    const listed = await api.handleMemoriesListRequest(deps, {}, { principal });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.review.length, 1);
    const item = listed.body.review[0];
    assert.equal(item.id, staged.captureId);
    assert.match(item.content, /clean-review-needle/);
    assert.doesNotMatch(item.content, /aos-capture/);
    assert.doesNotMatch(item.content, /Raw transcript/);
    assert.doesNotMatch(item.content, /^### Session/m);
    assert.match(item.title, /clean-review-needle/);
  });
});

test("memories: non-admin members cannot use memory management APIs", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "memory-review-denied");
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };

    const deniedList = await api.handleMemoriesListRequest(deps, {}, { principal });
    assert.equal(deniedList.status, 403);
    assert.equal(deniedList.body.error.code, "forbidden");

    const deniedAction = await api.handleMemoryReviewActionRequest(
      deps,
      { action: "discard", captureId: crypto.randomUUID() },
      { principal },
    );
    assert.equal(deniedAction.status, 403);
    assert.equal(deniedAction.body.error.code, "forbidden");

    const deniedUpdate = await api.handleMemoryReviewActionRequest(
      deps,
      {
        action: "update",
        sourceId: crypto.randomUUID(),
        title: "Denied",
        content: "Denied content",
        ...preparedMemoryPayload("Denied content", "reviewed/pending/denied.md"),
      },
      { principal },
    );
    assert.equal(deniedUpdate.status, 403);
    assert.equal(deniedUpdate.body.error.code, "forbidden");

    const deniedDelete = await api.handleMemoryReviewActionRequest(
      deps,
      { action: "delete", sourceId: crypto.randomUUID() },
      { principal },
    );
    assert.equal(deniedDelete.status, 403);
    assert.equal(deniedDelete.body.error.code, "forbidden");

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((event) => event.metadata.reason === "memory_management_requires_admin"));
  });
});

test("memories: admin discard keeps review capture out of recall", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "memory-review-discard");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const staged = await stageReviewCapture(deps, principal, {
      content: "Discard-only review needle should never be searchable.",
    });

    const discarded = await api.handleMemoryReviewActionRequest(
      deps,
      {
        action: "discard",
        captureId: staged.captureId,
        discardReason: "not_durable",
      },
      { principal },
    );
    assert.equal(discarded.status, 200);
    assert.equal(discarded.body.discarded.reason, "not_durable");

    const listed = await api.handleMemoriesListRequest(deps, {}, { principal });
    assert.equal(listed.status, 200);
    assert.equal("discarded" in listed.body, false);
    assert.equal("discarded" in listed.body.counts, false);

    const sources = await deps.store.client.query(
      "SELECT count(*)::int AS n FROM memory_sources WHERE team_id = $1",
      [team.id],
    );
    assert.equal(sources.rows[0].n, 0);

    const searched = await api.handleSearchRequest(
      deps,
      searchBody({ query: "Discard-only review needle", scope: { include: ["team"] } }),
      { principal },
    );
    assert.equal(searched.status, 200);
    assert.equal(searched.body.results.length, 0);

    const captureRow = await deps.store.client.query(
      "SELECT status, metadata FROM memory_capture_events WHERE id = $1",
      [staged.captureId],
    );
    assert.equal(captureRow.rows[0].status, "processed");
    assert.equal(captureRow.rows[0].metadata.discard.reason, "not_durable");

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    const discardEvent = events.find((event) => event.action === "memory.discarded" && event.targetId === staged.captureId);
    assert.ok(discardEvent);
    assert.equal(discardEvent.metadata.reason, "not_durable");
  });
});

test("memories: redacted review items keep metadata but hide raw content", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "memory-review-redacted");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const staged = await stageReviewCapture(deps, principal, {
      content: "Raw review content that will be redacted.",
    });

    await deps.store.client.query(
      `UPDATE memory_capture_events
          SET processed_at = now() - interval '31 days',
              content = 'raw content before redaction'
        WHERE id = $1`,
      [staged.captureId],
    );

    const listed = await api.handleMemoriesListRequest(deps, {}, { principal });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.review.length, 1);
    assert.equal(listed.body.review[0].id, staged.captureId);
    assert.equal(listed.body.review[0].status, "redacted");
    assert.equal(listed.body.review[0].content, "");
    assert.equal(listed.body.review[0].contentAvailable, false);
    assert.equal(listed.body.review[0].reason, "low_confidence");
  });
});

test("memories: accepted client memories stay scoped to the selected client", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "memory-review-client");
    await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
    await identityStore.upsertClient({ teamId: team.id, slug: "globex", name: "Globex" });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const staged = await stageReviewCapture(deps, principal, {
      scope: { teamId: team.id, clientId: "acme", userId: null, visibility: "client" },
      content: "Acme client remembers the client-review-needle launch rule.",
    });
    const acceptedContent = "# Acme Memory\n\nClient-review-needle belongs only to Acme.";

    const accepted = await api.handleMemoryReviewActionRequest(
      deps,
      {
        action: "accept",
        captureId: staged.captureId,
        title: "Acme Memory",
        content: acceptedContent,
        ...preparedMemoryPayload(acceptedContent, "reviewed/pending/acme-memory.md"),
      },
      { principal },
    );
    assert.equal(accepted.status, 200);
    assert.match(accepted.body.accepted.sourcePath, /^reviewed\/client-acme\//);

    const acme = await api.handleSearchRequest(
      deps,
      searchBody({ query: "client-review-needle", scope: { clientId: "acme", include: ["client"] } }),
      { principal },
    );
    assert.equal(acme.status, 200);
    assert.ok(acme.body.results.some((result) => result.sourceId === accepted.body.accepted.sourceId));

    const globex = await api.handleSearchRequest(
      deps,
      searchBody({ query: "client-review-needle", scope: { clientId: "globex", include: ["client"] } }),
      { principal },
    );
    assert.equal(globex.status, 200);
    assert.equal(globex.body.results.length, 0);
  });
});

test("memories: admin updates published memory and reindexes searchable content", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "memory-published-update");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const published = await publishReviewedMemory(deps, principal, {
      reviewContent: "Team should remember the old-published-needle preference.",
      content: "# Original Published Memory\n\nThe old-published-needle should be replaced.",
      title: "Original Published Memory",
    });
    const updatedContent = "# Updated Published Memory\n\nThe new-published-needle is now the durable fact.";

    const updated = await api.handleMemoryReviewActionRequest(
      deps,
      {
        action: "update",
        sourceId: published.sourceId,
        title: "Updated Published Memory",
        content: updatedContent,
        ...preparedMemoryPayload(updatedContent, published.sourcePath),
      },
      { principal },
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.updated.sourceId, published.sourceId);
    assert.ok(updated.body.updated.chunksInserted >= 1);

    const newSearch = await api.handleSearchRequest(
      deps,
      searchBody({ query: "new-published-needle", scope: { include: ["team"] } }),
      { principal },
    );
    assert.equal(newSearch.status, 200);
    assert.ok(newSearch.body.results.some((result) => result.sourceId === published.sourceId));

    const oldSearch = await api.handleSearchRequest(
      deps,
      searchBody({ query: "old-published-needle", scope: { include: ["team"] } }),
      { principal },
    );
    assert.equal(oldSearch.status, 200);
    assert.equal(oldSearch.body.results.some((result) => /old-published-needle/.test(result.content)), false);

    const listed = await api.handleMemoriesListRequest(deps, {}, { principal });
    const listedMemory = listed.body.published.find((memory) => memory.id === published.sourceId);
    assert.ok(listedMemory);
    assert.match(listedMemory.content, /new-published-needle/);
    assert.doesNotMatch(listedMemory.content, /old-published-needle/);

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((event) => event.action === "memory.updated" && event.targetId === published.sourceId));
  });
});

test("memories: admin deletes published memory by archiving source and removing chunks", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "memory-published-delete");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const published = await publishReviewedMemory(deps, principal, {
      reviewContent: "Team should remember the delete-published-needle preference.",
      content: "# Delete Published Memory\n\nThe delete-published-needle should disappear.",
      title: "Delete Published Memory",
    });

    const deleted = await api.handleMemoryReviewActionRequest(
      deps,
      {
        action: "delete",
        sourceId: published.sourceId,
      },
      { principal },
    );
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted.sourceId, published.sourceId);
    assert.ok(deleted.body.deleted.chunksDeleted >= 1);

    const listed = await api.handleMemoriesListRequest(deps, {}, { principal });
    assert.equal(listed.body.published.some((memory) => memory.id === published.sourceId), false);

    const source = await deps.store.client.query(
      "SELECT status, archived_at FROM memory_sources WHERE id = $1",
      [published.sourceId],
    );
    assert.equal(source.rows[0].status, "archived");
    assert.ok(source.rows[0].archived_at);

    const chunks = await deps.store.client.query(
      "SELECT count(*)::int AS n FROM memory_chunks WHERE source_id = $1",
      [published.sourceId],
    );
    assert.equal(chunks.rows[0].n, 0);

    const searched = await api.handleSearchRequest(
      deps,
      searchBody({ query: "delete-published-needle", scope: { include: ["team"] } }),
      { principal },
    );
    assert.equal(searched.status, 200);
    assert.equal(searched.body.results.length, 0);

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((event) => event.action === "memory.deleted" && event.targetId === published.sourceId));
  });
});

test("captures: new session capture defers the whole pending session", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "capture-defer");
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };

    const firstContent = "First durable session note.";
    const first = await api.handleCaptureCreateRequest(
      deps,
      {
        scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" },
        sessionId: "long-session",
        sourceHash: sha256("long-session-1"),
        sourcePath: "context/memory/2026-06-30.aos.md#long-session-1",
        content: firstContent,
        contentSha256: sha256(firstContent),
        eligibleAfter: "2000-01-01T00:00:00.000Z",
      },
      { principal },
    );
    assert.equal(first.status, 200);

    const secondContent = "Second durable session note.";
    const second = await api.handleCaptureCreateRequest(
      deps,
      {
        scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" },
        sessionId: "long-session",
        sourceHash: sha256("long-session-2"),
        sourcePath: "context/memory/2026-06-30.aos.md#long-session-2",
        content: secondContent,
        contentSha256: sha256(secondContent),
      },
      { principal },
    );
    assert.equal(second.status, 200);

    const deferred = await deps.store.client.query(
      `SELECT count(*)::int AS n
         FROM memory_capture_events
        WHERE team_id = $1
          AND session_id = 'long-session'
          AND status = 'pending'
          AND eligible_after > now()`,
      [team.id],
    );
    assert.equal(deferred.rows[0].n, 2);

    const claimed = await api.handleConsolidationClaimRequest(
      deps,
      { scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" } },
      { principal },
    );
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.batch, null);
    assert.equal(claimed.body.captures.length, 0);

    const status = await api.handleMemoryStatusRequest(deps, { principal });
    assert.equal(status.status, 200);
    assert.equal(status.body.captureEventsByStatus.pending, 2);
    assert.equal(status.body.captureEligibility.pending, 2);
    assert.equal(status.body.captureEligibility.eligiblePending, 0);
    assert.equal(status.body.captureEligibility.waitingPending, 2);
    assert.match(status.body.captureEligibility.nextEligibleAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("captures: expired consolidation claims are released before the next claim", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "capture-expired");
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };
    const content = "Expired claim should return to claimable queue.";

    const staged = await api.handleCaptureCreateRequest(
      deps,
      {
        scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" },
        sessionId: "expired-session",
        sourceHash: sha256("expired-session-1"),
        sourcePath: "context/memory/2026-06-30.aos.md#expired-session",
        content,
        contentSha256: sha256(content),
        eligibleAfter: "2000-01-01T00:00:00.000Z",
      },
      { principal },
    );
    assert.equal(staged.status, 200);

    const firstClaim = await api.handleConsolidationClaimRequest(
      deps,
      { scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" } },
      { principal },
    );
    assert.equal(firstClaim.status, 200);
    const firstBatchId = firstClaim.body.batch.id;

    await deps.store.client.query(
      "UPDATE memory_consolidation_batches SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [firstBatchId],
    );

    const secondClaim = await api.handleConsolidationClaimRequest(
      deps,
      { scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" } },
      { principal },
    );
    assert.equal(secondClaim.status, 200);
    assert.ok(secondClaim.body.batch);
    assert.notEqual(secondClaim.body.batch.id, firstBatchId);

    const oldBatch = await deps.store.client.query(
      "SELECT status, error_message FROM memory_consolidation_batches WHERE id = $1",
      [firstBatchId],
    );
    assert.equal(oldBatch.rows[0].status, "failed");
    assert.match(oldBatch.rows[0].error_message, /expired/);
  });
});

test("captures: discard completes captures without creating recall memory", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "capture-discard");
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };
    const content = "Transient implementation chatter with no durable memory.";

    const staged = await api.handleCaptureCreateRequest(
      deps,
      {
        scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" },
        sessionId: "discard-session",
        sourceHash: sha256("discard-session-1"),
        sourcePath: "context/memory/2026-06-30.aos.md#discard-session",
        content,
        contentSha256: sha256(content),
        eligibleAfter: "2000-01-01T00:00:00.000Z",
      },
      { principal },
    );
    assert.equal(staged.status, 200);

    const claimed = await api.handleConsolidationClaimRequest(
      deps,
      { scope: { teamId: team.id, clientId: null, userId: null, visibility: "team" } },
      { principal },
    );
    assert.equal(claimed.status, 200);

    const completed = await api.handleConsolidationCompleteRequest(
      deps,
      {
        batchId: claimed.body.batch.id,
        claimToken: claimed.body.batch.claimToken,
        items: [
          {
            disposition: "discard",
            captureIds: [staged.body.capture.id],
            discardReason: "no_durable_memory",
            confidence: 0.9,
          },
        ],
      },
      { principal },
    );
    assert.equal(completed.status, 200);
    assert.equal(completed.body.published.length, 0);
    assert.equal(completed.body.discarded.length, 1);

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    const discardEvent = events.find((event) => event.action === "memory.discarded" && event.targetId === claimed.body.batch.id);
    assert.ok(discardEvent);
    assert.equal(discardEvent.metadata.reason, "no_durable_memory");
    assert.deepEqual(discardEvent.metadata.captureIds, [staged.body.capture.id]);

    const sources = await deps.store.client.query(
      "SELECT count(*)::int AS n FROM memory_sources WHERE team_id = $1",
      [team.id],
    );
    assert.equal(sources.rows[0].n, 0);

    const captureRow = await deps.store.client.query(
      "SELECT status, metadata FROM memory_capture_events WHERE id = $1",
      [staged.body.capture.id],
    );
    assert.equal(captureRow.rows[0].status, "processed");
    assert.equal(captureRow.rows[0].metadata.discard.reason, "no_durable_memory");
  });
});

test("authz: client search cannot widen access with body teamId/clientId", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team: teamA, user } = await seedTeam(identityStore, "authz-client-a");
    const teamB = await identityStore.createTeam({ slug: "authz-client-b", name: "Team B" });
    const clientA = await identityStore.upsertClient({
      teamId: teamA.id,
      slug: "acme",
      name: "Acme A",
    });
    await identityStore.upsertClient({ teamId: teamB.id, slug: "acme", name: "Acme B" });
    await identityStore.grantClientAccess({
      teamId: teamA.id,
      clientId: clientA.id,
      userId: user.id,
      access: "write",
    });

    const principal = { teamId: teamA.id, userId: user.id, authSource: "test" };
    await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: teamA.id, clientId: "acme", userId: null, visibility: "client" },
        sourcePath: "clients/acme/team-a.md",
        content: "# Billing\n\nTeam A billing alpha.",
      }),
      { principal },
    );
    await api.handleIngestRequest(
      {
        store: deps.store,
        expectedEmbeddingModel: EMBED_MODEL,
        expectedEmbeddingDim: EMBED_DIM,
      },
      ingestBody({
        scope: { teamId: teamB.id, clientId: "acme", userId: null, visibility: "client" },
        sourcePath: "clients/acme/team-b.md",
        content: "# Billing\n\nTeam B billing beta.",
      }),
    );

    const res = await api.handleSearchRequest(
      deps,
      searchBody({
        query: "billing",
        scope: { teamId: teamB.id, clientId: "acme", userId: "someone-else", include: ["client"] },
      }),
      { principal },
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.results.some((r) => r.sourcePath === "clients/acme/team-a.md"));
    assert.ok(!res.body.results.some((r) => r.sourcePath === "clients/acme/team-b.md"));
  });
});

test("authz: revoked client grants fail on the next request and audit denials", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, user } = await seedTeam(identityStore, "authz-revoke");
    const client = await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
    await identityStore.grantClientAccess({
      teamId: team.id,
      clientId: client.id,
      userId: user.id,
      access: "write",
    });
    const principal = { teamId: team.id, userId: user.id, authSource: "test" };

    const ok = await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: "forged", clientId: "acme", userId: null, visibility: "client" },
        sourcePath: "clients/acme/revoked.md",
        content: "# Revoked\n\nRevoked access needle.",
      }),
      { principal },
    );
    assert.equal(ok.status, 200);

    await identityStore.revokeClientAccess({
      teamId: team.id,
      clientId: client.id,
      userId: user.id,
    });

    const deniedSearch = await api.handleSearchRequest(
      deps,
      searchBody({
        query: "revoked access needle",
        scope: { clientId: "acme", include: ["client"] },
      }),
      { principal },
    );
    assert.equal(deniedSearch.status, 403);
    assert.equal(deniedSearch.body.error.code, "access_revoked");

    const deniedIngest = await api.handleIngestRequest(
      deps,
      ingestBody({
        scope: { teamId: team.id, clientId: "acme", userId: null, visibility: "client" },
        sourcePath: "clients/acme/after-revoke.md",
        content: "# Denied\n\nThis should not ingest.",
      }),
      { principal },
    );
    assert.equal(deniedIngest.status, 403);
    assert.equal(deniedIngest.body.error.code, "access_revoked");

    const events = await identityStore.listAuditEvents({ teamId: team.id });
    assert.ok(events.some((e) => e.action === "access.denied_search"));
    assert.ok(events.some((e) => e.action === "access.denied_ingest"));
    assert.ok(events.some((e) => e.metadata.reason === "revoked_client_grant"));
  });
});

test("company memberships: existing logins promote directly, new accounts get links, and Owner is never downgraded", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore);
    const context = {
      userPrincipal: { userId: owner.id, authSource: "browser-session" },
      publicBaseUrl: "https://team.example.com",
    };

    const existing = await identityStore.upsertUser({ email: "existing-admin@example.com" });
    const promoted = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "invite-admin", email: existing.email },
      context,
    );
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.inviteUrl, null);
    assert.equal(promoted.body.promoted, true);
    assert.equal((await identityStore.getCompanyMembership(existing.id)).status, "active");

    const legacyCredential = legacyPasswordRecord();
    const legacyExisting = await identityStore.upsertUser({
      email: "legacy-company-admin@example.com",
      metadata: { teamOsPassword: legacyCredential, note: "keep-me" },
    });
    const legacyOwnerTeam = await identityStore.createTeam({
      slug: "legacy-company-admin-owner-team",
      name: "Legacy Company Admin Owner Team",
    });
    await identityStore.upsertMembership({
      teamId: legacyOwnerTeam.id,
      userId: legacyExisting.id,
      role: "owner",
      status: "active",
    });
    const promotedLegacy = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "invite-admin", email: legacyExisting.email },
      context,
    );
    assert.equal(promotedLegacy.status, 200);
    assert.equal(promotedLegacy.body.inviteUrl, null);
    assert.equal(promotedLegacy.body.promoted, true);
    assert.equal((await identityStore.getCompanyMembership(legacyExisting.id)).status, "active");
    const preservedLegacy = await identityStore.getUserById(legacyExisting.id);
    assert.deepEqual(preservedLegacy.metadata.teamOsPassword, legacyCredential);
    assert.equal(preservedLegacy.metadata.note, "keep-me");

    const disabled = await identityStore.upsertUser({
      email: "existing-disabled-admin@example.com",
      status: "disabled",
    });
    const disabledPromotion = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "invite-admin", email: disabled.email },
      context,
    );
    assert.equal(disabledPromotion.status, 409);
    assert.equal(disabledPromotion.body.error.code, "inactive_user");
    assert.equal(await identityStore.getCompanyMembership(disabled.id), null);

    const invited = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "invite-admin", email: "new-admin@example.com" },
      context,
    );
    assert.equal(invited.status, 200);
    assert.match(invited.body.inviteUrl, /^https:\/\/team\.example\.com\/company\/join\?/);
    const invitedUser = await identityStore.getUserByEmail("new-admin@example.com");
    const invitedMembership = await identityStore.getCompanyMembership(invitedUser.id);
    assert.equal(invitedMembership.status, "invited");
    assert.ok(invitedMembership.inviteTokenHash);

    const protectedTeam = await identityStore.createTeam({
      slug: "company-admin-invite-protected-owner",
      name: "Protected Owner",
    });
    const protectedOwner = await identityStore.upsertUser({ email: "company-invite-team-owner@example.com" });
    await identityStore.upsertMembership({
      teamId: protectedTeam.id,
      userId: protectedOwner.id,
      role: "owner",
      status: "active",
    });
    const protectedInvite = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "invite-admin", email: protectedOwner.email },
      context,
    );
    assert.equal(protectedInvite.status, 409);
    assert.equal(protectedInvite.body.error.code, "protected_authority");
    assert.equal(await identityStore.getCompanyMembership(protectedOwner.id), null);

    const ownerInvite = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "invite-admin", email: owner.email },
      context,
    );
    assert.equal(ownerInvite.status, 409);
    const ownerMembership = await identityStore.getCompanyMembership(owner.id);
    assert.equal(ownerMembership.role, "owner");
    assert.equal(ownerMembership.status, "active");

    await identityStore.client.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [existing.id]);
    const disabledTransfer = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "transfer-ownership", user: existing.id },
      context,
    );
    assert.equal(disabledTransfer.status, 409);
    assert.equal(disabledTransfer.body.error.code, "inactive_user");
    assert.equal((await identityStore.getCompanyMembership(owner.id)).role, "owner");
    assert.equal((await identityStore.getCompanyMembership(existing.id)).role, "admin");
  });
});

test("company Teams expose only active usable accounts in existingUsers", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore, "picker-company-owner@example.com");
    const betterAuthUser = await identityStore.upsertUser({
      email: "existing-team-picker@example.com",
      displayName: "Existing Picker",
    });
    const legacyUser = await identityStore.upsertUser({
      email: "legacy-team-picker@example.com",
      metadata: { teamOsPassword: legacyPasswordRecord() },
    });
    const noCredential = await identityStore.upsertUser({ email: "no-credential-picker@example.com" });
    const disabled = await identityStore.upsertUser({
      email: "existing-disabled-picker@example.com",
      status: "disabled",
    });

    const response = await apiWithCompanyTeamAuth.handleCompanyTeamsRequest(
      deps,
      {},
      { userPrincipal: { userId: owner.id, authSource: "browser-session" } },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(
      new Set(response.body.existingUsers.map((user) => user.userId)),
      new Set([betterAuthUser.id, legacyUser.id]),
    );
    assert.ok(response.body.eligibleOwners.some((user) => user.userId === noCredential.id));
    assert.ok(!response.body.existingUsers.some((user) => user.userId === noCredential.id));
    assert.ok(!response.body.existingUsers.some((user) => user.userId === disabled.id));
  });
});

test("company Teams add existing members, reactivate suspended rows, and audit both changes", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore, "add-member-company-owner@example.com");
    const teamOwner = await identityStore.upsertUser({ email: "add-member-team-owner@example.com" });
    const team = await identityStore.createTeam({ slug: "add-existing-member", name: "Add Existing Member" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: teamOwner.id,
      role: "owner",
      status: "active",
    });
    const existing = await identityStore.upsertUser({ email: "existing-add-team-member@example.com" });
    const context = { userPrincipal: { userId: owner.id, authSource: "browser-session" } };

    const added = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: existing.id, role: "member" },
      context,
    );
    assert.equal(added.status, 200);
    const firstMembership = await identityStore.getMembership(team.id, existing.id);
    assert.equal(firstMembership.status, "active");
    assert.equal(firstMembership.role, "member");

    const duplicate = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: existing.id, role: "admin" },
      context,
    );
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "duplicate_membership");

    await identityStore.setMembershipStatus(team.id, existing.id, "suspended");
    await identityStore.client.query(
      `UPDATE memberships SET metadata = $3::jsonb WHERE team_id = $1 AND user_id = $2`,
      [team.id, existing.id, JSON.stringify({ inviteTokenHash: "stale-token", _inviteClaimId: "stale-claim" })],
    );
    const reactivated = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: existing.id, role: "admin" },
      context,
    );
    assert.equal(reactivated.status, 200);
    const currentMembership = await identityStore.getMembership(team.id, existing.id);
    assert.equal(currentMembership.id, firstMembership.id);
    assert.equal(currentMembership.status, "active");
    assert.equal(currentMembership.role, "admin");
    assert.deepEqual(currentMembership.metadata, {});

    const audit = await identityStore.listCompanyAuditEvents({
      teamId: team.id,
      targetType: "membership",
      targetId: firstMembership.id,
    });
    assert.deepEqual(
      new Set(audit.map((event) => event.action)),
      new Set(["team_member.added", "team_member.reactivated"]),
    );
    assert.equal(audit[0].metadata.previousStatus, "suspended");
  });
});

test("company Teams reject unsafe existing-account additions and require Admin Full access", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore, "guarded-add-company-owner@example.com");
    const teamOwner = await identityStore.upsertUser({ email: "guarded-add-team-owner@example.com" });
    const team = await identityStore.createTeam({ slug: "guarded-add-member", name: "Guarded Add Member" });
    await identityStore.upsertMembership({ teamId: team.id, userId: teamOwner.id, role: "owner", status: "active" });
    const ownerContext = { userPrincipal: { userId: owner.id, authSource: "browser-session" } };

    const noCredential = await identityStore.upsertUser({ email: "no-credential-add-member@example.com" });
    const missingCredential = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: noCredential.id, role: "member" },
      ownerContext,
    );
    assert.equal(missingCredential.status, 409);
    assert.equal(missingCredential.body.error.code, "missing_credential");

    const disabled = await identityStore.upsertUser({
      email: "existing-disabled-add-member@example.com",
      status: "disabled",
    });
    const inactive = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: disabled.id, role: "member" },
      ownerContext,
    );
    assert.equal(inactive.status, 409);
    assert.equal(inactive.body.error.code, "inactive_user");

    const invited = await identityStore.upsertUser({ email: "existing-invited-add-member@example.com" });
    await identityStore.upsertMembership({ teamId: team.id, userId: invited.id, role: "member", status: "invited" });
    const invitedDuplicate = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: invited.id, role: "member" },
      ownerContext,
    );
    assert.equal(invitedDuplicate.status, 409);
    assert.equal(invitedDuplicate.body.error.code, "duplicate_membership");

    const protectedAdmin = await identityStore.upsertUser({ email: "existing-protected-add-member@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: protectedAdmin.id,
      role: "admin",
      status: "active",
      acceptedAt: new Date().toISOString(),
      invitedBy: owner.id,
    });
    await identityStore.grantCompanyTeamAccess({
      teamId: team.id,
      userId: protectedAdmin.id,
      grantedBy: owner.id,
    });
    const protectedResult = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: protectedAdmin.id, role: "admin" },
      ownerContext,
    );
    assert.equal(protectedResult.status, 409);
    assert.equal(protectedResult.body.error.code, "protected_authority");

    const ungrantedAdmin = await identityStore.upsertUser({ email: "existing-ungranted-company-admin@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: ungrantedAdmin.id,
      role: "admin",
      status: "active",
      acceptedAt: new Date().toISOString(),
      invitedBy: owner.id,
    });
    const forbidden = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: noCredential.id, role: "member" },
      { userPrincipal: { userId: ungrantedAdmin.id, authSource: "browser-session" } },
    );
    assert.equal(forbidden.status, 403);

    await identityStore.archiveTeam({ teamId: team.id, actorUserId: owner.id });
    const archived = await apiWithCompanyTeamAuth.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-member", teamId: team.id, user: noCredential.id, role: "member" },
      ownerContext,
    );
    assert.equal(archived.status, 409);
    assert.equal(archived.body.error.code, "team_archived");
  });
});

test("promote-admin uses an existing account and preserves every direct Team membership", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore, "promote-company-owner@example.com");
    const existing = await identityStore.upsertUser({ email: "existing-promote-admin@example.com" });
    const ownerTeam = await identityStore.createTeam({ slug: "promote-owner-team", name: "Promote Owner Team" });
    const adminTeam = await identityStore.createTeam({ slug: "promote-admin-team", name: "Promote Admin Team" });
    const memberTeam = await identityStore.createTeam({ slug: "promote-member-team", name: "Promote Member Team" });
    await identityStore.upsertMembership({ teamId: ownerTeam.id, userId: existing.id, role: "owner", status: "active" });
    await identityStore.upsertMembership({ teamId: adminTeam.id, userId: existing.id, role: "admin", status: "active" });
    await identityStore.upsertMembership({ teamId: memberTeam.id, userId: existing.id, role: "member", status: "active" });
    const before = await identityStore.listMembershipsForUser(existing.id);
    const context = { userPrincipal: { userId: owner.id, authSource: "browser-session" } };

    const promoted = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "promote-admin", user: existing.id },
      context,
    );
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.promoted, true);
    assert.equal(promoted.body.inviteUrl, null);
    assert.equal((await identityStore.getCompanyMembership(existing.id)).status, "active");
    assert.deepEqual(await identityStore.listMembershipsForUser(existing.id), before);

    const duplicate = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "promote-admin", user: existing.id },
      context,
    );
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "duplicate_membership");

    const noCredential = await identityStore.upsertUser({ email: "promote-without-credential@example.com" });
    const missing = await apiWithCompanyTeamAuth.handleCompanyMembershipsActionRequest(
      deps,
      { action: "promote-admin", user: noCredential.id },
      context,
    );
    assert.equal(missing.status, 409);
    assert.equal(missing.body.error.code, "missing_credential");
  });
});

test("company access reports each Admin Team source and request resolution time", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore, "access-source-company-owner@example.com");
    const admin = await identityStore.upsertUser({ email: "access-source-admin@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: admin.id,
      role: "admin",
      status: "active",
      acceptedAt: new Date().toISOString(),
      invitedBy: owner.id,
    });
    const ownerTeam = await identityStore.createTeam({ slug: "access-source-owner", name: "Owner source" });
    const adminTeam = await identityStore.createTeam({ slug: "access-source-admin", name: "Admin source" });
    const grantTeam = await identityStore.createTeam({ slug: "access-source-grant", name: "Grant source" });
    await identityStore.upsertMembership({ teamId: ownerTeam.id, userId: admin.id, role: "owner", status: "active" });
    await identityStore.upsertMembership({ teamId: adminTeam.id, userId: admin.id, role: "admin", status: "active" });
    await identityStore.grantCompanyTeamAccess({ teamId: grantTeam.id, userId: admin.id, grantedBy: owner.id });
    await identityStore.grantCompanyTeamAccess({ teamId: ownerTeam.id, userId: admin.id, grantedBy: owner.id });
    const request = await identityStore.createCompanyAccessRequest({
      teamId: adminTeam.id,
      userId: admin.id,
      reason: "Need managed access",
    });
    await identityStore.updateCompanyAccessRequest({
      requestId: request.id,
      status: "denied",
      actorUserId: owner.id,
    });

    const response = await api.handleCompanyAccessRequest(
      deps,
      { userPrincipal: { userId: owner.id, authSource: "browser-session" } },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      new Set(response.body.adminTeamAccess.map((entry) => `${entry.teamId}:${entry.source}`)),
      new Set([
        `${ownerTeam.id}:team_owner`,
        `${adminTeam.id}:team_admin`,
        `${grantTeam.id}:company_grant`,
      ]),
    );
    assert.ok(response.body.adminTeamAccess.every((entry) => entry.userId === admin.id));
    assert.equal(response.body.adminTeamAccess.length, 3, "a redundant grant is collapsed behind direct Team authority");
    const resolved = response.body.requests.find((item) => item.id === request.id);
    assert.equal(typeof resolved.resolvedAt, "string");
    assert.ok(resolved.resolvedAt.length > 0);
  });
});

test("company access grant and revoke return the updated adminTeamAccess state", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore, "access-toggle-company-owner@example.com");
    const admin = await identityStore.upsertUser({ email: "access-toggle-admin@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: admin.id,
      role: "admin",
      status: "active",
      acceptedAt: new Date().toISOString(),
      invitedBy: owner.id,
    });
    const team = await identityStore.createTeam({ slug: "access-toggle-team", name: "Access Toggle Team" });
    const context = { userPrincipal: { userId: owner.id, authSource: "browser-session" } };

    const granted = await apiWithCompanyTeamAuth.handleCompanyAccessActionRequest(
      deps,
      { action: "grant-access", user: admin.id, teamId: team.id },
      context,
    );
    assert.equal(granted.status, 200);
    assert.deepEqual(
      granted.body.adminTeamAccess.filter((entry) => entry.userId === admin.id && entry.teamId === team.id),
      [{ userId: admin.id, teamId: team.id, source: "company_grant" }],
    );

    const revoked = await apiWithCompanyTeamAuth.handleCompanyAccessActionRequest(
      deps,
      { action: "revoke-access", user: admin.id, teamId: team.id },
      context,
    );
    assert.equal(revoked.status, 200);
    assert.deepEqual(
      revoked.body.adminTeamAccess.filter((entry) => entry.userId === admin.id && entry.teamId === team.id),
      [],
    );
    assert.deepEqual(await identityStore.listCompanyTeamAccessGrants({ userId: admin.id, status: "active" }), []);
  });
});

test("company access: an invalid Team makes a bulk grant atomic", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore, "bulk-company-owner@example.com");
    const admin = await identityStore.upsertUser({ email: "bulk-company-admin@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: admin.id,
      role: "admin",
      status: "active",
      acceptedAt: new Date().toISOString(),
      invitedBy: owner.id,
    });
    const firstTeam = await identityStore.createTeam({ slug: "bulk-first", name: "Bulk First" });
    const secondTeam = await identityStore.createTeam({ slug: "bulk-second", name: "Bulk Second" });
    const missingTeamId = crypto.randomUUID();
    const context = { userPrincipal: { userId: owner.id, authSource: "browser-session" } };

    const malformed = await api.handleCompanyAccessActionRequest(
      deps,
      {
        action: "grant-access-bulk",
        user: admin.id,
        teamIds: [firstTeam.id, "not-a-team-id", secondTeam.id],
      },
      context,
    );
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, "invalid_request");

    const rejected = await api.handleCompanyAccessActionRequest(
      deps,
      {
        action: "grant-access-bulk",
        user: admin.id,
        teamIds: [firstTeam.id, missingTeamId, secondTeam.id],
      },
      context,
    );

    assert.equal(rejected.status, 404);
    assert.equal(rejected.body.error.code, "not_found");
    assert.deepEqual(
      await identityStore.listCompanyTeamAccessGrants({ userId: admin.id, status: "active" }),
      [],
      "no valid Team may be granted when any Team id is invalid",
    );
    const audit = await identityStore.listCompanyAuditEvents({ targetType: "company_team_access_grant" });
    assert.equal(audit.length, 0, "a rejected batch must not leave grant audit events");
  });
});

test("company operations return user-correctable statuses instead of throwing 500s", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore, "domain-company-owner@example.com");
    const teamOwner = await identityStore.upsertUser({ email: "domain-team-owner@example.com" });
    const team = await identityStore.createTeam({ slug: "domain-errors", name: "Domain Errors" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: teamOwner.id,
      role: "owner",
      status: "active",
    });
    const context = { userPrincipal: { userId: owner.id, authSource: "browser-session" } };

    const lastOwner = await api.handleCompanyTeamsActionRequest(
      deps,
      { action: "remove-team-owner", teamId: team.id, user: teamOwner.id },
      context,
    );
    assert.equal(lastOwner.status, 409);
    assert.equal(lastOwner.body.error.code, "conflict");

    const sameOwnerTransfer = await api.handleCompanyMembershipsActionRequest(
      deps,
      { action: "transfer-ownership", user: owner.id },
      context,
    );
    assert.equal(sameOwnerTransfer.status, 400);
    assert.equal(sameOwnerTransfer.body.error.code, "invalid_request");

    const duplicateSlug = await api.handleCompanyTeamsActionRequest(
      deps,
      {
        action: "create-team",
        slug: team.slug,
        name: "Duplicate Domain Errors",
        ownerUserId: teamOwner.id,
      },
      context,
    );
    assert.equal(duplicateSlug.status, 409);
    assert.equal(duplicateSlug.body.error.code, "conflict");

    const archived = await api.handleCompanyTeamsActionRequest(
      deps,
      { action: "archive-team", teamId: team.id },
      context,
    );
    assert.equal(archived.status, 200);

    const archiveAgain = await api.handleCompanyTeamsActionRequest(
      deps,
      { action: "archive-team", teamId: team.id },
      context,
    );
    assert.equal(archiveAgain.status, 409);
    assert.equal(archiveAgain.body.error.code, "conflict");

    const deleteTooSoon = await api.handleCompanyTeamsActionRequest(
      deps,
      { action: "delete-team", teamId: team.id, expectedName: team.name, confirm: true },
      context,
    );
    assert.equal(deleteTooSoon.status, 409);
    assert.equal(deleteTooSoon.body.error.code, "team_not_deletable");
  });
});

test("permanent Team deletion purges only exclusively owned active workspace files", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const rootDir = tempDir();
    const outsideDir = `${rootDir}-outside`;
    try {
      deps.workspaceRoot = rootDir;
      const { owner } = await seedCompanyOwner(identityStore, "purge-company-owner@example.com");
      const targetTeam = await identityStore.createTeam({
        slug: "purge-target-team",
        name: "Purge Target Team",
      });
      const otherTeam = await identityStore.createTeam({
        slug: "purge-other-team",
        name: "Purge Other Team",
      });

      await identityStore.upsertClient({
        teamId: targetTeam.id,
        slug: "target-only",
        name: "Target only",
      });
      await identityStore.upsertClient({
        teamId: otherTeam.id,
        slug: "other-only",
        name: "Other only",
      });
      await identityStore.upsertClient({
        teamId: targetTeam.id,
        slug: "shared-client",
        name: "Shared target",
      });
      await identityStore.upsertClient({
        teamId: otherTeam.id,
        slug: "shared-client",
        name: "Shared other",
      });
      // Legacy/corrupt rows may contain a path-shaped slug. It must never be
      // allowed to escape the configured workspace during deletion.
      const outsideName = path.basename(outsideDir);
      await identityStore.upsertClient({
        teamId: targetTeam.id,
        slug: `../${outsideName}`,
        name: "Unsafe legacy client",
      });

      const targetDir = path.join(rootDir, "clients", "target-only");
      const otherDir = path.join(rootDir, "clients", "other-only");
      const sharedDir = path.join(rootDir, "clients", "shared-client");
      const companySharedFile = path.join(rootDir, "brand_context", "company-shared.md");
      fs.mkdirSync(path.join(targetDir, "nested"), { recursive: true });
      fs.mkdirSync(otherDir, { recursive: true });
      fs.mkdirSync(sharedDir, { recursive: true });
      fs.mkdirSync(path.dirname(companySharedFile), { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, "one.md"), "target one");
      fs.writeFileSync(path.join(targetDir, "nested", "two.md"), "target two");
      fs.writeFileSync(path.join(otherDir, "keep.md"), "other Team");
      fs.writeFileSync(path.join(sharedDir, "keep.md"), "shared slug");
      fs.writeFileSync(companySharedFile, "company shared");
      fs.writeFileSync(path.join(outsideDir, "keep.md"), "outside workspace");

      assert.equal(
        await identityStore.isClientWorkspaceSlugExclusiveToTeam(targetTeam.id, "target-only"),
        true,
      );
      assert.equal(
        await identityStore.isClientWorkspaceSlugExclusiveToTeam(targetTeam.id, "shared-client"),
        false,
      );

      const archivedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      await identityStore.client.query(
        `UPDATE teams
         SET status = 'archived', archived_at = $2::timestamptz, archived_by = $3
         WHERE id = $1`,
        [targetTeam.id, archivedAt, owner.id],
      );

      const rejected = await api.handleCompanyTeamsActionRequest(
        deps,
        {
          action: "delete-team",
          teamId: targetTeam.id,
          expectedName: "Wrong confirmation",
          confirm: true,
        },
        { userPrincipal: { userId: owner.id, authSource: "browser-session" } },
      );
      assert.equal(rejected.status, 400);
      assert.equal(fs.existsSync(path.join(targetDir, "one.md")), true);
      assert.equal(
        fs.readdirSync(rootDir).some((entry) => entry.startsWith(".team-os-purge-")),
        false,
        "validation failures must happen before workspace staging",
      );

      const response = await api.handleCompanyTeamsActionRequest(
        deps,
        {
          action: "delete-team",
          teamId: targetTeam.id,
          expectedName: targetTeam.name,
          confirm: true,
        },
        { userPrincipal: { userId: owner.id, authSource: "browser-session" } },
      );

      assert.equal(response.status, 200);
      assert.deepEqual(response.body.workspacePurge, {
        files: 2,
        clientDirectories: 1,
        sharedClientDirectoriesSkipped: 1,
        unsafeClientDirectoriesSkipped: 1,
        cleanupPending: false,
      });
      assert.equal(fs.existsSync(targetDir), false, "target Team directory must be purged");
      assert.equal(fs.existsSync(otherDir), true, "another Team directory must remain");
      assert.equal(fs.existsSync(sharedDir), true, "ambiguous shared slug directory must remain");
      assert.equal(fs.existsSync(companySharedFile), true, "company-shared files must remain");
      assert.equal(fs.existsSync(path.join(outsideDir, "keep.md")), true, "path traversal must not escape");
      assert.equal(await identityStore.getTeam(targetTeam.id), null);
      assert.notEqual(await identityStore.getTeam(otherTeam.id), null);
      assert.notEqual(await identityStore.getClientBySlug(otherTeam.id, "other-only"), null);
      assert.notEqual(await identityStore.getClientBySlug(otherTeam.id, "shared-client"), null);
      assert.equal(
        fs.readdirSync(rootDir).some((entry) => entry.startsWith(".team-os-purge-")),
        false,
        "completed purge staging must be removed",
      );

      const audit = await identityStore.listCompanyAuditEvents({ teamId: targetTeam.id });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, "team.deleted");
      assert.deepEqual(audit[0].metadata.workspacePurge, {
        files: 2,
        clientDirectories: 1,
        sharedClientDirectoriesSkipped: 1,
        unsafeClientDirectoriesSkipped: 1,
      });
    } finally {
      rmDir(rootDir);
      rmDir(outsideDir);
    }
  });
});

test("failed Team deletion preserves staged data when an active path is recreated", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const rootDir = tempDir();
    const originalDelete = identityStore.deleteTeamPermanently;
    try {
      deps.workspaceRoot = rootDir;
      const { owner } = await seedCompanyOwner(identityStore, "restore-company-owner@example.com");
      const team = await identityStore.createTeam({
        slug: "restore-collision-team",
        name: "Restore Collision Team",
      });
      await identityStore.upsertClient({
        teamId: team.id,
        slug: "collision-client",
        name: "Collision client",
      });
      await identityStore.upsertClient({
        teamId: team.id,
        slug: "restorable-client",
        name: "Restorable client",
      });

      const collisionDir = path.join(rootDir, "clients", "collision-client");
      const restorableDir = path.join(rootDir, "clients", "restorable-client");
      fs.mkdirSync(collisionDir, { recursive: true });
      fs.mkdirSync(restorableDir, { recursive: true });
      fs.writeFileSync(path.join(collisionDir, "original.md"), "staged original");
      fs.writeFileSync(path.join(restorableDir, "original.md"), "restorable original");
      const archivedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      await identityStore.client.query(
        `UPDATE teams
         SET status = 'archived', archived_at = $2::timestamptz, archived_by = $3
         WHERE id = $1`,
        [team.id, archivedAt, owner.id],
      );

      identityStore.deleteTeamPermanently = async () => {
        assert.equal(fs.existsSync(collisionDir), false, "client directory should already be staged");
        assert.equal(fs.existsSync(restorableDir), false, "all owned directories should be staged");
        fs.mkdirSync(collisionDir, { recursive: true });
        fs.writeFileSync(path.join(collisionDir, "replacement.md"), "concurrent replacement");
        throw new Error("forced database failure");
      };

      let response;
      try {
        response = await api.handleCompanyTeamsActionRequest(
          deps,
          {
            action: "delete-team",
            teamId: team.id,
            expectedName: team.name,
            confirm: true,
          },
          { userPrincipal: { userId: owner.id, authSource: "browser-session" } },
        );
      } finally {
        identityStore.deleteTeamPermanently = originalDelete;
      }

      assert.equal(response.status, 500);
      assert.equal(response.body.error.code, "workspace_restore_failed");
      assert.match(response.body.error.recoveryRef, /^[0-9a-f-]{36}$/);
      const serializedError = JSON.stringify(response.body.error);
      assert.equal(serializedError.includes(rootDir), false, "the API must not expose the workspace path");
      assert.equal(serializedError.includes(collisionDir), false, "the API must not expose client paths");

      assert.equal(
        fs.readFileSync(path.join(collisionDir, "replacement.md"), "utf8"),
        "concurrent replacement",
        "the recreated active path must not be overwritten",
      );
      assert.equal(
        fs.readFileSync(path.join(restorableDir, "original.md"), "utf8"),
        "restorable original",
        "non-conflicting staged data should be restored",
      );

      const stagingName = `.team-os-purge-${response.body.error.recoveryRef}`;
      const stagingRoot = path.join(rootDir, stagingName);
      assert.equal(fs.existsSync(stagingRoot), true, "recovery staging must be preserved");
      assert.equal(
        fs.readFileSync(path.join(stagingRoot, "clients", "collision-client", "original.md"), "utf8"),
        "staged original",
        "the conflicting original must remain recoverable",
      );
      assert.equal(
        fs.existsSync(path.join(stagingRoot, "clients", "restorable-client")),
        false,
        "successfully restored directories should no longer remain staged",
      );
      assert.notEqual(await identityStore.getTeam(team.id), null, "the failed DB deletion must keep the Team");
    } finally {
      identityStore.deleteTeamPermanently = originalDelete;
      rmDir(rootDir);
    }
  });
});

test("company invitation: a short password does not consume the invite", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    await seedCompanyOwner(identityStore);
    const token = "company-invite-token";
    const tokenHash = sha256(token);
    const user = await identityStore.upsertUser({ email: "new-short-password@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: user.id,
      role: "admin",
      status: "invited",
      inviteTokenHash: tokenHash,
      inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    companyPasswordSetCalls = 0;

    const response = await apiWithCompanyTeamAuth.handleCompanyInvitationAcceptRequest(deps, {
      email: user.email,
      token,
      password: "short",
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "invalid_request");
    assert.equal(companyPasswordSetCalls, 0);
    const membership = await identityStore.getCompanyMembership(user.id);
    assert.equal(membership.status, "invited");
    assert.equal(membership.inviteTokenHash, tokenHash);
  });
});

test("company invitation: disabled or already-credentialed users cannot accept", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    await seedCompanyOwner(identityStore);
    for (const candidate of [
      { email: "disabled-company-accept@example.com", disabled: true },
      { email: "existing-company-accept@example.com", disabled: false },
    ]) {
      const token = `token-${candidate.email}`;
      const tokenHash = sha256(token);
      const user = await identityStore.upsertUser({ email: candidate.email });
      await identityStore.upsertCompanyMembership({
        userId: user.id,
        role: "admin",
        status: "invited",
        inviteTokenHash: tokenHash,
        inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      if (candidate.disabled) {
        await identityStore.client.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [user.id]);
      }
      companyPasswordSetCalls = 0;

      const response = await apiWithCompanyTeamAuth.handleCompanyInvitationAcceptRequest(deps, {
        email: candidate.email,
        token,
        password: "valid-password-123",
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "invalid_invite");
      assert.equal(companyPasswordSetCalls, 0);
      const membership = await identityStore.getCompanyMembership(user.id);
      assert.equal(membership.status, "invited");
      assert.equal(membership.inviteTokenHash, tokenHash);
    }
  });
});

test("company invitation: an old link cannot replace a legacy credential or promote a later Team Owner", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    await seedCompanyOwner(identityStore);
    const team = await identityStore.createTeam({
      slug: "company-invite-later-owner",
      name: "Company Invite Later Owner",
    });
    const cases = [
      { email: "legacy-old-company-invite@example.com", becomesOwner: false },
      { email: "later-owner-company-invite@example.com", becomesOwner: true },
    ];

    for (const candidate of cases) {
      const token = `old-${candidate.email}`;
      const tokenHash = sha256(token);
      let user = await identityStore.upsertUser({ email: candidate.email });
      await identityStore.upsertCompanyMembership({
        userId: user.id,
        role: "admin",
        status: "invited",
        inviteTokenHash: tokenHash,
        inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      if (candidate.becomesOwner) {
        await identityStore.upsertMembership({
          teamId: team.id,
          userId: user.id,
          role: "owner",
          status: "active",
        });
      } else {
        user = await identityStore.upsertUser({
          email: user.email,
          metadata: { teamOsPassword: legacyPasswordRecord(), note: "preserve" },
        });
      }

      const response = await apiWithCompanyTeamAuth.handleCompanyInvitationAcceptRequest(deps, {
        email: user.email,
        token,
        password: "must-not-replace-123",
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "invalid_invite");
      assert.equal(companyPasswordSetCalls, 0);
      const membership = await identityStore.getCompanyMembership(user.id);
      assert.equal(membership.status, "invited");
      assert.equal(membership.inviteTokenHash, tokenHash);
      if (!candidate.becomesOwner) {
        assert.equal((await identityStore.getUserById(user.id)).metadata.note, "preserve");
      }
    }
  });
});

test("company invitation: concurrent acceptance writes only the winner's credential", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    await seedCompanyOwner(identityStore);
    await identityStore.client.query(
      `INSERT INTO team_os_instance (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING`,
    );
    const token = "concurrent-company-invite";
    const tokenHash = sha256(token);
    const user = await identityStore.upsertUser({ email: "new-concurrent-admin@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: user.id,
      role: "admin",
      status: "invited",
      inviteTokenHash: tokenHash,
      inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    companyPasswordSetCalls = 0;

    const responses = await Promise.all([
      apiWithCompanyTeamAuth.handleCompanyInvitationAcceptRequest(deps, {
        email: user.email,
        token,
        password: "first-password-123",
      }),
      apiWithCompanyTeamAuth.handleCompanyInvitationAcceptRequest(deps, {
        email: user.email,
        token,
        password: "second-password-456",
      }),
    ]);

    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(companyPasswordSetCalls, 1);
    assert.equal((await identityStore.getCompanyMembership(user.id)).status, "active");
  });
});

test("company invitation: credential failure releases the claim and retry can succeed", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    await seedCompanyOwner(identityStore);
    await identityStore.client.query(
      `INSERT INTO team_os_instance (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING`,
    );
    const token = "recoverable-company-invite";
    const tokenHash = sha256(token);
    const user = await identityStore.upsertUser({ email: "new-recoverable-admin@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: user.id,
      role: "admin",
      status: "invited",
      inviteTokenHash: tokenHash,
      inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    companyPasswordSetCalls = 0;
    companyPasswordSetError = new identityTeamAuth.TeamAuthError(
      500,
      "invalid_request",
      "credential creation failed",
    );

    const failed = await apiWithCompanyTeamAuth.handleCompanyInvitationAcceptRequest(deps, {
      email: user.email,
      token,
      password: "recoverable-password-123",
    });
    assert.equal(failed.status, 500);
    let membership = await identityStore.getCompanyMembership(user.id);
    assert.equal(membership.status, "invited");
    assert.equal(membership.inviteTokenHash, tokenHash);
    assert.equal(membership.metadata._inviteClaimId, undefined);

    companyPasswordSetError = null;
    const retried = await apiWithCompanyTeamAuth.handleCompanyInvitationAcceptRequest(deps, {
      email: user.email,
      token,
      password: "recoverable-password-123",
    });
    assert.equal(retried.status, 200);
    membership = await identityStore.getCompanyMembership(user.id);
    assert.equal(membership.status, "active");
  });
});

test("company invitation: finalization rejects authority or status changes made after the claim", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    await seedCompanyOwner(identityStore);
    const ownerTeam = await identityStore.createTeam({
      slug: "company-finalize-race-owner",
      name: "Company Finalize Race Owner",
    });
    for (const scenario of ["disabled", "team-owner"]) {
      const token = `company-finalize-${scenario}`;
      const tokenHash = sha256(token);
      const user = await identityStore.upsertUser({ email: `${scenario}-company-finalize@example.com` });
      await identityStore.upsertCompanyMembership({
        userId: user.id,
        role: "admin",
        status: "invited",
        inviteTokenHash: tokenHash,
        inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      companyPasswordSetHook = async () => {
        if (scenario === "disabled") {
          await identityStore.client.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [user.id]);
        } else {
          await identityStore.upsertMembership({
            teamId: ownerTeam.id,
            userId: user.id,
            role: "owner",
            status: "active",
          });
        }
      };

      const response = await apiWithCompanyTeamAuth.handleCompanyInvitationAcceptRequest(deps, {
        email: user.email,
        token,
        password: "race-safe-password-123",
      });
      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, "invite_claim_lost");
      const membership = await identityStore.getCompanyMembership(user.id);
      assert.equal(membership.status, "invited");
      assert.equal(membership.inviteTokenHash, tokenHash);
      assert.equal(membership.metadata._inviteClaimId, undefined);
      assert.equal(membership.metadata._inviteCredentialReady, undefined);
    }
    assert.equal(companyPasswordSetCalls, 2);
  });
});

test("team Members merges protected Company access and blocks direct mutations", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner: companyOwner } = await seedCompanyOwner(identityStore);
    const team = await identityStore.createTeam({ slug: "protected-company-member", name: "Protected Company Member" });
    const teamOwner = await identityStore.upsertUser({ email: "team-owner-protected@example.com" });
    await identityStore.upsertMembership({ teamId: team.id, userId: teamOwner.id, role: "owner", status: "active" });
    await identityStore.upsertMembership({ teamId: team.id, userId: companyOwner.id, role: "member", status: "active" });
    const context = { principal: { teamId: team.id, userId: teamOwner.id, authSource: "test" } };

    const state = await api.handleTeamAdminRequest(deps, context);
    assert.equal(state.status, 200);
    const rows = state.body.members.filter((member) => member.userId === companyOwner.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "admin");
    assert.equal(rows[0].protected, true);
    assert.equal(rows[0].source, "company_owner");

    const roleChange = await api.handleTeamAdminActionRequest(
      deps,
      { action: "set-member-role", user: companyOwner.email, role: "admin" },
      context,
    );
    assert.equal(roleChange.status, 403);
    const removal = await api.handleTeamAdminActionRequest(
      deps,
      { action: "remove-member", user: companyOwner.email },
      context,
    );
    assert.equal(removal.status, 403);
    assert.equal((await identityStore.getMembership(team.id, companyOwner.id)).status, "active");
  });
});

test("Company Admin with Full access can add and remove a Team Owner", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { owner } = await seedCompanyOwner(identityStore);
    const companyAdmin = await identityStore.upsertUser({ email: "company-admin-owner-mgmt@example.com" });
    await identityStore.upsertCompanyMembership({
      userId: companyAdmin.id,
      role: "admin",
      status: "active",
      acceptedAt: new Date().toISOString(),
      invitedBy: owner.id,
    });
    const team = await identityStore.createTeam({ slug: "company-admin-owner-mgmt", name: "Owner Management" });
    const initialOwner = await identityStore.upsertUser({ email: "initial-team-owner@example.com" });
    const nextOwner = await identityStore.upsertUser({ email: "next-team-owner@example.com" });
    await identityStore.upsertMembership({ teamId: team.id, userId: initialOwner.id, role: "owner", status: "active" });
    await identityStore.upsertMembership({ teamId: team.id, userId: nextOwner.id, role: "member", status: "active" });
    await identityStore.grantCompanyTeamAccess({
      teamId: team.id,
      userId: companyAdmin.id,
      grantedBy: owner.id,
    });
    const context = { userPrincipal: { userId: companyAdmin.id, authSource: "browser-session" } };

    const added = await api.handleCompanyTeamsActionRequest(
      deps,
      { action: "add-team-owner", teamId: team.id, user: nextOwner.id },
      context,
    );
    assert.equal(added.status, 200);
    assert.equal((await identityStore.getMembership(team.id, nextOwner.id)).role, "owner");

    const removed = await api.handleCompanyTeamsActionRequest(
      deps,
      {
        action: "remove-team-owner",
        teamId: team.id,
        user: nextOwner.id,
        replacementRole: "member",
      },
      context,
    );
    assert.equal(removed.status, 200);
    assert.equal((await identityStore.getMembership(team.id, nextOwner.id)).role, "member");
  });
});

test("team admin: invite links are full hosted URLs without a separate token field", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-invite-link");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const res = await api.handleTeamAdminActionRequest(
      deps,
      { action: "invite-member", email: "pending@example.com", role: "member" },
      { principal, publicBaseUrl: "https://team.example.test" },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.invite.email, "pending@example.com");
    assert.equal(res.body.invite.token, undefined);
    assert.match(res.body.invite.url, /^https:\/\/team\.example\.test\/team\/join\?/);
    const url = new URL(res.body.invite.url);
    assert.equal(url.searchParams.get("team"), team.slug);
    assert.equal(url.searchParams.get("email"), "pending@example.com");
    assert.ok(url.searchParams.get("token"));
  });
});

test("team admin: copying a pending invite regenerates a fresh hosted link", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-invite-regenerate");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const first = await api.handleTeamAdminActionRequest(
      deps,
      { action: "invite-member", email: "pending2@example.com", role: "admin" },
      { principal, publicBaseUrl: "https://team.example.test" },
    );
    const second = await api.handleTeamAdminActionRequest(
      deps,
      { action: "create-invite-link", user: "pending2@example.com" },
      { principal, publicBaseUrl: "https://team.example.test" },
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.notEqual(first.body.invite.url, second.body.invite.url);
    assert.equal(new URL(second.body.invite.url).searchParams.get("email"), "pending2@example.com");
  });
});

test("team invitations never create or accept a password link for an existing account", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "existing-team-invite");
    const email = "existing-team-member@example.com";
    const existing = await identityStore.upsertUser({ email });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const create = await apiWithCompanyTeamAuth.handleTeamAdminActionRequest(
      deps,
      { action: "invite-member", email, role: "member" },
      { principal, publicBaseUrl: "https://team.example.test" },
    );
    assert.equal(create.status, 409);
    assert.equal(create.body.error.code, "existing_account");
    assert.equal(await identityStore.getMembership(team.id, existing.id), null);

    const legacyInvite = await identityInvites.inviteMember(identityStore, {
      teamId: team.id,
      actorUserId: admin.id,
      email,
      role: "member",
    });
    companyPasswordSetCalls = 0;
    const accept = await apiWithCompanyTeamAuth.handleTeamJoinRequest(deps, {
      team: team.slug,
      email,
      token: legacyInvite.token,
      password: "replacement-password-123",
    });
    assert.equal(accept.status, 400);
    assert.equal(accept.body.error.code, "invalid_invite");
    assert.equal(companyPasswordSetCalls, 0);
    assert.equal((await identityStore.getMembership(team.id, existing.id)).status, "invited");

    const legacyCredential = legacyPasswordRecord();
    const legacyUser = await identityStore.upsertUser({
      email: "legacy-team-member@example.com",
      metadata: { teamOsPassword: legacyCredential, note: "keep-legacy" },
    });
    const legacyCreate = await apiWithCompanyTeamAuth.handleTeamAdminActionRequest(
      deps,
      { action: "invite-member", email: legacyUser.email, role: "member" },
      { principal, publicBaseUrl: "https://team.example.test" },
    );
    assert.equal(legacyCreate.status, 409);
    assert.equal(legacyCreate.body.error.code, "existing_account");
    assert.equal(await identityStore.getMembership(team.id, legacyUser.id), null);

    const oldLegacyInvite = await identityInvites.inviteMember(identityStore, {
      teamId: team.id,
      actorUserId: admin.id,
      email: legacyUser.email,
      role: "member",
    });
    const legacyAccept = await apiWithCompanyTeamAuth.handleTeamJoinRequest(deps, {
      team: team.slug,
      email: legacyUser.email,
      token: oldLegacyInvite.token,
      password: "must-not-replace-legacy-123",
    });
    assert.equal(legacyAccept.status, 400);
    assert.equal(legacyAccept.body.error.code, "invalid_invite");
    assert.equal(companyPasswordSetCalls, 0);
    assert.equal((await identityStore.getMembership(team.id, legacyUser.id)).status, "invited");
    const preserved = await identityStore.getUserById(legacyUser.id);
    assert.deepEqual(preserved.metadata.teamOsPassword, legacyCredential);
    assert.equal(preserved.metadata.note, "keep-legacy");
  });
});

test("team invitation: invalid password does not consume the invite", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "short-team-invite");
    const invited = await identityInvites.inviteMember(identityStore, {
      teamId: team.id,
      actorUserId: admin.id,
      email: "new-short-team-invite@example.com",
      role: "member",
    });
    companyPasswordSetCalls = 0;

    const response = await apiWithCompanyTeamAuth.handleTeamJoinRequest(deps, {
      team: team.slug,
      email: invited.user.email,
      token: invited.token,
      password: "short",
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "invalid_request");
    assert.equal(companyPasswordSetCalls, 0);
    assert.equal((await identityStore.getMembership(team.id, invited.user.id)).status, "invited");
  });
});

test("team invitation: credential failure releases the claim and a retry succeeds", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "recoverable-team-invite");
    await identityStore.client.query(
      `INSERT INTO team_os_instance (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING`,
    );
    const invited = await identityInvites.inviteMember(identityStore, {
      teamId: team.id,
      actorUserId: admin.id,
      email: "recoverable-team-member@example.com",
      role: "member",
    });
    companyPasswordSetError = new identityTeamAuth.TeamAuthError(
      500,
      "internal",
      "credential creation failed",
    );

    const failed = await apiWithCompanyTeamAuth.handleTeamJoinRequest(deps, {
      team: team.slug,
      email: invited.user.email,
      token: invited.token,
      password: "recoverable-password-123",
    });
    assert.equal(failed.status, 500);
    let membership = await identityStore.getMembership(team.id, invited.user.id);
    assert.equal(membership.status, "invited");
    assert.equal(membership.metadata._inviteClaimId, undefined);
    assert.ok(membership.metadata.inviteTokenHash);

    companyPasswordSetError = null;
    const retried = await apiWithCompanyTeamAuth.handleTeamJoinRequest(deps, {
      team: team.slug,
      email: invited.user.email,
      token: invited.token,
      password: "recoverable-password-123",
    });
    assert.equal(retried.status, 200);
    membership = await identityStore.getMembership(team.id, invited.user.id);
    assert.equal(membership.status, "active");
    assert.equal(companyPasswordSetCalls, 2);
  });
});

test("team invitation: concurrent acceptance creates only one credential", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "concurrent-team-invite");
    await identityStore.client.query(
      `INSERT INTO team_os_instance (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING`,
    );
    const invited = await identityInvites.inviteMember(identityStore, {
      teamId: team.id,
      actorUserId: admin.id,
      email: "concurrent-team-member@example.com",
      role: "member",
    });

    const responses = await Promise.all([
      apiWithCompanyTeamAuth.handleTeamJoinRequest(deps, {
        team: team.slug,
        email: invited.user.email,
        token: invited.token,
        password: "first-concurrent-password-123",
      }),
      apiWithCompanyTeamAuth.handleTeamJoinRequest(deps, {
        team: team.slug,
        email: invited.user.email,
        token: invited.token,
        password: "second-concurrent-password-456",
      }),
    ]);

    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
    assert.equal(companyPasswordSetCalls, 1);
    assert.equal((await identityStore.getMembership(team.id, invited.user.id)).status, "active");
  });
});

test("team invitation: finalization rejects status or Company authority changes after the claim", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "team-finalize-race");
    await seedCompanyOwner(identityStore, "team-finalize-company-owner@example.com");
    for (const scenario of ["disabled", "company-admin"]) {
      const invited = await identityInvites.inviteMember(identityStore, {
        teamId: team.id,
        actorUserId: admin.id,
        email: `${scenario}-team-finalize@example.com`,
        role: "member",
      });
      companyPasswordSetHook = async () => {
        if (scenario === "disabled") {
          await identityStore.client.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [invited.user.id]);
        } else {
          await identityStore.upsertCompanyMembership({
            userId: invited.user.id,
            role: "admin",
            status: "active",
          });
        }
      };

      const response = await apiWithCompanyTeamAuth.handleTeamJoinRequest(deps, {
        team: team.slug,
        email: invited.user.email,
        token: invited.token,
        password: "race-safe-password-123",
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "invalid_invite");
      const membership = await identityStore.getMembership(team.id, invited.user.id);
      assert.equal(membership.status, "invited");
      assert.equal(membership.metadata._inviteClaimId, undefined);
      assert.equal(membership.metadata._inviteCredentialReady, undefined);
    }
    assert.equal(companyPasswordSetCalls, 2);
  });
});

test("team invitation credential actions reject Company authority", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "protected-team-invite");
    const teamOwner = await identityStore.upsertUser({ email: "protected-invite-team-owner@example.com" });
    await identityStore.upsertMembership({ teamId: team.id, userId: teamOwner.id, role: "owner", status: "active" });
    const otherTeam = await identityStore.createTeam({ slug: "protected-owner-other-team", name: "Other Team" });
    const crossTeamOwner = await identityStore.upsertUser({ email: "protected-cross-team-owner@example.com" });
    await identityStore.upsertMembership({
      teamId: otherTeam.id,
      userId: crossTeamOwner.id,
      role: "owner",
      status: "active",
    });
    const { owner } = await seedCompanyOwner(identityStore, "protected-invite-owner@example.com");
    const companyAdmin = await identityStore.upsertUser({ email: "protected-invite-admin@example.com" });
    await identityStore.upsertCompanyMembership({ userId: companyAdmin.id, role: "admin", status: "active" });
    await identityStore.grantCompanyTeamAccess({ teamId: team.id, userId: companyAdmin.id });
    const companyAdminWithoutGrant = await identityStore.upsertUser({ email: "protected-invite-admin-no-grant@example.com" });
    await identityStore.upsertCompanyMembership({ userId: companyAdminWithoutGrant.id, role: "admin", status: "active" });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    for (const user of [teamOwner, crossTeamOwner, owner, companyAdmin, companyAdminWithoutGrant]) {
      const response = await apiWithCompanyTeamAuth.handleTeamAdminActionRequest(
        deps,
        { action: "invite-member", email: user.email, role: "member" },
        { principal },
      );
      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, "forbidden");
      const membership = await identityStore.getMembership(team.id, user.id);
      if (user.id === teamOwner.id) assert.equal(membership.role, "owner");
      else assert.equal(membership, null);
    }

    const reinviteOwner = await apiWithCompanyTeamAuth.handleTeamAdminActionRequest(
      deps,
      { action: "create-invite-link", user: teamOwner.email },
      { principal },
    );
    assert.equal(reinviteOwner.status, 403);
    assert.equal(reinviteOwner.body.error.code, "forbidden");
  });
});

test("team admin: client name creation generates unique slugs", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-client-slugs");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const first = await api.handleTeamAdminActionRequest(
      deps,
      { action: "create-client", name: "Acme Client" },
      { principal },
    );
    const second = await api.handleTeamAdminActionRequest(
      deps,
      { action: "create-client", name: "Acme Client" },
      { principal },
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const slugs = second.body.clients.map((client) => client.slug).sort();
    assert.deepEqual(slugs, ["acme-client", "acme-client-2"]);
  });
});

test("team admin: an explicit client slug is normalized and created", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-explicit-client-slug");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const response = await api.handleTeamAdminActionRequest(
      deps,
      { action: "create-client", name: "Customer Workspace", slug: "  Acme.Client  " },
      { principal },
    );

    assert.equal(response.status, 200);
    assert.ok(response.body.clients.some((client) => (
      client.slug === "acme.client" && client.name === "Customer Workspace"
    )));
  });
});

test("team admin: an explicit duplicate slug returns 409 without mutation", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-duplicate-client-slug");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const original = await identityStore.upsertClient({
      teamId: team.id,
      slug: "Acme",
      name: "Original client",
      metadata: { source: "original" },
    });

    const response = await api.handleTeamAdminActionRequest(
      deps,
      { action: "create-client", name: "Replacement client", slug: " ACME " },
      { principal },
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "conflict");
    const persisted = await identityStore.getClientBySlug(team.id, "Acme");
    assert.equal(persisted.id, original.id);
    assert.equal(persisted.slug, "Acme");
    assert.equal(persisted.name, "Original client");
    assert.deepEqual(persisted.metadata, { source: "original" });
    assert.equal((await identityStore.listClients(team.id)).length, 1);
  });
});

test("team admin: the root client slug is reserved", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-reserved-client-slug");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const response = await api.handleTeamAdminActionRequest(
      deps,
      { action: "create-client", name: "Root client", slug: "ROOT" },
      { principal },
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "invalid_request");
    assert.match(response.body.error.message, /reserved/i);
    assert.equal(await identityStore.getClientBySlug(team.id, "root"), null);
  });
});

test("team admin: generated slugs skip the reserved root name", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-generated-root-client");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const response = await api.handleTeamAdminActionRequest(
      deps,
      { action: "create-client", name: "Root" },
      { principal },
    );

    assert.equal(response.status, 200);
    assert.ok(response.body.clients.some((client) => client.slug === "root-2"));
    assert.equal(await identityStore.getClientBySlug(team.id, "root"), null);
  });
});

test("team admin: generated slugs skip cross-platform reserved folder names", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-generated-windows-client");
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const response = await api.handleTeamAdminActionRequest(
      deps,
      { action: "create-client", name: "CON" },
      { principal },
    );

    assert.equal(response.status, 200);
    assert.ok(response.body.clients.some((client) => client.slug === "con-2"));
    assert.equal(await identityStore.getClientBySlug(team.id, "con"), null);
  });
});

test("team clients: owners and admins receive implicit editor access to every active client", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-auto-client-access");
    await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
    await identityStore.upsertClient({ teamId: team.id, slug: "globex", name: "Globex" });
    await identityStore.upsertClient({ teamId: team.id, slug: "inactive", name: "Inactive", status: "archived" });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const res = await api.handleTeamClientsRequest(deps, { principal });

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.clients.map((client) => [client.slug, client.access, client.implicit, client.protected]).sort(),
      [
        ["acme", "write", true, true],
        ["globex", "write", true, true],
      ],
    );
  });
});

test("team admin: owner and admin client access appears as protected grants", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-auto-grants");
    const client = await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
    const member = await identityStore.upsertUser({ email: "client-user@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: member.id,
      role: "member",
      status: "active",
    });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const res = await api.handleTeamAdminRequest(deps, { principal });

    assert.equal(res.status, 200);
    const adminGrant = res.body.clientGrants.find((grant) => grant.userId === admin.id && grant.clientId === client.id);
    assert.equal(adminGrant.access, "write");
    assert.equal(adminGrant.implicit, true);
    assert.equal(adminGrant.protected, true);
    const memberRow = res.body.members.find((item) => item.userId === admin.id);
    assert.equal(memberRow.clients[0].slug, "acme");
    assert.equal(memberRow.clients[0].implicit, true);
  });
});

test("team admin: storage status prefers GitHub backup env vars and requires token", async () => {
  const rootDir = tempDir();
  const keys = [
    "AI_OS_DIR",
    "TEAM_OS_GITHUB_BACKUP_REMOTE",
    "TEAM_OS_WORKSPACE_BACKUP_REMOTE",
    "TEAM_OS_GIT_BACKUP_REMOTE",
    "TEAM_OS_GITHUB_BACKUP_TOKEN",
    "TEAM_OS_WORKSPACE_BACKUP_TOKEN",
    "TEAM_OS_GIT_BACKUP_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "TEAM_OS_GITHUB_BACKUP_BRANCH",
    "TEAM_OS_WORKSPACE_BACKUP_BRANCH",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.AI_OS_DIR = rootDir;
  process.env.TEAM_OS_GITHUB_BACKUP_REMOTE = "https://github.com/example/github.git";
  process.env.TEAM_OS_WORKSPACE_BACKUP_REMOTE = "https://github.com/example/legacy.git";
  process.env.TEAM_OS_GITHUB_BACKUP_BRANCH = "github-branch";
  try {
    await withIdentityDeps(async (deps, identityStore) => {
      deps.workspaceRoot = rootDir;
      const { team, admin } = await seedAdminTeam(identityStore, "admin-storage-backup");
      const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

      const missingToken = await api.handleTeamAdminRequest(deps, { principal });
      assert.equal(missingToken.status, 200);
      assert.equal(missingToken.body.storage.backup.configured, false);
      assert.equal(missingToken.body.storage.backup.remoteConfigured, true);
      assert.equal(missingToken.body.storage.backup.tokenConfigured, false);
      assert.equal(missingToken.body.storage.backup.branch, "github-branch");
      assert.match(missingToken.body.storage.backup.warning, /token/i);

      process.env.TEAM_OS_GITHUB_BACKUP_TOKEN = "github-token";
      const configured = await api.handleTeamAdminRequest(deps, { principal });
      assert.equal(configured.status, 200);
      assert.equal(configured.body.storage.backup.configured, true);
      assert.equal(configured.body.storage.backup.remoteConfigured, true);
      assert.equal(configured.body.storage.backup.tokenConfigured, true);
      assert.equal(configured.body.storage.backup.branch, "github-branch");
      assert.equal(configured.body.storage.backup.warning, null);
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmDir(rootDir);
  }
});

test("team admin: storage status still accepts workspace backup env aliases", async () => {
  const rootDir = tempDir();
  const keys = [
    "AI_OS_DIR",
    "TEAM_OS_GITHUB_BACKUP_REMOTE",
    "TEAM_OS_WORKSPACE_BACKUP_REMOTE",
    "TEAM_OS_GITHUB_BACKUP_TOKEN",
    "TEAM_OS_WORKSPACE_BACKUP_TOKEN",
    "TEAM_OS_GITHUB_BACKUP_BRANCH",
    "TEAM_OS_WORKSPACE_BACKUP_BRANCH",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.AI_OS_DIR = rootDir;
  process.env.TEAM_OS_WORKSPACE_BACKUP_REMOTE = "https://github.com/example/legacy.git";
  process.env.TEAM_OS_WORKSPACE_BACKUP_TOKEN = "legacy-token";
  process.env.TEAM_OS_WORKSPACE_BACKUP_BRANCH = "legacy-branch";
  try {
    await withIdentityDeps(async (deps, identityStore) => {
      deps.workspaceRoot = rootDir;
      const { team, admin } = await seedAdminTeam(identityStore, "admin-storage-legacy-backup");
      const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

      const response = await api.handleTeamAdminRequest(deps, { principal });
      assert.equal(response.status, 200);
      assert.equal(response.body.storage.backup.configured, true);
      assert.equal(response.body.storage.backup.branch, "legacy-branch");
      assert.equal(response.body.storage.backup.warning, null);
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmDir(rootDir);
  }
});

test("team admin: client grant action adds a member as an editor", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-add-client-editor");
    const member = await identityStore.upsertUser({ email: "editor@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: member.id,
      role: "member",
      status: "active",
    });
    const client = await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const res = await api.handleTeamAdminActionRequest(
      deps,
      { action: "grant-client", client: client.id, user: member.id, access: "write" },
      { principal },
    );

    assert.equal(res.status, 200);
    const grant = res.body.clientGrants.find((item) => item.userId === member.id && item.clientId === client.id);
    assert.equal(grant.access, "write");
    assert.equal(grant.implicit, false);
  });
});

test("team admin: client grant and revoke actions accept id and email user refs", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-client-user-refs");
    const member = await identityStore.upsertUser({ email: "client-ref-member@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: member.id,
      role: "member",
      status: "active",
    });
    const client = await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
    const originalGetUserById = identityStore.getUserById.bind(identityStore);
    identityStore.getUserById = async (userId) => {
      if (userId === "external-member-id") return member;
      return originalGetUserById(userId);
    };

    let res = await api.handleTeamAdminActionRequest(
      deps,
      { action: "grant-client", client: client.id, user: "external-member-id", access: "write" },
      { principal },
    );

    assert.equal(res.status, 200);
    let grant = res.body.clientGrants.find((item) => item.userId === member.id && item.clientId === client.id);
    assert.equal(grant.access, "write");

    res = await api.handleTeamAdminActionRequest(
      deps,
      { action: "revoke-client", client: client.id, user: member.email },
      { principal },
    );

    assert.equal(res.status, 200);
    assert.ok(!res.body.clientGrants.some((item) => item.userId === member.id && item.clientId === client.id));

    res = await api.handleTeamAdminActionRequest(
      deps,
      { action: "grant-client", client: client.id, user: member.id, access: "read" },
      { principal },
    );

    assert.equal(res.status, 200);
    grant = res.body.clientGrants.find((item) => item.userId === member.id && item.clientId === client.id);
    assert.equal(grant.access, "read");
  });
});

test("team admin: suspended users are hidden and their client grants are revoked", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-remove-member");
    const member = await identityStore.upsertUser({ email: "remove-me@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: member.id,
      role: "member",
      status: "active",
    });
    const client = await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
    await identityStore.grantClientAccess({
      teamId: team.id,
      clientId: client.id,
      userId: member.id,
      access: "write",
      grantedBy: admin.id,
    });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const res = await api.handleTeamAdminActionRequest(
      deps,
      { action: "remove-member", user: "remove-me@example.com" },
      { principal },
    );

    assert.equal(res.status, 200);
    assert.ok(!res.body.members.some((item) => item.email === "remove-me@example.com"));
    assert.ok(!res.body.clientGrants.some((grant) => grant.email === "remove-me@example.com"));
    const membership = await identityStore.getMembership(team.id, member.id);
    assert.equal(membership.status, "suspended");
    const activeGrant = await identityStore.getActiveGrant(team.id, client.id, member.id);
    assert.equal(activeGrant, null);
  });
});

test("team admin: password reset action returns a hosted reset URL", async () => {
  resetTokenCalls = [];
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "admin-reset-link");
    const member = await identityStore.upsertUser({ email: "active@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: member.id,
      role: "member",
      status: "active",
    });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    const res = await apiWithStubbedTeamAuth.handleTeamAdminActionRequest(
      deps,
      { action: "create-password-reset-link", user: "active@example.com" },
      { principal, publicBaseUrl: "https://team.example.test" },
    );

    assert.equal(res.status, 200);
    assert.deepEqual(resetTokenCalls, ["active@example.com"]);
    assert.equal(res.body.reset.email, "active@example.com");
    const url = new URL(res.body.reset.url);
    assert.equal(url.origin, "https://team.example.test");
    assert.equal(url.pathname, "/team/reset-password");
    assert.equal(url.searchParams.get("email"), "active@example.com");
    assert.equal(url.searchParams.get("token"), "reset-token-for-test");
  });
});

test("team admin: password reset rejects Team Owner and Company authority credentials", async () => {
  resetTokenCalls = [];
  await withIdentityDeps(async (deps, identityStore) => {
    const { team, admin } = await seedAdminTeam(identityStore, "protected-reset-link");
    const teamOwner = await identityStore.upsertUser({ email: "protected-reset-team-owner@example.com" });
    await identityStore.upsertMembership({ teamId: team.id, userId: teamOwner.id, role: "owner", status: "active" });
    const otherTeam = await identityStore.createTeam({ slug: "protected-reset-other-team", name: "Reset Other Team" });
    const crossTeamOwner = await identityStore.upsertUser({ email: "protected-reset-cross-owner@example.com" });
    await identityStore.upsertMembership({ teamId: team.id, userId: crossTeamOwner.id, role: "member", status: "active" });
    await identityStore.upsertMembership({
      teamId: otherTeam.id,
      userId: crossTeamOwner.id,
      role: "owner",
      status: "active",
    });
    const { owner: companyOwner } = await seedCompanyOwner(identityStore, "protected-reset-company-owner@example.com");
    const companyAdmin = await identityStore.upsertUser({ email: "protected-reset-company-admin@example.com" });
    await identityStore.upsertCompanyMembership({ userId: companyAdmin.id, role: "admin", status: "active" });
    await identityStore.grantCompanyTeamAccess({ teamId: team.id, userId: companyAdmin.id });
    const member = await identityStore.upsertUser({ email: "reset-ordinary-member@example.com" });
    await identityStore.upsertMembership({ teamId: team.id, userId: member.id, role: "member", status: "active" });
    const principal = { teamId: team.id, userId: admin.id, authSource: "test" };

    for (const user of [teamOwner, crossTeamOwner, companyOwner, companyAdmin]) {
      const denied = await apiWithStubbedTeamAuth.handleTeamAdminActionRequest(
        deps,
        { action: "create-password-reset-link", user: user.email },
        { principal, publicBaseUrl: "https://team.example.test" },
      );
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error.code, "forbidden");
    }

    const allowed = await apiWithStubbedTeamAuth.handleTeamAdminActionRequest(
      deps,
      { action: "create-password-reset-link", user: member.email },
      { principal, publicBaseUrl: "https://team.example.test" },
    );
    assert.equal(allowed.status, 200);
    assert.deepEqual(resetTokenCalls, [member.email]);
  });
});

test("brand context sync allows member reads and only admin writes", async () => {
  const rootDir = tempDir();
  try {
    await withIdentityDeps(async (deps, identityStore) => {
      deps.workspaceRoot = rootDir;
      fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
      fs.writeFileSync(path.join(rootDir, "brand_context", "voice-profile.md"), "# Voice\n\nPlain spoken.\n");
      fs.writeFileSync(path.join(rootDir, "brand_context", ".env"), "SECRET=hidden\n");

      const { team, admin } = await seedAdminTeam(identityStore, "brand-sync");
      const member = await identityStore.upsertUser({ email: "brand-member@example.com" });
      await identityStore.upsertMembership({
        teamId: team.id,
        userId: member.id,
        role: "member",
        status: "active",
      });
      const memberPrincipal = { teamId: team.id, userId: member.id, authSource: "test" };
      const adminPrincipal = { teamId: team.id, userId: admin.id, authSource: "test" };

      const manifest = await api.handleBrandContextManifestRequest(deps, { principal: memberPrincipal });
      assert.equal(manifest.status, 200);
      assert.equal(manifest.body.writable, false);
      assert.deepEqual(manifest.body.files.map((file) => file.path), ["brand_context/voice-profile.md"]);

      const read = await api.handleBrandContextFileReadRequest(
        deps,
        { path: "brand_context/voice-profile.md" },
        { principal: memberPrincipal },
      );
      assert.equal(read.status, 200);
      assert.equal(read.body.content, "# Voice\n\nPlain spoken.\n");

      const deniedWrite = await api.handleBrandContextFileWriteRequest(
        deps,
        { content: "# Voice\n\nMember write.\n" },
        { path: "brand_context/voice-profile.md" },
        { principal: memberPrincipal },
      );
      assert.equal(deniedWrite.status, 403);

      const conflict = await api.handleBrandContextFileWriteRequest(
        deps,
        { content: "# Voice\n\nAdmin write.\n", expectedSha256: "not-the-current-hash" },
        { path: "brand_context/voice-profile.md" },
        { principal: adminPrincipal },
      );
      assert.equal(conflict.status, 409);

      const write = await api.handleBrandContextFileWriteRequest(
        deps,
        { content: "# Voice\n\nAdmin write.\n" },
        { path: "brand_context/voice-profile.md" },
        { principal: adminPrincipal },
      );
      assert.equal(write.status, 200);
      assert.equal(fs.readFileSync(path.join(rootDir, "brand_context", "voice-profile.md"), "utf-8"), "# Voice\n\nAdmin write.\n");
    });
  } finally {
    rmDir(rootDir);
  }
});

test("context documents isolate private users, teams, and client write grants", async () => {
  await withIdentityDeps(async (deps, identityStore) => {
    const { team: teamA, admin: adminA } = await seedAdminTeam(identityStore, "context-a");
    const { team: teamB, admin: adminB } = await seedAdminTeam(identityStore, "context-b");
    const viewer = await identityStore.upsertUser({ email: "context-viewer@example.com" });
    const editor = await identityStore.upsertUser({ email: "context-editor@example.com" });
    await identityStore.upsertMembership({
      teamId: teamA.id,
      userId: viewer.id,
      role: "member",
      status: "active",
    });
    await identityStore.upsertMembership({
      teamId: teamA.id,
      userId: editor.id,
      role: "member",
      status: "active",
    });
    const client = await identityStore.upsertClient({
      teamId: teamA.id,
      slug: "acme",
      name: "Acme",
    });
    await identityStore.grantClientAccess({
      teamId: teamA.id,
      clientId: client.id,
      userId: viewer.id,
      access: "read",
      grantedBy: adminA.id,
    });
    await identityStore.grantClientAccess({
      teamId: teamA.id,
      clientId: client.id,
      userId: editor.id,
      access: "write",
      grantedBy: adminA.id,
    });

    const adminAPrincipal = { teamId: teamA.id, userId: adminA.id, authSource: "test" };
    const adminBPrincipal = { teamId: teamB.id, userId: adminB.id, authSource: "test" };
    const viewerPrincipal = { teamId: teamA.id, userId: viewer.id, authSource: "test" };
    const editorPrincipal = { teamId: teamA.id, userId: editor.id, authSource: "test" };

    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "team", path: "team_context/AGENTS.md", content: "# Team A agents\n\nTEAM_A_AGENT_CONTEXT" },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "team", path: "team_context/team-profile.md", content: "# Team A profile\n\nTEAM_A_PROFILE_CONTEXT" },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "team", path: "team_context/preferences.md", content: "# Team A available preferences\n\nTEAM_A_AVAILABLE_BODY_SHOULD_NOT_LOAD" },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "team", path: "brand_context/brand-snapshot.md", content: "# Team A brand snapshot\n\nTEAM_A_BRAND_SNAPSHOT_CONTEXT" },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "team", path: "brand_context/voice-profile.md", content: "# Team A available voice\n\nTEAM_A_VOICE_BODY_SHOULD_NOT_LOAD" },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "team", path: "brand_context/archive/old.md", content: "# Team A archive\n\nTEAM_A_ARCHIVE_BODY_SHOULD_NOT_LOAD" },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "team", path: "team_context/team-profile.md", content: "Team B only" },
      { principal: adminBPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "private", path: "context/USER.md", content: "Viewer private" },
      { principal: viewerPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "private", path: "context/MEMORY.md", content: "Viewer curated memory" },
      { principal: viewerPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "private", path: "AGENTS.local.md", content: "Viewer local agent override" },
      { principal: viewerPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "private", path: "context/learnings.md", content: "Viewer private learnings" },
      { principal: viewerPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "private", path: "context/prompt-tags.md", content: "## private/tag\n\nViewer private tag" },
      { principal: viewerPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "private", path: ".claude/skills/demo/SKILL.local.md", content: "Viewer skill local" },
      { principal: viewerPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      { visibility: "private", path: "context/USER.md", content: "Editor private" },
      { principal: editorPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      {
        visibility: "client",
        client: "acme",
        path: "clients/acme/AGENTS.md",
        kind: "agents",
        content: "# Acme agents\n\nACME_AGENT_CONTEXT",
      },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      {
        visibility: "client",
        client: "acme",
        path: "clients/acme/brand_context/archive/old.md",
        kind: "brand",
        content: "# Acme archive\n\nACME_ARCHIVE_BODY_SHOULD_NOT_LOAD",
      },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      {
        visibility: "client",
        client: "acme",
        path: "clients/acme/context/MEMORY.md",
        kind: "memory",
        content: "# Acme memory\n\nACME_MEMORY_CONTEXT",
      },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      {
        visibility: "client",
        client: "acme",
        path: "clients/acme/brand_context/brand-snapshot.md",
        kind: "brand",
        content: "# Acme snapshot\n\nACME_SNAPSHOT_CONTEXT",
      },
      { principal: adminAPrincipal },
    )).status, 200);
    assert.equal((await api.handleContextDocumentWriteRequest(
      deps,
      {
        visibility: "client",
        client: "acme",
        path: "clients/acme/brand_context/voice.md",
        kind: "brand",
        content: "# Acme available voice\n\nACME_AVAILABLE_BODY_SHOULD_NOT_LOAD",
      },
      { principal: adminAPrincipal },
    )).status, 200);

    const viewerSnapshot = await api.handleContextSnapshotRequest(
      deps,
      { client: "acme" },
      { principal: viewerPrincipal },
    );
    assert.equal(viewerSnapshot.status, 200);
    assert.match(viewerSnapshot.body.snapshot.markdown, /TEAM_A_AGENT_CONTEXT/);
    assert.match(viewerSnapshot.body.snapshot.markdown, /TEAM_A_PROFILE_CONTEXT/);
    assert.match(viewerSnapshot.body.snapshot.markdown, /TEAM_A_BRAND_SNAPSHOT_CONTEXT/);
    assert.match(viewerSnapshot.body.snapshot.markdown, /Viewer private/);
    assert.match(viewerSnapshot.body.snapshot.markdown, /Viewer curated memory/);
    assert.match(viewerSnapshot.body.snapshot.markdown, /ACME_AGENT_CONTEXT/);
    assert.match(viewerSnapshot.body.snapshot.markdown, /ACME_MEMORY_CONTEXT/);
    assert.match(viewerSnapshot.body.snapshot.markdown, /ACME_SNAPSHOT_CONTEXT/);
    assert.match(viewerSnapshot.body.snapshot.markdown, /Context Available/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /TEAM_A_AVAILABLE_BODY_SHOULD_NOT_LOAD/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /TEAM_A_VOICE_BODY_SHOULD_NOT_LOAD/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /TEAM_A_ARCHIVE_BODY_SHOULD_NOT_LOAD/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /ACME_AVAILABLE_BODY_SHOULD_NOT_LOAD/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /ACME_ARCHIVE_BODY_SHOULD_NOT_LOAD/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /Team B only/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /Editor private/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /Viewer local agent override/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /Viewer private learnings/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /Viewer private tag/);
    assert.doesNotMatch(viewerSnapshot.body.snapshot.markdown, /Viewer skill local/);
    assert.deepEqual(
      viewerSnapshot.body.snapshot.layers.map((layer) => layer.path).sort(),
      [
        "brand_context/brand-snapshot.md",
        "clients/acme/AGENTS.md",
        "clients/acme/brand_context/brand-snapshot.md",
        "clients/acme/context/MEMORY.md",
        "context/MEMORY.md",
        "context/USER.md",
        "team_context/AGENTS.md",
        "team_context/team-profile.md",
      ],
    );
    assert.ok(viewerSnapshot.body.snapshot.availableContext.some((file) => file.path === "team_context/preferences.md"));
    assert.ok(viewerSnapshot.body.snapshot.availableContext.some((file) => file.path === "brand_context/voice-profile.md"));
    assert.ok(!viewerSnapshot.body.snapshot.availableContext.some((file) => file.path === "brand_context/archive/old.md"));
    assert.ok(viewerSnapshot.body.snapshot.availableContext.some((file) => file.path === "clients/acme/brand_context/voice.md"));
    assert.ok(!viewerSnapshot.body.snapshot.availableContext.some((file) => file.path === "clients/acme/brand_context/archive/old.md"));

    const readOnlyEdit = await api.handleContextDocumentWriteRequest(
      deps,
      {
        visibility: "client",
        client: "acme",
        path: "clients/acme/brand_context/voice.md",
        kind: "brand",
        content: "Viewer edit",
      },
      { principal: viewerPrincipal },
    );
    assert.equal(readOnlyEdit.status, 404);

    const current = await api.handleContextDocumentsListRequest(
      deps,
      { visibility: "client", client: "acme" },
      { principal: editorPrincipal },
    );
    const currentVoice = current.body.documents.find((doc) => doc.path === "clients/acme/brand_context/voice.md");
    assert.ok(currentVoice);
    const editorEdit = await api.handleContextDocumentWriteRequest(
      deps,
      {
        visibility: "client",
        client: "acme",
        path: "clients/acme/brand_context/voice.md",
        kind: "brand",
        content: "Editor edit",
        expectedSha256: currentVoice.sha256,
      },
      { principal: editorPrincipal },
    );
    assert.equal(editorEdit.status, 200);

    await identityStore.revokeClientAccess({
      teamId: teamA.id,
      clientId: client.id,
      userId: viewer.id,
      revokedBy: adminA.id,
    });
    const revokedSnapshot = await api.handleContextSnapshotRequest(
      deps,
      { client: "acme" },
      { principal: viewerPrincipal },
    );
    assert.equal(revokedSnapshot.status, 403);
    assert.equal(revokedSnapshot.body.error.code, "access_revoked");
  });
});

test("context snapshot does not load workspace team or brand context by default", async () => {
  const rootDir = tempDir();
  try {
    await withIdentityDeps(async (deps, identityStore) => {
      deps.workspaceRoot = rootDir;
      fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "team_context"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "context"), { recursive: true });
      fs.writeFileSync(path.join(rootDir, "AGENTS.md"), "# System\n", "utf-8");
      fs.writeFileSync(path.join(rootDir, "CLAUDE.md"), "# Claude\n", "utf-8");
      fs.writeFileSync(path.join(rootDir, "context", "SOUL.md"), "VISIBLE_SOUL_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "team_context", "AGENTS.md"), "WORKSPACE_TEAM_AGENT_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "team_context", "team-profile.md"), "WORKSPACE_TEAM_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "brand_context", "brand-snapshot.md"), "WORKSPACE_BRAND_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "brand_context", "voice-profile.md"), "# Workspace voice\n\nWORKSPACE_VOICE_BODY", "utf-8");
      fs.writeFileSync(path.join(rootDir, "brand_context", ".env"), "SECRET_ENV_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "brand_context", ".mcp.json"), "SECRET_MCP_CONTEXT", "utf-8");
      for (const dirName of [
        ".AI-OS",
        ".command-centre",
        ".git",
        "backups",
        "build",
        "dist",
        "node_modules",
        "transcripts",
      ]) {
        const dir = path.join(rootDir, "brand_context", dirName);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "secret.md"), `HIDDEN_${dirName.replace(/[^a-z0-9]/gi, "_")}`, "utf-8");
      }

      const { team, admin } = await seedAdminTeam(identityStore, "context-exclusions");
      const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
      const response = await api.handleContextSnapshotRequest(deps, {}, { principal });
      assert.equal(response.status, 200);
      const markdown = response.body.snapshot.markdown;
      assert.match(markdown, /VISIBLE_SOUL_CONTEXT/);
      assert.doesNotMatch(markdown, /WORKSPACE_TEAM_AGENT_CONTEXT/);
      assert.doesNotMatch(markdown, /WORKSPACE_TEAM_CONTEXT/);
      assert.doesNotMatch(markdown, /WORKSPACE_BRAND_CONTEXT/);
      assert.doesNotMatch(markdown, /WORKSPACE_VOICE_BODY/);
      assert.deepEqual(response.body.snapshot.availableContext, []);
      assert.doesNotMatch(markdown, /SECRET_ENV_CONTEXT/);
      assert.doesNotMatch(markdown, /SECRET_MCP_CONTEXT/);
      assert.doesNotMatch(markdown, /HIDDEN_/);
    });
  } finally {
    rmDir(rootDir);
  }
});

test("context snapshot workspace fallback loads curated files and lists the rest", async () => {
  const rootDir = tempDir();
  const previousFallback = process.env.TEAM_OS_ENABLE_WORKSPACE_CONTEXT_FALLBACK;
  process.env.TEAM_OS_ENABLE_WORKSPACE_CONTEXT_FALLBACK = "1";
  try {
    await withIdentityDeps(async (deps, identityStore) => {
      deps.workspaceRoot = rootDir;
      fs.mkdirSync(path.join(rootDir, "brand_context", "archive"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "team_context"), { recursive: true });
      fs.mkdirSync(path.join(rootDir, "context"), { recursive: true });
      fs.writeFileSync(path.join(rootDir, "context", "SOUL.md"), "VISIBLE_SOUL_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "team_context", "AGENTS.md"), "# Workspace team agents\n\nWORKSPACE_TEAM_AGENT_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "team_context", "team-profile.md"), "# Workspace team\n\nWORKSPACE_TEAM_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "team_context", "prompt-tags.md"), "# Workspace prompt tags\n\nWORKSPACE_TAG_BODY_SHOULD_NOT_LOAD", "utf-8");
      fs.writeFileSync(path.join(rootDir, "brand_context", "brand-snapshot.md"), "# Workspace brand\n\nWORKSPACE_BRAND_CONTEXT", "utf-8");
      fs.writeFileSync(path.join(rootDir, "brand_context", "voice-profile.md"), "# Workspace voice\n\nWORKSPACE_VOICE_BODY_SHOULD_NOT_LOAD", "utf-8");
      fs.writeFileSync(path.join(rootDir, "brand_context", "archive", "old.md"), "WORKSPACE_ARCHIVE_BODY_SHOULD_NOT_LOAD", "utf-8");
      fs.writeFileSync(path.join(rootDir, "brand_context", ".env"), "SECRET_ENV_CONTEXT", "utf-8");

      const { team, admin } = await seedAdminTeam(identityStore, "context-workspace-fallback");
      const principal = { teamId: team.id, userId: admin.id, authSource: "test" };
      const response = await api.handleContextSnapshotRequest(deps, {}, { principal });
      assert.equal(response.status, 200);
      const markdown = response.body.snapshot.markdown;
      assert.match(markdown, /WORKSPACE_TEAM_AGENT_CONTEXT/);
      assert.match(markdown, /WORKSPACE_TEAM_CONTEXT/);
      assert.match(markdown, /WORKSPACE_BRAND_CONTEXT/);
      assert.doesNotMatch(markdown, /WORKSPACE_TAG_BODY_SHOULD_NOT_LOAD/);
      assert.doesNotMatch(markdown, /WORKSPACE_VOICE_BODY_SHOULD_NOT_LOAD/);
      assert.doesNotMatch(markdown, /WORKSPACE_ARCHIVE_BODY_SHOULD_NOT_LOAD/);
      assert.doesNotMatch(markdown, /SECRET_ENV_CONTEXT/);
      assert.ok(!response.body.snapshot.availableContext.some((file) => file.path === "team_context/AGENTS.md"));
      assert.ok(response.body.snapshot.availableContext.some((file) => file.path === "team_context/prompt-tags.md"));
      assert.ok(response.body.snapshot.availableContext.some((file) => file.path === "brand_context/voice-profile.md"));
      assert.ok(!response.body.snapshot.availableContext.some((file) => file.path === "brand_context/archive/old.md"));
      assert.ok(!response.body.snapshot.availableContext.some((file) => file.path === "brand_context/.env"));
    });
  } finally {
    if (previousFallback === undefined) {
      delete process.env.TEAM_OS_ENABLE_WORKSPACE_CONTEXT_FALLBACK;
    } else {
      process.env.TEAM_OS_ENABLE_WORKSPACE_CONTEXT_FALLBACK = previousFallback;
    }
    rmDir(rootDir);
  }
});

test("workspace sync includes binary files, hides secrets from viewers, and enforces editor writes", async () => {
  const rootDir = tempDir();
  try {
    await withIdentityDeps(async (deps, identityStore) => {
      deps.workspaceRoot = rootDir;
      fs.mkdirSync(path.join(rootDir, "clients", "acme"), { recursive: true });
      fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "# Notes\n");
      fs.writeFileSync(path.join(rootDir, "clients", "acme", ".env"), "API_KEY=secret\n");
      fs.writeFileSync(path.join(rootDir, "clients", "acme", "logo.bin"), Buffer.from([0, 1, 2, 3]));

      const { team, admin } = await seedAdminTeam(identityStore, "workspace-sync");
      const viewer = await identityStore.upsertUser({ email: "viewer@example.com" });
      await identityStore.upsertMembership({
        teamId: team.id,
        userId: viewer.id,
        role: "member",
        status: "active",
      });
      const client = await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
      await identityStore.grantClientAccess({
        teamId: team.id,
        clientId: client.id,
        userId: viewer.id,
        access: "read",
      });
      const viewerPrincipal = { teamId: team.id, userId: viewer.id, authSource: "test" };
      const adminPrincipal = { teamId: team.id, userId: admin.id, authSource: "test" };

      const viewerManifest = await api.handleWorkspaceManifestRequest(deps, { client: "acme" }, { principal: viewerPrincipal });
      assert.equal(viewerManifest.status, 200);
      assert.deepEqual(viewerManifest.body.files.map((file) => file.path).sort(), [
        "clients/acme/logo.bin",
        "clients/acme/notes.md",
      ]);
      assert.equal(viewerManifest.body.secretFilesHidden, 1);

      const secretDenied = await api.handleWorkspaceFileReadRequest(
        deps,
        { path: "clients/acme/.env" },
        { principal: viewerPrincipal },
      );
      assert.equal(secretDenied.status, 404);

      const binary = await api.handleWorkspaceFileReadRequest(
        deps,
        { path: "clients/acme/logo.bin" },
        { principal: viewerPrincipal },
      );
      assert.equal(binary.status, 200);
      assert.equal(binary.body.encoding, "base64");
      assert.equal(binary.body.contentBase64, Buffer.from([0, 1, 2, 3]).toString("base64"));

      const adminManifest = await api.handleWorkspaceManifestRequest(deps, { client: "acme" }, { principal: adminPrincipal });
      assert.equal(adminManifest.status, 200);
      assert.ok(adminManifest.body.files.some((file) => file.path === "clients/acme/.env" && file.secret === true));

      const viewerWrite = await api.handleWorkspaceFileWriteRequest(
        deps,
        { content: "nope" },
        { path: "clients/acme/notes.md" },
        { principal: viewerPrincipal },
      );
      assert.equal(viewerWrite.status, 404);

      const writeBinary = await api.handleWorkspaceFileWriteRequest(
        deps,
        { contentBase64: Buffer.from([9, 8, 7]).toString("base64") },
        { path: "clients/acme/assets/icon.bin" },
        { principal: adminPrincipal },
      );
      assert.equal(writeBinary.status, 200);
      assert.deepEqual(fs.readFileSync(path.join(rootDir, "clients", "acme", "assets", "icon.bin")), Buffer.from([9, 8, 7]));

      const deleteConflict = await api.handleWorkspaceFileDeleteRequest(
        deps,
        { path: "clients/acme/notes.md", expectedSha256: "wrong" },
        { principal: adminPrincipal },
      );
      assert.equal(deleteConflict.status, 409);

      const currentHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(rootDir, "clients", "acme", "notes.md"))).digest("hex");
      const deleted = await api.handleWorkspaceFileDeleteRequest(
        deps,
        { path: "clients/acme/notes.md", expectedSha256: currentHash },
        { principal: adminPrincipal },
      );
      assert.equal(deleted.status, 200);
      assert.equal(fs.existsSync(path.join(rootDir, "clients", "acme", "notes.md")), false);
    });
  } finally {
    rmDir(rootDir);
  }
});

test("workspace client brand_context writes mirror into context_documents, and deletes archive them", async () => {
  const rootDir = tempDir();
  try {
    await withIdentityDeps(async (deps, identityStore) => {
      deps.workspaceRoot = rootDir;
      fs.mkdirSync(path.join(rootDir, "clients", "acme"), { recursive: true });

      const { team, admin } = await seedAdminTeam(identityStore, "workspace-brand-mirror");
      const client = await identityStore.upsertClient({ teamId: team.id, slug: "acme", name: "Acme" });
      const adminPrincipal = { teamId: team.id, userId: admin.id, authSource: "test" };

      const write = await api.handleWorkspaceFileWriteRequest(
        deps,
        { content: "# Voice\n\nWarm and direct.\n" },
        { path: "clients/acme/brand_context/voice-profile.md" },
        { principal: adminPrincipal },
      );
      assert.equal(write.status, 200);

      const afterWrite = await deps.store.listContextDocuments({
        visibility: "client",
        teamId: team.id,
        clientId: client.id,
        path: "clients/acme/brand_context/voice-profile.md",
        status: "active",
      });
      assert.equal(afterWrite.length, 1);
      assert.equal(afterWrite[0].kind, "brand");
      assert.equal(afterWrite[0].content, "# Voice\n\nWarm and direct.\n");

      // A non-brand_context client file must not create a mirrored document.
      const otherWrite = await api.handleWorkspaceFileWriteRequest(
        deps,
        { content: "# Acme\n" },
        { path: "clients/acme/AGENTS.md" },
        { principal: adminPrincipal },
      );
      assert.equal(otherWrite.status, 200);
      const otherDocs = await deps.store.listContextDocuments({
        visibility: "client",
        teamId: team.id,
        clientId: client.id,
        path: "clients/acme/AGENTS.md",
        status: "active",
      });
      assert.equal(otherDocs.length, 0);

      const deleted = await api.handleWorkspaceFileDeleteRequest(
        deps,
        { path: "clients/acme/brand_context/voice-profile.md" },
        { principal: adminPrincipal },
      );
      assert.equal(deleted.status, 200);

      const afterDelete = await deps.store.listContextDocuments({
        visibility: "client",
        teamId: team.id,
        clientId: client.id,
        path: "clients/acme/brand_context/voice-profile.md",
        status: "active",
      });
      assert.equal(afterDelete.length, 0);
    });
  } finally {
    rmDir(rootDir);
  }
});

test("server skill sync lists, reads, and enforces write permissions", async () => {
  const rootDir = tempDir();
  try {
    await withIdentityDeps(async (deps, identityStore) => {
      deps.workspaceRoot = rootDir;
      fs.mkdirSync(path.join(rootDir, ".claude", "skills", "mkt-copywriting"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, ".claude", "skills", "mkt-copywriting", "SKILL.md"),
        "---\nname: mkt-copywriting\ndescription: >\n  HTTP skill that should parse\n  folded YAML text.\n---\n\n# Old\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(rootDir, ".claude", "skills", "mkt-copywriting", "SKILL.local.md"),
        "private override\n",
        "utf-8",
      );
      fs.mkdirSync(path.join(rootDir, ".claude", "skills", "mkt-copywriting", "scripts", "lib", "__pycache__"), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, ".claude", "skills", "mkt-copywriting", "scripts", "lib", "__pycache__", "cache.pyc"),
        Buffer.from([0, 1, 2]),
      );

      const { team, admin } = await seedAdminTeam(identityStore, "skill-sync");
      const reader = await identityStore.upsertUser({ email: "skill-reader@example.com" });
      await identityStore.upsertMembership({
        teamId: team.id,
        userId: reader.id,
        role: "member",
        status: "active",
      });
      await identityStore.grantSkillAccess({
        teamId: team.id,
        skillName: "mkt-copywriting",
        userId: reader.id,
        permission: "skill.use",
      });
      const readerPrincipal = { teamId: team.id, userId: reader.id, authSource: "test" };
      const adminPrincipal = { teamId: team.id, userId: admin.id, authSource: "test" };

      const list = await api.handleSkillsListRequest(deps, { principal: readerPrincipal });
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.skills.map((skill) => skill.slug), ["mkt-copywriting"]);
      assert.equal(list.body.skills[0].writable, false);
      assert.equal(list.body.skills[0].description, "HTTP skill that should parse folded YAML text.");

      const manifest = await api.handleSkillManifestRequest(
        deps,
        { skill: "mkt-copywriting" },
        { principal: readerPrincipal },
      );
      assert.equal(manifest.status, 200);
      assert.equal(manifest.body.filesCount, 1);
      assert.deepEqual(manifest.body.files.map((file) => file.path), [".claude/skills/mkt-copywriting/SKILL.md"]);
      assert.equal(
        manifest.body.files[0].normalizedSha256,
        normalizedTextSha256("---\nname: mkt-copywriting\ndescription: >\n  HTTP skill that should parse\n  folded YAML text.\n---\n\n# Old\n"),
      );

      const read = await api.handleSkillFileReadRequest(
        deps,
        { path: ".claude/skills/mkt-copywriting/SKILL.md" },
        { principal: readerPrincipal },
      );
      assert.equal(read.status, 200);
      assert.match(read.body.content, /# Old/);

      const deniedWrite = await api.handleSkillFileWriteRequest(
        deps,
        { content: "# Denied\n" },
        { path: ".claude/skills/mkt-copywriting/SKILL.md" },
        { principal: readerPrincipal },
      );
      assert.equal(deniedWrite.status, 403);

      const written = await api.handleSkillFileWriteRequest(
        deps,
        { content: "# Updated\n" },
        { path: ".claude/skills/mkt-copywriting/SKILL.md" },
        { principal: adminPrincipal },
      );
      assert.equal(written.status, 200);
      assert.equal(
        fs.readFileSync(path.join(rootDir, ".claude", "skills", "mkt-copywriting", "SKILL.md"), "utf-8"),
        "# Updated\n",
      );
    });
  } finally {
    rmDir(rootDir);
  }
});
