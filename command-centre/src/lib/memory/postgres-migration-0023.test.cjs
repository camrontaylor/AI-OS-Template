"use strict";
/**
 * Real-Postgres coverage for migration 0023.
 *
 * This test intentionally starts with the complete v22 schema and owned data,
 * then applies 0023 on a disposable pgvector database. It proves the repair is
 * additive, restores the canonical constraints/indexes, and remains safe when
 * its SQL has to be re-applied.
 *
 * WARNING: this test drops and recreates the public schema. TEST_DATABASE_URL
 * must point to a throwaway database owned by the test runner.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const resolve = (file) => path.join(__dirname, file);
const migrate = loadTsModule(resolve("migrate.ts"));
const adapter = loadTsModule(resolve("postgres-adapter.ts"));

const RUN_PG_TESTS =
  process.env.MEMORY_PG_TESTS === "1" ||
  process.env.npm_lifecycle_event === "test:memory:pg";
const TEST_URL = RUN_PG_TESTS ? process.env.TEST_DATABASE_URL : "";

const EMBED_DIM = 384;
const OWNER_ID = "user-v22-owner";

async function resetPostgresDatabase(client) {
  await client.exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
}

async function countById(client, table, id) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE id = $1`,
    [id],
  );
  return Number(rows[0].count);
}

test(
  "migration 0023 upgrades a populated v22 schema without losing data or ownership",
  { skip: TEST_URL ? false : "set TEST_DATABASE_URL to run against a real Postgres" },
  async () => {
    const { client, close } = await adapter.openPostgres(TEST_URL);
    try {
      await resetPostgresDatabase(client);

      const allMigrations = migrate.loadMigrationsFromDir(migrate.resolveMigrationsDir());
      const throughV22 = allMigrations.filter((migration) => migration.version <= 22);
      assert.equal(throughV22.at(-1).version, 22, "the fixture must stop at schema v22");

      const initial = await migrate.applyMigrations(client, {
        embedDim: EMBED_DIM,
        migrations: throughV22,
      });
      assert.equal(initial.to, 22);

      const source = await client.query(
        `INSERT INTO memory_sources
           (user_id, visibility, source_path, source_type, title, content_sha256,
            status, created_by_user_id, metadata)
         VALUES ($1, 'private', 'context/memory/v22-private.md', 'memory',
                 'Private v22 memory', 'sha-v22-private', 'indexed', $1,
                 '{"fixture":"v22"}'::jsonb)
         RETURNING id`,
        [OWNER_ID],
      );
      const sourceId = source.rows[0].id;

      const vector = new Array(EMBED_DIM).fill(0);
      vector[0] = 1;
      const chunk = await client.query(
        `INSERT INTO memory_chunks
           (source_id, user_id, visibility, chunk_index, content, source_path,
            source_type, embedding, embedding_model, embedding_dim, chunk_key,
            content_hash, metadata)
         VALUES ($1, $2, 'private', 0, 'private memory survives migration 0023',
                 'context/memory/v22-private.md', 'memory', $3::vector,
                 'test-v22', $4, 'v22-private:0', 'chunk-sha-v22',
                 '{"fixture":"v22"}'::jsonb)
         RETURNING id`,
        [sourceId, OWNER_ID, `[${vector.join(",")}]`, EMBED_DIM],
      );
      const chunkId = chunk.rows[0].id;

      const job = await client.query(
        `INSERT INTO index_jobs
           (user_id, visibility, source_path, source_id, reason, status, payload)
         VALUES ($1, 'private', 'context/memory/v22-private.md', $2,
                 'backfill', 'succeeded', '{"fixture":"v22"}'::jsonb)
         RETURNING id`,
        [OWNER_ID, sourceId],
      );
      const jobId = job.rows[0].id;

      const manualImport = await client.query(
        `INSERT INTO manual_imports
           (user_id, visibility, actor_user_id, source_path, source_type, title,
            content, content_sha256, status, source_id, metadata)
         VALUES ($1, 'private', $1, 'imports/v22-private.md', 'other',
                 'Private import', 'durable import content', 'import-sha-v22',
                 'indexed', $2, '{"fixture":"v22"}'::jsonb)
         RETURNING id`,
        [OWNER_ID, sourceId],
      );
      const manualImportId = manualImport.rows[0].id;

      const searchEvent = await client.query(
        `INSERT INTO search_events
           (user_id, visibility_set, query_text, result_count, result_chunk_ids,
            metadata)
         VALUES ($1, ARRAY['private'], 'private v22 query', 1, ARRAY[$2::uuid],
                 '{"fixture":"v22"}'::jsonb)
         RETURNING id`,
        [OWNER_ID, chunkId],
      );
      const searchEventId = searchEvent.rows[0].id;

      const upgraded = await migrate.applyMigrations(client, {
        embedDim: EMBED_DIM,
        migrations: allMigrations,
      });
      assert.deepEqual(upgraded.applied, ["23_memory_index_repair"]);
      assert.equal(upgraded.from, 22);
      assert.equal(upgraded.to, 23);

      const ownedRows = await client.query(
        `SELECT s.user_id AS source_user_id,
                s.created_by_user_id,
                s.visibility AS source_visibility,
                c.user_id AS chunk_user_id,
                c.visibility AS chunk_visibility,
                c.content,
                c.content_tsv @@ plainto_tsquery('simple', 'private') AS keyword_match
           FROM memory_sources s
           JOIN memory_chunks c ON c.source_id = s.id
          WHERE s.id = $1 AND c.id = $2`,
        [sourceId, chunkId],
      );
      assert.deepEqual(ownedRows.rows, [
        {
          source_user_id: OWNER_ID,
          created_by_user_id: OWNER_ID,
          source_visibility: "private",
          chunk_user_id: OWNER_ID,
          chunk_visibility: "private",
          content: "private memory survives migration 0023",
          keyword_match: true,
        },
      ]);
      assert.equal(await countById(client, "index_jobs", jobId), 1);
      assert.equal(await countById(client, "manual_imports", manualImportId), 1);
      assert.equal(await countById(client, "search_events", searchEventId), 1);

      const { rows: indexes } = await client.query(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = ANY($1::text[])`,
        [[
          "uq_memory_sources_scope_path",
          "idx_memory_chunks_embedding_hnsw",
          "idx_memory_chunks_scope",
          "idx_memory_chunks_source_id",
          "uq_memory_chunks_source_chunk_key",
          "idx_memory_chunks_source_order",
          "idx_memory_chunks_chunk_key",
          "idx_memory_chunks_content_tsv",
          "idx_index_jobs_status_enqueued",
        ]],
      );
      assert.equal(indexes.length, 9, "all canonical memory indexes must exist");
      assert.match(
        indexes.find((row) => row.indexname === "idx_memory_chunks_embedding_hnsw").indexdef,
        /USING hnsw \(embedding vector_cosine_ops\)/,
      );

      const { rows: constraints } = await client.query(
        `SELECT conname
           FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace
            AND conname = ANY($1::text[])`,
        [[
          "memory_sources_scope_chk",
          "memory_sources_status_chk",
          "memory_chunks_scope_chk",
          "index_jobs_scope_chk",
        ]],
      );
      assert.equal(constraints.length, 4, "canonical ownership/status constraints must exist");

      await assert.rejects(
        () => client.query(
          `INSERT INTO memory_sources
             (visibility, source_path, source_type, content_sha256)
           VALUES ('private', 'invalid/no-owner.md', 'memory', 'invalid-no-owner')`,
        ),
        /memory_sources_scope_chk|violates check constraint/,
      );
      await assert.rejects(
        () => client.query(
          `INSERT INTO index_jobs (visibility, source_path)
           VALUES ('private', 'invalid/no-owner.md')`,
        ),
        /index_jobs_scope_chk|violates check constraint/,
      );
      await assert.rejects(
        () => client.query(
          `INSERT INTO memory_chunks
             (source_id, user_id, visibility, chunk_index, content, source_path,
              source_type, chunk_key)
           VALUES ($1, $2, 'private', 1, 'duplicate key', 'duplicate.md',
                   'memory', 'v22-private:0')`,
          [sourceId, OWNER_ID],
        ),
        /uq_memory_chunks_source_chunk_key|duplicate key/,
      );

      // Force the migration SQL to execute again, instead of merely testing
      // that the ledger skips it. The repair must remain additive on reapply.
      await client.query("DELETE FROM schema_migrations WHERE version = 23");
      const reapplied = await migrate.applyMigrations(client, {
        embedDim: EMBED_DIM,
        migrations: allMigrations,
      });
      assert.deepEqual(reapplied.applied, ["23_memory_index_repair"]);
      assert.equal(await countById(client, "memory_sources", sourceId), 1);
      assert.equal(await countById(client, "memory_chunks", chunkId), 1);
      assert.equal(await countById(client, "manual_imports", manualImportId), 1);
      assert.equal(await countById(client, "search_events", searchEventId), 1);

      const idempotent = await migrate.applyMigrations(client, {
        embedDim: EMBED_DIM,
        migrations: allMigrations,
      });
      assert.equal(idempotent.applied.length, 0, "a current ledger must be a no-op");
    } finally {
      await resetPostgresDatabase(client).catch(() => undefined);
      await close();
    }
  },
);
