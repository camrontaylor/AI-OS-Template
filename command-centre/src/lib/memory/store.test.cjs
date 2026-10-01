const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");
const { openMemoryTestStore, resetMemoryTestStore } = require("./test-store.cjs");

// loadTsModule transpiles a SINGLE .ts file and does not recurse into sibling
// .ts imports, so each leaf module is loaded first and then injected as a stub
// into the modules that import it. Third-party imports (@electric-sql/pglite and
// its /vector subpath) fall through loadTsModule's localRequire to the real
// require(), so they need no stub.
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

const EMBED_DIM = 4;
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");
const COMMAND_CENTRE_ROOT = path.resolve(__dirname, "../../..");
const WORKSPACE_ROOT = path.resolve(COMMAND_CENTRE_ROOT, "..");
let sharedStore = null;

test.before(async () => {
  sharedStore = await openMemoryTestStore(store, { embedDim: EMBED_DIM });
});

test.after(async () => {
  await sharedStore?.close();
  sharedStore = null;
});

function latestMigrationVersion() {
  return Math.max(
    ...fs.readdirSync(MIGRATIONS_DIR)
      .map((name) => Number((name.match(/^(\d+)_/) || [])[1]))
      .filter(Number.isInteger),
  );
}

function mkScope(visibility, overrides = {}) {
  return { teamId: null, clientId: null, userId: null, visibility, ...overrides };
}

/** Make a fresh temp directory; the caller removes it when done. */
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

// ---------------------------------------------------------------------------
// Pure embedding helpers (no DB).
// ---------------------------------------------------------------------------

test("toVectorLiteral / parseVectorLiteral round-trip", () => {
  assert.equal(embedding.toVectorLiteral([0.1, 0.2, 0.3]), "[0.1,0.2,0.3]");
  assert.deepEqual(embedding.parseVectorLiteral("[0.1,0.2,0.3]"), [0.1, 0.2, 0.3]);
  assert.equal(embedding.parseVectorLiteral(null), null);
  assert.deepEqual(embedding.parseVectorLiteral([1, 2, 3]), [1, 2, 3]);
  assert.throws(() => embedding.toVectorLiteral([]), /non-empty/);
  assert.throws(() => embedding.toVectorLiteral([1, NaN]), /finite/);
});

// ---------------------------------------------------------------------------
// Migrations apply against a real PGLite + pgvector instance.
// ---------------------------------------------------------------------------

test("openMemoryStore runs migrations and registers pgvector", async () => {
  await withStore(async (s) => {
    const ext = await s.client.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    assert.equal(ext.rows.length, 1);

    const reg = await s.client.query("SELECT to_regclass('memory_chunks') AS reg");
    assert.notEqual(reg.rows[0].reg, null);

    const led = await s.client.query(
      "SELECT version, embed_dim FROM schema_migrations ORDER BY version",
    );
    assert.equal(Number(led.rows[0].version), 1);
    assert.equal(Number(led.rows.at(-1).version), latestMigrationVersion());
    assert.equal(Number(led.rows[0].embed_dim), EMBED_DIM);
  });
});

test("resolveMigrationsDir falls back to the source tree when bundled paths are virtual", () => {
  const virtualDir = path.join(path.parse(WORKSPACE_ROOT).root, "ROOT", "src", "lib", "memory");
  const bundledCwd = path.join(WORKSPACE_ROOT, ".next", "server");

  assert.equal(
    migrate.resolveMigrationsDir(undefined, {
      dirname: virtualDir,
      cwd: bundledCwd,
      env: { AI_OS_DIR: WORKSPACE_ROOT },
    }),
    MIGRATIONS_DIR,
  );
});

// ---------------------------------------------------------------------------
// insertSource — insert + idempotent UPSERT.
// ---------------------------------------------------------------------------

test("insertSource inserts and re-index UPSERTs in place", async () => {
  await withStore(async (s) => {
    const first = await s.insertSource({
      scope: mkScope("system"),
      sourcePath: "context/learnings.md",
      sourceType: "learnings",
      contentSha256: "sha-1",
    });
    assert.match(first.id, /^[0-9a-f-]{36}$/);
    assert.equal(first.visibility, "system");
    assert.equal(first.sourcePath, "context/learnings.md");
    assert.equal(first.authorityWeight, 1.0);

    // Same scope + path => UPSERT (not a duplicate row), sha updated.
    const second = await s.insertSource({
      scope: mkScope("system"),
      sourcePath: "context/learnings.md",
      sourceType: "learnings",
      contentSha256: "sha-2",
    });
    assert.equal(second.id, first.id);
    assert.equal(second.contentSha256, "sha-2");

    const count = await s.client.query(
      "SELECT count(*)::int AS n FROM memory_sources WHERE source_path = $1",
      ["context/learnings.md"],
    );
    assert.equal(Number(count.rows[0].n), 1);
  });
});

