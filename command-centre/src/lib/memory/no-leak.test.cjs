/**
 * AIOS Memory Schema — no-leak tests.
 *
 * The proof that the Phase 3 memory foundation never lets one tenant see
 * another's memory. The whole leak boundary funnels through one function —
 * buildScopeWhere() in scope.ts — applied by store.vectorSearch (search path)
 * and re-derived by indexer.scopeForSource (index path). These tests pin that
 * boundary down across all three tenant axes: client, team, and private user.
 *
 * How the tests stay honest: every search-layer case seeds two tenants with the
 * SAME embedding vector, so similarity can't separate them — only the scope
 * filter can. Drop or widen buildScopeWhere and the forbidden tenant's rows
 * surface, and the `!includes(other)` assertions go red. The index-layer cases
 * put two tenants in ONE store and search as a single tenant, with a count check
 * first so we're proving exclusion, not mere absence.
 *
 * Acceptance: client/team/private isolation; shared team search omits
 * private; tests fail if the filter is removed; both indexing and searching are
 * covered; names spell out each guarantee.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");

// Leaf-first stub graph — the union of the store+search graph (search.test.cjs)
// and the indexer graph (indexer.test.cjs). Each .ts module is transpiled once
// and injected as a stub into the modules that import it; third-party imports
// (@electric-sql/pglite + its /vector subpath) fall through to the real require.
const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
const scope = loadTsModule(path.resolve(__dirname, "scope.ts"), {
  stubs: { "./types": types },
});
const migrate = loadTsModule(path.resolve(__dirname, "migrate.ts"));
const embedding = loadTsModule(path.resolve(__dirname, "embedding.ts"));
const rowMappers = loadTsModule(path.resolve(__dirname, "row-mappers.ts"), {
  stubs: { "./types": types, "./embedding": embedding },
});
const adapter = loadTsModule(path.resolve(__dirname, "pglite-adapter.ts"));
const postgresAdapter = loadTsModule(path.resolve(__dirname, "postgres-adapter.ts"));
const backend = loadTsModule(path.resolve(__dirname, "backend.ts"));
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
const reranker = loadTsModule(path.resolve(__dirname, "reranker.ts"));
const search = loadTsModule(path.resolve(__dirname, "search.ts"), {
  stubs: { "./types": types, "./reranker": reranker, "./row-mappers": rowMappers },
});
const embedder = loadTsModule(path.resolve(__dirname, "embedder.ts"));
const chunker = loadTsModule(path.resolve(__dirname, "chunker.ts"));
const discovery = loadTsModule(path.resolve(__dirname, "discovery.ts"));
const ingest = loadTsModule(path.resolve(__dirname, "ingest.ts"), {
  stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
});
const indexer = loadTsModule(path.resolve(__dirname, "indexer.ts"), {
  stubs: { "./scope": scope, "./ingest": ingest, "./discovery": discovery },
});

const EMBED_DIM = 4;
const NOW = new Date("2026-06-07T00:00:00Z");
// One vector for every tenant: in the search tests, only the scope filter — not
// similarity — can keep tenants apart. That's what makes a missing filter fail.
const SAME_VECTOR = [1, 0, 0, 0];
let sharedStore = null;

test.before(async () => {
  sharedStore = await openMemoryTestStore(store, { embedDim: EMBED_DIM });
});

test.after(async () => {
  await sharedStore?.close();
  sharedStore = null;
});

function mkScope(visibility, overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility, ...overrides };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-noleak-"));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** searchMemory embeds the query; this lets a test pin the query vector exactly. */
function fixedEmbedder(vec, model = "fixed-test") {
  return { model, dim: vec.length, embed: async () => [vec] };
}

/** The real deterministic embedder, for the index-path tests. */
function newHashEmbedder() {
  return new embedder.HashEmbedder({ dim: EMBED_DIM });
}

/** Open an ephemeral store (in-memory PGLite), run `fn`, always close. */
async function withStore(fn) {
  if (!sharedStore) throw new Error("shared memory test store was not initialized");
  await resetMemoryTestStore(sharedStore);
  return fn(sharedStore);
}

