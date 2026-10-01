-- ============================================================================
-- Team OS Phase 3 — manual shared content imports
--
-- Admin-triggered imports need their own durable record so a failed import can
-- be inspected and retried without recreating the original request body. The
-- actual indexing still goes through ingestContent and writes memory_sources,
-- memory_chunks, and index_jobs as before.
-- ============================================================================

CREATE TABLE IF NOT EXISTS manual_imports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Authorized scope that the import writes with.
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
