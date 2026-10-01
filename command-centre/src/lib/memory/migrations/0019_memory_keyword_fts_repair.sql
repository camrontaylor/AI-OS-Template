-- ============================================================================
-- AIOS Memory Schema — migration 0019 (keyword FTS repair)
--
-- Some hosted databases may have the 0003 migration recorded before the
-- content_tsv generated column existed. Keep this additive and idempotent so a
-- normal memory:migrate run repairs those databases without touching data.
-- ============================================================================

ALTER TABLE memory_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(source_path, '')), 'B') ||
    setweight(to_tsvector('simple', content), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_memory_chunks_content_tsv
  ON memory_chunks USING gin (content_tsv);
