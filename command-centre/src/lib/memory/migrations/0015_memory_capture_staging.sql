-- ============================================================================
-- Team OS memory capture staging + provenance
--
-- Automatic session captures should not become shared recall memory immediately.
-- They first land here as raw/staged events with explicit authorship. A later
-- consolidation step publishes durable items into memory_sources and links them
-- back through memory_source_provenance.
-- ============================================================================

ALTER TABLE memory_sources
  ADD COLUMN IF NOT EXISTS created_by_user_id text;

CREATE INDEX IF NOT EXISTS idx_memory_sources_created_by
  ON memory_sources (team_id, created_by_user_id, updated_at DESC);

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_chk;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_action_chk CHECK (action IN (
    'membership.invited', 'membership.joined', 'membership.role_changed',
    'membership.suspended', 'membership.removed',
    'membership.invite_denied', 'membership.join_denied',
    'grant.granted', 'grant.revoked',
    'skill.granted', 'skill.revoked',
    'secret.created', 'secret.updated', 'secret.archived',
    'secret.granted', 'secret.revoked', 'secret.synced',
    'config.synced',
    'workstation.registered', 'workstation.revoked',
    'client.created', 'client.archived',
    'access.denied_use', 'access.denied_read', 'access.denied_edit',
    'access.denied_search', 'access.denied_ingest',
    'sync.pull', 'sync.push', 'sync.denied', 'sync.conflict',
    'memory.imported', 'memory.published', 'memory.retry',
    'memory.failed', 'memory.reindexed',
    'memory.captured', 'memory.consolidation_claimed', 'memory.review_requested',
    'context.read', 'context.write', 'context.denied',
    'context.conflict', 'context.archived'
  ));

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_target_type_check;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_target_type_chk;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_target_type_chk CHECK (target_type IN (
    'user', 'membership', 'client', 'skill', 'grant', 'skill_grant',
    'secret', 'secret_grant', 'user_config_file',
    'workstation', 'team', 'memory_source', 'manual_import',
    'memory_capture', 'memory_consolidation_batch',
    'context_document'
  ));

CREATE TABLE IF NOT EXISTS memory_consolidation_batches (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  team_id             text        NOT NULL,
  client_id           text,
  visibility          text        NOT NULL
                      CHECK (visibility IN ('team', 'client')),

  status              text        NOT NULL DEFAULT 'claimed'
                      CHECK (status IN ('claimed', 'completed', 'failed', 'review')),
  claimed_by_user_id  text,
  claim_token         text        NOT NULL,
  capture_count       integer     NOT NULL DEFAULT 0,
  error_message       text,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,
  completed_at        timestamptz,

  CONSTRAINT memory_consolidation_batches_scope_chk CHECK (
    (visibility = 'team' AND team_id IS NOT NULL AND client_id IS NULL) OR
    (visibility = 'client' AND team_id IS NOT NULL AND client_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_consolidation_batches_claim_token
  ON memory_consolidation_batches (claim_token);

CREATE INDEX IF NOT EXISTS idx_memory_consolidation_batches_team_status
  ON memory_consolidation_batches (team_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_capture_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  team_id             text        NOT NULL,
  client_id           text,
  actor_user_id       text        NOT NULL,
  visibility          text        NOT NULL
                      CHECK (visibility IN ('team', 'client')),

  session_id          text        NOT NULL,
  source_hash         text        NOT NULL,
  source_path         text,
  source_type         text        NOT NULL DEFAULT 'session'
                      CHECK (source_type IN ('memory', 'learnings', 'brand', 'transcript', 'session', 'other')),
  title               text,
  content_date        date,
  content             text        NOT NULL,
  content_sha256      text        NOT NULL,
  byte_size           integer,

  status              text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'claimed', 'processed', 'review', 'failed', 'redacted')),
  sync_status         text        NOT NULL DEFAULT 'synced'
                      CHECK (sync_status IN ('local_pending', 'synced', 'sync_failed')),
  eligible_after      timestamptz NOT NULL DEFAULT (now() + interval '20 minutes'),
  claimed_batch_id    uuid        REFERENCES memory_consolidation_batches(id) ON DELETE SET NULL,
  processed_at        timestamptz,
  redacted_at         timestamptz,
  error_message       text,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT memory_capture_events_scope_chk CHECK (
    (visibility = 'team' AND team_id IS NOT NULL AND client_id IS NULL) OR
    (visibility = 'client' AND team_id IS NOT NULL AND client_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_capture_events_source_hash
  ON memory_capture_events (
    team_id,
    COALESCE(client_id, ''),
    actor_user_id,
    session_id,
    source_hash
  );

CREATE INDEX IF NOT EXISTS idx_memory_capture_events_team_status
  ON memory_capture_events (team_id, status, sync_status, eligible_after);

CREATE INDEX IF NOT EXISTS idx_memory_capture_events_actor
  ON memory_capture_events (team_id, actor_user_id, created_at DESC);

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
