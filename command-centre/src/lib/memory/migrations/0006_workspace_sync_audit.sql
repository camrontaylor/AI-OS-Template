-- Extend Team OS audit actions for permission-scoped workspace sync.

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
