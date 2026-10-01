/**
 * AIOS Team Platform — identity & access-control row/enum types.
 *
 * The TypeScript contract for the team-platform models. They mirror the DDL in
 * ../memory/migrations/0004_team_platform.sql exactly. The store and row-mappers
 * import from here so there is a single source of truth for the row shapes.
 *
 * Naming: snake_case in SQL, camelCase in TS. ./row-mappers bridges the two.
 *
 * This module is intentionally dependency-free (pure types + const arrays) so it
 * loads stub-free under the runtime .ts loader the tests use.
 */

// ── Enums (must match the DB CHECK constraints in the migrations exactly) ────

/** A user's account state. */
export type UserStatus = "active" | "disabled";

/** A team's lifecycle state. */
export type TeamStatus = "active" | "archived";

/** A member's role within a team. owner ⊃ admin ⊃ member in capability. */
export type Role = "owner" | "admin" | "member";

/** Membership lifecycle. `invited` until the user joins; `suspended` pauses access. */
export type MembershipStatus = "active" | "invited" | "suspended";

/** A role at the single-company/server boundary. */
export type CompanyRole = "owner" | "admin";

/** Company membership and invite lifecycle. */
export type CompanyMembershipStatus = "invited" | "active" | "removed";

/** Company Admin request lifecycle for one Team. */
export type CompanyAccessRequestStatus = "pending" | "approved" | "denied" | "canceled";

/** A client workspace's lifecycle state. */
export type ClientStatus = "active" | "archived";

/** Client-access level. `write` implies `read`. */
export type GrantAccess = "read" | "write";

/** Grant lifecycle. Revoke flips to `revoked` (history is never deleted). */
export type GrantStatus = "active" | "revoked";

/** Per-skill permission. Higher permissions imply lower ones. */
export type SkillPermission = "skill.use" | "skill.read" | "skill.edit" | "skill.admin";

/** Secret scope. Team secrets sync to root .env; client secrets sync to client .env. */
export type SecretScope = "team" | "client";

/** Secret lifecycle. Archive keeps history without exposing values. */
export type SecretStatus = "active" | "archived";

/** Secret grant permission. V1 grants read/sync only. */
export type SecretGrantAccess = "read";

/** Private encrypted config file lifecycle. */
export type UserConfigFileStatus = "active" | "archived";

/** Workstation lifecycle. */
export type WorkstationStatus = "active" | "revoked";

/** Source of a Team API session token. */
export type TeamApiAuthSource = "browser-session" | "cli-device-token" | "api-key";

/** Team API session lifecycle. */
export type TeamApiSessionStatus = "active" | "revoked";

/** Sensitive actions recorded in the audit trail. Mirrors the audit CHECK list. */
export type AuditAction =
  | "membership.invited"
  | "membership.joined"
  | "membership.role_changed"
  | "membership.suspended"
  | "membership.removed"
  | "membership.invite_denied"
  | "membership.join_denied"
  | "grant.granted"
  | "grant.revoked"
  | "skill.granted"
  | "skill.revoked"
  | "secret.created"
  | "secret.updated"
  | "secret.archived"
  | "secret.granted"
  | "secret.revoked"
  | "secret.synced"
  | "config.synced"
  | "workstation.registered"
  | "workstation.revoked"
  | "client.created"
  | "client.archived"
  | "access.denied_use"
  | "access.denied_read"
  | "access.denied_edit"
  | "access.denied_search"
  | "access.denied_ingest"
  | "sync.pull"
  | "sync.push"
  | "sync.denied"
  | "sync.conflict"
  | "memory.imported"
  | "memory.published"
  | "memory.retry"
  | "memory.failed"
  | "memory.reindexed"
  | "memory.captured"
  | "memory.consolidation_claimed"
  | "memory.review_requested"
  | "memory.discarded"
  | "memory.updated"
  | "memory.deleted"
  | "context.read"
  | "context.write"
  | "context.denied"
  | "context.conflict"
  | "context.archived";

/** The kind of entity an audit event is about. */
export type AuditTargetType =
  | "user"
  | "membership"
  | "client"
  | "skill"
  | "grant"
  | "skill_grant"
  | "secret"
  | "secret_grant"
  | "user_config_file"
  | "workstation"
  | "team"
  | "memory_source"
  | "manual_import"
  | "memory_capture"
  | "memory_consolidation_batch"
  | "context_document";

export const ROLES: readonly Role[] = ["owner", "admin", "member"];
export const COMPANY_ROLES: readonly CompanyRole[] = ["owner", "admin"];
export const COMPANY_MEMBERSHIP_STATUSES: readonly CompanyMembershipStatus[] = [
  "invited",
  "active",
  "removed",
];
export const COMPANY_ACCESS_REQUEST_STATUSES: readonly CompanyAccessRequestStatus[] = [
  "pending",
  "approved",
  "denied",
  "canceled",
];
export const GRANT_ACCESS_LEVELS: readonly GrantAccess[] = ["read", "write"];
export const SKILL_PERMISSIONS: readonly SkillPermission[] = [
  "skill.use",
  "skill.read",
  "skill.edit",
  "skill.admin",
];
export const SECRET_SCOPES: readonly SecretScope[] = ["team", "client"];

