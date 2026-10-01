-- ============================================================================
-- Team OS auth sessions
--
-- Stores user-scoped Team API tokens outside the shared dev-token path. Tokens
-- are hashed before storage, can expire, and resolve to a concrete user/team
-- principal for every protected Team API request.
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_api_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     text        NOT NULL,
  auth_source    text        NOT NULL
                 CHECK (auth_source IN ('browser-session', 'cli-device-token', 'api-key')),
  status         text        NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'revoked')),
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz,
  revoked_at     timestamptz,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT team_api_sessions_revoked_chk CHECK (
    (status = 'active'  AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_api_sessions_token_hash
  ON team_api_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_team_api_sessions_lookup
  ON team_api_sessions (team_id, user_id, status, expires_at);
