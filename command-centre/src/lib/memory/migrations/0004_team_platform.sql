-- ============================================================================
-- AIOS Team Platform Schema — migration 0004 (team_platform)
--
-- Identity & access-control models for hosted team memory: users, teams,
-- memberships, clients, client grants, workstations, and audit events.
-- Lives in the SAME database as the memory store so the enforcement layer can
-- check grants in the same place it searches memory. Runs IDENTICALLY in local PGLite
-- (Postgres-in-WASM) and hosted Postgres, applied by migrate.ts after 0001.
--
-- No vector columns here, so the `:EMBED_DIM` token does not appear.
--
-- Conventions mirror 0001_init.sql: gen_random_uuid() uuid PKs, CHECK-constrained
-- text status/role columns, jsonb metadata, timestamptz, CREATE ... IF NOT EXISTS.
--
-- Type-bridge note: identity team/client ids are uuid here; the memory store's
-- memory_sources.team_id / client_id are text (folder slug / tenant text). The
-- enforcement layer bridges them — render teams.id::text, and resolve
-- a memory client slug to clients.id via the (team_id, slug) unique key below.
-- Do NOT join the uuid and text columns directly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- USERS — global identity. One human, many team memberships. Not team-scoped:
-- email is unique across the whole install (case-insensitive).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  display_name  text,
  status        text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'disabled')),
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- citext is unavailable in PGLite; enforce case-insensitive email uniqueness with
-- an expression index. upsertUser keys its ON CONFLICT on this same expression.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));

-- ----------------------------------------------------------------------------
-- TEAMS — the tenant boundary. A team owns clients, memberships, and grants.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL,
  name        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_slug ON teams (lower(slug));

-- ----------------------------------------------------------------------------
-- MEMBERSHIPS — user ↔ team with a role. The `invited`/`suspended` states give
-- the invite/join flow a state machine without a separate invites table; the
-- metadata bag holds a pending invite's hashed, expiring token until the member
-- joins (then it is cleared).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memberships (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text        NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member')),
  status      text        NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'invited', 'suspended')),
  invited_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_memberships_team_user UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user
  ON memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_team_status
  ON memberships (team_id, status);

-- ----------------------------------------------------------------------------
-- CLIENTS — DB identity for a client workspace. `slug` matches the filesystem
-- folder slug the memory store uses as memory_sources.client_id. The
-- (team_id, slug) UNIQUE is what lets the enforcement layer resolve a memory
-- client slug to this row's uuid, then to its grants.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slug        text        NOT NULL,
  name        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_clients_team_slug UNIQUE (team_id, slug)
);

-- ----------------------------------------------------------------------------
-- CLIENT_GRANTS — per (team, client, user) read/write access. Revoke is a status
-- flip (never DELETE), so history is preserved. The partial unique index allows
-- AT MOST ONE active grant per triple while keeping every revoked row; re-granting
-- after a revoke inserts a fresh active row. client_id references clients.id (the
-- uuid), never the slug.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_grants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  client_id   uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  access      text        NOT NULL DEFAULT 'read'
              CHECK (access IN ('read', 'write')),
  status      text        NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'revoked')),
  granted_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- A revoked grant always carries its revocation time; an active one never does.
  CONSTRAINT client_grants_revoked_chk CHECK (
    (status = 'active'  AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

-- At most one ACTIVE grant per (team, client, user); revoked rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_grants_active
  ON client_grants (team_id, client_id, user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_client_grants_lookup
  ON client_grants (team_id, client_id, user_id, status);

-- ----------------------------------------------------------------------------
-- WORKSTATIONS — a registered device/agent host bound to a user within a team.
-- Minimal shape (the issue underspecifies it): identity + revocable status +
-- last-seen. Same revoke-keeps-history pattern as grants.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workstations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  fingerprint    text        NOT NULL,          -- stable device/host identifier
  status         text        NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'revoked')),
  registered_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  last_seen_at   timestamptz,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,

  CONSTRAINT workstations_revoked_chk CHECK (
    (status = 'active'  AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

-- One active registration per device fingerprint within a team; revoked rows kept.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workstations_active_fp
  ON workstations (team_id, fingerprint)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_workstations_team_user
  ON workstations (team_id, user_id);

-- ----------------------------------------------------------------------------
-- AUDIT_EVENTS — append-only trail of sensitive actions (permission changes,
-- denied access). actor + action + target. No FK on actor_user_id / target_id:
-- an audit record must survive even after the user or grant it references is
-- removed. Queryable by team and by target. Distinct from the memory store's
-- search_events (search telemetry) and from any UI-only logs.
-- The action / target_type CHECK lists are extended by later migrations as
-- more sensitive actions are wired through recordAuditEvent.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_user_id  uuid,                            -- who did it (null = system action)
  action         text        NOT NULL
                 CHECK (action IN (
                   'membership.invited', 'membership.joined', 'membership.role_changed',
                   'membership.suspended', 'membership.removed',
                   'grant.granted', 'grant.revoked',
                   'workstation.registered', 'workstation.revoked',
                   'client.created', 'client.archived',
                   'access.denied_search', 'access.denied_ingest')),
  target_type    text        NOT NULL
                 CHECK (target_type IN (
                   'user', 'membership', 'client', 'grant', 'workstation', 'team')),
  target_id      uuid,                            -- affected row's id (no FK — see header)
  summary        text,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_team_created
  ON audit_events (team_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_team_target
  ON audit_events (team_id, target_type, target_id);
