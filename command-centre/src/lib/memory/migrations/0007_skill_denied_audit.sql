-- Extend Team OS audit actions for denied skill use/read/edit checks.

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
