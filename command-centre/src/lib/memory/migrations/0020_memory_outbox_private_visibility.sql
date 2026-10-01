-- ============================================================================
-- AIOS Memory Schema — migration 0020 (outbox private visibility)
--
-- The offline sync outbox only allowed team/client visibility, which forced
-- an explicit private capture to be silently coerced to team scope whenever
-- the Team OS API was unreachable. The outbox lives in the user's own local
-- store, so queuing a private ingest item here carries no sharing risk.
-- ============================================================================

ALTER TABLE memory_sync_outbox DROP CONSTRAINT IF EXISTS memory_sync_outbox_visibility_check;
ALTER TABLE memory_sync_outbox DROP CONSTRAINT IF EXISTS memory_sync_outbox_visibility_chk;
ALTER TABLE memory_sync_outbox DROP CONSTRAINT IF EXISTS memory_sync_outbox_scope_chk;

ALTER TABLE memory_sync_outbox
  ADD CONSTRAINT memory_sync_outbox_visibility_chk CHECK (
    visibility IN ('team', 'client', 'private')
  );

ALTER TABLE memory_sync_outbox
  ADD CONSTRAINT memory_sync_outbox_scope_chk CHECK (
    (visibility = 'team' AND team_id IS NOT NULL AND client_id IS NULL) OR
    (visibility = 'client' AND team_id IS NOT NULL AND client_id IS NOT NULL) OR
    (visibility = 'private' AND team_id IS NOT NULL AND client_id IS NULL)
  );
