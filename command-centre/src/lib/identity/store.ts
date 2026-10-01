/**
 * AIOS Team Platform — identity & access-control store.
 *
 * A thin repository over the team-platform tables (users, teams, memberships,
 * clients, client_grants, workstations, audit_events) added by migration
 * 0004_team_platform.sql. It lives in the SAME database as the memory store and
 * reuses the memory store's engine seam: the migration runner (../memory/migrate),
 * the PGLite/Postgres adapters, and the backend selector. The exact same class
 * therefore backs local PGLite and hosted Postgres with no change — every
 * operation talks to the schema through the engine-agnostic SqlClient.
 *
 * Scope: the data model only. The invite/join flow, the grant/revoke flow
 * authorization, enforcement before memory search/ingest, and the full audit
 * wiring build ON these repository methods — they are intentionally left as
 * clean seams here.
 *
 * Transactions: grant/revoke write the grant AND its audit event atomically via
 * BEGIN/COMMIT issued on the SqlClient. That requires a SINGLE pinned connection
 * (PGLite is single-user; the Postgres adapter's openPostgres pins one
 * connection). The pooled Postgres client rejects bare BEGIN by design — do not
 * back this store with a pool. (Same rationale as ../memory/postgres-adapter.ts.)
 *
 * SQL is snake_case, the TS surface is camelCase; ./row-mappers bridges the two.
 */


import { applyMigrations, DEFAULT_EMBED_DIM, type SqlClient } from "../memory/migrate";
import { openPGlite } from "../memory/pglite-adapter";
import { openPostgres } from "../memory/postgres-adapter";
import { resolveMemoryBackend, type MemoryBackendSelector } from "../memory/backend";
import {
  clientSlugValidationError,
  normalizeClientSlug,
} from "../client-slug";
import {
  mapAuditEventRow,
  mapClientGrantRow,
  mapClientRow,
  mapCompanyAccessRequestRow,
  mapCompanyAuditEventRow,
  mapCompanyMembershipRow,
  mapCompanyTeamAccessGrantRow,
  mapMembershipRow,
  mapSecretGrantRow,
  mapSkillGrantRow,
  mapTeamSecretRow,
  mapTeamApiSessionRow,
  mapTeamRow,
  mapUserConfigFileRow,
  mapUserRow,
  mapWorkstationRow,
} from "./row-mappers";
import type {
  AuditAction,
  AuditEventRow,
  AuditTargetType,
  ClientGrantRow,
  ClientRow,
  ClientStatus,
  CompanyAccessRequestRow,
  CompanyAccessRequestStatus,
  CompanyAuditEventRow,
  CompanyMembershipRow,
  CompanyMembershipStatus,
  CompanyRole,
  CompanyTeamAccessGrantRow,
  GrantAccess,
  MembershipRow,
  MembershipStatus,
  Role,
  SecretGrantRow,
  SecretScope,
  TeamSecretRow,
  SkillGrantRow,
  SkillPermission,
  TeamApiAuthSource,
  TeamApiSessionRow,
  TeamOsInstanceRow,
  TeamRow,
  TeamStatus,
  UserConfigFileRow,
  UserRow,
  UserStatus,
  WorkstationRow,
} from "./types";

export interface OpenIdentityStoreOptions {
  /** Persisted PGLite directory. Omit for an ephemeral in-memory database (tests). */
  dataDir?: string;
  /** Storage engine selector. Overrides `MEMORY_STORE_BACKEND`. Default `auto`. */
  backend?: MemoryBackendSelector;
  /** Hosted Postgres connection string. Overrides `MEMORY_DATABASE_URL`/`DATABASE_URL`. */
  connectionString?: string;
  /**
   * Use an already-open SqlClient (e.g. one shared with the memory store). When
   * provided, open + migrate are skipped and `close()` is a no-op — the caller
   * owns the connection lifecycle. This is the seam the flow and enforcement
   * layers use to run identity reads/writes on the same connection that serves memory.
   */
  client?: SqlClient;
  /**
   * Embedding dimension forwarded to applyMigrations' ledger. The team-platform
   * tables have no vector columns, so this only matters because memory
   * migrations apply alongside identity migrations in a fresh database.
   * Default 1024.
   */
  embedDim?: number;
}

/** Fields to create-or-update a global user (keyed on lower(email)). */
export interface UpsertUserInput {
  email: string;
  displayName?: string | null;
  status?: UserStatus;
  metadata?: Record<string, unknown>;
}

/** Fields to create a team. */
export interface CreateTeamInput {
  slug: string;
  name: string;
  status?: TeamStatus;
  metadata?: Record<string, unknown>;
}

export interface ListUsersOptions {
  status?: UserStatus;
}

export interface ListTeamsOptions {
  includeArchived?: boolean;
}

export interface UpdateTeamInput {
  teamId: string;
  name: string;
  actorUserId: string;
}

export interface UpsertCompanyMembershipInput {
  userId: string;
  role?: CompanyRole;
  status?: CompanyMembershipStatus;
  invitedBy?: string | null;
  inviteTokenHash?: string | null;
  inviteExpiresAt?: string | null;
  acceptedAt?: string | null;
  removedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ClaimCompanyInvitationInput {
  userId: string;
  tokenHash: string;
  claimId: string;
  now?: Date;
}

export interface FinalizeCompanyInvitationInput {
  userId: string;
  claimId: string;
  now?: Date;
}

export interface CompanyAccessRequestFilter {
  id?: string;
  teamId?: string;
  userId?: string;
  status?: CompanyAccessRequestStatus;
}

export interface CreateCompanyAccessRequestInput {
  teamId: string;
  userId: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateCompanyAccessRequestInput {
  requestId: string;
  status: Exclude<CompanyAccessRequestStatus, "pending">;
  actorUserId: string;
}

export interface CompanyTeamAccessGrantFilter {
  teamId?: string;
  userId?: string;
  status?: "active" | "revoked";
}

export interface GrantCompanyTeamAccessInput {
  teamId: string;
  userId: string;
  grantedBy?: string | null;
  metadata?: Record<string, unknown>;
}

export interface GrantCompanyTeamAccessBulkInput {
  teamIds: string[];
  userId: string;
  grantedBy?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RevokeCompanyTeamAccessInput {
  teamId: string;
  userId: string;
  revokedBy?: string | null;
}

export interface RecordCompanyAuditEventInput {
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  teamId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListCompanyAuditEventsFilter {
  teamId?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
}

export interface TransferCompanyOwnershipInput {
  currentOwnerUserId: string;
  newOwnerUserId: string;
  actorUserId: string;
}

export interface RecoverCompanyOwnerInput {
  userId: string;
}

export interface RemoveCompanyAdminInput {
  userId: string;
  actorUserId: string;
}

export interface PromoteCompanyAdminInput {
  userId: string;
  actorUserId: string;
  acceptedAt?: string;
}

export interface CreateTeamWithOwnerInput extends CreateTeamInput {
  ownerUserId: string;
  creatorUserId: string;
}

export interface ArchiveTeamInput {
  teamId: string;
  actorUserId: string;
}

export interface ReactivateTeamInput {
  teamId: string;
  actorUserId: string;
}

export interface DeleteTeamPermanentlyInput {
  teamId: string;
  actorUserId: string;
  expectedName: string;
  now?: Date;
  /**
   * Counts collected by the API after it has moved exclusively owned client
   * directories out of the active workspace. They are kept in the single
   * minimal deletion audit event; file names and contents are deliberately not
   * retained.
   */
  workspacePurge?: {
    files: number;
    clientDirectories: number;
    sharedClientDirectoriesSkipped: number;
    unsafeClientDirectoriesSkipped: number;
  };
}

export interface AddTeamOwnerInput {
  teamId: string;
  userId: string;
  actorUserId: string;
}

export interface RemoveTeamOwnerInput {
  teamId: string;
  userId: string;
  actorUserId: string;
  replacementRole?: Exclude<Role, "owner">;
}

export interface AddTeamMemberInput {
  teamId: string;
  userId: string;
  actorUserId: string;
  role: Exclude<Role, "owner">;
}

/** Fields to create-or-update a membership (keyed on (teamId, userId)). */
export interface UpsertMembershipInput {
  teamId: string;
  userId: string;
  role?: Role;
  status?: MembershipStatus;
  invitedBy?: string | null;
  /** Replaces the metadata bag. Omit to clear it to `{}` on upsert. */
  metadata?: Record<string, unknown>;
}

/** Fields to create-or-update a client (keyed on (teamId, slug)). */
export interface UpsertClientInput {
  teamId: string;
  slug: string;
  name: string;
  status?: ClientStatus;
  metadata?: Record<string, unknown>;
}

/** Fields to create a client without replacing an existing (teamId, slug). */
export type CreateClientInput = UpsertClientInput;

/** Fields to grant client access to a member. Re-granting supersedes any active grant. */
export interface GrantClientAccessInput {
  teamId: string;
  clientId: string;
  userId: string;
  /** Defaults to 'read'. 'write' implies read. */
  access?: GrantAccess;
  grantedBy?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fields to revoke a member's active client grant. */
export interface RevokeClientAccessInput {
  teamId: string;
  clientId: string;
  userId: string;
  revokedBy?: string | null;
}

/** Fields to grant one skill permission to a member. */
export interface GrantSkillAccessInput {
  teamId: string;
  skillName: string;
  userId: string;
  permission: SkillPermission;
  grantedBy?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fields to revoke a member's active skill grant. */
export interface RevokeSkillAccessInput {
  teamId: string;
  skillName: string;
  userId: string;
  permission?: SkillPermission;
  revokedBy?: string | null;
}

/** Fields to create or update an encrypted shared secret. */
export interface UpsertTeamSecretInput {
  teamId: string;
  clientId?: string | null;
  scope: SecretScope;
  name: string;
  envKey: string;
  encryptedValue: string;
  encryptionKeyId: string;
  nonce: string;
  authTag: string;
  valueSha256: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fields to archive one secret. */
export interface ArchiveTeamSecretInput {
  teamId: string;
  secretId: string;
  actorUserId?: string | null;
}

/** Fields to grant one secret to one user. */
export interface GrantSecretAccessInput {
  teamId: string;
  secretId: string;
  userId: string;
  grantedBy?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fields to revoke one user's active grant to one secret. */
export interface RevokeSecretAccessInput {
  teamId: string;
  secretId: string;
  userId: string;
  revokedBy?: string | null;
}

/** Fields to create or update an encrypted private user config file. */
export interface UpsertUserConfigFileInput {
  teamId: string;
  userId: string;
  path: string;
  encryptedValue: string;
  encryptionKeyId: string;
  nonce: string;
  authTag: string;
  valueSha256: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Filter for listing grants (active + revoked history). */
export interface ListGrantsFilter {
  teamId: string;
  clientId?: string;
  userId?: string;
}

/** Filter for listing skill grants (active + revoked history). */
export interface ListSkillGrantsFilter {
  teamId: string;
  skillName?: string;
  userId?: string;
}

/** Filter for listing shared secrets. Values are still encrypted in returned rows. */
export interface ListTeamSecretsFilter {
  teamId: string;
  clientId?: string | null;
  includeArchived?: boolean;
}

/** Filter for listing secret grants (active + revoked history). */
export interface ListSecretGrantsFilter {
  teamId: string;
  secretId?: string;
  userId?: string;
}

/** Fields to register a workstation. Re-registering a fingerprint supersedes the active one. */
export interface RegisterWorkstationInput {
  teamId: string;
  userId: string;
  name: string;
  fingerprint: string;
  registeredBy?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fields to record an audit event. */
export interface RecordAuditEventInput {
  teamId: string;
  actorUserId?: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}

/** Filter for querying the audit trail by team and (optionally) target. */
export interface ListAuditEventsFilter {
  teamId: string;
  targetType?: AuditTargetType;
  targetId?: string;
  limit?: number;
}

/** Fields to create a user-scoped Team API session. */
export interface CreateTeamApiSessionInput {
  teamId: string;
  userId: string;
  tokenHash: string;
  authSource: TeamApiAuthSource;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

// ── RETURNING column lists (timestamps cast to ::text for stable string parsing) ──
const USER_COLS =
  "id, email, display_name, status, metadata, " +
  "created_at::text AS created_at, updated_at::text AS updated_at";
const TEAM_COLS =
  "id, slug, name, status, archived_at::text AS archived_at, archived_by, metadata, " +
  "created_at::text AS created_at, updated_at::text AS updated_at";
const MEMBERSHIP_COLS =
  "id, team_id, user_id, role, status, invited_by, metadata, " +
  "created_at::text AS created_at, updated_at::text AS updated_at";
const COMPANY_MEMBERSHIP_COLS =
  "id, user_id, role, status, invited_by, invite_token_hash, " +
  "invite_expires_at::text AS invite_expires_at, accepted_at::text AS accepted_at, " +
  "removed_at::text AS removed_at, metadata, " +
  "created_at::text AS created_at, updated_at::text AS updated_at";
const COMPANY_ACCESS_REQUEST_COLS =
  "id, team_id, user_id, status, reason, requested_at::text AS requested_at, " +
  "resolved_at::text AS resolved_at, resolved_by, metadata";
const COMPANY_TEAM_ACCESS_GRANT_COLS =
  "id, team_id, user_id, status, granted_by, granted_at::text AS granted_at, " +
  "revoked_by, revoked_at::text AS revoked_at, metadata";
const COMPANY_AUDIT_COLS =
  "id, actor_user_id, action, target_type, target_id, team_id, summary, metadata, " +
  "created_at::text AS created_at";
const TEAM_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const CLIENT_COLS =
  "id, team_id, slug, name, status, metadata, " +
  "created_at::text AS created_at, updated_at::text AS updated_at";
const GRANT_COLS =
  "id, team_id, client_id, user_id, access, status, granted_by, " +
  "granted_at::text AS granted_at, revoked_by, revoked_at::text AS revoked_at, metadata";
const SKILL_GRANT_COLS =
  "id, team_id, skill_name, user_id, permission, status, granted_by, " +
  "granted_at::text AS granted_at, revoked_by, revoked_at::text AS revoked_at, metadata";
const TEAM_SECRET_COLS =
  "id, team_id, client_id, scope, name, env_key, encrypted_value, " +
  "encryption_key_id, nonce, auth_tag, value_sha256, status, created_by, updated_by, " +
  "created_at::text AS created_at, updated_at::text AS updated_at, " +
  "archived_at::text AS archived_at, metadata";
const SECRET_GRANT_COLS =
  "id, team_id, secret_id, user_id, access, status, granted_by, " +
  "granted_at::text AS granted_at, revoked_by, revoked_at::text AS revoked_at, metadata";
const USER_CONFIG_FILE_COLS =
  "id, team_id, user_id, path, encrypted_value, encryption_key_id, nonce, auth_tag, " +
  "value_sha256, status, updated_by, created_at::text AS created_at, " +
  "updated_at::text AS updated_at, archived_at::text AS archived_at, metadata";
const WORKSTATION_COLS =
  "id, team_id, user_id, name, fingerprint, status, registered_by, " +
  "last_seen_at::text AS last_seen_at, metadata, " +
  "created_at::text AS created_at, revoked_at::text AS revoked_at";
const TEAM_API_SESSION_COLS =
  "id, team_id, user_id, token_hash, auth_source, status, " +
  "expires_at::text AS expires_at, created_at::text AS created_at, " +
  "last_seen_at::text AS last_seen_at, revoked_at::text AS revoked_at, metadata";
const AUDIT_COLS =
  "id, team_id, actor_user_id, action, target_type, target_id, summary, metadata, " +
  "created_at::text AS created_at";

/**
 * Engine-neutral repository over the team-platform tables. Construct it via
 * {@link openIdentityStore}; the only engine-specific concern is teardown,
 * injected as `closeFn`.
 */
export class IdentityStore {
  constructor(
    readonly client: SqlClient,
    private readonly closeFn: () => Promise<void>,
  ) {}

