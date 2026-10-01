const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");

// Same leaf-first stub graph the store test and the CLI use: each .ts is loaded
// once and injected as a stub into the modules that import it. reranker.ts is a
// leaf (only node:fs / node:path), so it needs no stubs.
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

const EMBED_DIM = 4;
const NOW = new Date("2026-06-07T00:00:00Z");
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-mem-"));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function withStore(fn) {
  if (!sharedStore) throw new Error("shared memory test store was not initialized");
  await resetMemoryTestStore(sharedStore);
  return fn(sharedStore);
}

/** A fixed-vector embedder: searchMemory embeds the query, we control the vector. */
function fixedEmbedder(vec, model = "fixed-test") {
  return { model, dim: vec.length, embed: async () => [vec] };
}

/** Insert a source + a single embedded chunk under one scope. Returns the chunk. */
async function seedChunk(s, opts) {
  const { sc, sourcePath, sourceType = "memory", contentDate = null } = opts;
  const authorityWeight = opts.authorityWeight ?? 1.0;
  const src = await s.insertSource({
    scope: sc,
    sourcePath,
    sourceType,
    contentDate,
    authorityWeight,
    contentSha256: `sha-${sourcePath}`,
  });
  return s.insertChunk({
    sourceId: src.id,
    sourceScope: sc,
    chunkScope: sc,
    chunkIndex: opts.chunkIndex ?? 0,
    content: opts.content,
    sourcePath,
    sourceType,
    contentDate,
    authorityWeight,
    embedding: opts.embedding,
    embeddingModel: opts.embeddingModel ?? "fixed-test",
    embeddingDim: opts.embedding?.length,
  });
}

// ---------------------------------------------------------------------------
// rerank — pure, no DB. Preserves the authority + recency + floor-ratio rules.
// ---------------------------------------------------------------------------

test("rerank: authority + recency + floor-ratio gating (parity fixture)", () => {
  const hits = [
    // similarity 1.0, authority 2.0, undated → s2 = 1*2*(0.7+0.3*1) = 2.0
    { id: "a", sourcePath: "context/MEMORY.md", content: "alpha", authorityWeight: 2.0, contentDate: null, distance: 0.0 },
    // similarity 0.8, authority 1.0, dated 14d ago → rf=exp(-1); s2 ≈ 0.648291
    { id: "b", sourcePath: "context/memory/2026-05-24.md", content: "beta", authorityWeight: 1.0, contentDate: "2026-05-24", distance: 0.2 },
    // similarity 0.1, authority 1.0, undated → s2 = 0.1; below 0.3*2.0=0.6 → gated out
    { id: "c", sourcePath: "context/memory/old.md", content: "gamma", authorityWeight: 1.0, contentDate: null, distance: 0.9 },
  ];

  const out = reranker.rerank(hits, reranker.RERANK_DEFAULTS, NOW);

  assert.equal(out.length, 2, "low-relevance hit c is gated out");
  assert.equal(out[0].id, "a");
  assert.equal(out[1].id, "b");
  assert.ok(Math.abs(out[0].finalScore - 2.0) < 1e-9, `a=${out[0].finalScore}`);
  assert.ok(Math.abs(out[1].finalScore - 0.648291) < 1e-6, `b=${out[1].finalScore}`);
  assert.ok(!out.some((r) => r.id === "c"));
  assert.ok(out.every((r) => r.reranked === true));
  // Passthrough fields survive the rerank.
  assert.equal(out[0].sourcePath, "context/MEMORY.md");
  assert.equal(out[0].content, "alpha");
});

test("rerank: higher authority wins at equal distance", () => {
  const hits = [
    { id: "low", sourcePath: "context/memory/x.md", content: "x", authorityWeight: 1.0, contentDate: null, distance: 0.1 },
    { id: "high", sourcePath: "context/MEMORY.md", content: "y", authorityWeight: 2.0, contentDate: null, distance: 0.1 },
  ];
  const out = reranker.rerank(hits, reranker.RERANK_DEFAULTS, NOW);
  assert.equal(out[0].id, "high");
  assert.equal(out.length, 2);
});

test("rerank: more recent wins at equal distance and authority", () => {
  const hits = [
    { id: "fresh", sourcePath: "context/memory/2026-06-07.md", content: "f", authorityWeight: 1.0, contentDate: "2026-06-07", distance: 0.1 },
    { id: "stale", sourcePath: "context/memory/2026-05-10.md", content: "s", authorityWeight: 1.0, contentDate: "2026-05-10", distance: 0.1 },
  ];
  const out = reranker.rerank(hits, reranker.RERANK_DEFAULTS, NOW);
  assert.equal(out[0].id, "fresh");
  assert.equal(out[1].id, "stale");
});

test("rerank: empty input returns empty", () => {
  assert.deepEqual(reranker.rerank([], reranker.RERANK_DEFAULTS, NOW), []);
});

test("recencyFactor: undated => 1.0, decays with age", () => {
  assert.equal(reranker.recencyFactor(null, 14, NOW), 1.0);
  // 14-day half-life: exactly one half-life ago => exp(-1).
  const f = reranker.recencyFactor("2026-05-24", 14, NOW);
  assert.ok(Math.abs(f - Math.exp(-1)) < 1e-9, `f=${f}`);
  // Future-dated never boosts above 1.0 (age clamped at 0).
  assert.equal(reranker.recencyFactor("2026-12-31", 14, NOW), 1.0);
});

// ---------------------------------------------------------------------------
// searchMemory — integration against real PGLite + the max-privacy audit row.
// ---------------------------------------------------------------------------