/** Insert a source + one embedded chunk under a single scope. */
async function seedChunk(s, opts) {
  const sc = opts.sc;
  const src = await s.insertSource({
    scope: sc,
    sourcePath: opts.sourcePath,
    sourceType: "memory",
    contentSha256: `sha-${opts.sourcePath}`,
  });
  return s.insertChunk({
    sourceId: src.id,
    sourceScope: sc,
    chunkScope: sc,
    chunkIndex: 0,
    content: opts.content,
    sourcePath: opts.sourcePath,
    sourceType: "memory",
    embedding: opts.embedding ?? SAME_VECTOR,
    embeddingModel: opts.embeddingModel ?? "fixed-test",
  });
}

// ---------------------------------------------------------------------------
// Searching behaviour — identical embeddings, so only buildScopeWhere separates
// the tenants. (store.vectorSearch is exercised through searchMemory.)
// ---------------------------------------------------------------------------

test("no-leak (search): client A search never returns client B memory", async () => {
  await withStore(async (s) => {
    for (const clientId of ["acme", "globex"]) {
      await seedChunk(s, {
        sc: mkScope("client", { clientId }),
        sourcePath: `clients/${clientId}/context/memory/notes.md`,
        content: `secret ${clientId} note`,
      });
    }

    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder(SAME_VECTOR),
      query: "secret",
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      topK: 10,
      now: NOW,
    });

    assert.ok(res.results.length >= 1, "client A must see its own memory");
    assert.ok(res.results.every((r) => r.sourcePath.includes("acme")));
    assert.ok(
      !res.results.some((r) => r.sourcePath.includes("globex")),
      "client B memory leaked into client A search",
    );
    assert.deepEqual(res.event.visibilitySet, ["client"]);
  });
});

test("no-leak (search): team A search never returns team B memory", async () => {
  await withStore(async (s) => {
    for (const teamId of ["team-a", "team-b"]) {
      await seedChunk(s, {
        sc: mkScope("team", { teamId }),
        sourcePath: `context/memory/${teamId}.md`,
        content: `secret ${teamId} note`,
      });
    }

    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder(SAME_VECTOR),
      query: "secret",
      searchScope: { teamId: "team-a", include: ["team"] },
      topK: 10,
      now: NOW,
    });

    assert.ok(res.results.length >= 1, "team A must see its own memory");
    assert.ok(res.results.every((r) => r.sourcePath.includes("team-a")));
    assert.ok(
      !res.results.some((r) => r.sourcePath.includes("team-b")),
      "team B memory leaked into team A search",
    );
    assert.deepEqual(res.event.visibilitySet, ["team"]);
  });
});

test("no-leak (search): user B never receives user A private memory", async () => {
  await withStore(async (s) => {
    for (const userId of ["user-a", "user-b"]) {
      await seedChunk(s, {
        sc: mkScope("private", { teamId: "team-1", userId }),
        sourcePath: `context/memory/${userId}.md`,
        content: `secret ${userId} note`,
      });
    }

    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder(SAME_VECTOR),
      query: "secret",
      searchScope: { teamId: "team-1", userId: "user-b", include: ["private"] },
      topK: 10,
      now: NOW,
    });

    assert.ok(res.results.length >= 1, "user B must see their own private memory");
    assert.ok(res.results.every((r) => r.sourcePath.includes("user-b")));
    assert.ok(
      !res.results.some((r) => r.sourcePath.includes("user-a")),
      "user A private memory leaked to user B",
    );
    assert.deepEqual(res.event.visibilitySet, ["private"]);
  });
});

test("no-leak (search): shared team search never includes private user memory", async () => {
  await withStore(async (s) => {
    await seedChunk(s, {
      sc: mkScope("team", { teamId: "team-1" }),
      sourcePath: "context/memory/team-shared.md",
      content: "shared team roadmap",
    });
    // Same team, same content + vector — only the scope keeps it private.
    await seedChunk(s, {
      sc: mkScope("private", { teamId: "team-1", userId: "user-a" }),
      sourcePath: "context/memory/user-a-private.md",
      content: "shared team roadmap",
    });

    // A teammate searching the shared team scope passes no userId.
    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder(SAME_VECTOR),
      query: "roadmap",
      searchScope: { teamId: "team-1" }, // include defaults to all visibilities
      topK: 10,
      now: NOW,
    });

    assert.ok(
      res.results.some((r) => r.sourcePath.includes("team-shared")),
      "shared team memory must be visible",
    );
    assert.ok(
      !res.results.some((r) => r.sourcePath.includes("private")),
      "private memory leaked into a shared team search",
    );
    assert.ok(res.event.visibilitySet.includes("team"));
    assert.ok(
      !res.event.visibilitySet.includes("private"),
      "private must not be in the searched visibility set without a user id",
    );
  });
});

