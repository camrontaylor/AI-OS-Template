/**
 * ingest.ts tests — the shared single-source pipeline.
 *
 * ingestContent() is the seam both the filesystem indexer and the hosted API
 * ingest through. These tests pin its contract directly, content-in (no
 * filesystem): idempotent skip, force re-embed, stale-chunk pruning, scope
 * validation, sha256 computation, and the index_jobs audit trail.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");

// Leaf-first loading, same as indexer.test.cjs.
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
const ingest = loadTsModule(path.resolve(__dirname, "ingest.ts"), {
  stubs: { "./scope": scope, "./embedding": embedding, "./chunker": chunker },
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-ingest-"));
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function sysScope(overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility: "system", ...overrides };
}
function newEmbedder() {
  return new embedder.HashEmbedder({ dim: EMBED_DIM });
}
async function withStore(fn) {
  if (!sharedStore) throw new Error("shared memory test store was not initialized");
  await resetMemoryTestStore(sharedStore);
  return fn(sharedStore);
}
function newCountingEmbedder() {
  const inner = newEmbedder();
  return {
    model: inner.model,
    dim: inner.dim,
    calls: 0,
    texts: [],
    async embed(texts) {
      this.calls += texts.length;
      this.texts.push(...texts);
      return inner.embed(texts);
    },
  };
}
function baseOpts(s, overrides = {}) {
  return {
    store: s,
    embedder: newEmbedder(),
    scope: sysScope(),
    sourcePath: "context/memory/2026-06-10.md",
    sourceType: "memory",
    content: "# A\n\naaa body\n\n## B\n\nbbb body\n\n## C\n\nccc body",
    ...overrides,
  };
}

test("ingestContent inserts a source with chunks and an audit row", async () => {
  await withStore(async (s) => {
    const result = await ingest.ingestContent(
      baseOpts(s, { title: "Daily", contentDate: "2026-06-10", authorityWeight: 1.5 }),
    );

    assert.ok(result.sourceId);
    assert.equal(result.skipped, false);
    assert.equal(result.chunksInserted, 3); // three heading sections
    assert.equal(result.chunksPruned, 0);

    const src = await s.client.query(
      "SELECT title, content_date::text AS d, authority_weight, content_sha256, byte_size, " +
        "status, error_message, indexed_at::text AS indexed_at " +
        "FROM memory_sources WHERE id = $1",
      [result.sourceId],
    );
    assert.equal(src.rows[0].title, "Daily");
    assert.equal(src.rows[0].d, "2026-06-10");
    assert.ok(Math.abs(Number(src.rows[0].authority_weight) - 1.5) < 1e-6);
    // sha256 computed from the content when not provided.
    assert.equal(src.rows[0].content_sha256, ingest.sha256Hex(baseOpts(s).content));
    assert.equal(Number(src.rows[0].byte_size), Buffer.byteLength(baseOpts(s).content));
    assert.equal(src.rows[0].status, "indexed");
    assert.equal(src.rows[0].error_message, null);
    assert.ok(src.rows[0].indexed_at);

    const chunks = await s.client.query(
      "SELECT heading, heading_level, start_line, end_line, content_hash, chunk_key " +
        "FROM memory_chunks WHERE source_id = $1 ORDER BY chunk_index",
      [result.sourceId],
    );
    assert.equal(chunks.rows[0].heading, "A");
    assert.equal(Number(chunks.rows[0].heading_level), 1);
    assert.equal(Number(chunks.rows[0].start_line), 3);
    assert.equal(Number(chunks.rows[0].end_line), 3);
    assert.match(chunks.rows[0].content_hash, /^[0-9a-f]{64}$/);
    assert.match(chunks.rows[0].chunk_key, /^chunk:v1:[0-9a-f]{64}$/);

    const jobs = await s.client.query(
      "SELECT count(*)::int AS n FROM index_jobs WHERE status = 'succeeded'",
    );
    assert.equal(Number(jobs.rows[0].n), 1);
  });
});

test("ingestContent normalizes identifiers that do not belong to the visibility", async () => {
  await withStore(async (s) => {
    await ingest.ingestContent(
      baseOpts(s, {
        scope: sysScope({
          teamId: "team-1",
          clientId: "must-not-persist",
          userId: "must-not-persist",
        }),
      }),
    );
    const { rows } = await s.client.query(
      "SELECT team_id, client_id, user_id, visibility FROM memory_sources",
    );
    assert.deepEqual(rows, [{
      team_id: "team-1",
      client_id: null,
      user_id: null,
      visibility: "system",
    }]);
  });
});

test("ingestContent skips unchanged content and records the skip", async () => {
  await withStore(async (s) => {
    const first = await ingest.ingestContent(baseOpts(s));
    const second = await ingest.ingestContent(baseOpts(s));

    assert.equal(second.skipped, true);
    assert.equal(second.sourceId, first.sourceId); // same row, not a duplicate
    assert.equal(second.chunksInserted, 0);

    const skipped = await s.client.query(
      "SELECT count(*)::int AS n FROM index_jobs WHERE status = 'skipped'",
    );
    assert.equal(Number(skipped.rows[0].n), 1);
  });
});

test("ingestContent marks a failed source and force retry recovers it", async () => {
  await withStore(async (s) => {
    const failingEmbedder = {
      model: "hash-test",
      dim: EMBED_DIM,
      async embed() {
        throw new Error("embedding service offline");
      },
    };
    await assert.rejects(
      () => ingest.ingestContent(baseOpts(s, { embedder: failingEmbedder })),
      /embedding service offline/,
    );

    const failed = await s.client.query(
      "SELECT id, status, error_message FROM memory_sources WHERE source_path = $1",
      [baseOpts(s).sourcePath],
    );
    assert.equal(failed.rows.length, 1);
    assert.equal(failed.rows[0].status, "failed");
    assert.match(failed.rows[0].error_message, /embedding service offline/);

    const retried = await ingest.ingestContent(baseOpts(s, { force: true }));
    assert.equal(retried.sourceId, failed.rows[0].id);
    assert.equal(retried.skipped, false);

    const recovered = await s.client.query(
      "SELECT status, error_message, indexed_at::text AS indexed_at FROM memory_sources WHERE id = $1",
      [retried.sourceId],
    );
    assert.equal(recovered.rows[0].status, "indexed");
    assert.equal(recovered.rows[0].error_message, null);
    assert.ok(recovered.rows[0].indexed_at);

    const chunks = await s.client.query(
      "SELECT count(*)::int AS n FROM memory_chunks WHERE source_id = $1",
      [retried.sourceId],
    );
    assert.equal(Number(chunks.rows[0].n), retried.chunksInserted);
  });
});

test("ingestContent reuses unchanged chunk embeddings by stable key", async () => {
  await withStore(async (s) => {
    const emb = newCountingEmbedder();
    const firstContent = "# A\n\nsame body\n\n## B\n\nold body";
    const secondContent = "# A\n\nsame body\n\n## B\n\nnew body";

    await ingest.ingestContent(baseOpts(s, { embedder: emb, content: firstContent }));
    assert.equal(emb.calls, 2);

    const firstRows = await s.client.query(
      "SELECT chunk_key, embedding::text AS embedding FROM memory_chunks ORDER BY chunk_index",
    );
    const unchangedKey = firstRows.rows[0].chunk_key;
    const unchangedEmbedding = firstRows.rows[0].embedding;

    const second = await ingest.ingestContent(
      baseOpts(s, { embedder: emb, content: secondContent }),
    );
    assert.equal(second.skipped, false);
    assert.equal(second.chunksInserted, 2);
    assert.equal(emb.calls, 3, "only the changed B section should be embedded again");

    const afterRows = await s.client.query(
      "SELECT chunk_key, embedding::text AS embedding, content FROM memory_chunks ORDER BY chunk_index",
    );
    assert.equal(afterRows.rows.length, 2);
    assert.equal(afterRows.rows[0].chunk_key, unchangedKey);
    assert.equal(afterRows.rows[0].embedding, unchangedEmbedding);
    assert.equal(afterRows.rows[0].content, "same body");
    assert.equal(afterRows.rows[1].content, "new body");
  });
});

test("ingestContent force re-embeds unchanged content", async () => {
  await withStore(async (s) => {
    await ingest.ingestContent(baseOpts(s));
    const forced = await ingest.ingestContent(baseOpts(s, { force: true }));
    assert.equal(forced.skipped, false);
    assert.equal(forced.chunksInserted, 3);
  });
});

test("ingestContent prunes stale chunks when content shrinks", async () => {
  await withStore(async (s) => {
    const first = await ingest.ingestContent(baseOpts(s));
    assert.equal(first.chunksInserted, 3);

    const smaller = await ingest.ingestContent(
      baseOpts(s, { content: "# A\n\njust one section now" }),
    );
    assert.equal(smaller.skipped, false);
    assert.equal(smaller.chunksInserted, 1);
    assert.equal(smaller.chunksPruned, 3);

    const remaining = await s.client.query(
      "SELECT count(*)::int AS n FROM memory_chunks WHERE source_id = $1",
      [smaller.sourceId],
    );
    assert.equal(Number(remaining.rows[0].n), 1);
  });
});

test("ingestContent rejects an invalid scope", async () => {
  await withStore(async (s) => {
    await assert.rejects(
      () =>
        ingest.ingestContent(
          // private visibility with no userId → invalid.
          baseOpts(s, { scope: sysScope({ visibility: "private" }) }),
        ),
      /Invalid memory scope/,
    );
  });
});

test("ingestContent rejects an embedder/store dimension mismatch", async () => {
  await withStore(async (s) => {
    await assert.rejects(
      () =>
        ingest.ingestContent(
          baseOpts(s, { embedder: new embedder.HashEmbedder({ dim: EMBED_DIM + 1 }) }),
        ),
      /must match/,
    );
  });
});

test("ingestContent with trackJobs=false writes no index_jobs rows", async () => {
  await withStore(async (s) => {
    await ingest.ingestContent(baseOpts(s, { trackJobs: false }));
    const jobs = await s.client.query("SELECT count(*)::int AS n FROM index_jobs");
    assert.equal(Number(jobs.rows[0].n), 0);
  });
});

// ---------------------------------------------------------------------------
// deleteSource — the missing half of live sync: a file that's gone from disk.
// ---------------------------------------------------------------------------

test("deleteSource removes the source row and cascades its chunks", async () => {
  const dataDir = tempDir();
  const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
  try {
    const ingested = await ingest.ingestContent(baseOpts(s));
    assert.equal(ingested.chunksInserted, 3);

    const result = await ingest.deleteSource(s, sysScope(), baseOpts(s).sourcePath);
    assert.equal(result.deleted, true);
    assert.equal(result.sourceId, ingested.sourceId);

    const src = await s.client.query("SELECT count(*)::int AS n FROM memory_sources WHERE id = $1", [
      ingested.sourceId,
    ]);
    assert.equal(Number(src.rows[0].n), 0);

    const chunks = await s.client.query(
      "SELECT count(*)::int AS n FROM memory_chunks WHERE source_id = $1",
      [ingested.sourceId],
    );
    assert.equal(Number(chunks.rows[0].n), 0, "chunks must cascade-delete with the source");

    const jobs = await s.client.query(
      "SELECT count(*)::int AS n FROM index_jobs WHERE reason = 'file_change' AND status = 'succeeded'",
    );
    assert.equal(Number(jobs.rows[0].n), 1);
  } finally {
    await s.close();
    rmDir(dataDir);
  }
});

test("deleteSource is a no-op when nothing matches scope + sourcePath", async () => {
  const dataDir = tempDir();
  const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
  try {
    const result = await ingest.deleteSource(s, sysScope(), "context/memory/never-indexed.md");
    assert.equal(result.deleted, false);
    assert.equal(result.sourceId, null);
  } finally {
    await s.close();
    rmDir(dataDir);
  }
});

test("deleteSource only deletes the matching scope, not a same-path source in another scope", async () => {
  const dataDir = tempDir();
  const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
  try {
    const sharedPath = "clients/acme/context/memory/2026-06-10.md";
    const systemIngest = await ingest.ingestContent(
      baseOpts(s, { sourcePath: sharedPath, scope: sysScope() }),
    );
    const clientIngest = await ingest.ingestContent(
      baseOpts(s, { sourcePath: sharedPath, scope: sysScope({ visibility: "client", clientId: "acme" }) }),
    );

    const result = await ingest.deleteSource(s, sysScope(), sharedPath);
    assert.equal(result.deleted, true);
    assert.equal(result.sourceId, systemIngest.sourceId);

    const remaining = await s.client.query("SELECT id FROM memory_sources WHERE id = $1", [
      clientIngest.sourceId,
    ]);
    assert.equal(remaining.rows.length, 1, "the client-scoped source must be untouched");
  } finally {
    await s.close();
    rmDir(dataDir);
  }
});

test("deleteSource with trackJobs=false writes no index_jobs row", async () => {
  const dataDir = tempDir();
  const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
  try {
    await ingest.ingestContent(baseOpts(s, { trackJobs: false }));
    await ingest.deleteSource(s, sysScope(), baseOpts(s).sourcePath, { trackJobs: false });

    const jobs = await s.client.query("SELECT count(*)::int AS n FROM index_jobs");
    assert.equal(Number(jobs.rows[0].n), 0);
  } finally {
    await s.close();
    rmDir(dataDir);
  }
});

test("deleteSource rejects an invalid scope", async () => {
  const dataDir = tempDir();
  const s = await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM });
  try {
    await assert.rejects(
      () => ingest.deleteSource(s, sysScope({ visibility: "private" }), "context/memory/x.md"),
      /Invalid memory scope/,
    );
  } finally {
    await s.close();
    rmDir(dataDir);
  }
});