test("searchMemory ranks results and writes a max-privacy search_events row", async () => {
  await withStore(async (s) => {
    const sys = mkScope("system");
    await seedChunk(s, {
      sc: sys, sourcePath: "context/MEMORY.md", authorityWeight: 2.0,
      content: "memory scope design", embedding: [1, 0, 0, 0],
    });
    await seedChunk(s, {
      sc: sys, sourcePath: "context/memory/2026-06-01.md", contentDate: "2026-06-01",
      content: "daily session log", embedding: [0.8, 0.6, 0, 0],
    });

    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder([1, 0, 0, 0]),
      query: "how did we scope memory?",
      searchScope: { teamId: null, include: ["system"] },
      topK: 5,
      now: NOW,
    });

    assert.ok(res.results.length >= 1);
    assert.equal(res.results[0].sourcePath, "context/MEMORY.md");
    assert.ok(res.results.every((r) => r.reranked === true));
    assert.equal(typeof res.latencyMs, "number");

    // Audit row — present, correctly scoped, and NO query content stored.
    assert.ok(res.event, "an event row was written");
    assert.equal(res.event.queryText, null, "query_text not stored by default");
    assert.equal(res.event.queryEmbedding, null, "query_embedding never stored");
    assert.deepEqual(res.event.visibilitySet, ["system"]);
    assert.equal(res.event.topK, 5);
    assert.equal(res.event.resultCount, res.results.length);
    assert.deepEqual(
      res.event.resultChunkIds,
      res.results.map((r) => r.id),
    );
    assert.equal(typeof res.event.latencyMs, "number");

    // Belt-and-braces: assert the DB row itself has NULL query columns.
    const raw = await s.client.query(
      "SELECT count(*)::int AS n FROM search_events " +
      "WHERE query_text IS NULL AND query_embedding IS NULL",
    );
    assert.equal(Number(raw.rows[0].n), 1);
  });
});

test("searchMemory isolates client scope (no cross-client leak)", async () => {
  await withStore(async (s) => {
    for (const clientId of ["acme", "globex"]) {
      await seedChunk(s, {
        sc: mkScope("client", { clientId }),
        sourcePath: `clients/${clientId}/context/memory/x.md`,
        content: `secret-${clientId}`,
        embedding: [1, 0, 0, 0], // identical: only the scope filter can separate them
      });
    }

    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder([1, 0, 0, 0]),
      query: "secret",
      searchScope: { teamId: null, clientId: "acme", include: ["client"] },
      topK: 10,
      now: NOW,
    });

    assert.ok(res.results.length >= 1);
    assert.ok(res.results.every((r) => r.sourcePath.includes("acme")));
    assert.ok(!res.results.some((r) => r.sourcePath.includes("globex")));
    assert.deepEqual(res.event.visibilitySet, ["client"]);
  });
});

test("searchMemory includes scoped exact keyword hits outside the vector candidate pool", async () => {
  await withStore(async (s) => {
    const sys = mkScope("system");
    await seedChunk(s, {
      sc: sys,
      sourcePath: "context/memory/2026-06-16.md",
      content: "unrelated but vector-close",
      embedding: [0, 1, 0, 0],
    });
    await seedChunk(s, {
      sc: sys,
      sourcePath: "context/memory/2026-06-16.aos.md",
      content: "release marker ALPHA-NEEDLE-7781 was discussed",
      embedding: [1, 0, 0, 0],
    });

    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder([0, 1, 0, 0]),
      query: "ALPHA-NEEDLE-7781",
      searchScope: { teamId: null, include: ["system"] },
      topK: 5,
      candidateK: 1,
      now: NOW,
    });

    assert.ok(
      res.results.some((r) => r.content.includes("ALPHA-NEEDLE-7781") && r.matchType === "keyword"),
      "exact keyword hit should be included even when vector candidateK excludes it",
    );
  });
});

test("searchMemory --store-query-text persists the query text", async () => {
  await withStore(async (s) => {
    const sys = mkScope("system");
    await seedChunk(s, {
      sc: sys, sourcePath: "context/MEMORY.md",
      content: "anything", embedding: [1, 0, 0, 0],
    });

    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder([1, 0, 0, 0]),
      query: "remember the billing flow",
      searchScope: { teamId: null, include: ["system"] },
      storeQueryText: true,
      now: NOW,
    });

    assert.equal(res.event.queryText, "remember the billing flow");
    assert.equal(res.event.queryEmbedding, null, "embedding still never stored");
  });
});

test("searchMemory recordEvent=false writes no audit row", async () => {
  await withStore(async (s) => {
    const sys = mkScope("system");
    await seedChunk(s, {
      sc: sys, sourcePath: "context/MEMORY.md",
      content: "anything", embedding: [1, 0, 0, 0],
    });

    const res = await search.searchMemory({
      store: s,
      embedder: fixedEmbedder([1, 0, 0, 0]),
      query: "no audit please",
      searchScope: { teamId: null, include: ["system"] },
      recordEvent: false,
      now: NOW,
    });

    assert.equal(res.event, null);
    const count = await s.client.query("SELECT count(*)::int AS n FROM search_events");
    assert.equal(Number(count.rows[0].n), 0);
  });
});

test("searchMemory rejects embedding model mismatch by default", async () => {
  await withStore(async (s) => {
    const sys = mkScope("system");
    await seedChunk(s, {
      sc: sys,
      sourcePath: "context/memory/legacy.md",
      content: "legacy vector",
      embedding: [1, 0, 0, 0],
      embeddingModel: "hash-v1-4",
    });

    await assert.rejects(
      () =>
        search.searchMemory({
          store: s,
          embedder: fixedEmbedder([1, 0, 0, 0], "fixed-test"),
          query: "legacy",
          searchScope: { teamId: null, include: ["system"] },
          now: NOW,
        }),
      /different embedding model/,
    );
  });
});
