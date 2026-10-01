-- ============================================================================
-- Per-user encrypted config file backups
--
-- V1 stores .mcp.json as a private encrypted backup. It is never context and
-- never enters snapshots or memory indexing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_config_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path text NOT NULL,
  encrypted_value text NOT NULL,
  encryption_key_id text NOT NULL,
  nonce text NOT NULL,
  auth_tag text NOT NULL,
  value_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (path <> ''),
  CHECK (path NOT LIKE '/%'),
  CHECK (path NOT LIKE '%..%'),
  CHECK ((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_config_files_active_path
  ON user_config_files (team_id, user_id, path)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_config_files_lookup
  ON user_config_files (team_id, user_id, status, path);

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
    'context_document'
  ));
