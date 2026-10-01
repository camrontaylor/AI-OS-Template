"use strict";
/**
 * postgres-adapter — unit tests (pure, always run) + integration tests
 * (gated on TEST_DATABASE_URL).
 *
 * The pure tests cover resolveSsl and need no database, so they run in the
 * normal `npm run test:memory` suite. The integration test runs against a REAL
 * Postgres: the shared migration applies, pgvector is enabled, and a
 * vector-search round-trip returns nearest-first. It runs ONLY when
 * TEST_DATABASE_URL points at a disposable pgvector database
 * (e.g. the local docker-compose one) — otherwise it skips, keeping CI green.
 *
 * WARNING: the integration tests DROP and recreate the public schema for
 * repeatability. Point TEST_DATABASE_URL at an owned throwaway database, never
 * production.
 *
 *   docker compose -f command-centre/docker-compose.yml up -d
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_memory \
 *     npm run test:memory:pg
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const resolve = (file) => path.join(__dirname, file);

const migrate = loadTsModule(resolve("migrate.ts"));
const embedding = loadTsModule(resolve("embedding.ts"));
const adapter = loadTsModule(resolve("postgres-adapter.ts"));

// The store module graph — to prove the SAME openMemoryStore works on Postgres.
const types = { ALL_VISIBILITIES: ["private", "client", "team", "system"] };
const scope = loadTsModule(resolve("scope.ts"), { stubs: { "./types": types } });
const pgliteAdapter = loadTsModule(resolve("pglite-adapter.ts"));
const backend = loadTsModule(resolve("backend.ts"));
const rowMappers = loadTsModule(resolve("row-mappers.ts"), {
  stubs: { "./types": types, "./embedding": embedding },
});
const store = loadTsModule(resolve("store.ts"), {
  stubs: {
    "./types": types,
    "./migrate": migrate,
    "./scope": scope,
    "./embedding": embedding,
    "./row-mappers": rowMappers,
    "./pglite-adapter": pgliteAdapter,
    "./postgres-adapter": adapter,
    "./backend": backend,
  },
});

// ---------------------------------------------------------------------------
// Pure unit tests — resolveSsl. No database required.
// ---------------------------------------------------------------------------
test("resolveSsl: an explicit option wins over every heuristic", () => {
  assert.equal(adapter.resolveSsl("postgres://x@remote.example:5432/db", false), false);
});

test("resolveSsl: localhost / loopback default to no SSL", () => {
  assert.equal(adapter.resolveSsl("postgres://postgres:postgres@localhost:5432/db"), false);
  assert.equal(adapter.resolveSsl("postgres://postgres@127.0.0.1:5432/db"), false);
});

test("resolveSsl: a remote host defaults to SSL without cert verification", () => {
  assert.deepEqual(adapter.resolveSsl("postgres://u:p@db.proxy.rlwy.net:1234/railway"), {
    rejectUnauthorized: false,
  });
});

test("resolveSsl: sslmode=disable in the URL turns SSL off", () => {
  assert.equal(
    adapter.resolveSsl("postgres://u:p@db.proxy.rlwy.net:1234/railway?sslmode=disable"),
    false,
  );
});

test("resolveSsl: PGSSLMODE overrides the host default", () => {
  const prev = process.env.PGSSLMODE;
  try {
    process.env.PGSSLMODE = "disable";
    assert.equal(adapter.resolveSsl("postgres://u:p@remote.example:5432/db"), false);
    process.env.PGSSLMODE = "require";
    assert.deepEqual(adapter.resolveSsl("postgres://postgres@localhost:5432/db"), {
      rejectUnauthorized: false,
    });
  } finally {
    if (prev === undefined) delete process.env.PGSSLMODE;
    else process.env.PGSSLMODE = prev;
  }
});

test("openPostgres: rejects an empty connection string", async () => {
  await assert.rejects(() => adapter.openPostgres(""), /non-empty connection string/);
});

test("openPostgresPool: rejects an empty connection string", async () => {
  await assert.rejects(() => adapter.openPostgresPool(""), /non-empty connection string/);
});

test("PostgresPoolSqlClient: refuses bare transaction-control exec calls", async () => {
  // A fake pool is enough — the guard must trip BEFORE any query is issued.
  const calls = [];
  const fakePool = { query: async (sql) => { calls.push(sql); return { rows: [] }; } };
  const client = new adapter.PostgresPoolSqlClient(fakePool);

  for (const stmt of ["BEGIN", "COMMIT", "ROLLBACK", "  begin ;", "commit;"]) {
    await assert.rejects(() => client.exec(stmt), /dedicated single connection/);
  }
  assert.equal(calls.length, 0, "no transaction-control statement may reach the pool");

  // Ordinary statements (and multi-statement strings) pass through.
  await client.exec("SELECT 1; SELECT 2");
  await client.query("SELECT $1", [1]);
  assert.equal(calls.length, 2);
});

// ---------------------------------------------------------------------------
// Integration test — gated on TEST_DATABASE_URL (throwaway pgvector database).
// ---------------------------------------------------------------------------
const RUN_PG_TESTS =
  process.env.MEMORY_PG_TESTS === "1" ||
  process.env.npm_lifecycle_event === "test:memory:pg";
const TEST_URL = RUN_PG_TESTS ? process.env.TEST_DATABASE_URL : "";

async function resetPostgresDatabase(client) {
  await client.exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
}

test(
  "hosted Postgres: migration applies, pgvector works, vector search is nearest-first",
  { skip: TEST_URL ? false : "set TEST_DATABASE_URL to run against a real Postgres" },
  async () => {
    const dim = 384;
    const { client, close } = await adapter.openPostgres(TEST_URL);
    try {
      // Clean slate so the test is repeatable on a reused database.
      await resetPostgresDatabase(client);

      // 1) The shared migration applies against real Postgres.
      const applied = await migrate.applyMigrations(client, { embedDim: dim });
      assert.ok(applied.applied.includes("1_init"), "0001_init should be applied");
      assert.equal(applied.embedDim, dim);

      // 2) pgvector is enabled by the migration's CREATE EXTENSION.
      const ext = await client.query(
        "SELECT extname FROM pg_extension WHERE extname = 'vector'",
      );
      assert.equal(ext.rows.length, 1, "the vector extension must be present");

      // 3) Migration 0020 accepts private outbox items without a client and
      //    rejects a private item that tries to carry client scope.
      await client.query(
        `INSERT INTO memory_sync_outbox
           (operation, dedupe_key, team_id, actor_user_id, visibility,
            request_path, request_body)
         VALUES ('ingest', $1, $2, $3, 'private', '/v1/memory/ingest', $4::jsonb)`,
        ["pg-private-valid", "team-test", "user-test", "{}"],
      );
      await assert.rejects(
        () => client.query(
          `INSERT INTO memory_sync_outbox
             (operation, dedupe_key, team_id, client_id, actor_user_id, visibility,
              request_path, request_body)
           VALUES ('ingest', $1, $2, $3, $4, 'private', '/v1/memory/ingest', $5::jsonb)`,
          ["pg-private-invalid", "team-test", "client-test", "user-test", "{}"],
        ),
        /memory_sync_outbox_scope_chk|violates check constraint/,
      );

      // 4) Insert a source + two chunks with controlled unit-vector embeddings,
      //    then prove cosine ordering: the query is nearest to chunk A.
      const unit = (i) => {
        const v = new Array(dim).fill(0);
        v[i] = 1;
        return v;
      };
      const queryVec = new Array(dim).fill(0);
      queryVec[0] = 0.9;
      queryVec[1] = 0.1;

      const src = await client.query(
        `INSERT INTO memory_sources (visibility, source_path, source_type, content_sha256)
         VALUES ('system', $1, 'memory', $2)
         RETURNING id`,
        ["test/aios-152.md", `sha-${"0".repeat(60)}`],
      );
      const sourceId = src.rows[0].id;

      const insertChunk = (idx, content, vec) =>
        client.query(
          `INSERT INTO memory_chunks
             (source_id, visibility, chunk_index, content, source_path, source_type,
              embedding, embedding_model, embedding_dim)
           VALUES ($1, 'system', $2, $3, 'test/aios-152.md', 'memory',
                   $4::vector, 'test-unit', $5)`,
          [sourceId, idx, content, embedding.toVectorLiteral(vec), dim],
        );
      await insertChunk(0, "alpha chunk", unit(0));
      await insertChunk(1, "beta chunk", unit(1));

      const search = await client.query(
        `SELECT content, (embedding <=> $1::vector) AS distance
           FROM memory_chunks
          WHERE visibility = 'system' AND embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT 2`,
        [embedding.toVectorLiteral(queryVec)],
      );
      assert.equal(search.rows.length, 2);
      assert.equal(search.rows[0].content, "alpha chunk", "nearest chunk should be A");
      assert.ok(
        Number(search.rows[0].distance) < Number(search.rows[1].distance),
        "cosine distances must be ordered ascending",
      );

      // 5) The migration is idempotent.
      const again = await migrate.applyMigrations(client, { embedDim: dim });
      assert.equal(again.applied.length, 0, "re-running applies nothing");
    } finally {
      await close();
    }
  },
);

// ---------------------------------------------------------------------------
// The SAME store interface, selected onto hosted Postgres.
// The same index/search logic works with local and hosted backends:
// openMemoryStore({ backend: "postgres" }) runs insertSource → insertChunk →
// vectorSearch against real Postgres, exactly as the PGLite store does.
// ---------------------------------------------------------------------------
test(
  "openMemoryStore(postgres): insertSource → insertChunk → vectorSearch round-trip",
  { skip: TEST_URL ? false : "set TEST_DATABASE_URL to run against a real Postgres" },
  async () => {
    const dim = migrate.DEFAULT_EMBED_DIM;
    const unit = (i) => {
      const v = new Array(dim).fill(0);
      v[i] = 1;
      return v;
    };

    // Clean slate so this test is independent of run order.
    const raw = await adapter.openPostgres(TEST_URL);
    try {
      await resetPostgresDatabase(raw.client);
    } finally {
      await raw.close();
    }

    const s = await store.openMemoryStore({ backend: "postgres", connectionString: TEST_URL });
    try {
      assert.equal(s.embedDim, dim, "default embedDim baked into the schema");

      const sys = { teamId: null, clientId: null, userId: null, visibility: "system" };
      const src = await s.insertSource({
        scope: sys,
        sourcePath: "context/MEMORY.md",
        sourceType: "memory",
        contentSha256: "sha-154",
      });
      assert.match(src.id, /^[0-9a-f-]{36}$/);

      await s.insertChunk({
        sourceId: src.id, sourceScope: sys, chunkScope: sys, chunkIndex: 0,
        content: "alpha", sourcePath: src.sourcePath, sourceType: "memory",
        embedding: unit(0), embeddingModel: "test-unit",
      });
      await s.insertChunk({
        sourceId: src.id, sourceScope: sys, chunkScope: sys, chunkIndex: 1,
        content: "beta", sourcePath: src.sourcePath, sourceType: "memory",
        embedding: unit(1), embeddingModel: "test-unit",
      });

      const queryVec = new Array(dim).fill(0);
      queryVec[0] = 0.9;
      queryVec[1] = 0.1;

      const hits = await s.vectorSearch({ teamId: null, include: ["system"] }, queryVec, 2);
      assert.equal(hits.length, 2);
      assert.equal(hits[0].content, "alpha", "nearest chunk should be alpha");
      assert.ok(hits[0].distance <= hits[1].distance, "cosine distances ascending");
    } finally {
      await s.close();
    }
  },
);

// ---------------------------------------------------------------------------
// Pooled serving for the hosted memory API: migrations run on a dedicated
// single connection, then the SAME store interface serves through a pg.Pool
// (concurrent single-statement queries, no pinned-connection fragility).
// ---------------------------------------------------------------------------
test(
  "openMemoryStore(postgres, pool): migrate-then-pool round-trip with concurrent queries",
  { skip: TEST_URL ? false : "set TEST_DATABASE_URL to run against a real Postgres" },
  async () => {
    const dim = migrate.DEFAULT_EMBED_DIM;
    const unit = (i) => {
      const v = new Array(dim).fill(0);
      v[i] = 1;
      return v;
    };

    // Clean slate so this test is independent of run order.
    const raw = await adapter.openPostgres(TEST_URL);
    try {
      await resetPostgresDatabase(raw.client);
    } finally {
      await raw.close();
    }

    const s = await store.openMemoryStore({
      backend: "postgres",
      connectionString: TEST_URL,
      pool: true,
    });
    try {
      const sys = { teamId: null, clientId: null, userId: null, visibility: "system" };
      const src = await s.insertSource({
        scope: sys,
        sourcePath: "context/MEMORY.md",
        sourceType: "memory",
        contentSha256: "sha-153-pool",
      });

      // Concurrent inserts — the pool serves them in parallel.
      await Promise.all([
        s.insertChunk({
          sourceId: src.id, sourceScope: sys, chunkScope: sys, chunkIndex: 0,
          content: "alpha", sourcePath: src.sourcePath, sourceType: "memory",
          embedding: unit(0), embeddingModel: "test-unit",
        }),
        s.insertChunk({
          sourceId: src.id, sourceScope: sys, chunkScope: sys, chunkIndex: 1,
          content: "beta", sourcePath: src.sourcePath, sourceType: "memory",
          embedding: unit(1), embeddingModel: "test-unit",
        }),
      ]);

      const queryVec = new Array(dim).fill(0);
      queryVec[0] = 0.9;
      queryVec[1] = 0.1;
      const hits = await s.vectorSearch({ teamId: null, include: ["system"] }, queryVec, 2);
      assert.equal(hits.length, 2);
      assert.equal(hits[0].content, "alpha");

      // The pooled client refuses migration-style transaction control.
      await assert.rejects(() => s.client.exec("BEGIN"), /dedicated single connection/);
    } finally {
      await s.close();
    }
  },
);