  /** Return the immutable identity created for this Team OS database. */
  async getServerIdentity(): Promise<TeamOsInstanceRow> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT server_id::text AS server_id, created_at::text AS created_at
       FROM team_os_instance WHERE singleton = TRUE`,
    );
    if (!rows.length) throw new Error("Team OS server identity is not initialized");
    return {
      serverId: String(rows[0].server_id),
      createdAt: String(rows[0].created_at),
    };
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  /** Create or update a user, keyed case-insensitively on email. Idempotent. */
  async upsertUser(input: UpsertUserInput): Promise<UserRow> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO users (email, display_name, status, metadata)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (lower(email)) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, users.display_name),
         metadata     = CASE WHEN $5::boolean THEN EXCLUDED.metadata ELSE users.metadata END,
         updated_at   = now()
       RETURNING ${USER_COLS}`,
      [
        input.email,
        input.displayName ?? null,
        input.status ?? "active",
        JSON.stringify(input.metadata ?? {}),
        input.metadata !== undefined,
      ],
    );
    return mapUserRow(rows[0]);
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${USER_COLS} FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows.length ? mapUserRow(rows[0]) : null;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${USER_COLS} FROM users WHERE id = $1`,
      [id],
    );
    return rows.length ? mapUserRow(rows[0]) : null;
  }

  async listUsers(options: ListUsersOptions = {}): Promise<UserRow[]> {
    const params: unknown[] = [];
    const where = options.status ? `WHERE status = $${params.push(options.status)}` : "";
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${USER_COLS} FROM users ${where} ORDER BY created_at, id`,
      params,
    );
    return rows.map(mapUserRow);
  }

  // ── Teams ──────────────────────────────────────────────────────────────────

  async createTeam(input: CreateTeamInput): Promise<TeamRow> {
    const slug = input.slug.trim().toLowerCase();
    const name = input.name.trim();
    if (!TEAM_SLUG_RE.test(slug)) throw new Error("Team slug is invalid");
    if (!name) throw new Error("Team name is required");
    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO teams (slug, name, status, archived_at, metadata)
       VALUES ($1, $2, $3, CASE WHEN $3 = 'archived' THEN now() ELSE NULL END, $4::jsonb)
       RETURNING ${TEAM_COLS}`,
      [slug, name, input.status ?? "active", JSON.stringify(input.metadata ?? {})],
    );
    return mapTeamRow(rows[0]);
  }

  async getTeam(id: string): Promise<TeamRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${TEAM_COLS} FROM teams WHERE id = $1`,
      [id],
    );
    return rows.length ? mapTeamRow(rows[0]) : null;
  }

  async getTeamBySlug(slug: string): Promise<TeamRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${TEAM_COLS} FROM teams WHERE lower(slug) = lower($1)`,
      [slug.trim()],
    );
    return rows.length ? mapTeamRow(rows[0]) : null;
  }

  async listTeams(options: ListTeamsOptions = {}): Promise<TeamRow[]> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${TEAM_COLS} FROM teams
       ${options.includeArchived ? "" : "WHERE status = 'active'"}
       ORDER BY created_at, id`,
    );
    return rows.map(mapTeamRow);
  }

  // ── Memberships ─────────────────────────────────────────────────────────────

  /** Create or update a membership, keyed on (teamId, userId). */
  async upsertMembership(input: UpsertMembershipInput): Promise<MembershipRow> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO memberships (team_id, user_id, role, status, invited_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (team_id, user_id) DO UPDATE SET
         role       = EXCLUDED.role,
         status     = EXCLUDED.status,
         invited_by = COALESCE(EXCLUDED.invited_by, memberships.invited_by),
         metadata   = EXCLUDED.metadata,
         updated_at = now()
       RETURNING ${MEMBERSHIP_COLS}`,
      [
        input.teamId,
        input.userId,
        input.role ?? "member",
        input.status ?? "active",
        input.invitedBy ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapMembershipRow(rows[0]);
  }

  async getMembership(teamId: string, userId: string): Promise<MembershipRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${MEMBERSHIP_COLS} FROM memberships WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId],
    );
    return rows.length ? mapMembershipRow(rows[0]) : null;
  }

  async listMemberships(teamId: string): Promise<MembershipRow[]> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${MEMBERSHIP_COLS} FROM memberships WHERE team_id = $1 ORDER BY created_at`,
      [teamId],
    );
    return rows.map(mapMembershipRow);
  }

  async listMembershipsForUser(userId: string): Promise<MembershipRow[]> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${MEMBERSHIP_COLS} FROM memberships WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return rows.map(mapMembershipRow);
  }

  /** True iff the user has an `active` membership of the team. */
  async isActiveMember(teamId: string, userId: string): Promise<boolean> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT 1 FROM memberships
       WHERE team_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [teamId, userId],
    );
    return rows.length > 0;
  }

