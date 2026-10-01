-- ============================================================================
-- Team OS memory offline outbox
--
-- Local Team OS memory writes can be queued here when the hosted API is
-- unavailable, then drained later once the API is reachable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_sync_outbox (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  operation         text        NOT NULL
                    CHECK (operation IN ('capture_create', 'ingest', 'manual_import')),
  dedupe_key        text        NOT NULL,

  team_id           text        NOT NULL,
  client_id         text,
  actor_user_id     text        NOT NULL,
  visibility        text        NOT NULL
                    CHECK (visibility IN ('team', 'client')),

  source_path       text,
  source_hash       text,
  content_sha256    text,

  request_method    text        NOT NULL DEFAULT 'POST',
  request_path      text        NOT NULL,
  request_body      jsonb       NOT NULL,

  status            text        NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'syncing', 'failed')),
  attempts          integer     NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  last_error        text,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT memory_sync_outbox_scope_chk CHECK (
    (visibility = 'team' AND team_id IS NOT NULL AND client_id IS NULL) OR
    (visibility = 'client' AND team_id IS NOT NULL AND client_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_sync_outbox_dedupe
  ON memory_sync_outbox (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_memory_sync_outbox_team_status
  ON memory_sync_outbox (team_id, actor_user_id, status, next_attempt_at, created_at);
