const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");

// Same leaf-first loading pattern as store.test.cjs: each .ts module is loaded
// once and injected as a stub into the modules that import it. The indexer test
// stays fully OFFLINE — it injects HashEmbedder directly and never touches the
// createEmbedder "local" path, so @huggingface/transformers is never imported.
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
const embedder = loadTsModule(path.resolve(__dirname, "embedder.ts"));
const chunker = loadTsModule(path.resolve(__dirname, "chunker.ts"));
const discovery = loadTsModule(path.resolve(__dirname, "discovery.ts"));
const ingest = loadTsModule(path.resolve(__dirname, "ingest.ts"), {
  stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
});
const indexer = loadTsModule(path.resolve(__dirname, "indexer.ts"), {
  stubs: { "./scope": scope, "./ingest": ingest, "./discovery": discovery },
});

const EMBED_DIM = 8;
let sharedStore = null;

test.before(async () => {
  sharedStore = await openMemoryTestStore(store, { embedDim: EMBED_DIM });
});

test.after(async () => {
  await sharedStore?.close();
  sharedStore = null;
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-idx-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
async function withStore(fn) {
  if (!sharedStore) throw new Error("shared memory test store was not initialized");
  await resetMemoryTestStore(sharedStore);
  return fn(sharedStore);
}
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function sysScope(overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility: "system", ...overrides };
}
function newEmbedder() {
  return new embedder.HashEmbedder({ dim: EMBED_DIM });
}

// ---------------------------------------------------------------------------
// chunker
// ---------------------------------------------------------------------------

test("chunkMarkdown is deterministic and heading-aware", () => {
  const md = [
    "# Title",
    "",
    "Intro paragraph under the title.",
    "",
    "## Section A",
    "",
    "Body of section A.",
    "",
    "## Section B",
    "",
    "Body of section B.",
  ].join("\n");

  const first = chunker.chunkMarkdown(md);
  const second = chunker.chunkMarkdown(md);
  assert.deepEqual(first, second); // determinism

  // One chunk per heading section; dense indices from 0.
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((c) => c.index), [0, 1, 2]);
  assert.equal(first[0].heading, "Title");
  assert.equal(first[1].heading, "Section A");
  assert.equal(first[2].heading, "Section B");
  assert.deepEqual(first.map((c) => c.headingLevel), [1, 2, 2]);
  assert.deepEqual(
    first.map((c) => [c.startLine, c.endLine]),
    [[3, 3], [7, 7], [11, 11]],
  );
  assert.ok(first.every((c) => /^[0-9a-f]{64}$/.test(c.contentHash)));
  assert.ok(first[0].content.includes("Intro paragraph"));
  assert.ok(first.every((c) => c.tokenCount > 0));
});

test("chunkMarkdown drops empty sections and hard-splits oversized ones", () => {
  // An empty heading section contributes no chunk.
  const withEmpty = ["# A", "", "## Empty", "", "## B", "", "content"].join("\n");
  const chunks = chunker.chunkMarkdown(withEmpty);
  assert.ok(!chunks.some((c) => c.content.trim() === ""));
  // "A" heading has no body, "Empty" has no body → only "B" yields a chunk.
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, "B");

  // A single oversized section splits into multiple capped windows.
  const big = "# Big\n\n" + "word ".repeat(2000); // ~10k chars
  const split = chunker.chunkMarkdown(big, { targetChars: 1000, overlapChars: 100, maxChars: 1500 });
  assert.ok(split.length > 1);
  assert.ok(split.every((c) => c.content.length <= 1500));
  assert.ok(split.every((c) => c.startLine >= 3 && c.endLine >= c.startLine));
  assert.deepEqual(split.map((c) => c.index), split.map((_, i) => i));
});

test("estimateTokens approximates chars/4", () => {
  assert.equal(chunker.estimateTokens(""), 0);
  assert.equal(chunker.estimateTokens("abcd"), 1);
  assert.equal(chunker.estimateTokens("abcde"), 2);
});

// ---------------------------------------------------------------------------
// HashEmbedder
// ---------------------------------------------------------------------------

test("HashEmbedder yields normalized, deterministic vectors", async () => {
  const emb = newEmbedder();
  const [a1] = await emb.embed(["pglite pgvector memory store"]);
  const [a2] = await emb.embed(["pglite pgvector memory store"]);
  const [b] = await emb.embed(["completely different text here"]);

  assert.equal(a1.length, EMBED_DIM);
  assert.deepEqual(a1, a2); // determinism

  const norm = Math.sqrt(a1.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9); // L2-normalized

  assert.notDeepEqual(a1, b); // distinct text → distinct vector
});

test("HashEmbedder gives empty text a deterministic unit fallback", async () => {
  const emb = newEmbedder();
  const [v] = await emb.embed([""]);
  assert.equal(v.length, EMBED_DIM);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
});

