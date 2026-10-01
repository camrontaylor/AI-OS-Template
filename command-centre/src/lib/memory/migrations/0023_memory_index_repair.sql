-- ============================================================================
-- Current memory index schema repair
--
-- This migration is the canonical, idempotent definition of the rebuildable
-- memory index. memory-reset executes this exact file after dropping only the
-- derived index tables, so a reset cannot replay old Team OS audit constraints.
--
-- Keep this migration additive when it runs normally. In particular, do not
-- drop or rewrite search_events, manual_imports, capture staging, outbox,
-- identity, or audit data.
--
-- IMPORTANT FOR MIGRATION 0024 OR LATER: memory-reset requires its canonical
-- repair migration to be the final migration. After any new migration, add a
-- new final, idempotent repair migration containing the complete definition of
-- every rebuildable table; update MEMORY_REPAIR_VERSION and MEMORY_REPAIR_NAME
-- in memory-reset.cjs; and update catalog snapshots, validation, and reset
-- tests. The reset deliberately refuses to replay later migrations.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Durable manual imports are not reset. CREATE IF NOT EXISTS also repairs
-- installations affected by the legacy reset that removed migration 0008.
CREATE TABLE IF NOT EXISTS manual_imports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  team_id           text,
  client_id         text,
  user_id           text,
  visibility        text        NOT NULL
                    CHECK (visibility IN ('private', 'client', 'team', 'system')),

  actor_user_id     text,

  source_path       text        NOT NULL,
  source_type       text        NOT NULL DEFAULT 'other'
                    CHECK (source_type IN ('memory', 'learnings', 'brand', 'transcript', 'session', 'other')),
  title             text,
  content_date      date,
  authority_weight  real,
  content           text        NOT NULL,
  content_sha256    text        NOT NULL,

  status            text        NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'indexing', 'indexed', 'failed', 'skipped')),
  attempts          integer     NOT NULL DEFAULT 0,
  source_id         uuid,
  error_message     text,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  indexed_at        timestamptz,

  CONSTRAINT manual_imports_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  )
);

CREATE INDEX IF NOT EXISTS idx_manual_imports_team_status
  ON manual_imports (team_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_manual_imports_source_path
  ON manual_imports (team_id, source_path);

CREATE TABLE IF NOT EXISTS memory_sources (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  team_id             text,
  client_id           text,
  user_id             text,
  visibility          text        NOT NULL DEFAULT 'system'
                      CHECK (visibility IN ('private', 'client', 'team', 'system')),

  source_path         text        NOT NULL,
  source_type         text        NOT NULL
                      CHECK (source_type IN ('memory', 'learnings', 'brand', 'transcript', 'session', 'other')),
  title               text,
  content_date        date,
  authority_weight    real        NOT NULL DEFAULT 1.0,
  content_sha256      text        NOT NULL,

  byte_size           integer,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  status              text        NOT NULL DEFAULT 'indexed',
  error_message       text,
  indexed_at          timestamptz,
  archived_at         timestamptz,
  created_by_user_id  text,

  CONSTRAINT memory_sources_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  ),
  CONSTRAINT memory_sources_status_chk CHECK (
    status IN ('pending', 'indexing', 'indexed', 'failed', 'archived')
  )
);

-- Add columns introduced after 0001 when repairing an existing older table.
ALTER TABLE memory_sources
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'indexed',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_user_id text;

ALTER TABLE memory_sources DROP CONSTRAINT IF EXISTS memory_sources_scope_chk;
ALTER TABLE memory_sources
  ADD CONSTRAINT memory_sources_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  );

