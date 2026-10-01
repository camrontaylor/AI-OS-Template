-- ============================================================================
-- AIOS Memory Schema — migration 0001 (init)
--
-- Phase 3 — Postgres-Compatible Memory Foundation.
-- Runs IDENTICALLY in local PGLite (Postgres-in-WASM) and hosted Postgres.
--
-- The single token `:EMBED_DIM` is substituted at bootstrap by migrate.ts
-- (default 1024). pgvector requires a fixed dimension at column-definition
-- time, so it cannot be a runtime variable — it is a build-time substitution.
--
-- Design notes & rationale live in docs/memory/memory-schema.md.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ----------------------------------------------------------------------------
-- SOURCES — one row per normalized source document (a file, a captured
-- session, etc.). Carries the four scope columns + reranking provenance.
--
-- Scope model:
--   private => user_id   NOT NULL
--   client  => client_id NOT NULL
--   team    => team_id   NOT NULL
--   system  => baseline within a tenant (no extra column required)
-- team_id is nullable: local single-tenant installs leave it NULL.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_sources (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope.
  team_id           text,                            -- NULL on local single-tenant installs
  client_id         text,
  user_id           text,
  visibility        text        NOT NULL DEFAULT 'system'
                    CHECK (visibility IN ('private', 'client', 'team', 'system')),

  -- Provenance / reranking metadata.
  source_path       text        NOT NULL,           -- repo-relative, e.g. context/learnings.md
  source_type       text        NOT NULL
                    CHECK (source_type IN ('memory', 'learnings', 'brand', 'transcript', 'session', 'other')),
  title             text,                            -- heading / display name for citations
  content_date      date,                            -- parsed YYYY-MM-DD (recency decay input)
  authority_weight  real        NOT NULL DEFAULT 1.0, -- snapshot of path-prefix weight (memory-config.json)
  content_sha256    text        NOT NULL,            -- dedup / change detection for re-index

  -- Bookkeeping.
  byte_size         integer,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Scope invariants (row-local, no subqueries — valid in PGLite and Postgres).
  CONSTRAINT memory_sources_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  )
);

-- Re-indexing the same file updates rather than duplicates. A source is unique
-- by its scope + path. COALESCE keeps NULL scope columns from defeating the
-- uniqueness (NULLs are distinct under a plain unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_sources_scope_path
  ON memory_sources (
    source_path,
    visibility,
    COALESCE(team_id, ''),
    COALESCE(client_id, ''),
    COALESCE(user_id, '')
  );

-- ----------------------------------------------------------------------------
-- CHUNKS — one row per embedded chunk. Scope + reranking metadata are
-- DENORMALIZED from the parent source so the vector search WHERE clause never
-- has to JOIN before filtering (critical for HNSW pre-filter performance and
-- for leak-proofing). scope.ts (assertChunkMatchesSource) keeps them in sync.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_chunks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         uuid        NOT NULL REFERENCES memory_sources(id) ON DELETE CASCADE,

  -- Denormalized scope (MUST equal the parent source's scope).
  team_id           text,
  client_id         text,
  user_id           text,
  visibility        text        NOT NULL
                    CHECK (visibility IN ('private', 'client', 'team', 'system')),

  -- Chunk content + position.
  chunk_index       integer     NOT NULL,           -- 0-based order within the source
  content           text        NOT NULL,           -- the chunk text (returned for citation)
  heading           text,                            -- section/heading for citation
  token_count       integer,

  -- Reranking metadata denormalized to avoid a join on the hot path.
  source_path       text        NOT NULL,
  source_type       text        NOT NULL,
  content_date      date,
  authority_weight  real        NOT NULL DEFAULT 1.0,

  -- The vector. Dimension fixed at bootstrap (default 1024). Nullable until embedded.
  embedding         vector(:EMBED_DIM),
  embedding_model   text,                            -- e.g. 'bge-m3'
  embedding_dim     smallint,                        -- redundant guard for audits

  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT memory_chunks_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  ),
  CONSTRAINT uq_memory_chunks_source_idx UNIQUE (source_id, chunk_index)
);

-- Vector index: HNSW + cosine. No training step (good recall on a cold/small
-- corpus — the local PGLite case). pgvector applies the scope WHERE as a
-- pre-filter during the HNSW scan. Embeddings MUST be L2-normalized at embed
-- time (contract for the indexer).
CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding_hnsw
  ON memory_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Scope-filter support for the search path. Btree indexes NULLs, so this
-- serves both `team_id = $1` and `team_id IS NULL` (local).
CREATE INDEX IF NOT EXISTS idx_memory_chunks_scope
  ON memory_chunks (team_id, visibility, client_id, user_id);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_id
  ON memory_chunks (source_id);

-- ----------------------------------------------------------------------------
-- INDEX JOBS — work queue for the indexer and capture hooks. Scope is REQUIRED
-- at enqueue time (explicit scope at indexing).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS index_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope the job will write with.
  team_id         text,
  client_id       text,
  user_id         text,
  visibility      text        NOT NULL
                  CHECK (visibility IN ('private', 'client', 'team', 'system')),

  source_path     text        NOT NULL,             -- file/dir the job will (re)index
  source_id       uuid        REFERENCES memory_sources(id) ON DELETE SET NULL,
  reason          text        NOT NULL DEFAULT 'manual'
                  CHECK (reason IN ('manual', 'file_change', 'session_capture', 'refresh', 'backfill')),

  status          text        NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempts        integer     NOT NULL DEFAULT 0,
  error_message   text,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,

  CONSTRAINT index_jobs_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  )
);

CREATE INDEX IF NOT EXISTS idx_index_jobs_status_enqueued
  ON index_jobs (status, enqueued_at);

-- ----------------------------------------------------------------------------
-- SEARCH EVENTS — telemetry / audit for every scoped search, and the artifact
-- the no-leak tests can assert against. query_text and query_embedding are
-- nullable for privacy (see docs/memory/memory-schema.md).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The scope the search was EXECUTED under (the filter that was applied).
  team_id           text,
  client_id         text,
  user_id           text,
  visibility_set    text[]      NOT NULL,            -- which visibilities were searched

  query_text        text,                            -- nullable for privacy
  query_embedding   vector(:EMBED_DIM),             -- nullable for privacy
  top_k             integer     NOT NULL DEFAULT 10,
  result_count      integer     NOT NULL DEFAULT 0,
  result_chunk_ids  uuid[]      NOT NULL DEFAULT '{}', -- for citation auditing
  latency_ms        integer,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_events_team_created
  ON search_events (team_id, created_at);