// ---------------------------------------------------------------------------
// indexSources — end to end against a real PGLite store
// ---------------------------------------------------------------------------

test("indexSources indexes real source files with scope and metadata", async () => {
  const root = tempDir();
  write(root, "context/memory/2026-06-05.md", "# Daily\n\nThe pglite pgvector memory store works.");
  write(root, "context/learnings.md", "# Learnings\n\nSomething learned about indexing.");
  write(root, "brand_context/voice-profile.md", "# Brand\n\nShould stay outside default memory.");

  try {
    await withStore(async (s) => {
    const summary = await indexer.indexSources({
      store: s,
      embedder: newEmbedder(),
      scope: sysScope(),
      rootDir: root,
    });

    assert.equal(summary.sourcesIndexed, 2);
    assert.equal(summary.sourcesSkipped, 0);
    assert.ok(summary.chunksInserted >= 2);
    assert.equal(summary.errors.length, 0);

    const counts = await s.client.query(
      "SELECT (SELECT count(*) FROM memory_sources)::int AS sources, " +
        "(SELECT count(*) FROM memory_chunks)::int AS chunks",
    );
    assert.equal(Number(counts.rows[0].sources), 2);
    assert.ok(Number(counts.rows[0].chunks) >= 2);

    const sourcePaths = await s.client.query(
      "SELECT source_path FROM memory_sources ORDER BY source_path",
    );
    assert.deepEqual(
      sourcePaths.rows.map((r) => r.source_path),
      ["context/learnings.md", "context/memory/2026-06-05.md"],
    );

    // contentDate parsed from filename; authority weight from built-in defaults.
    const dated = await s.client.query(
      "SELECT content_date::text AS d, source_type, authority_weight FROM memory_sources WHERE source_path = $1",
      ["context/memory/2026-06-05.md"],
    );
    assert.equal(dated.rows[0].d, "2026-06-05");
    assert.equal(dated.rows[0].source_type, "memory");

    const learn = await s.client.query(
      "SELECT source_type, authority_weight FROM memory_sources WHERE source_path = $1",
      ["context/learnings.md"],
    );
    assert.equal(learn.rows[0].source_type, "learnings");
    assert.ok(Math.abs(Number(learn.rows[0].authority_weight) - 1.5) < 1e-6);

    // A real scoped vector search finds the seeded chunk.
    const [q] = await newEmbedder().embed(["pglite pgvector memory store"]);
    const hits = await s.vectorSearch({ teamId: null, include: ["system"] }, q, 5);
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((h) => h.content.includes("pglite pgvector memory store")));
    assert.ok(hits.every((h) => h.sourceType !== undefined));

    // index_jobs audit trail: one succeeded job per indexed source.
    const jobs = await s.client.query(
      "SELECT count(*)::int AS n FROM index_jobs WHERE status = 'succeeded'",
    );
    assert.equal(Number(jobs.rows[0].n), 2);
    });
  } finally {
    rmDir(root);
  }
});

test("brand_context sources are explicit-only", () => {
  const root = tempDir();
  try {
    write(root, "context/memory/2026-06-05.md", "# Daily\n\nActive memory.");
    write(root, "brand_context/voice-profile.md", "# Voice\n\nBrand voice guidance.");

    const defaults = discovery.discoverSources({ rootDir: root });
    assert.ok(defaults.some((s) => s.sourcePath === "context/memory/2026-06-05.md"));
    assert.ok(!defaults.some((s) => s.sourcePath.startsWith("brand_context/")));

    const explicit = discovery.discoverSources({
      rootDir: root,
      roots: ["brand_context"],
    });
    assert.deepEqual(explicit.map((s) => s.sourcePath), ["brand_context/voice-profile.md"]);
    assert.equal(explicit[0].sourceType, "brand");
  } finally {
    rmDir(root);
  }
});

test("legacy .memsearch sources are import-only", () => {
  const root = tempDir();
  try {
    write(root, "context/memory/2026-06-05.md", "# Daily\n\nActive memory.");
    write(root, ".memsearch/memory/2026-06-04.md", "# Legacy\n\nOld capture.");

    const defaults = discovery.discoverSources({ rootDir: root });
    assert.ok(defaults.some((s) => s.sourcePath === "context/memory/2026-06-05.md"));
    assert.ok(!defaults.some((s) => s.sourcePath.startsWith(".memsearch/memory/")));

    const explicit = discovery.discoverSources({
      rootDir: root,
      roots: [".memsearch/memory"],
    });
    assert.deepEqual(explicit.map((s) => s.sourcePath), [".memsearch/memory/2026-06-04.md"]);
    assert.equal(explicit[0].sourceType, "memory");
  } finally {
    rmDir(root);
  }
});

