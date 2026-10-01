-- ============================================================================
-- Team OS secret management
--
-- Stores shared API keys as encrypted values with key-level grants. Better Auth
-- remains the authentication layer; these tables are the Team OS secret store.
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  client_id uuid NULL REFERENCES clients(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('team', 'client')),
  name text NOT NULL,
  env_key text NOT NULL,
  encrypted_value text NOT NULL,
  encryption_key_id text NOT NULL,
  nonce text NOT NULL,
  auth_tag text NOT NULL,
  value_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (name <> ''),
  CHECK (env_key ~ '^[A-Z_][A-Z0-9_]*$'),
  CHECK ((scope = 'team' AND client_id IS NULL) OR (scope = 'client' AND client_id IS NOT NULL)),
  CHECK ((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_secrets_active_scope_key
  ON team_secrets (
    team_id,
    scope,
    env_key,
    COALESCE(client_id::text, '')
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_team_secrets_lookup
  ON team_secrets (team_id, client_id, status, env_key);

CREATE TABLE IF NOT EXISTS secret_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  secret_id uuid NOT NULL REFERENCES team_secrets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access text NOT NULL DEFAULT 'read' CHECK (access IN ('read')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  granted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_secret_grants_active
  ON secret_grants (team_id, secret_id, user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_secret_grants_lookup
  ON secret_grants (team_id, secret_id, user_id, status);

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