  /** Company-derived authority is displayed and mutated as a protected access. */
  private async hasProtectedCompanyTeamAccess(teamId: string, userId: string): Promise<boolean> {
    const { rows } = await this.client.query<{ protected: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM company_memberships company_membership
         WHERE company_membership.user_id = $2
           AND company_membership.status = 'active'
           AND (
             company_membership.role = 'owner'
             OR (
               company_membership.role = 'admin'
               AND EXISTS (
                 SELECT 1 FROM company_team_access_grants company_grant
                 WHERE company_grant.team_id = $1
                   AND company_grant.user_id = $2
                   AND company_grant.status = 'active'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM memberships direct_membership
                 WHERE direct_membership.team_id = $1
                   AND direct_membership.user_id = $2
                   AND direct_membership.status = 'active'
                   AND direct_membership.role IN ('owner', 'admin')
               )
             )
           )
       ) AS protected`,
      [teamId, userId],
    );
    return rows[0]?.protected === true;
  }

  async setMembershipStatus(
    teamId: string,
    userId: string,
    status: MembershipStatus,
  ): Promise<MembershipRow | null> {
    return this.transaction(async (tx) => {
      const { rows: teamRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM teams WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [teamId],
      );
      if (!teamRows.length) throw new Error("active Team is required");
      const { rows: currentRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${MEMBERSHIP_COLS} FROM memberships
         WHERE team_id = $1 AND user_id = $2 FOR UPDATE`,
        [teamId, userId],
      );
      const current = currentRows.length ? mapMembershipRow(currentRows[0]) : null;
      if (current?.role === "owner" && status !== "active") {
        throw new Error("Team Owners can only be changed through company management");
      }
      if (current && await tx.hasProtectedCompanyTeamAccess(teamId, userId)) {
        throw new Error("Company-protected access cannot be changed through Team membership APIs");
      }
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE memberships SET status = $3, updated_at = now()
         WHERE team_id = $1 AND user_id = $2
         RETURNING ${MEMBERSHIP_COLS}`,
        [teamId, userId, status],
      );
      return rows.length ? mapMembershipRow(rows[0]) : null;
    });
  }

  async setRole(teamId: string, userId: string, role: Role): Promise<MembershipRow | null> {
    return this.transaction(async (tx) => {
      const { rows: teamRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM teams WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [teamId],
      );
      if (!teamRows.length) throw new Error("active Team is required");
      const { rows: currentRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${MEMBERSHIP_COLS} FROM memberships
         WHERE team_id = $1 AND user_id = $2 FOR UPDATE`,
        [teamId, userId],
      );
      const current = currentRows.length ? mapMembershipRow(currentRows[0]) : null;
      if (role === "owner" || current?.role === "owner") {
        throw new Error("Team Owners can only be changed through company management");
      }
      if (current && await tx.hasProtectedCompanyTeamAccess(teamId, userId)) {
        throw new Error("Company-protected access cannot be changed through Team membership APIs");
      }
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE memberships SET role = $3, updated_at = now()
         WHERE team_id = $1 AND user_id = $2
         RETURNING ${MEMBERSHIP_COLS}`,
        [teamId, userId, role],
      );
      return rows.length ? mapMembershipRow(rows[0]) : null;
    });
  }

  // ── Company memberships and Team Full access ────────────────────────────────

  async getCompanyMembership(userId: string): Promise<CompanyMembershipRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${COMPANY_MEMBERSHIP_COLS}
       FROM company_memberships WHERE user_id = $1`,
      [userId],
    );
    return rows.length ? mapCompanyMembershipRow(rows[0]) : null;
  }

  async listCompanyMemberships(): Promise<CompanyMembershipRow[]> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${COMPANY_MEMBERSHIP_COLS}
       FROM company_memberships
       ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at, id`,
    );
    return rows.map(mapCompanyMembershipRow);
  }

  async upsertCompanyMembership(
    input: UpsertCompanyMembershipInput,
  ): Promise<CompanyMembershipRow> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      const status = input.status ?? "active";
      const role = input.role ?? "admin";
      if (status === "active") {
        const { rows: userRows } = await tx.client.query<Record<string, unknown>>(
          `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
          [input.userId],
        );
        if (!userRows.length) throw new Error("an active user is required for Company access");
      }
      const { rows: currentRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${COMPANY_MEMBERSHIP_COLS}
         FROM company_memberships WHERE user_id = $1 FOR UPDATE`,
        [input.userId],
      );
      const current = currentRows.length ? mapCompanyMembershipRow(currentRows[0]) : null;
      if (status === "removed") {
        throw new Error("Company Admin removal must use removeCompanyAdmin");
      }
      if (current?.role === "owner" && current.status === "active") {
        if (role !== "owner" || status !== "active") {
          throw new Error("Company Ownership can only change through transferCompanyOwnership");
        }
        return current;
      } else if (role === "owner") {
        throw new Error("Company Owner can only be assigned through recovery or ownership transfer");
      }
      if (current?.role === "admin" && current.status === "active" && status !== "active") {
        throw new Error("active Company Admins can only be removed through removeCompanyAdmin");
      }

      const removedAt: string | null = null;
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `INSERT INTO company_memberships (
           user_id, role, status, invited_by, invite_token_hash,
           invite_expires_at, accepted_at, removed_at, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz,
                   $8::timestamptz, $9::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET
           role = EXCLUDED.role,
           status = EXCLUDED.status,
           invited_by = EXCLUDED.invited_by,
           invite_token_hash = EXCLUDED.invite_token_hash,
           invite_expires_at = EXCLUDED.invite_expires_at,
           accepted_at = EXCLUDED.accepted_at,
           removed_at = EXCLUDED.removed_at,
           metadata = EXCLUDED.metadata,
           updated_at = now()
         RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
        [
          input.userId,
          role,
          status,
          input.invitedBy ?? null,
          status === "invited" ? input.inviteTokenHash ?? null : null,
          status === "invited" ? input.inviteExpiresAt ?? null : null,
          status === "active" ? input.acceptedAt ?? null : null,
          removedAt,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      const membership = mapCompanyMembershipRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.invitedBy ?? null,
        action: status === "invited"
          ? "company_membership.invited"
          : "company_membership.activated",
        targetType: "company_membership",
        targetId: membership.id,
        summary: status === "invited"
          ? "invited Company Admin"
          : "activated Company Admin",
        metadata: {
          userId: membership.userId,
          previousStatus: current?.status ?? null,
        },
      });
      return membership;
    });
  }

  async claimCompanyInvitation(
    input: ClaimCompanyInvitationInput,
  ): Promise<CompanyMembershipRow | null> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      const now = (input.now ?? new Date()).toISOString();
      const { rows: userRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [input.userId],
      );
      if (!userRows.length) throw new Error("an active user is required to accept Company access");
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE company_memberships
         SET metadata = metadata || jsonb_build_object(
               '_inviteClaimId', $3::text,
               '_inviteClaimedAt', $4::text
             ),
             updated_at = now()
         WHERE user_id = $1
           AND invite_token_hash = $2
           AND status = 'invited'
           AND role = 'admin'
           AND invite_expires_at > $4::timestamptz
           AND (
             metadata->>'_inviteClaimId' IS NULL
             OR NULLIF(metadata->>'_inviteClaimedAt', '')::timestamptz
                  <= $4::timestamptz - interval '5 minutes'
           )
         RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
        [input.userId, input.tokenHash, input.claimId, now],
      );
      return rows.length ? mapCompanyMembershipRow(rows[0]) : null;
    });
  }

  async markCompanyInvitationCredentialReady(
    input: { userId: string; claimId: string },
  ): Promise<boolean> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `UPDATE company_memberships
       SET metadata = metadata || jsonb_build_object('_inviteCredentialReady', true),
           updated_at = now()
       WHERE user_id = $1 AND status = 'invited' AND metadata->>'_inviteClaimId' = $2
       RETURNING id`,
      [input.userId, input.claimId],
    );
    return rows.length > 0;
  }

  async releaseCompanyInvitationClaim(
    input: { userId: string; claimId: string },
  ): Promise<void> {
    await this.client.query(
      `UPDATE company_memberships
       SET metadata = metadata - '_inviteClaimId' - '_inviteClaimedAt' - '_inviteCredentialReady',
           updated_at = now()
       WHERE user_id = $1 AND status = 'invited' AND metadata->>'_inviteClaimId' = $2`,
      [input.userId, input.claimId],
    );
  }

  async finalizeCompanyInvitation(
    input: FinalizeCompanyInvitationInput,
  ): Promise<CompanyMembershipRow | null> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      const now = (input.now ?? new Date()).toISOString();
      const { rows: activeUsers } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [input.userId],
      );
      const { rows: ownerMemberships } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM memberships
         WHERE user_id = $1 AND status = 'active' AND role = 'owner'
         FOR UPDATE`,
        [input.userId],
      );
      if (!activeUsers.length || ownerMemberships.length) {
        await tx.client.query(
          `UPDATE company_memberships
           SET metadata = metadata - '_inviteClaimId' - '_inviteClaimedAt' - '_inviteCredentialReady',
               updated_at = now()
           WHERE user_id = $1 AND status = 'invited' AND metadata->>'_inviteClaimId' = $2`,
          [input.userId, input.claimId],
        );
        return null;
      }
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE company_memberships
         SET status = 'active',
             invite_token_hash = NULL,
             invite_expires_at = NULL,
             accepted_at = $3::timestamptz,
             removed_at = NULL,
             metadata = metadata - '_inviteClaimId' - '_inviteClaimedAt' - '_inviteCredentialReady',
             updated_at = now()
         WHERE user_id = $1
           AND status = 'invited'
           AND role = 'admin'
           AND metadata->>'_inviteClaimId' = $2
           AND metadata->>'_inviteCredentialReady' = 'true'
           AND EXISTS (
             SELECT 1 FROM users
             WHERE users.id = company_memberships.user_id AND users.status = 'active'
           )
           AND NOT EXISTS (
             SELECT 1 FROM memberships
             WHERE memberships.user_id = company_memberships.user_id
               AND memberships.status = 'active'
               AND memberships.role = 'owner'
           )
         RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
        [input.userId, input.claimId, now],
      );
      if (!rows.length) {
        await tx.client.query(
          `UPDATE company_memberships
           SET metadata = metadata - '_inviteClaimId' - '_inviteClaimedAt' - '_inviteCredentialReady',
               updated_at = now()
           WHERE user_id = $1 AND status = 'invited' AND metadata->>'_inviteClaimId' = $2`,
          [input.userId, input.claimId],
        );
        return null;
      }
      const membership = mapCompanyMembershipRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.userId,
        action: "company_membership.accepted",
        targetType: "company_membership",
        targetId: membership.id,
        summary: "accepted Company Admin invitation",
      });
      return membership;
    });
  }

  async getCompanyAccessRequest(id: string): Promise<CompanyAccessRequestRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${COMPANY_ACCESS_REQUEST_COLS}
       FROM company_team_access_requests WHERE id = $1`,
      [id],
    );
    return rows.length ? mapCompanyAccessRequestRow(rows[0]) : null;
  }

  async listCompanyAccessRequests(
    filter: CompanyAccessRequestFilter = {},
  ): Promise<CompanyAccessRequestRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    };
    if (filter.id) add("id", filter.id);
    if (filter.teamId) add("team_id", filter.teamId);
    if (filter.userId) add("user_id", filter.userId);
    if (filter.status) add("status", filter.status);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${COMPANY_ACCESS_REQUEST_COLS}
       FROM company_team_access_requests ${where}
       ORDER BY requested_at DESC, id DESC`,
      params,
    );
    return rows.map(mapCompanyAccessRequestRow);
  }

  async createCompanyAccessRequest(
    input: CreateCompanyAccessRequestInput,
  ): Promise<CompanyAccessRequestRow> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      const team = await tx.getTeam(input.teamId);
      if (!team || team.status !== "active") throw new Error("active Team is required");
      const companyMembership = await tx.getCompanyMembership(input.userId);
      if (
        !companyMembership ||
        companyMembership.status !== "active" ||
        companyMembership.role !== "admin"
      ) {
        throw new Error("active Company Admin role is required");
      }
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `INSERT INTO company_team_access_requests (
           team_id, user_id, status, reason, metadata
         ) VALUES ($1, $2, 'pending', $3, $4::jsonb)
         ON CONFLICT (team_id, user_id) WHERE status = 'pending'
         DO UPDATE SET reason = EXCLUDED.reason, metadata = EXCLUDED.metadata
         RETURNING ${COMPANY_ACCESS_REQUEST_COLS}`,
        [input.teamId, input.userId, input.reason?.trim() || null, JSON.stringify(input.metadata ?? {})],
      );
      const request = mapCompanyAccessRequestRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.userId,
        action: "company_access.requested",
        targetType: "company_access_request",
        targetId: request.id,
        teamId: input.teamId,
        summary: "requested Full access to Team",
      });
      return request;
    });
  }

  async updateCompanyAccessRequest(
    input: UpdateCompanyAccessRequestInput,
  ): Promise<CompanyAccessRequestRow | null> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      const { rows: lockedRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${COMPANY_ACCESS_REQUEST_COLS}
         FROM company_team_access_requests
         WHERE id = $1 FOR UPDATE`,
        [input.requestId],
      );
      if (!lockedRows.length) return null;
      const current = mapCompanyAccessRequestRow(lockedRows[0]);
      if (current.status !== "pending") return null;

      const actorCompany = await tx.getCompanyMembership(input.actorUserId);
      const actorIsOwner = actorCompany?.status === "active" && actorCompany.role === "owner";
      if (input.status === "canceled") {
        if (input.actorUserId !== current.userId && !actorIsOwner) {
          throw new Error("request owner or Company Owner is required");
        }
      } else if (!actorIsOwner) {
        throw new Error("Company Owner role is required");
      }

      if (input.status === "approved") {
        await tx.insertActiveCompanyTeamAccessGrant({
          teamId: current.teamId,
          userId: current.userId,
          grantedBy: input.actorUserId,
          metadata: { requestId: current.id },
        });
      }
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE company_team_access_requests
         SET status = $2, resolved_at = now(), resolved_by = $3
         WHERE id = $1 AND status = 'pending'
         RETURNING ${COMPANY_ACCESS_REQUEST_COLS}`,
        [input.requestId, input.status, input.actorUserId],
      );
      if (!rows.length) return null;
      const updated = mapCompanyAccessRequestRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: `company_access.${input.status}`,
        targetType: "company_access_request",
        targetId: updated.id,
        teamId: updated.teamId,
        summary: `${input.status} Full access request`,
        metadata: { userId: updated.userId },
      });
      return updated;
    });
  }

  async getActiveCompanyTeamAccessGrant(
    teamId: string,
    userId: string,
  ): Promise<CompanyTeamAccessGrantRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${COMPANY_TEAM_ACCESS_GRANT_COLS}
       FROM company_team_access_grants
       WHERE team_id = $1 AND user_id = $2 AND status = 'active'
       LIMIT 1`,
      [teamId, userId],
    );
    return rows.length ? mapCompanyTeamAccessGrantRow(rows[0]) : null;
  }

  async listCompanyTeamAccessGrants(
    filter: CompanyTeamAccessGrantFilter = {},
  ): Promise<CompanyTeamAccessGrantRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    };
    if (filter.teamId) add("team_id", filter.teamId);
    if (filter.userId) add("user_id", filter.userId);
    if (filter.status) add("status", filter.status);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${COMPANY_TEAM_ACCESS_GRANT_COLS}
       FROM company_team_access_grants ${where}
       ORDER BY granted_at DESC, id DESC`,
      params,
    );
    return rows.map(mapCompanyTeamAccessGrantRow);
  }

  private async insertActiveCompanyTeamAccessGrant(
    input: GrantCompanyTeamAccessInput,
  ): Promise<CompanyTeamAccessGrantRow> {
    const existing = await this.getActiveCompanyTeamAccessGrant(input.teamId, input.userId);
    if (existing) return existing;
    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO company_team_access_grants (
         team_id, user_id, status, granted_by, metadata
       ) VALUES ($1, $2, 'active', $3, $4::jsonb)
       RETURNING ${COMPANY_TEAM_ACCESS_GRANT_COLS}`,
      [input.teamId, input.userId, input.grantedBy ?? null, JSON.stringify(input.metadata ?? {})],
    );
    return mapCompanyTeamAccessGrantRow(rows[0]);
  }

  async grantCompanyTeamAccess(
    input: GrantCompanyTeamAccessInput,
  ): Promise<CompanyTeamAccessGrantRow> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      const team = await tx.getTeam(input.teamId);
      if (!team) throw new Error("Team not found");
      const membership = await tx.getCompanyMembership(input.userId);
      if (!membership || membership.role !== "admin" || membership.status === "removed") {
        throw new Error("Company Admin membership is required");
      }
      if (input.grantedBy) await tx.requireActiveCompanyOwner(input.grantedBy);
      const grant = await tx.insertActiveCompanyTeamAccessGrant(input);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.grantedBy ?? null,
        action: "company_access.granted",
        targetType: "company_team_access_grant",
        targetId: grant.id,
        teamId: grant.teamId,
        summary: "granted Full access to Team",
        metadata: { userId: grant.userId },
      });
      return grant;
    });
  }

  /**
   * Grant Full access to several Teams as one unit. Every Team and authority
   * precondition is checked before the first grant is written, and any later
   * insert/audit failure rolls the entire batch back.
   */
  async grantCompanyTeamAccessBulk(
    input: GrantCompanyTeamAccessBulkInput,
  ): Promise<CompanyTeamAccessGrantRow[]> {
    const teamIds = [...new Set(input.teamIds)];
    if (!teamIds.length) return [];

    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();

      const teams = await Promise.all(teamIds.map((teamId) => tx.getTeam(teamId)));
      if (teams.some((team) => !team)) throw new Error("Team not found");

      const membership = await tx.getCompanyMembership(input.userId);
      if (!membership || membership.role !== "admin" || membership.status === "removed") {
        throw new Error("Company Admin membership is required");
      }
      if (input.grantedBy) await tx.requireActiveCompanyOwner(input.grantedBy);

      const grants: CompanyTeamAccessGrantRow[] = [];
      for (const teamId of teamIds) {
        const grant = await tx.insertActiveCompanyTeamAccessGrant({
          teamId,
          userId: input.userId,
          grantedBy: input.grantedBy,
          metadata: input.metadata,
        });
        await tx.recordCompanyAuditEvent({
          actorUserId: input.grantedBy ?? null,
          action: "company_access.granted",
          targetType: "company_team_access_grant",
          targetId: grant.id,
          teamId: grant.teamId,
          summary: "granted Full access to Team",
          metadata: { userId: grant.userId },
        });
        grants.push(grant);
      }
      return grants;
    });
  }

  async revokeCompanyTeamAccess(
    input: RevokeCompanyTeamAccessInput,
  ): Promise<CompanyTeamAccessGrantRow | null> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      if (input.revokedBy && input.revokedBy !== input.userId) {
        await tx.requireActiveCompanyOwner(input.revokedBy);
      }
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE company_team_access_grants
         SET status = 'revoked', revoked_by = $3, revoked_at = now()
         WHERE team_id = $1 AND user_id = $2 AND status = 'active'
         RETURNING ${COMPANY_TEAM_ACCESS_GRANT_COLS}`,
        [input.teamId, input.userId, input.revokedBy ?? null],
      );
      if (!rows.length) return null;
      const grant = mapCompanyTeamAccessGrantRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.revokedBy ?? null,
        action: "company_access.revoked",
        targetType: "company_team_access_grant",
        targetId: grant.id,
        teamId: grant.teamId,
        summary: "revoked Full access to Team",
        metadata: { userId: grant.userId },
      });
      return grant;
    });
  }

  async recordCompanyAuditEvent(
    input: RecordCompanyAuditEventInput,
  ): Promise<CompanyAuditEventRow> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO company_audit_events (
         actor_user_id, action, target_type, target_id, team_id, summary, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING ${COMPANY_AUDIT_COLS}`,
      [
        input.actorUserId ?? null,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.teamId ?? null,
        input.summary ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapCompanyAuditEventRow(rows[0]);
  }

  async listCompanyAuditEvents(
    filter: ListCompanyAuditEventsFilter = {},
  ): Promise<CompanyAuditEventRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    };
    if (filter.teamId) add("team_id", filter.teamId);
    if (filter.targetType) add("target_type", filter.targetType);
    if (filter.targetId) add("target_id", filter.targetId);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    let sql = `SELECT ${COMPANY_AUDIT_COLS}
       FROM company_audit_events ${where}
       ORDER BY created_at DESC, id DESC`;
    if (filter.limit != null) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const { rows } = await this.client.query<Record<string, unknown>>(sql, params);
    return rows.map(mapCompanyAuditEventRow);
  }

  private async lockCompanyAuthority(): Promise<void> {
    await this.client.query(
      `SELECT singleton FROM team_os_instance WHERE singleton = TRUE FOR UPDATE`,
    );
  }

  private async requireActiveCompanyOwner(userId: string): Promise<CompanyMembershipRow> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${COMPANY_MEMBERSHIP_COLS}
       FROM company_memberships
       WHERE user_id = $1 AND status = 'active' AND role = 'owner'
       FOR UPDATE`,
      [userId],
    );
    if (!rows.length) throw new Error("Company Owner role is required");
    return mapCompanyMembershipRow(rows[0]);
  }

  private async requireCompanyTeamManager(
    teamId: string,
    userId: string,
    includeArchived = false,
  ): Promise<{ team: TeamRow; companyMembership: CompanyMembershipRow }> {
    await this.lockCompanyAuthority();
    const { rows: teamRows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${TEAM_COLS} FROM teams WHERE id = $1 FOR UPDATE`,
      [teamId],
    );
    if (!teamRows.length) throw new Error("Team not found");
    const team = mapTeamRow(teamRows[0]);
    if (!includeArchived && team.status !== "active") throw new Error("active Team is required");

    const { rows: companyRows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${COMPANY_MEMBERSHIP_COLS}
       FROM company_memberships
       WHERE user_id = $1 AND status = 'active'
       FOR UPDATE`,
      [userId],
    );
    if (!companyRows.length) throw new Error("Company role is required");
    const companyMembership = mapCompanyMembershipRow(companyRows[0]);
    if (companyMembership.role === "owner") return { team, companyMembership };

    const membership = await this.getMembership(teamId, userId);
    if (
      membership?.status === "active" &&
      (membership.role === "owner" || membership.role === "admin")
    ) {
      return { team, companyMembership };
    }
    const grant = await this.getActiveCompanyTeamAccessGrant(teamId, userId);
    if (grant) return { team, companyMembership };
    throw new Error("Full access to Team is required");
  }

  /**
   * Emergency recovery primitive used by the local CLI. Better Auth account
   * validation stays in the CLI; this transaction guarantees the database can
   * never recover a second active Company Owner.
   */
  async recoverCompanyOwner(input: RecoverCompanyOwnerInput): Promise<CompanyMembershipRow> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      const { rows: ownerRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM company_memberships
         WHERE role = 'owner' AND status = 'active'
         FOR UPDATE`,
      );
      if (ownerRows.length) throw new Error("an active Company Owner already exists");

      const { rows: userRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [input.userId],
      );
      if (!userRows.length) throw new Error("an active user is required for recovery");

      const { rows } = await tx.client.query<Record<string, unknown>>(
        `INSERT INTO company_memberships (
           user_id, role, status, accepted_at, metadata
         ) VALUES ($1, 'owner', 'active', now(), $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET
           role = 'owner',
           status = 'active',
           invited_by = NULL,
           invite_token_hash = NULL,
           invite_expires_at = NULL,
           accepted_at = COALESCE(company_memberships.accepted_at, now()),
           removed_at = NULL,
           metadata = company_memberships.metadata || EXCLUDED.metadata,
           updated_at = now()
         RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
        [input.userId, JSON.stringify({ recovery: true })],
      );
      const owner = mapCompanyMembershipRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.userId,
        action: "company_ownership.recovered",
        targetType: "company_membership",
        targetId: owner.id,
        summary: "recovered Company Ownership",
        metadata: { userId: owner.userId },
      });
      return owner;
    });
  }

  async transferCompanyOwnership(
    input: TransferCompanyOwnershipInput,
  ): Promise<{ previousOwner: CompanyMembershipRow; owner: CompanyMembershipRow }> {
    if (input.currentOwnerUserId === input.newOwnerUserId) {
      throw new Error("new Company Owner must be a different user");
    }
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      if (input.actorUserId !== input.currentOwnerUserId) {
        throw new Error("current Company Owner must perform the transfer");
      }
      const { rows: activeUserRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM users
         WHERE id IN ($1, $2) AND status = 'active'
         ORDER BY id
         FOR UPDATE`,
        [input.currentOwnerUserId, input.newOwnerUserId],
      );
      if (activeUserRows.length !== 2) {
        throw new Error("ownership can only transfer between active users");
      }
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${COMPANY_MEMBERSHIP_COLS}
         FROM company_memberships
         WHERE user_id IN ($1, $2)
         ORDER BY user_id
         FOR UPDATE`,
        [input.currentOwnerUserId, input.newOwnerUserId],
      );
      const memberships = rows.map(mapCompanyMembershipRow);
      const current = memberships.find((row) => row.userId === input.currentOwnerUserId);
      const next = memberships.find((row) => row.userId === input.newOwnerUserId);
      if (!current || current.status !== "active" || current.role !== "owner") {
        throw new Error("active Company Owner was not found");
      }
      if (!next || next.status !== "active" || next.role !== "admin") {
        throw new Error("ownership can only transfer to an active Company Admin");
      }

      const { rows: previousRows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE company_memberships
         SET role = 'admin', updated_at = now()
         WHERE id = $1
         RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
        [current.id],
      );
      const { rows: ownerRows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE company_memberships
         SET role = 'owner', updated_at = now()
         WHERE id = $1
         RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
        [next.id],
      );

      await tx.client.query(
        `INSERT INTO company_team_access_grants (
           team_id, user_id, status, granted_by, metadata
         )
         SELECT teams.id, $1, 'active', $2,
                jsonb_build_object('reason', 'ownership_transfer')
         FROM teams
         ON CONFLICT (team_id, user_id) WHERE status = 'active' DO NOTHING`,
        [input.currentOwnerUserId, input.actorUserId],
      );

      const previousOwner = mapCompanyMembershipRow(previousRows[0]);
      const owner = mapCompanyMembershipRow(ownerRows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "company_ownership.transferred",
        targetType: "company_membership",
        targetId: owner.id,
        summary: "transferred Company Ownership",
        metadata: {
          previousOwnerUserId: previousOwner.userId,
          newOwnerUserId: owner.userId,
        },
      });
      return { previousOwner, owner };
    });
  }

  async removeCompanyAdmin(input: RemoveCompanyAdminInput): Promise<CompanyMembershipRow | null> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      await tx.requireActiveCompanyOwner(input.actorUserId);
      const { rows: targetRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${COMPANY_MEMBERSHIP_COLS}
         FROM company_memberships WHERE user_id = $1 FOR UPDATE`,
        [input.userId],
      );
      if (!targetRows.length) return null;
      const target = mapCompanyMembershipRow(targetRows[0]);
      if (target.role !== "admin" || target.status === "removed") return null;

      await tx.client.query(
        `UPDATE company_team_access_grants
         SET status = 'revoked', revoked_by = $2, revoked_at = now()
         WHERE user_id = $1 AND status = 'active'`,
        [input.userId, input.actorUserId],
      );
      await tx.client.query(
        `UPDATE company_team_access_requests
         SET status = 'canceled', resolved_at = now(), resolved_by = $2
         WHERE user_id = $1 AND status = 'pending'`,
        [input.userId, input.actorUserId],
      );
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE company_memberships
         SET status = 'removed', role = 'admin', invite_token_hash = NULL,
             invite_expires_at = NULL, removed_at = now(), updated_at = now()
         WHERE id = $1
         RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
        [target.id],
      );
      const removed = mapCompanyMembershipRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "company_membership.removed",
        targetType: "company_membership",
        targetId: removed.id,
        summary: "removed Company Admin",
        metadata: { userId: removed.userId },
      });
      return removed;
    });
  }

  /** Promote an existing account without modifying any of its direct Team memberships. */
  async promoteCompanyAdmin(input: PromoteCompanyAdminInput): Promise<CompanyMembershipRow> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      await tx.requireActiveCompanyOwner(input.actorUserId);
      const { rows: actorRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [input.actorUserId],
      );
      if (!actorRows.length) throw new Error("Company Owner role is required");
      const { rows: userRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [input.userId],
      );
      if (!userRows.length) throw new Error("Company Admin promotion requires an active user");

      const { rows: currentRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${COMPANY_MEMBERSHIP_COLS}
         FROM company_memberships WHERE user_id = $1 FOR UPDATE`,
        [input.userId],
      );
      const current = currentRows.length ? mapCompanyMembershipRow(currentRows[0]) : null;
      if (current?.role === "owner") {
        throw new Error("Company Owner cannot be promoted to Company Admin");
      }
      if (current?.status === "active" || current?.status === "invited") {
        throw new Error("user is already an active or invited Company Admin");
      }

      const acceptedAt = input.acceptedAt ?? new Date().toISOString();
      const { rows } = current
        ? await tx.client.query<Record<string, unknown>>(
            `UPDATE company_memberships
             SET role = 'admin', status = 'active', invited_by = $2,
                 invite_token_hash = NULL, invite_expires_at = NULL,
                 accepted_at = COALESCE(accepted_at, $3::timestamptz), removed_at = NULL,
                 metadata = metadata - '_inviteClaimId' - '_inviteClaimedAt' - '_inviteCredentialReady',
                 updated_at = now()
             WHERE id = $1 AND status = 'removed'
             RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
            [current.id, input.actorUserId, acceptedAt],
          )
        : await tx.client.query<Record<string, unknown>>(
            `INSERT INTO company_memberships (
               user_id, role, status, invited_by, accepted_at, metadata
             ) VALUES ($1, 'admin', 'active', $2, $3::timestamptz, '{}'::jsonb)
             RETURNING ${COMPANY_MEMBERSHIP_COLS}`,
            [input.userId, input.actorUserId, acceptedAt],
          );
      if (!rows.length) throw new Error("Company Admin membership changed while it was being promoted");
      const promoted = mapCompanyMembershipRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "company_membership.promoted",
        targetType: "company_membership",
        targetId: promoted.id,
        summary: "promoted existing user to Company Admin",
        metadata: {
          userId: promoted.userId,
          previousStatus: current?.status ?? null,
        },
      });
      return promoted;
    });
  }

  async createTeamWithOwner(input: CreateTeamWithOwnerInput): Promise<{
    team: TeamRow;
    ownerMembership: MembershipRow;
    creatorGrant: CompanyTeamAccessGrantRow | null;
  }> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      const creatorCompany = await tx.getCompanyMembership(input.creatorUserId);
      if (!creatorCompany || creatorCompany.status !== "active") {
        throw new Error("active Company role is required");
      }
      const owner = await tx.getUserById(input.ownerUserId);
      if (!owner || owner.status !== "active") throw new Error("initial Team Owner must be an active user");

      const team = await tx.createTeam(input);
      const ownerMembership = await tx.upsertMembership({
        teamId: team.id,
        userId: owner.id,
        role: "owner",
        status: "active",
      });
      const creatorGrant = creatorCompany.role === "admin"
        ? await tx.insertActiveCompanyTeamAccessGrant({
            teamId: team.id,
            userId: input.creatorUserId,
            grantedBy: input.creatorUserId,
            metadata: { reason: "team_creator" },
          })
        : null;
      await tx.recordCompanyAuditEvent({
        actorUserId: input.creatorUserId,
        action: "team.created",
        targetType: "team",
        targetId: team.id,
        teamId: team.id,
        summary: `created Team ${team.name}`,
        metadata: { slug: team.slug, ownerUserId: owner.id },
      });
      return { team, ownerMembership, creatorGrant };
    });
  }

  async updateTeam(input: UpdateTeamInput): Promise<TeamRow | null> {
    return this.transaction(async (tx) => {
      await tx.requireCompanyTeamManager(input.teamId, input.actorUserId, true);
      const name = input.name.trim();
      if (!name) throw new Error("Team name is required");
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE teams SET name = $2, updated_at = now()
         WHERE id = $1 RETURNING ${TEAM_COLS}`,
        [input.teamId, name],
      );
      if (!rows.length) return null;
      const team = mapTeamRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "team.updated",
        targetType: "team",
        targetId: team.id,
        teamId: team.id,
        summary: `renamed Team to ${team.name}`,
      });
      return team;
    });
  }

  async archiveTeam(input: ArchiveTeamInput): Promise<TeamRow | null> {
    return this.transaction(async (tx) => {
      await tx.requireCompanyTeamManager(input.teamId, input.actorUserId, false);
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE teams
         SET status = 'archived', archived_at = now(), archived_by = $2, updated_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING ${TEAM_COLS}`,
        [input.teamId, input.actorUserId],
      );
      if (!rows.length) return null;
      await tx.client.query(
        `UPDATE company_team_access_requests
         SET status = 'canceled', resolved_at = now(), resolved_by = $2
         WHERE team_id = $1 AND status = 'pending'`,
        [input.teamId, input.actorUserId],
      );
      const team = mapTeamRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "team.archived",
        targetType: "team",
        targetId: team.id,
        teamId: team.id,
        summary: `archived Team ${team.name}`,
      });
      return team;
    });
  }

  async reactivateTeam(input: ReactivateTeamInput): Promise<TeamRow | null> {
    return this.transaction(async (tx) => {
      await tx.requireCompanyTeamManager(input.teamId, input.actorUserId, true);
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE teams
         SET status = 'active', archived_at = NULL, archived_by = NULL, updated_at = now()
         WHERE id = $1 AND status = 'archived'
         RETURNING ${TEAM_COLS}`,
        [input.teamId],
      );
      if (!rows.length) return null;
      const team = mapTeamRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "team.reactivated",
        targetType: "team",
        targetId: team.id,
        teamId: team.id,
        summary: `reactivated Team ${team.name}`,
      });
      return team;
    });
  }

  async addTeamOwner(input: AddTeamOwnerInput): Promise<MembershipRow> {
    return this.transaction(async (tx) => {
      await tx.requireCompanyTeamManager(input.teamId, input.actorUserId, false);
      const user = await tx.getUserById(input.userId);
      if (!user || user.status !== "active") throw new Error("Team Owner must be an active user");
      const membership = await tx.upsertMembership({
        teamId: input.teamId,
        userId: input.userId,
        role: "owner",
        status: "active",
      });
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "team_owner.added",
        targetType: "membership",
        targetId: membership.id,
        teamId: input.teamId,
        summary: "added Team Owner",
        metadata: { userId: input.userId },
      });
      return membership;
    });
  }

  async removeTeamOwner(input: RemoveTeamOwnerInput): Promise<MembershipRow | null> {
    const replacementRole = input.replacementRole ?? "admin";
    if ((replacementRole as Role) === "owner") {
      throw new Error("Team Owner replacement role must be member or admin");
    }
    return this.transaction(async (tx) => {
      await tx.requireCompanyTeamManager(input.teamId, input.actorUserId, false);
      const { rows: ownerRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${MEMBERSHIP_COLS}
         FROM memberships
         WHERE team_id = $1 AND role = 'owner' AND status = 'active'
         ORDER BY id FOR UPDATE`,
        [input.teamId],
      );
      const owners = ownerRows.map(mapMembershipRow);
      const target = owners.find((owner) => owner.userId === input.userId);
      if (!target) return null;
      if (owners.length <= 1) throw new Error("at least one active Team Owner is required");
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE memberships SET role = $3, updated_at = now()
         WHERE team_id = $1 AND user_id = $2 AND role = 'owner' AND status = 'active'
         RETURNING ${MEMBERSHIP_COLS}`,
        [input.teamId, input.userId, replacementRole],
      );
      if (!rows.length) return null;
      const membership = mapMembershipRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "team_owner.removed",
        targetType: "membership",
        targetId: membership.id,
        teamId: input.teamId,
        summary: "removed Team Owner",
        metadata: { userId: input.userId, replacementRole: membership.role },
      });
      return membership;
    });
  }

  /**
   * Add an existing platform account to an active Team. This is intentionally
   * separate from invitation acceptance: active/invited rows are duplicates,
   * while a suspended row is reactivated in place so its identity and history
   * remain stable.
   */
  async addTeamMember(input: AddTeamMemberInput): Promise<MembershipRow> {
    if ((input.role as Role) === "owner") {
      throw new Error("Team member role must be member or admin");
    }
    return this.transaction(async (tx) => {
      await tx.requireCompanyTeamManager(input.teamId, input.actorUserId, false);
      const { rows: userRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [input.userId],
      );
      if (!userRows.length) throw new Error("Team member must be an active user");

      const { rows: currentRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${MEMBERSHIP_COLS} FROM memberships
         WHERE team_id = $1 AND user_id = $2 FOR UPDATE`,
        [input.teamId, input.userId],
      );
      const current = currentRows.length ? mapMembershipRow(currentRows[0]) : null;
      if (current?.status === "active" || current?.status === "invited") {
        throw new Error("Team member already has an active or invited membership");
      }
      if (current?.role === "owner" || await tx.hasProtectedCompanyTeamAccess(input.teamId, input.userId)) {
        throw new Error("Company-protected access cannot be replaced by a Team membership");
      }

      const { rows } = current
        ? await tx.client.query<Record<string, unknown>>(
            `UPDATE memberships
             SET role = $3, status = 'active', metadata = '{}'::jsonb, updated_at = now()
             WHERE id = $1 AND user_id = $2 AND status = 'suspended'
             RETURNING ${MEMBERSHIP_COLS}`,
            [current.id, input.userId, input.role],
          )
        : await tx.client.query<Record<string, unknown>>(
            `INSERT INTO memberships (team_id, user_id, role, status, invited_by, metadata)
             VALUES ($1, $2, $3, 'active', $4, '{}'::jsonb)
             RETURNING ${MEMBERSHIP_COLS}`,
            [input.teamId, input.userId, input.role, input.actorUserId],
          );
      if (!rows.length) throw new Error("Team membership changed while it was being added");
      const membership = mapMembershipRow(rows[0]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: current ? "team_member.reactivated" : "team_member.added",
        targetType: "membership",
        targetId: membership.id,
        teamId: input.teamId,
        summary: current ? "reactivated existing Team member" : "added existing Team member",
        metadata: {
          userId: input.userId,
          role: membership.role,
          previousStatus: current?.status ?? null,
        },
      });
      return membership;
    });
  }

  async deleteTeamPermanently(input: DeleteTeamPermanentlyInput): Promise<TeamRow | null> {
    return this.transaction(async (tx) => {
      await tx.lockCompanyAuthority();
      await tx.requireActiveCompanyOwner(input.actorUserId);
      const { rows: teamRows } = await tx.client.query<Record<string, unknown>>(
        `SELECT ${TEAM_COLS} FROM teams WHERE id = $1 FOR UPDATE`,
        [input.teamId],
      );
      if (!teamRows.length) return null;
      const team = mapTeamRow(teamRows[0]);
      if (team.name !== input.expectedName) throw new Error("Team name confirmation does not match");
      if (team.status !== "archived" || !team.archivedAt) {
        throw new Error("Team must be archived before permanent deletion");
      }
      const now = input.now ?? new Date();
      const eligibleAt = new Date(team.archivedAt).getTime() + 30 * 24 * 60 * 60 * 1000;
      if (now.getTime() < eligibleAt) throw new Error("Team must be archived for 30 days before deletion");

      // Permanent deletion keeps one minimal company event for this Team.
      await tx.client.query(`DELETE FROM company_audit_events WHERE team_id = $1`, [team.id]);
      await tx.recordCompanyAuditEvent({
        actorUserId: input.actorUserId,
        action: "team.deleted",
        targetType: "team",
        targetId: team.id,
        teamId: team.id,
        summary: `permanently deleted Team ${team.name}`,
        metadata: {
          name: team.name,
          slug: team.slug,
          archivedAt: team.archivedAt,
          ...(input.workspacePurge ? { workspacePurge: input.workspacePurge } : {}),
        },
      });

      // Memory scope uses text Team ids and intentionally has no FK to teams.
      // Purge each active table explicitly; UUID identity/config tables cascade
      // from the final teams delete. The minimal company event deliberately does not.
      const textScopedTables = [
        "memory_source_provenance",
        "memory_sync_outbox",
        "memory_capture_events",
        "memory_consolidation_batches",
        "manual_imports",
        "search_events",
        "index_jobs",
        "memory_chunks",
        "memory_sources",
      ];
      for (const table of textScopedTables) {
        await tx.client.query(`DELETE FROM ${table} WHERE team_id = $1`, [team.id]);
      }
      await tx.client.query(`DELETE FROM teams WHERE id = $1`, [team.id]);
      return team;
    });
  }

  // ── Clients ─────────────────────────────────────────────────────────────────

  /**
   * Insert a client without replacing an existing row.
   *
   * Returns null when the normalized slug already belongs to this Team,
   * including a mixed-case row written by an older release. The legacy check
   * and insert share one SQL statement, while every new writer uses the same
   * lowercase key protected by the existing unique constraint.
   */
  async createClient(input: CreateClientInput): Promise<ClientRow | null> {
    const slug = normalizeClientSlug(input.slug);
    const validationError = clientSlugValidationError(slug);
    if (validationError) throw new Error(validationError);
    const name = input.name.trim();
    if (!name) throw new Error("Client name is required.");

    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO clients (team_id, slug, name, status, metadata)
       SELECT $1, $2, $3, $4, $5::jsonb
       WHERE NOT EXISTS (
         SELECT 1
         FROM clients
         WHERE team_id = $1 AND lower(slug) = lower($2)
       )
       ON CONFLICT (team_id, slug) DO NOTHING
       RETURNING ${CLIENT_COLS}`,
      [
        input.teamId,
        slug,
        name,
        input.status ?? "active",
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return rows.length ? mapClientRow(rows[0]) : null;
  }

  /** Create or update a client, keyed on (teamId, slug). */
  async upsertClient(input: UpsertClientInput): Promise<ClientRow> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO clients (team_id, slug, name, status, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (team_id, slug) DO UPDATE SET
         name       = EXCLUDED.name,
         status     = EXCLUDED.status,
         metadata   = EXCLUDED.metadata,
         updated_at = now()
       RETURNING ${CLIENT_COLS}`,
      [
        input.teamId,
        input.slug,
        input.name,
        input.status ?? "active",
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapClientRow(rows[0]);
  }

  /** Resolve a memory-store client slug to its DB row within a team (enforcement hook). */
  async getClientBySlug(teamId: string, slug: string): Promise<ClientRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${CLIENT_COLS} FROM clients WHERE team_id = $1 AND slug = $2`,
      [teamId, slug],
    );
    return rows.length ? mapClientRow(rows[0]) : null;
  }

  async getClientById(id: string): Promise<ClientRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${CLIENT_COLS} FROM clients WHERE id = $1`,
      [id],
    );
    return rows.length ? mapClientRow(rows[0]) : null;
  }

  async listClients(teamId: string): Promise<ClientRow[]> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${CLIENT_COLS} FROM clients WHERE team_id = $1 ORDER BY created_at`,
      [teamId],
    );
    return rows.map(mapClientRow);
  }

  /**
   * A client directory is safe to attribute to one Team only when no client in
   * another Team resolves to the same case-insensitive filesystem slug.
   *
   * Client slugs are unique inside a Team, while the server workspace stores
   * them at clients/{slug}. This explicit cross-Team check is therefore the
   * ownership proof required before permanent deletion touches that directory.
   */
  async isClientWorkspaceSlugExclusiveToTeam(teamId: string, slug: string): Promise<boolean> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT team_id::text AS team_id
       FROM clients
       WHERE lower(slug) = lower($1)`,
      [slug],
    );
    return rows.length > 0 && rows.every((row) => String(row.team_id) === teamId);
  }

  // ── Client grants ────────────────────────────────────────────────────────────

  /**
   * Grant a member read/write access to a client. Any existing active grant for
   * the same (team, client, user) is superseded (revoked, then a fresh active row
   * inserted) so re-granting is safe and the partial unique index is honoured. The
   * grant and a `grant.granted` audit event are written in one transaction.
   */
  async grantClientAccess(input: GrantClientAccessInput): Promise<ClientGrantRow> {
    return this.transaction(async (tx) => {
      await tx.client.query(
        `UPDATE client_grants
           SET status = 'revoked', revoked_at = now(), revoked_by = $4
         WHERE team_id = $1 AND client_id = $2 AND user_id = $3 AND status = 'active'`,
        [input.teamId, input.clientId, input.userId, input.grantedBy ?? null],
      );

      const { rows } = await tx.client.query<Record<string, unknown>>(
        `INSERT INTO client_grants
           (team_id, client_id, user_id, access, status, granted_by, metadata)
         VALUES ($1, $2, $3, $4, 'active', $5, $6::jsonb)
         RETURNING ${GRANT_COLS}`,
        [
          input.teamId,
          input.clientId,
          input.userId,
          input.access ?? "read",
          input.grantedBy ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      const grant = mapClientGrantRow(rows[0]);

      await tx.recordAuditEvent({
        teamId: input.teamId,
        actorUserId: input.grantedBy ?? null,
        action: "grant.granted",
        targetType: "grant",
        targetId: grant.id,
        summary: `granted ${grant.access} on client ${input.clientId} to user ${input.userId}`,
        metadata: { clientId: input.clientId, userId: input.userId, access: grant.access },
      });

      return grant;
    });
  }

  /**
   * Revoke a member's active grant for a client. The row is flipped to `revoked`
   * (history is preserved, never deleted) and a `grant.revoked` audit event is
   * written in the same transaction. Returns the revoked grant, or null if there
   * was no active grant.
   */
  async revokeClientAccess(input: RevokeClientAccessInput): Promise<ClientGrantRow | null> {
    return this.transaction(async (tx) => {
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE client_grants
           SET status = 'revoked', revoked_at = now(), revoked_by = $4
         WHERE team_id = $1 AND client_id = $2 AND user_id = $3 AND status = 'active'
         RETURNING ${GRANT_COLS}`,
        [input.teamId, input.clientId, input.userId, input.revokedBy ?? null],
      );
      if (rows.length === 0) return null;
      const grant = mapClientGrantRow(rows[0]);

      await tx.recordAuditEvent({
        teamId: input.teamId,
        actorUserId: input.revokedBy ?? null,
        action: "grant.revoked",
        targetType: "grant",
        targetId: grant.id,
        summary: `revoked access on client ${input.clientId} from user ${input.userId}`,
        metadata: { clientId: input.clientId, userId: input.userId },
      });

      return grant;
    });
  }

  /**
   * The member's current active grant for a client, or null. Revoked grants are
   * ignored here but remain queryable via {@link listGrants} — this is how
   * "revoked grants can be checked without deleting history" is satisfied.
   */
  async getActiveGrant(
    teamId: string,
    clientId: string,
    userId: string,
  ): Promise<ClientGrantRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${GRANT_COLS} FROM client_grants
       WHERE team_id = $1 AND client_id = $2 AND user_id = $3 AND status = 'active'`,
      [teamId, clientId, userId],
    );
    return rows.length ? mapClientGrantRow(rows[0]) : null;
  }

  /** List grants (active and revoked) — the full auditable history for a team. */
  async listGrants(filter: ListGrantsFilter): Promise<ClientGrantRow[]> {
    const conditions = ["team_id = $1"];
    const params: unknown[] = [filter.teamId];
    if (filter.clientId != null) {
      params.push(filter.clientId);
      conditions.push(`client_id = $${params.length}`);
    }
    if (filter.userId != null) {
      params.push(filter.userId);
      conditions.push(`user_id = $${params.length}`);
    }
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${GRANT_COLS} FROM client_grants
       WHERE ${conditions.join(" AND ")}
       ORDER BY granted_at`,
      params,
    );
    return rows.map(mapClientGrantRow);
  }

  // ── Skill grants ─────────────────────────────────────────────────────────────

  /**
   * Grant a user one skill permission. Re-granting the same permission
   * supersedes an existing active row and inserts a new one, preserving history.
   */
  async grantSkillAccess(input: GrantSkillAccessInput): Promise<SkillGrantRow> {
    return this.transaction(async (tx) => {
      await tx.client.query(
        `UPDATE skill_grants
           SET status = 'revoked', revoked_at = now(), revoked_by = $5
         WHERE team_id = $1 AND skill_name = $2 AND user_id = $3
           AND permission = $4 AND status = 'active'`,
        [
          input.teamId,
          input.skillName,
          input.userId,
          input.permission,
          input.grantedBy ?? null,
        ],
      );

      const { rows } = await tx.client.query<Record<string, unknown>>(
        `INSERT INTO skill_grants
           (team_id, skill_name, user_id, permission, status, granted_by, metadata)
         VALUES ($1, $2, $3, $4, 'active', $5, $6::jsonb)
         RETURNING ${SKILL_GRANT_COLS}`,
        [
          input.teamId,
          input.skillName,
          input.userId,
          input.permission,
          input.grantedBy ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      const grant = mapSkillGrantRow(rows[0]);

      await tx.recordAuditEvent({
        teamId: input.teamId,
        actorUserId: input.grantedBy ?? null,
        action: "skill.granted",
        targetType: "skill_grant",
        targetId: grant.id,
        summary: `granted ${grant.permission} on skill ${input.skillName} to user ${input.userId}`,
        metadata: {
          skillName: input.skillName,
          userId: input.userId,
          permission: grant.permission,
        },
      });

      return grant;
    });
  }

  /**
   * Revoke active skill grants. When permission is omitted, all active grants for
   * the user's skill are revoked. Returns every revoked row.
   */
  async revokeSkillAccess(input: RevokeSkillAccessInput): Promise<SkillGrantRow[]> {
    return this.transaction(async (tx) => {
      const params: unknown[] = [
        input.teamId,
        input.skillName,
        input.userId,
        input.revokedBy ?? null,
      ];
      let permissionSql = "";
      if (input.permission != null) {
        params.push(input.permission);
        permissionSql = ` AND permission = $${params.length}`;
      }

      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE skill_grants
           SET status = 'revoked', revoked_at = now(), revoked_by = $4
         WHERE team_id = $1 AND skill_name = $2 AND user_id = $3
           AND status = 'active'${permissionSql}
         RETURNING ${SKILL_GRANT_COLS}`,
        params,
      );
      const grants = rows.map(mapSkillGrantRow);

      for (const grant of grants) {
        await tx.recordAuditEvent({
          teamId: input.teamId,
          actorUserId: input.revokedBy ?? null,
          action: "skill.revoked",
          targetType: "skill_grant",
          targetId: grant.id,
          summary: `revoked ${grant.permission} on skill ${input.skillName} from user ${input.userId}`,
          metadata: {
            skillName: input.skillName,
            userId: input.userId,
            permission: grant.permission,
          },
        });
      }

      return grants;
    });
  }

  /** Active skill grants for one user and skill. */
  async listActiveSkillGrants(
    teamId: string,
    skillName: string,
    userId: string,
  ): Promise<SkillGrantRow[]> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${SKILL_GRANT_COLS} FROM skill_grants
       WHERE team_id = $1 AND skill_name = $2 AND user_id = $3 AND status = 'active'
       ORDER BY granted_at`,
      [teamId, skillName, userId],
    );
    return rows.map(mapSkillGrantRow);
  }

  /** List skill grants (active and revoked) - the full auditable history. */
  async listSkillGrants(filter: ListSkillGrantsFilter): Promise<SkillGrantRow[]> {
    const conditions = ["team_id = $1"];
    const params: unknown[] = [filter.teamId];
    if (filter.skillName != null) {
      params.push(filter.skillName);
      conditions.push(`skill_name = $${params.length}`);
    }
    if (filter.userId != null) {
      params.push(filter.userId);
      conditions.push(`user_id = $${params.length}`);
    }
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${SKILL_GRANT_COLS} FROM skill_grants
       WHERE ${conditions.join(" AND ")}
       ORDER BY granted_at`,
      params,
    );
    return rows.map(mapSkillGrantRow);
  }

  // ── Team secrets ────────────────────────────────────────────────────────────

  /** Create or update one encrypted shared secret, keyed by active scope + env key. */
  async upsertTeamSecret(input: UpsertTeamSecretInput): Promise<TeamSecretRow> {
    return this.transaction(async (tx) => {
      const clientMatch = input.clientId == null ? "client_id IS NULL" : "client_id = $12";
      const params: unknown[] = [
        input.teamId,
        input.scope,
        input.envKey,
        input.name,
        input.encryptedValue,
        input.encryptionKeyId,
        input.nonce,
        input.authTag,
        input.valueSha256,
        input.actorUserId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ];
      if (input.clientId != null) params.push(input.clientId);
      const updated = await tx.client.query<Record<string, unknown>>(
        `UPDATE team_secrets SET
           name = $4,
           encrypted_value = $5,
           encryption_key_id = $6,
           nonce = $7,
           auth_tag = $8,
           value_sha256 = $9,
           updated_by = $10,
           metadata = $11::jsonb,
           updated_at = now()
         WHERE team_id = $1 AND scope = $2 AND env_key = $3
           AND status = 'active' AND ${clientMatch}
         RETURNING ${TEAM_SECRET_COLS}`,
        params,
      );
      let created = false;
      let secret = updated.rows.length ? mapTeamSecretRow(updated.rows[0]) : null;
      if (!secret) {
        const inserted = await tx.client.query<Record<string, unknown>>(
          `INSERT INTO team_secrets
             (team_id, client_id, scope, name, env_key, encrypted_value,
              encryption_key_id, nonce, auth_tag, value_sha256, status,
              created_by, updated_by, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $11, $12::jsonb)
           RETURNING ${TEAM_SECRET_COLS}`,
        [
          input.teamId,
          input.clientId ?? null,
          input.scope,
          input.name,
          input.envKey,
          input.encryptedValue,
          input.encryptionKeyId,
          input.nonce,
          input.authTag,
          input.valueSha256,
          input.actorUserId ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
        );
        secret = mapTeamSecretRow(inserted.rows[0]);
        created = true;
      }
      await tx.recordAuditEvent({
        teamId: input.teamId,
        actorUserId: input.actorUserId ?? null,
        action: created ? "secret.created" : "secret.updated",
        targetType: "secret",
        targetId: secret.id,
        summary: `${created ? "created" : "updated"} secret ${secret.envKey}`,
        metadata: {
          secretId: secret.id,
          envKey: secret.envKey,
          scope: secret.scope,
          clientId: secret.clientId,
        },
      });
      return secret;
    });
  }

  async getTeamSecret(teamId: string, secretId: string): Promise<TeamSecretRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${TEAM_SECRET_COLS} FROM team_secrets WHERE team_id = $1 AND id = $2`,
      [teamId, secretId],
    );
    return rows.length ? mapTeamSecretRow(rows[0]) : null;
  }

  async listTeamSecrets(filter: ListTeamSecretsFilter): Promise<TeamSecretRow[]> {
    const conditions = ["team_id = $1"];
    const params: unknown[] = [filter.teamId];
    if (!filter.includeArchived) conditions.push("status = 'active'");
    if (filter.clientId !== undefined) {
      if (filter.clientId === null) {
        conditions.push("client_id IS NULL");
      } else {
        params.push(filter.clientId);
        conditions.push(`client_id = $${params.length}`);
      }
    }
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${TEAM_SECRET_COLS} FROM team_secrets
       WHERE ${conditions.join(" AND ")}
       ORDER BY scope, env_key`,
      params,
    );
    return rows.map(mapTeamSecretRow);
  }

  async archiveTeamSecret(input: ArchiveTeamSecretInput): Promise<TeamSecretRow | null> {
    return this.transaction(async (tx) => {
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE team_secrets
            SET status = 'archived', archived_at = now(), updated_by = $3, updated_at = now()
          WHERE team_id = $1 AND id = $2 AND status = 'active'
          RETURNING ${TEAM_SECRET_COLS}`,
        [input.teamId, input.secretId, input.actorUserId ?? null],
      );
      if (rows.length === 0) return null;
      const secret = mapTeamSecretRow(rows[0]);
      await tx.recordAuditEvent({
        teamId: input.teamId,
        actorUserId: input.actorUserId ?? null,
        action: "secret.archived",
        targetType: "secret",
        targetId: secret.id,
        summary: `archived secret ${secret.envKey}`,
        metadata: { secretId: secret.id, envKey: secret.envKey, scope: secret.scope, clientId: secret.clientId },
      });
      return secret;
    });
  }

  async grantSecretAccess(input: GrantSecretAccessInput): Promise<SecretGrantRow> {
    return this.transaction(async (tx) => {
      await tx.client.query(
        `UPDATE secret_grants
            SET status = 'revoked', revoked_at = now(), revoked_by = $4
          WHERE team_id = $1 AND secret_id = $2 AND user_id = $3 AND status = 'active'`,
        [input.teamId, input.secretId, input.userId, input.grantedBy ?? null],
      );
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `INSERT INTO secret_grants
           (team_id, secret_id, user_id, access, status, granted_by, metadata)
         VALUES ($1, $2, $3, 'read', 'active', $4, $5::jsonb)
         RETURNING ${SECRET_GRANT_COLS}`,
        [
          input.teamId,
          input.secretId,
          input.userId,
          input.grantedBy ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      const grant = mapSecretGrantRow(rows[0]);
      await tx.recordAuditEvent({
        teamId: input.teamId,
        actorUserId: input.grantedBy ?? null,
        action: "secret.granted",
        targetType: "secret_grant",
        targetId: grant.id,
        summary: `granted secret ${input.secretId} to user ${input.userId}`,
        metadata: { secretId: input.secretId, userId: input.userId },
      });
      return grant;
    });
  }

  async revokeSecretAccess(input: RevokeSecretAccessInput): Promise<SecretGrantRow | null> {
    return this.transaction(async (tx) => {
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `UPDATE secret_grants
            SET status = 'revoked', revoked_at = now(), revoked_by = $4
          WHERE team_id = $1 AND secret_id = $2 AND user_id = $3 AND status = 'active'
          RETURNING ${SECRET_GRANT_COLS}`,
        [input.teamId, input.secretId, input.userId, input.revokedBy ?? null],
      );
      if (rows.length === 0) return null;
      const grant = mapSecretGrantRow(rows[0]);
      await tx.recordAuditEvent({
        teamId: input.teamId,
        actorUserId: input.revokedBy ?? null,
        action: "secret.revoked",
        targetType: "secret_grant",
        targetId: grant.id,
        summary: `revoked secret ${input.secretId} from user ${input.userId}`,
        metadata: { secretId: input.secretId, userId: input.userId },
      });
      return grant;
    });
  }

  async getActiveSecretGrant(
    teamId: string,
    secretId: string,
    userId: string,
  ): Promise<SecretGrantRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${SECRET_GRANT_COLS} FROM secret_grants
       WHERE team_id = $1 AND secret_id = $2 AND user_id = $3 AND status = 'active'`,
      [teamId, secretId, userId],
    );
    return rows.length ? mapSecretGrantRow(rows[0]) : null;
  }

  async listSecretGrants(filter: ListSecretGrantsFilter): Promise<SecretGrantRow[]> {
    const conditions = ["team_id = $1"];
    const params: unknown[] = [filter.teamId];
    if (filter.secretId != null) {
      params.push(filter.secretId);
      conditions.push(`secret_id = $${params.length}`);
    }
    if (filter.userId != null) {
      params.push(filter.userId);
      conditions.push(`user_id = $${params.length}`);
    }
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${SECRET_GRANT_COLS} FROM secret_grants
       WHERE ${conditions.join(" AND ")}
       ORDER BY granted_at`,
      params,
    );
    return rows.map(mapSecretGrantRow);
  }

  // ── Private encrypted config files ─────────────────────────────────────────

  /** Create or update one encrypted config file for a user, keyed by active path. */
  async upsertUserConfigFile(input: UpsertUserConfigFileInput): Promise<UserConfigFileRow> {
    return this.transaction(async (tx) => {
      const updated = await tx.client.query<Record<string, unknown>>(
        `UPDATE user_config_files SET
           encrypted_value = $4,
           encryption_key_id = $5,
           nonce = $6,
           auth_tag = $7,
           value_sha256 = $8,
           updated_by = $9,
           metadata = $10::jsonb,
           updated_at = now()
         WHERE team_id = $1 AND user_id = $2 AND path = $3 AND status = 'active'
         RETURNING ${USER_CONFIG_FILE_COLS}`,
        [
          input.teamId,
          input.userId,
          input.path,
          input.encryptedValue,
          input.encryptionKeyId,
          input.nonce,
          input.authTag,
          input.valueSha256,
          input.actorUserId ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      let file = updated.rows.length ? mapUserConfigFileRow(updated.rows[0]) : null;
      if (!file) {
        const inserted = await tx.client.query<Record<string, unknown>>(
          `INSERT INTO user_config_files
             (team_id, user_id, path, encrypted_value, encryption_key_id, nonce,
              auth_tag, value_sha256, status, updated_by, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10::jsonb)
           RETURNING ${USER_CONFIG_FILE_COLS}`,
          [
            input.teamId,
            input.userId,
            input.path,
            input.encryptedValue,
            input.encryptionKeyId,
            input.nonce,
            input.authTag,
            input.valueSha256,
            input.actorUserId ?? null,
            JSON.stringify(input.metadata ?? {}),
          ],
        );
        file = mapUserConfigFileRow(inserted.rows[0]);
      }
      await tx.recordAuditEvent({
        teamId: input.teamId,
        actorUserId: input.actorUserId ?? null,
        action: "config.synced",
        targetType: "user_config_file",
        targetId: file.id,
        summary: `synced user config file ${file.path}`,
        metadata: {
          path: file.path,
          userId: input.userId,
          valueSha256: file.valueSha256,
        },
      });
      return file;
    });
  }

  async getUserConfigFile(
    teamId: string,
    userId: string,
    filePath: string,
  ): Promise<UserConfigFileRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${USER_CONFIG_FILE_COLS}
       FROM user_config_files
       WHERE team_id = $1 AND user_id = $2 AND path = $3 AND status = 'active'`,
      [teamId, userId, filePath],
    );
    return rows.length ? mapUserConfigFileRow(rows[0]) : null;
  }

  // ── Workstations ─────────────────────────────────────────────────────────────

  /**
   * Register a workstation for a user. Any existing active registration of the
   * same (team, fingerprint) is superseded so the partial unique index is
   * honoured. Returns the new active workstation.
   */
  async registerWorkstation(input: RegisterWorkstationInput): Promise<WorkstationRow> {
    return this.transaction(async (tx) => {
      await tx.client.query(
        `UPDATE workstations SET status = 'revoked', revoked_at = now()
         WHERE team_id = $1 AND fingerprint = $2 AND status = 'active'`,
        [input.teamId, input.fingerprint],
      );
      const { rows } = await tx.client.query<Record<string, unknown>>(
        `INSERT INTO workstations
           (team_id, user_id, name, fingerprint, status, registered_by, metadata)
         VALUES ($1, $2, $3, $4, 'active', $5, $6::jsonb)
         RETURNING ${WORKSTATION_COLS}`,
        [
          input.teamId,
          input.userId,
          input.name,
          input.fingerprint,
          input.registeredBy ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      return mapWorkstationRow(rows[0]);
    });
  }

  /** Revoke a workstation by id. History is preserved (status flip + revoked_at). */
  async revokeWorkstation(id: string): Promise<WorkstationRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `UPDATE workstations SET status = 'revoked', revoked_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING ${WORKSTATION_COLS}`,
      [id],
    );
    return rows.length ? mapWorkstationRow(rows[0]) : null;
  }

  async listWorkstations(teamId: string, userId?: string): Promise<WorkstationRow[]> {
    const params: unknown[] = [teamId];
    let where = "team_id = $1";
    if (userId != null) {
      params.push(userId);
      where += ` AND user_id = $${params.length}`;
    }
    const { rows } = await this.client.query<Record<string, unknown>>(
      `SELECT ${WORKSTATION_COLS} FROM workstations WHERE ${where} ORDER BY created_at`,
      params,
    );
    return rows.map(mapWorkstationRow);
  }

  // ── Team API sessions ───────────────────────────────────────────────────────

  async createTeamApiSession(input: CreateTeamApiSessionInput): Promise<TeamApiSessionRow> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO team_api_sessions
         (team_id, user_id, token_hash, auth_source, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
       RETURNING ${TEAM_API_SESSION_COLS}`,
      [
        input.teamId,
        input.userId,
        input.tokenHash,
        input.authSource,
        input.expiresAt,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapTeamApiSessionRow(rows[0]);
  }

  async getActiveTeamApiSessionByHash(tokenHash: string): Promise<TeamApiSessionRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `UPDATE team_api_sessions
          SET last_seen_at = now()
        WHERE token_hash = $1
          AND status = 'active'
          AND expires_at > now()
        RETURNING ${TEAM_API_SESSION_COLS}`,
      [tokenHash],
    );
    return rows.length ? mapTeamApiSessionRow(rows[0]) : null;
  }

  async revokeTeamApiSessionByHash(tokenHash: string): Promise<TeamApiSessionRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `UPDATE team_api_sessions
          SET status = 'revoked', revoked_at = now()
        WHERE token_hash = $1 AND status = 'active'
        RETURNING ${TEAM_API_SESSION_COLS}`,
      [tokenHash],
    );
    return rows.length ? mapTeamApiSessionRow(rows[0]) : null;
  }

  // ── Audit events ─────────────────────────────────────────────────────────────

  /**
   * Append an audit event. Issues no transaction control of its own, so it is safe
   * to call standalone OR inside an open transaction (grant/revoke do the latter).
   */
  async recordAuditEvent(input: RecordAuditEventInput): Promise<AuditEventRow> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      `INSERT INTO audit_events
         (team_id, actor_user_id, action, target_type, target_id, summary, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING ${AUDIT_COLS}`,
      [
        input.teamId,
        input.actorUserId ?? null,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.summary ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapAuditEventRow(rows[0]);
  }

  /** Query the audit trail by team, optionally narrowed to a target. Newest first. */
  async listAuditEvents(filter: ListAuditEventsFilter): Promise<AuditEventRow[]> {
    const conditions = ["team_id = $1"];
    const params: unknown[] = [filter.teamId];
    if (filter.targetType != null) {
      params.push(filter.targetType);
      conditions.push(`target_type = $${params.length}`);
    }
    if (filter.targetId != null) {
      params.push(filter.targetId);
      conditions.push(`target_id = $${params.length}`);
    }
    let sql = `SELECT ${AUDIT_COLS} FROM audit_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC`;
    if (filter.limit != null) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const { rows } = await this.client.query<Record<string, unknown>>(sql, params);
    return rows.map(mapAuditEventRow);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.closeFn();
  }

  /** Run `fn` inside a single BEGIN/COMMIT, rolling back on any error. */
  private async transaction<T>(fn: (store: IdentityStore) => Promise<T>): Promise<T> {
    if (typeof this.client.transaction === "function") {
      return this.client.transaction(async (client) => {
        const txStore = new IdentityStore(client, async () => {});
        return fn(txStore);
      });
    }
    await this.client.exec("BEGIN");
    try {
      const result = await fn(this);
      await this.client.exec("COMMIT");
      return result;
    } catch (error) {
      await this.client.exec("ROLLBACK");
      throw error;
    }
  }
}

/**
 * Open (and migrate) the identity store, selecting the engine via
 * {@link resolveMemoryBackend}: hosted Postgres when a connection string is
 * configured (or `backend: "postgres"`), else local PGLite. applyMigrations runs
 * the shared memory and identity migration sequence in one database.
 *
 * Pass `opts.client` to wrap an already-open connection (shared with the memory
 * store); open + migrate are then skipped and `close()` is a no-op.
 *
 * Safety mirrors openMemoryStore: when the resolved engine is Postgres, a
 * connection or migration failure PROPAGATES — this never substitutes the local
 * PGLite store for a hosted one.
 */
export async function openIdentityStore(
  opts: OpenIdentityStoreOptions = {},
): Promise<IdentityStore> {
  if (opts.client) {
    return new IdentityStore(opts.client, async () => {});
  }

  const embedDim = opts.embedDim ?? DEFAULT_EMBED_DIM;
  const backend = resolveMemoryBackend(
    { backend: opts.backend, connectionString: opts.connectionString, dataDir: opts.dataDir },
    process.env,
  );

  if (backend.kind === "postgres") {
    const pg = await openPostgres(backend.connectionString);
    try {
      await applyMigrations(pg.client, { embedDim });
    } catch (error) {
      await pg.close();
      throw error;
    }
    return new IdentityStore(pg.client, pg.close);
  }

  // The local PGLite store is a regenerable derived index; quarantine a corrupt
  // dir and start fresh rather than wedging every command (same as the memory store).
  const { client, close } = await openPGlite(backend.dataDir, { recreateCorruptDir: true });
  try {
    await applyMigrations(client, { embedDim });
  } catch (error) {
    await close();
    throw error;
  }
  return new IdentityStore(client, close);
}
