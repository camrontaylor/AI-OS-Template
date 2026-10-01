-- ============================================================================
-- AIOS Team OS Phase 1 adjustments
--
-- Adds per-skill grants and extends the audit vocabulary for denied invite/join
-- paths and skill grant changes. This migration is additive so installs that
-- already applied 0004_team_platform can move forward without rebuilding.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SKILL_GRANTS - per-user access to one skill within one team.
--
-- Permissions are intentionally explicit. No team membership, invite, or client
-- grant implies skill access; the backend must check this table separately.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_grants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  skill_name  text        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  text        NOT NULL
              CHECK (permission IN ('skill.use', 'skill.read', 'skill.edit', 'skill.admin')),
  status      text        NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'revoked')),
  granted_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT skill_grants_revoked_chk CHECK (
    (status = 'active'  AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_grants_active
  ON skill_grants (team_id, skill_name, user_id, permission)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_skill_grants_lookup
  ON skill_grants (team_id, skill_name, user_id, status);

-- ----------------------------------------------------------------------------
-- Extend audit_events action / target check constraints.
-- 0004 created unnamed CHECK constraints, which PostgreSQL/PGLite name by the
-- table_column_check convention.
-- ----------------------------------------------------------------------------
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_target_type_check;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_chk;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_target_type_chk;

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

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_target_type_chk CHECK (target_type IN (
    'user', 'membership', 'client', 'skill', 'grant', 'skill_grant',
    'secret', 'secret_grant', 'user_config_file',
    'workstation', 'team', 'memory_source', 'manual_import',
    'context_document'
  ));