test("no-leak (search): a search that omits the team id returns nothing, never everything", async () => {
  await withStore(async (s) => {
    await seedChunk(s, {
      sc: mkScope("team", { teamId: "team-1" }),
      sourcePath: "context/memory/team-1.md",
      content: "secret team note",
    });

    // The team predicate is ALWAYS emitted, so a caller that forgot its team id
    // matches no team rows — it returns nothing, not everything.
    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder(SAME_VECTOR),
      query: "secret",
      searchScope: { teamId: null, include: ["team"] },
      topK: 10,
      now: NOW,
    });

    assert.equal(res.results.length, 0, "team memory leaked to a team-less search");
  });
});

test("no-leak (keyword): client A keyword search never returns client B's exact-token memory", async () => {
  await withStore(async (s) => {
    for (const clientId of ["acme", "globex"]) {
      // Distinct, non-overlapping embeddings so only the FTS keyword leg can
      // surface these rows — isolates keywordSearch from vector-leg fusion.
      await seedChunk(s, {
        sc: mkScope("client", { clientId }),
        sourcePath: `clients/${clientId}/context/memory/notes.md`,
        content: `release marker ALPHA-NEEDLE-7781 for ${clientId}`,
        embedding: clientId === "acme" ? [1, 0, 0, 0] : [0, 1, 0, 0],
      });
    }

    const hits = await s.keywordSearch(
      { teamId: null, clientId: "acme", include: ["client"] },
      "ALPHA-NEEDLE-7781",
      10,
    );

    assert.ok(hits.length >= 1, "client A must see its own exact-token memory");
    assert.ok(hits.every((r) => r.sourcePath.includes("acme")));
    assert.ok(
      !hits.some((r) => r.sourcePath.includes("globex")),
      "client B memory leaked into client A's keyword search",
    );
  });
});

test("no-leak (hybrid): a hybrid search that omits the team id returns nothing, never everything", async () => {
  await withStore(async (s) => {
    await seedChunk(s, {
      sc: mkScope("team", { teamId: "team-1" }),
      sourcePath: "context/memory/team-1.md",
      content: "exact token RELEASE-CODE-4242 for team-1",
    });

    // buildScopeWhere always emits the team predicate, so a caller that forgot
    // its team id matches no team rows on the keyword leg either.
    const hits = await s.keywordSearch(
      { teamId: null, include: ["team"] },
      "RELEASE-CODE-4242",
      10,
    );

    assert.equal(hits.length, 0, "team memory leaked to a team-less keyword search");
  });
});

// ---------------------------------------------------------------------------
// Indexing behaviour — drive the real indexer, then verify the written scope
// columns AND that search respects them. Two tenants share ONE store.
// ---------------------------------------------------------------------------

test("no-leak (index): client sources index under their own client scope and never cross over", async () => {
  const repo = tempDir();
  try {
    await withStore(async (s) => {
      write(repo, "clients/acme/context/memory/2026-06-01.md", "# Acme\n\nsecret acme onboarding plan");
      write(repo, "clients/globex/context/memory/2026-06-01.md", "# Globex\n\nsecret globex onboarding plan");

      const summary = await indexer.indexSources({
        store: s,
        embedder: newHashEmbedder(),
        scope: mkScope("system"), // base scope; client files are re-scoped to client
        rootDir: repo,
        roots: ["clients"],
        trackJobs: false,
      });
      assert.equal(summary.errors.length, 0);
      assert.ok(summary.chunksInserted >= 2);

      // scopeForSource must have stamped each chunk with its own client scope —
      // never the system base scope it was indexed under.
      const { rows } = await s.client.query(
        "SELECT client_id, visibility, source_path FROM memory_chunks ORDER BY source_path",
      );
      assert.ok(rows.length >= 2);
      for (const row of rows) {
        assert.equal(row.visibility, "client");
        assert.ok(
          row.source_path.includes(`clients/${row.client_id}/`),
          "chunk client_id must match its path",
        );
      }

      const res = await search.searchMemory({
        store: s,
        embedder: newHashEmbedder(),
        query: "onboarding plan",
        searchScope: { teamId: null, clientId: "acme", include: ["client"] },
        topK: 10,
        now: NOW,
      });
      assert.ok(res.results.length >= 1);
      assert.ok(res.results.every((r) => r.sourcePath.includes("acme")));
      assert.ok(
        !res.results.some((r) => r.sourcePath.includes("globex")),
        "client B memory leaked after indexing",
      );
    });
  } finally {
    rmDir(repo);
  }
});

