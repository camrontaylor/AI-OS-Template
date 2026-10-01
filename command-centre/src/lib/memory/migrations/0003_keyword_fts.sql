-- ============================================================================
-- AIOS Memory Schema — migration 0003 (keyword full-text search)
--
-- Upgrades the keyword leg of hybrid search from an unindexed ILIKE substring
-- scan to Postgres full-text search: a generated tsvector column + GIN index,
-- ranked with ts_rank_cd. Uses the 'simple' text-search config (lowercasing +
-- tokenizing, no stemming) rather than 'english' so it doesn't mis-stem
-- multilingual content — the embedder (BGE-M3) is multilingual, and the
-- keyword leg should match that, not assume English.
--
-- Additive only, like 0002: existing rows backfill content_tsv automatically
-- (STORED generated columns are computed on write; Postgres backfills them for
-- existing rows when the column is added).
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