ALTER TABLE memory_sources DROP CONSTRAINT IF EXISTS memory_sources_status_check;
ALTER TABLE memory_sources DROP CONSTRAINT IF EXISTS memory_sources_status_chk;
ALTER TABLE memory_sources
  ADD CONSTRAINT memory_sources_status_chk CHECK (
    status IN ('pending', 'indexing', 'indexed', 'failed', 'archived')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_sources_scope_path
  ON memory_sources (
    source_path,
    visibility,
    COALESCE(team_id, ''),
    COALESCE(client_id, ''),
    COALESCE(user_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_memory_sources_status_updated
  ON memory_sources (team_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_sources_created_by
  ON memory_sources (team_id, created_by_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         uuid        NOT NULL REFERENCES memory_sources(id) ON DELETE CASCADE,

  team_id           text,
  client_id         text,
  user_id           text,
  visibility        text        NOT NULL
                    CHECK (visibility IN ('private', 'client', 'team', 'system')),

  chunk_index       integer     NOT NULL,
  content           text        NOT NULL,
  heading           text,
  token_count       integer,

  source_path       text        NOT NULL,
  source_type       text        NOT NULL,
  content_date      date,
  authority_weight  real        NOT NULL DEFAULT 1.0,

  embedding         vector(:EMBED_DIM),
  embedding_model   text,
  embedding_dim     smallint,

  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),

  start_line        integer,
  end_line          integer,
  heading_level     smallint,
  content_hash      text,
  chunk_key         text,
  content_tsv       tsvector
                    GENERATED ALWAYS AS (
                      setweight(to_tsvector('simple', coalesce(heading, '')), 'A') ||
                      setweight(to_tsvector('simple', coalesce(source_path, '')), 'B') ||
                      setweight(to_tsvector('simple', content), 'C')
                    ) STORED,

  CONSTRAINT memory_chunks_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  )
);

ALTER TABLE memory_chunks
  ADD COLUMN IF NOT EXISTS start_line integer,
  ADD COLUMN IF NOT EXISTS end_line integer,
  ADD COLUMN IF NOT EXISTS heading_level smallint,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS chunk_key text,
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(heading, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(source_path, '')), 'B') ||
      setweight(to_tsvector('simple', content), 'C')
    ) STORED;

ALTER TABLE memory_chunks DROP CONSTRAINT IF EXISTS uq_memory_chunks_source_idx;
ALTER TABLE memory_chunks DROP CONSTRAINT IF EXISTS memory_chunks_scope_chk;
ALTER TABLE memory_chunks
  ADD CONSTRAINT memory_chunks_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  );

CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding_hnsw
  ON memory_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_scope
  ON memory_chunks (team_id, visibility, client_id, user_id);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_id
  ON memory_chunks (source_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_chunks_source_chunk_key
  ON memory_chunks (source_id, chunk_key)
  WHERE chunk_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_order
  ON memory_chunks (source_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_chunk_key
  ON memory_chunks (chunk_key)
  WHERE chunk_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_chunks_content_tsv
  ON memory_chunks USING gin (content_tsv);

CREATE TABLE IF NOT EXISTS index_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  team_id         text,
  client_id       text,
  user_id         text,
  visibility      text        NOT NULL
                  CHECK (visibility IN ('private', 'client', 'team', 'system')),

  source_path     text        NOT NULL,
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

ALTER TABLE index_jobs DROP CONSTRAINT IF EXISTS index_jobs_scope_chk;
ALTER TABLE index_jobs
  ADD CONSTRAINT index_jobs_scope_chk CHECK (
    (visibility = 'private' AND user_id   IS NOT NULL) OR
    (visibility = 'client'  AND client_id IS NOT NULL) OR
    (visibility = 'team'    AND team_id   IS NOT NULL) OR
    (visibility = 'system')
  );

CREATE INDEX IF NOT EXISTS idx_index_jobs_status_enqueued
  ON index_jobs (status, enqueued_at);

CREATE TABLE IF NOT EXISTS memory_source_provenance (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           uuid        NOT NULL REFERENCES memory_sources(id) ON DELETE CASCADE,
  capture_event_id    uuid        NOT NULL REFERENCES memory_capture_events(id) ON DELETE CASCADE,

  team_id             text        NOT NULL,
  client_id           text,
  actor_user_id       text,
  contribution_kind   text        NOT NULL DEFAULT 'capture'
                      CHECK (contribution_kind IN ('capture', 'review', 'manual')),
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_source_provenance_source_capture
  ON memory_source_provenance (source_id, capture_event_id);

CREATE INDEX IF NOT EXISTS idx_memory_source_provenance_team_source
  ON memory_source_provenance (team_id, source_id);

-- Search telemetry is durable and therefore never dropped by memory-reset.
-- CREATE IF NOT EXISTS repairs legacy resets that removed migration 0001's
-- table, while leaving every existing search event untouched.
CREATE TABLE IF NOT EXISTS search_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  team_id           text,
  client_id         text,
  user_id           text,
  visibility_set    text[]      NOT NULL,

  query_text        text,
  query_embedding   vector(:EMBED_DIM),
  top_k             integer     NOT NULL DEFAULT 10,
  result_count      integer     NOT NULL DEFAULT 0,
  result_chunk_ids  uuid[]      NOT NULL DEFAULT '{}',
  latency_ms        integer,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_events_team_created
  ON search_events (team_id, created_at);