// ── Row shapes (camelCase mirror of the snake_case columns) ──────────────────

/** A global user identity. Maps to `users`. */
export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** A team — the tenant boundary. Maps to `teams`. */
export interface TeamRow {
  id: string;
  slug: string;
  name: string;
  status: TeamStatus;
  archivedAt: string | null;
  archivedBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** A user's membership of a team, with a role. Maps to `memberships`. */
export interface MembershipRow {
  id: string;
  teamId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  invitedBy: string | null;
  /** Free-form bag. Holds a pending invite's hashed token + expiry until joined. */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** A client workspace owned by a team. Maps to `clients`. */
export interface ClientRow {
  id: string;
  teamId: string;
  slug: string;
  name: string;
  status: ClientStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** A read/write grant of one client to one member. Maps to `client_grants`. */
export interface ClientGrantRow {
  id: string;
  teamId: string;
  clientId: string;
  userId: string;
  access: GrantAccess;
  status: GrantStatus;
  grantedBy: string | null;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  metadata: Record<string, unknown>;
}

/** A per-skill grant to one user within a team. Maps to `skill_grants`. */
export interface SkillGrantRow {
  id: string;
  teamId: string;
  skillName: string;
  userId: string;
  permission: SkillPermission;
  status: GrantStatus;
  grantedBy: string | null;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  metadata: Record<string, unknown>;
}

/** An encrypted shared Team OS secret. Maps to `team_secrets`. */
export interface TeamSecretRow {
  id: string;
  teamId: string;
  clientId: string | null;
  scope: SecretScope;
  name: string;
  envKey: string;
  encryptedValue: string;
  encryptionKeyId: string;
  nonce: string;
  authTag: string;
  valueSha256: string;
  status: SecretStatus;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
}

/** A per-user grant to sync one Team OS secret. Maps to `secret_grants`. */
export interface SecretGrantRow {
  id: string;
  teamId: string;
  secretId: string;
  userId: string;
  access: SecretGrantAccess;
  status: GrantStatus;
  grantedBy: string | null;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  metadata: Record<string, unknown>;
}

/** An encrypted per-user config file, such as `.mcp.json`. */
export interface UserConfigFileRow {
  id: string;
  teamId: string;
  userId: string;
  path: string;
  encryptedValue: string;
  encryptionKeyId: string;
  nonce: string;
  authTag: string;
  valueSha256: string;
  status: UserConfigFileStatus;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
}

/** A registered device/agent host bound to a user. Maps to `workstations`. */
export interface WorkstationRow {
  id: string;
  teamId: string;
  userId: string;
  name: string;
  fingerprint: string;
  status: WorkstationStatus;
  registeredBy: string | null;
  lastSeenAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  revokedAt: string | null;
}

/** A user-scoped Team API bearer session. Maps to `team_api_sessions`. */
export interface TeamApiSessionRow {
  id: string;
  teamId: string;
  userId: string;
  tokenHash: string;
  authSource: TeamApiAuthSource;
  status: TeamApiSessionStatus;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  metadata: Record<string, unknown>;
}

/** A user's Company Owner/Admin role. Maps to `company_memberships`. */
export interface CompanyMembershipRow {
  id: string;
  userId: string;
  role: CompanyRole;
  status: CompanyMembershipStatus;
  invitedBy: string | null;
  inviteTokenHash: string | null;
  inviteExpiresAt: string | null;
  acceptedAt: string | null;
  removedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** A Company Admin's request for Full access to one Team. */
export interface CompanyAccessRequestRow {
  id: string;
  teamId: string;
  userId: string;
  status: CompanyAccessRequestStatus;
  reason: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  metadata: Record<string, unknown>;
}

/** Explicit Company Admin Full access to one Team. */
export interface CompanyTeamAccessGrantRow {
  id: string;
  teamId: string;
  userId: string;
  status: GrantStatus;
  grantedBy: string | null;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  metadata: Record<string, unknown>;
}

export type EffectiveTeamAccessSource =
  | "company_owner"
  | "membership"
  | "company_grant";

/** Resolved Team authority after applying Company and Team-level precedence. */
export interface EffectiveTeamAccess {
  companyRole: CompanyRole | null;
  source: EffectiveTeamAccessSource;
  effectiveRole: Role;
  fullAccess: boolean;
  protected: boolean;
  membership: MembershipRow | null;
  companyMembership: CompanyMembershipRow | null;
  grant: CompanyTeamAccessGrantRow | null;
}

/** Company-level audit that survives Team deletion. */
export interface CompanyAuditEventRow {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  teamId: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Stable identity of this Team OS authority. Maps to the singleton table. */
export interface TeamOsInstanceRow {
  serverId: string;
  createdAt: string;
}

/** An append-only audit record. Maps to `audit_events`. */
export interface AuditEventRow {
  id: string;
  teamId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