test("indexSources rejects an invalid scope", async () => {
  const root = tempDir();
  try {
    await withStore(async (s) => {
    await assert.rejects(
      () =>
        indexer.indexSources({
          store: s,
          embedder: newEmbedder(),
          // client visibility with no clientId → invalid.
          scope: { teamId: null, clientId: null, userId: null, visibility: "client" },
          rootDir: root,
        }),
      /Invalid memory scope/,
    );
    });
  } finally {
    rmDir(root);
  }
});

test("indexSources re-scopes clients/{slug} sources to client visibility", async () => {
  const root = tempDir();
  write(root, "clients/acme/context/memory/note.md", "# Acme\n\nClient-specific memory.");

  try {
    await withStore(async (s) => {
    const summary = await indexer.indexSources({
      store: s,
      embedder: newEmbedder(),
      scope: sysScope(),
      rootDir: root,
      roots: ["clients/acme/context/memory"],
    });
    assert.equal(summary.sourcesIndexed, 1);

    const row = await s.client.query(
      "SELECT visibility, client_id FROM memory_sources WHERE source_path = $1",
      ["clients/acme/context/memory/note.md"],
    );
    assert.equal(row.rows[0].visibility, "client");
    assert.equal(row.rows[0].client_id, "acme");

    // A system-scoped search must NOT see the client chunk.
    const [q] = await newEmbedder().embed(["client-specific memory"]);
    const sysHits = await s.vectorSearch({ teamId: null, include: ["system"] }, q, 5);
    assert.ok(!sysHits.some((h) => h.sourcePath.includes("acme")));
    // A client-scoped search does.
    const clientHits = await s.vectorSearch(
      { teamId: null, clientId: "acme", include: ["client"] },
      q,
      5,
    );
    assert.ok(clientHits.some((h) => h.sourcePath.includes("acme")));
    });
  } finally {
    rmDir(root);
  }
});

// ---------------------------------------------------------------------------
// Idempotency + stale-chunk pruning
// ---------------------------------------------------------------------------

test("indexSources skips unchanged sources and prunes stale chunks", async () => {
  const root = tempDir();
  const rel = "context/memory/2026-06-05.md";
  // Three heading sections → three chunks.
  write(root, rel, "# A\n\naaa body\n\n## B\n\nbbb body\n\n## C\n\nccc body");

  try {
    await withStore(async (s) => {
    const run1 = await indexer.indexSources({
      store: s, embedder: newEmbedder(), scope: sysScope(), rootDir: root,
    });
    assert.equal(run1.sourcesIndexed, 1);
    const firstChunks = run1.chunksInserted;
    assert.ok(firstChunks >= 3);

    // Re-run with no changes → skipped, nothing inserted.
    const run2 = await indexer.indexSources({
      store: s, embedder: newEmbedder(), scope: sysScope(), rootDir: root,
    });
    assert.equal(run2.sourcesSkipped, 1);
    assert.equal(run2.sourcesIndexed, 0);
    assert.equal(run2.chunksInserted, 0);

    // index_jobs records the skip.
    const skipped = await s.client.query(
      "SELECT count(*)::int AS n FROM index_jobs WHERE status = 'skipped'",
    );
    assert.equal(Number(skipped.rows[0].n), 1);

    // Shrink the file to a single chunk → re-index + prune the rest.
    write(root, rel, "# A\n\njust one section now");
    const run3 = await indexer.indexSources({
      store: s, embedder: newEmbedder(), scope: sysScope(), rootDir: root,
    });
    assert.equal(run3.sourcesIndexed, 1);
    assert.ok(run3.chunksPruned >= firstChunks - 1);

    // No orphan chunks remain for that source.
    const remaining = await s.client.query(
      "SELECT count(*)::int AS n FROM memory_chunks c " +
        "JOIN memory_sources s ON s.id = c.source_id WHERE s.source_path = $1",
      [rel],
    );
    assert.equal(Number(remaining.rows[0].n), run3.chunksInserted);
    assert.equal(Number(remaining.rows[0].n), 1);
    });
  } finally {
    rmDir(root);
  }
});

test("indexSources --force re-embeds unchanged sources", async () => {
  const root = tempDir();
  write(root, "context/learnings.md", "# Learnings\n\nstable content");

  try {
    await withStore(async (s) => {
    await indexer.indexSources({
      store: s, embedder: newEmbedder(), scope: sysScope(), rootDir: root,
    });
    const forced = await indexer.indexSources({
      store: s, embedder: newEmbedder(), scope: sysScope(), rootDir: root, force: true,
    });
    assert.equal(forced.sourcesIndexed, 1);
    assert.equal(forced.sourcesSkipped, 0);
    });
  } finally {
    rmDir(root);
  }
});