test("no-leak (index): team-scoped indexing keeps two teams isolated", async () => {
  const repoA = tempDir();
  const repoB = tempDir();
  try {
    await withStore(async (s) => {
      write(repoA, "context/memory/alpha-2026-06-01.md", "alpha planning notes for the quarter");
      write(repoB, "context/memory/beta-2026-06-01.md", "beta planning notes for the quarter");

      await indexer.indexSources({
        store: s,
        embedder: newHashEmbedder(),
        scope: mkScope("team", { teamId: "team-a" }),
        rootDir: repoA,
        trackJobs: false,
      });
      await indexer.indexSources({
        store: s,
        embedder: newHashEmbedder(),
        scope: mkScope("team", { teamId: "team-b" }),
        rootDir: repoB,
        trackJobs: false,
      });

      // Both teams really landed in the store, so this proves exclusion, not absence.
      const counts = await s.client.query(
        "SELECT team_id FROM memory_chunks GROUP BY team_id ORDER BY team_id",
      );
      assert.deepEqual(
        counts.rows.map((r) => r.team_id),
        ["team-a", "team-b"],
      );

      const res = await search.searchMemory({
        store: s,
        embedder: newHashEmbedder(),
        query: "planning notes",
        searchScope: { teamId: "team-a", include: ["team"] },
        topK: 10,
        now: NOW,
      });
      assert.ok(res.results.length >= 1);
      assert.ok(res.results.every((r) => r.sourcePath.includes("alpha")));
      assert.ok(
        !res.results.some((r) => r.sourcePath.includes("beta")),
        "team B memory leaked after indexing",
      );
    });
  } finally {
    rmDir(repoA);
    rmDir(repoB);
  }
});

test("no-leak (index): private-scoped indexing keeps two users isolated", async () => {
  const repoA = tempDir();
  const repoB = tempDir();
  try {
    await withStore(async (s) => {
      write(repoA, "context/memory/user-a-2026-06-01.md", "user a private journal entry");
      write(repoB, "context/memory/user-b-2026-06-01.md", "user b private journal entry");

      await indexer.indexSources({
        store: s,
        embedder: newHashEmbedder(),
        scope: mkScope("private", { teamId: "team-1", userId: "user-a" }),
        rootDir: repoA,
        trackJobs: false,
      });
      await indexer.indexSources({
        store: s,
        embedder: newHashEmbedder(),
        scope: mkScope("private", { teamId: "team-1", userId: "user-b" }),
        rootDir: repoB,
        trackJobs: false,
      });

      const counts = await s.client.query(
        "SELECT user_id FROM memory_chunks GROUP BY user_id ORDER BY user_id",
      );
      assert.deepEqual(
        counts.rows.map((r) => r.user_id),
        ["user-a", "user-b"],
      );

      const res = await search.searchMemory({
        store: s,
        embedder: newHashEmbedder(),
        query: "private journal",
        searchScope: { teamId: "team-1", userId: "user-b", include: ["private"] },
        topK: 10,
        now: NOW,
      });
      assert.ok(res.results.length >= 1);
      assert.ok(res.results.every((r) => r.sourcePath.includes("user-b")));
      assert.ok(
        !res.results.some((r) => r.sourcePath.includes("user-a")),
        "user A private memory leaked after indexing",
      );
    });
  } finally {
    rmDir(repoA);
    rmDir(repoB);
  }
});