// ---------------------------------------------------------------------------
// insertChunk — embedding round-trip + scope-drift guard.
// ---------------------------------------------------------------------------

test("insertChunk stores an embedding and rejects scope drift", async () => {
  await withStore(async (s) => {
    const src = await s.insertSource({
      scope: mkScope("client", { clientId: "acme" }),
      sourcePath: "clients/acme/context/memory/note.md",
      sourceType: "memory",
      contentSha256: "sha",
    });
    const srcScope = mkScope("client", { clientId: "acme" });

    const chunk = await s.insertChunk({
      sourceId: src.id,
      sourceScope: srcScope,
      chunkScope: srcScope,
      chunkIndex: 0,
      content: "hello world",
      heading: "Greeting",
      headingLevel: 2,
      startLine: 10,
      endLine: 12,
      contentHash: "hash-hello",
      chunkKey: "chunk-key-hello",
      sourcePath: src.sourcePath,
      sourceType: "memory",
      embedding: [1, 0, 0, 0],
      embeddingModel: "test-model",
    });
    assert.deepEqual(chunk.embedding, [1, 0, 0, 0]);
    assert.equal(chunk.embeddingDim, EMBED_DIM);
    assert.equal(chunk.clientId, "acme");
    assert.equal(chunk.heading, "Greeting");
    assert.equal(chunk.headingLevel, 2);
    assert.equal(chunk.startLine, 10);
    assert.equal(chunk.endLine, 12);
    assert.equal(chunk.contentHash, "hash-hello");
    assert.equal(chunk.chunkKey, "chunk-key-hello");

    // A chunk whose scope is wider/different from its source must be rejected.
    await assert.rejects(
      () =>
        s.insertChunk({
          sourceId: src.id,
          sourceScope: srcScope,
          chunkScope: mkScope("client", { clientId: "globex" }),
          chunkIndex: 1,
          content: "leaky",
          sourcePath: src.sourcePath,
          sourceType: "memory",
          embedding: [0, 1, 0, 0],
        }),
      /Chunk scope does not match/,
    );

    // A wrong-dimension embedding is caught in app code.
    await assert.rejects(
      () =>
        s.insertChunk({
          sourceId: src.id,
          sourceScope: srcScope,
          chunkScope: srcScope,
          chunkIndex: 2,
          content: "bad dim",
          sourcePath: src.sourcePath,
          sourceType: "memory",
          embedding: [1, 0, 0],
        }),
      /dimensions but the/,
    );
  });
});

// ---------------------------------------------------------------------------
// vectorSearch — nearest-first ordering.
// ---------------------------------------------------------------------------

test("vectorSearch returns nearest-first", async () => {
  await withStore(async (s) => {
    const sys = mkScope("system");
    const src = await s.insertSource({
      scope: sys,
      sourcePath: "context/MEMORY.md",
      sourceType: "memory",
      contentSha256: "sha",
    });

    const a = await s.insertChunk({
      sourceId: src.id, sourceScope: sys, chunkScope: sys, chunkIndex: 0,
      content: "A", sourcePath: src.sourcePath, sourceType: "memory",
      embedding: [1, 0, 0, 0],
    });
    await s.insertChunk({
      sourceId: src.id, sourceScope: sys, chunkScope: sys, chunkIndex: 1,
      content: "B", sourcePath: src.sourcePath, sourceType: "memory",
      embedding: [0, 1, 0, 0],
    });
    await s.insertChunk({
      sourceId: src.id, sourceScope: sys, chunkScope: sys, chunkIndex: 2,
      content: "C", sourcePath: src.sourcePath, sourceType: "memory",
      embedding: [0, 0, 1, 0],
    });

    const hits = await s.vectorSearch(
      { teamId: null, include: ["system"] },
      [0.9, 0.1, 0, 0],
      3,
    );
    assert.equal(hits.length, 3);
    assert.equal(hits[0].id, a.id);
    assert.equal(hits[0].startLine, null);
    assert.equal(hits[0].chunkKey, null);
    assert.ok(hits[0].distance <= hits[1].distance);
    assert.ok(hits[1].distance <= hits[2].distance);
  });
});

