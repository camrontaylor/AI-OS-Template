-- ============================================================================
-- Team OS context documents
--
-- Stores the Markdown context layers used by Team OS. The server owns scope
-- resolution, so local machines only receive already-filtered snapshots.
-- ============================================================================

CREATE TABLE IF NOT EXISTS context_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NULL REFERENCES teams(id) ON DELETE CASCADE,
  client_id uuid NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('system', 'team', 'client', 'private')),
  path text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('agents', 'user', 'brand', 'memory', 'learnings', 'preferences', 'other')),
  content text NOT NULL,
  content_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (path <> ''),
  CHECK (content_sha256 <> ''),
  CHECK (
    (visibility = 'private' AND user_id IS NOT NULL)
    OR (visibility = 'client' AND client_id IS NOT NULL)
    OR (visibility = 'team' AND team_id IS NOT NULL)
    OR visibility = 'system'
  )
);

CREATE TABLE IF NOT EXISTS context_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES context_documents(id) ON DELETE CASCADE,
  content_sha256 text NOT NULL,
  content text NOT NULL,
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (content_sha256 <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS context_documents_active_scope_path_idx
  ON context_documents (
    visibility,
    path,
    COALESCE(team_id::text, ''),
    COALESCE(client_id::text, ''),
    COALESCE(user_id::text, '')
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS context_documents_team_visibility_idx
  ON context_documents (team_id, visibility, status, path);

CREATE INDEX IF NOT EXISTS context_documents_client_visibility_idx
  ON context_documents (client_id, visibility, status, path);

CREATE INDEX IF NOT EXISTS context_documents_user_visibility_idx
  ON context_documents (user_id, visibility, status, path);

CREATE INDEX IF NOT EXISTS context_document_versions_document_idx
  ON context_document_versions (document_id, created_at DESC);

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
