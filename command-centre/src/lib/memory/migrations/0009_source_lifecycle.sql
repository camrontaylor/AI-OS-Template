-- ============================================================================
-- Team OS Phase 3 — source status lifecycle
--
-- The memory source row is the stable UI/API entity. Index jobs are the work
-- trail, but future screens need to know whether a source itself is pending,
-- indexing, indexed, failed, or archived.
-- ============================================================================

ALTER TABLE memory_sources
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'indexed';

ALTER TABLE memory_sources
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE memory_sources
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz;

ALTER TABLE memory_sources
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE memory_sources DROP CONSTRAINT IF EXISTS memory_sources_status_chk;
ALTER TABLE memory_sources DROP CONSTRAINT IF EXISTS memory_sources_status_check;

ALTER TABLE memory_sources
  ADD CONSTRAINT memory_sources_status_chk CHECK (
    status IN ('pending', 'indexing', 'indexed', 'failed', 'archived')
  );

CREATE INDEX IF NOT EXISTS idx_memory_sources_status_updated
  ON memory_sources (team_id, status, updated_at DESC);