// ---------------------------------------------------------------------------
// Scope isolation — the leak boundary (client A never sees client B).
// ---------------------------------------------------------------------------

test("vectorSearch isolates client scope (no cross-client leak)", async () => {
  await withStore(async (s) => {
    for (const clientId of ["acme", "globex"]) {
      const sc = mkScope("client", { clientId });
      const src = await s.insertSource({
        scope: sc,
        sourcePath: `clients/${clientId}/context/memory/x.md`,
        sourceType: "memory",
        contentSha256: "sha",
      });
      // Identical embedding for both clients: only the scope filter can separate them.
      await s.insertChunk({
        sourceId: src.id, sourceScope: sc, chunkScope: sc, chunkIndex: 0,
        content: `secret-${clientId}`, sourcePath: src.sourcePath,
        sourceType: "memory", embedding: [1, 0, 0, 0],
      });
    }

    const hits = await s.vectorSearch(
      { teamId: null, clientId: "acme", include: ["client"] },
      [1, 0, 0, 0],
      10,
    );
    assert.ok(hits.length >= 1);
    assert.ok(hits.every((h) => h.sourcePath.includes("acme")));
    assert.ok(!hits.some((h) => h.sourcePath.includes("globex")));
  });
});

// ---------------------------------------------------------------------------
// Persistence — data survives close + reopen.
// ---------------------------------------------------------------------------

test("memory persists across close and reopen", async () => {
  const dir = tempDir();
  try {
    const first = await store.openMemoryStore({ dataDir: dir, embedDim: EMBED_DIM });
    const sys = mkScope("system");
    const src = await first.insertSource({
      scope: sys,
      sourcePath: "context/MEMORY.md",
      sourceType: "memory",
      contentSha256: "sha",
    });
    await first.insertChunk({
      sourceId: src.id, sourceScope: sys, chunkScope: sys, chunkIndex: 0,
      content: "durable", sourcePath: src.sourcePath, sourceType: "memory",
      embedding: [1, 0, 0, 0],
    });
    await first.close();

    const reopened = await store.openMemoryStore({ dataDir: dir, embedDim: EMBED_DIM });
    try {
      const counts = await reopened.client.query(
        "SELECT (SELECT count(*) FROM memory_sources)::int AS sources, " +
          "(SELECT count(*) FROM memory_chunks)::int AS chunks",
      );
      assert.ok(Number(counts.rows[0].sources) >= 1);
      assert.ok(Number(counts.rows[0].chunks) >= 1);

      const hits = await reopened.vectorSearch(
        { teamId: null, include: ["system"] },
        [1, 0, 0, 0],
        5,
      );
      assert.ok(hits.some((h) => h.content === "durable"));
    } finally {
      await reopened.close();
    }
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Dimension guard — reopening with a different embedDim is refused.
// ---------------------------------------------------------------------------

test("reopening with a different embedDim is rejected", async () => {
  const dir = tempDir();
  try {
    const s = await store.openMemoryStore({ dataDir: dir, embedDim: EMBED_DIM });
    await s.close();

    await assert.rejects(
      () => store.openMemoryStore({ dataDir: dir, embedDim: EMBED_DIM * 2 }),
      /Embedding dimension mismatch/,
    );
  } finally {
    rmDir(dir);
  }
});

test("context document path prefixes treat percent, underscore, and backslash literally", async () => {
  await withStore(async (s) => {
    const scope = mkScope("system");
    const exactPath = "context/50%_ops\\guide.md";
    const wildcardDecoy = "context/50-anything-ops\\guide.md";

    await s.upsertContextDocument({
      scope,
      path: exactPath,
      kind: "other",
      content: "exact",
      contentSha256: "sha-exact",
    });
    await s.upsertContextDocument({
      scope,
      path: wildcardDecoy,
      kind: "other",
      content: "decoy",
      contentSha256: "sha-decoy",
    });

    const matches = await s.listContextDocuments({
      visibility: "system",
      pathPrefix: "context/50%_ops\\",
    });

    assert.deepEqual(matches.map((document) => document.path), [exactPath]);
  });
});
