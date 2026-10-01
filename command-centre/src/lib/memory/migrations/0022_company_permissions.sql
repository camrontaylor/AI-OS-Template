-- ============================================================================
-- Company-level roles, Team access, lifecycle, and durable company audit
--
-- One Team OS server is one company. Company roles therefore do not carry a
-- company_id: team_os_instance is the authority boundary. Team grants remain
-- explicit so an admin can have access to only selected Teams.
-- ============================================================================

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Older schemas already allowed status='archived' but did not record when it
-- happened. Treat the last Team update as the conservative archive timestamp.
UPDATE teams
SET archived_at = COALESCE(archived_at, updated_at, created_at, now())
WHERE status = 'archived' AND archived_at IS NULL;

UPDATE teams
SET archived_at = NULL, archived_by = NULL
WHERE status = 'active' AND (archived_at IS NOT NULL OR archived_by IS NOT NULL);

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_archive_state_chk;
ALTER TABLE teams
  ADD CONSTRAINT teams_archive_state_chk CHECK (
    (status = 'active' AND archived_at IS NULL AND archived_by IS NULL) OR
    (status = 'archived' AND archived_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_teams_status_archived_at
  ON teams (status, archived_at, id);
CREATE INDEX IF NOT EXISTS idx_teams_archived_by
  ON teams (archived_by)
  WHERE archived_by IS NOT NULL;

-- New writes normalize to lowercase. This expression index also protects
-- legacy mixed-case rows from a second slug that differs only by casing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_slug_lower
  ON teams (lower(slug));

CREATE TABLE IF NOT EXISTS company_memberships (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                text        NOT NULL
                      CHECK (role IN ('owner', 'admin')),
  status              text        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('invited', 'active', 'removed')),
  invited_by          uuid        REFERENCES users(id) ON DELETE SET NULL,
  invite_token_hash   text,
  invite_expires_at   timestamptz,
  accepted_at         timestamptz,
  removed_at          timestamptz,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_company_memberships_user UNIQUE (user_id),
  CONSTRAINT company_memberships_state_chk CHECK (
    (
      status = 'invited' AND
      role = 'admin' AND
      invite_token_hash IS NOT NULL AND
      invite_expires_at IS NOT NULL AND
      removed_at IS NULL
    ) OR (
      status = 'active' AND
      invite_token_hash IS NULL AND
      invite_expires_at IS NULL AND
      removed_at IS NULL
    ) OR (
      status = 'removed' AND
      role = 'admin' AND
      invite_token_hash IS NULL AND
      invite_expires_at IS NULL AND
      removed_at IS NOT NULL
    )
  )
);

-- At most one active Company Owner. The application owns the complementary
-- "at least one" invariant because recovery must remain possible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_memberships_active_owner
  ON company_memberships (role)
  WHERE role = 'owner' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_memberships_invite_token
  ON company_memberships (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_memberships_status_role
  ON company_memberships (status, role, created_at, id);
CREATE INDEX IF NOT EXISTS idx_company_memberships_invited_by
  ON company_memberships (invited_by)
  WHERE invited_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS company_team_access_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'denied', 'canceled')),
  reason         text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT company_team_access_requests_state_chk CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL) OR
    (status <> 'pending' AND resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_team_access_requests_pending
  ON company_team_access_requests (team_id, user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_company_team_access_requests_team_status
  ON company_team_access_requests (team_id, status, requested_at, id);
CREATE INDEX IF NOT EXISTS idx_company_team_access_requests_user_status
  ON company_team_access_requests (user_id, status, requested_at, id);
CREATE INDEX IF NOT EXISTS idx_company_team_access_requests_resolved_by
  ON company_team_access_requests (resolved_by)
  WHERE resolved_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS company_team_access_grants (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'revoked')),
  granted_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  revoked_at   timestamptz,
  metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT company_team_access_grants_state_chk CHECK (
    (status = 'active' AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_team_access_grants_active
  ON company_team_access_grants (team_id, user_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_company_team_access_grants_team_status
  ON company_team_access_grants (team_id, status, user_id);
CREATE INDEX IF NOT EXISTS idx_company_team_access_grants_user_status
  ON company_team_access_grants (user_id, status, team_id);
CREATE INDEX IF NOT EXISTS idx_company_team_access_grants_granted_by
  ON company_team_access_grants (granted_by)
  WHERE granted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_team_access_grants_revoked_by
  ON company_team_access_grants (revoked_by)
  WHERE revoked_by IS NOT NULL;

-- This table intentionally has no foreign keys to Teams or users. It is the
-- durable, minimal company trail that must survive permanent Team deletion.
CREATE TABLE IF NOT EXISTS company_audit_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid,
  action         text        NOT NULL CHECK (length(btrim(action)) > 0),
  target_type    text        NOT NULL CHECK (length(btrim(target_type)) > 0),
  target_id      uuid,
  team_id        uuid,
  summary        text,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_audit_events_created
  ON company_audit_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_company_audit_events_team_created
  ON company_audit_events (team_id, created_at DESC, id DESC)
  WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_audit_events_target
  ON company_audit_events (target_type, target_id, created_at DESC);

-- Deterministic genesis owner: oldest active Team Owner, then membership UUID.
-- If none exists, no row is fabricated; the recovery command owns that case.
INSERT INTO company_memberships (
  user_id,
  role,
  status,
  accepted_at,
  metadata,
  created_at,
  updated_at
)
SELECT
  memberships.user_id,
  'owner',
  'active',
  memberships.created_at,
  jsonb_build_object(
    'migratedFromMembershipId', memberships.id,
    'migratedFromTeamId', memberships.team_id
  ),
  memberships.created_at,
  now()
FROM memberships
JOIN users ON users.id = memberships.user_id AND users.status = 'active'
WHERE memberships.role = 'owner'
  AND memberships.status = 'active'
ORDER BY memberships.created_at ASC, memberships.id ASC
LIMIT 1
ON CONFLICT (user_id) DO NOTHING;
