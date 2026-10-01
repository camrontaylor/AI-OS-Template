-- ============================================================================
-- AIOS Memory Schema — migration 0002 (chunk provenance)
--
-- Adds stable chunk identity and source line metadata while keeping existing
-- databases readable. Existing chunks get NULL values until a reindex rebuilds
-- them from source files.
-- ============================================================================

ALTER TABLE memory_chunks
  ADD COLUMN IF NOT EXISTS start_line integer,
  ADD COLUMN IF NOT EXISTS end_line integer,
  ADD COLUMN IF NOT EXISTS heading_level smallint,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS chunk_key text;

-- Chunks are now stable-keyed. Keep chunk_index for ordered display, but allow
-- a changed source to insert replacement chunks before stale old keys are pruned.
ALTER TABLE memory_chunks
  DROP CONSTRAINT IF EXISTS uq_memory_chunks_source_idx;

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_chunks_source_chunk_key
  ON memory_chunks (source_id, chunk_key)
  WHERE chunk_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_order
  ON memory_chunks (source_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_chunk_key
  ON memory_chunks (chunk_key)
  WHERE chunk_key IS NOT NULL;
