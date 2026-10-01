/**
 * AIOS Team Platform — row mappers.
 *
 * SQL is snake_case; the TS contract in ./types is camelCase. These mappers are
 * the single place that bridges the two when reading rows out of the identity
 * store, so a column rename touches exactly one file. Mirrors the design of
 * ../memory/row-mappers.ts.
 *
 * Timestamps and other values are normalized defensively (`String(...)` /
 * `Number(...)`) so the mappers stay robust across PGLite versions and a future
 * hosted-`pg` type parser. The store SELECTs cast timestamps to `::text`.
 */

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
  GrantStatus,
  MembershipRow,
  MembershipStatus,
  Role,
  SecretGrantAccess,
  SecretGrantRow,
  SecretScope,
  SecretStatus,
  SkillGrantRow,
  SkillPermission,
  TeamApiAuthSource,
  TeamApiSessionRow,
  TeamApiSessionStatus,
  TeamSecretRow,
  TeamRow,
  TeamStatus,
  UserConfigFileRow,
  UserRow,
  UserStatus,
  WorkstationRow,
  WorkstationStatus,
} from "./types";

type Row = Record<string, unknown>;

/** jsonb columns arrive as an object (PGLite) or a JSON string (some pg setups). */
function asJson(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value as Record<string, unknown>;
}

/** Map a `users` row to {@link UserRow}. */
export function mapUserRow(r: Row): UserRow {
  return {
    id: r.id as string,
    email: r.email as string,
    displayName: (r.display_name as string | null) ?? null,
    status: r.status as UserStatus,
    metadata: asJson(r.metadata),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Map a `teams` row to {@link TeamRow}. */
export function mapTeamRow(r: Row): TeamRow {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    status: r.status as TeamStatus,
    archivedAt: r.archived_at == null ? null : String(r.archived_at),
    archivedBy: (r.archived_by as string | null) ?? null,
    metadata: asJson(r.metadata),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Map a `memberships` row to {@link MembershipRow}. */
export function mapMembershipRow(r: Row): MembershipRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    userId: r.user_id as string,
    role: r.role as Role,
    status: r.status as MembershipStatus,
    invitedBy: (r.invited_by as string | null) ?? null,
    metadata: asJson(r.metadata),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Map a `company_memberships` row to {@link CompanyMembershipRow}. */
export function mapCompanyMembershipRow(r: Row): CompanyMembershipRow {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    role: r.role as CompanyRole,
    status: r.status as CompanyMembershipStatus,
    invitedBy: (r.invited_by as string | null) ?? null,
    inviteTokenHash: (r.invite_token_hash as string | null) ?? null,
    inviteExpiresAt: r.invite_expires_at == null ? null : String(r.invite_expires_at),
    acceptedAt: r.accepted_at == null ? null : String(r.accepted_at),
    removedAt: r.removed_at == null ? null : String(r.removed_at),
    metadata: asJson(r.metadata),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Map a `company_team_access_requests` row. */
export function mapCompanyAccessRequestRow(r: Row): CompanyAccessRequestRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    userId: r.user_id as string,
    status: r.status as CompanyAccessRequestStatus,
    reason: (r.reason as string | null) ?? null,
    requestedAt: String(r.requested_at),
    resolvedAt: r.resolved_at == null ? null : String(r.resolved_at),
    resolvedBy: (r.resolved_by as string | null) ?? null,
    metadata: asJson(r.metadata),
  };
}

/** Map a `company_team_access_grants` row. */
export function mapCompanyTeamAccessGrantRow(r: Row): CompanyTeamAccessGrantRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    userId: r.user_id as string,
    status: r.status as GrantStatus,
    grantedBy: (r.granted_by as string | null) ?? null,
    grantedAt: String(r.granted_at),
    revokedBy: (r.revoked_by as string | null) ?? null,
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    metadata: asJson(r.metadata),
  };
}

/** Map a `company_audit_events` row. */
export function mapCompanyAuditEventRow(r: Row): CompanyAuditEventRow {
  return {
    id: r.id as string,
    actorUserId: (r.actor_user_id as string | null) ?? null,
    action: r.action as string,
    targetType: r.target_type as string,
    targetId: (r.target_id as string | null) ?? null,
    teamId: (r.team_id as string | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    metadata: asJson(r.metadata),
    createdAt: String(r.created_at),
  };
}

/** Map a `clients` row to {@link ClientRow}. */
export function mapClientRow(r: Row): ClientRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    slug: r.slug as string,
    name: r.name as string,
    status: r.status as ClientStatus,
    metadata: asJson(r.metadata),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Map a `client_grants` row to {@link ClientGrantRow}. */
export function mapClientGrantRow(r: Row): ClientGrantRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    clientId: r.client_id as string,
    userId: r.user_id as string,
    access: r.access as GrantAccess,
    status: r.status as GrantStatus,
    grantedBy: (r.granted_by as string | null) ?? null,
    grantedAt: String(r.granted_at),
    revokedBy: (r.revoked_by as string | null) ?? null,
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    metadata: asJson(r.metadata),
  };
}

/** Map a `skill_grants` row to {@link SkillGrantRow}. */
export function mapSkillGrantRow(r: Row): SkillGrantRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    skillName: r.skill_name as string,
    userId: r.user_id as string,
    permission: r.permission as SkillPermission,
    status: r.status as GrantStatus,
    grantedBy: (r.granted_by as string | null) ?? null,
    grantedAt: String(r.granted_at),
    revokedBy: (r.revoked_by as string | null) ?? null,
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    metadata: asJson(r.metadata),
  };
}

/** Map a `team_secrets` row to {@link TeamSecretRow}. */
export function mapTeamSecretRow(r: Row): TeamSecretRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    clientId: (r.client_id as string | null) ?? null,
    scope: r.scope as SecretScope,
    name: r.name as string,
    envKey: r.env_key as string,
    encryptedValue: r.encrypted_value as string,
    encryptionKeyId: r.encryption_key_id as string,
    nonce: r.nonce as string,
    authTag: r.auth_tag as string,
    valueSha256: r.value_sha256 as string,
    status: r.status as SecretStatus,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    archivedAt: r.archived_at == null ? null : String(r.archived_at),
    metadata: asJson(r.metadata),
  };
}

/** Map a `secret_grants` row to {@link SecretGrantRow}. */
export function mapSecretGrantRow(r: Row): SecretGrantRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    secretId: r.secret_id as string,
    userId: r.user_id as string,
    access: r.access as SecretGrantAccess,
    status: r.status as GrantStatus,
    grantedBy: (r.granted_by as string | null) ?? null,
    grantedAt: String(r.granted_at),
    revokedBy: (r.revoked_by as string | null) ?? null,
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    metadata: asJson(r.metadata),
  };
}

/** Map a `user_config_files` row to {@link UserConfigFileRow}. */
export function mapUserConfigFileRow(r: Row): UserConfigFileRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    userId: r.user_id as string,
    path: r.path as string,
    encryptedValue: r.encrypted_value as string,
    encryptionKeyId: r.encryption_key_id as string,
    nonce: r.nonce as string,
    authTag: r.auth_tag as string,
    valueSha256: r.value_sha256 as string,
    status: r.status as "active" | "archived",
    updatedBy: (r.updated_by as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    archivedAt: r.archived_at == null ? null : String(r.archived_at),
    metadata: asJson(r.metadata),
  };
}

/** Map a `workstations` row to {@link WorkstationRow}. */
export function mapWorkstationRow(r: Row): WorkstationRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    userId: r.user_id as string,
    name: r.name as string,
    fingerprint: r.fingerprint as string,
    status: r.status as WorkstationStatus,
    registeredBy: (r.registered_by as string | null) ?? null,
    lastSeenAt: r.last_seen_at == null ? null : String(r.last_seen_at),
    metadata: asJson(r.metadata),
    createdAt: String(r.created_at),
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
  };
}

/** Map a `team_api_sessions` row to {@link TeamApiSessionRow}. */
export function mapTeamApiSessionRow(r: Row): TeamApiSessionRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    userId: r.user_id as string,
    tokenHash: r.token_hash as string,
    authSource: r.auth_source as TeamApiAuthSource,
    status: r.status as TeamApiSessionStatus,
    expiresAt: String(r.expires_at),
    createdAt: String(r.created_at),
    lastSeenAt: r.last_seen_at == null ? null : String(r.last_seen_at),
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    metadata: asJson(r.metadata),
  };
}

/** Map an `audit_events` row to {@link AuditEventRow}. */
export function mapAuditEventRow(r: Row): AuditEventRow {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    actorUserId: (r.actor_user_id as string | null) ?? null,
    action: r.action as AuditAction,
    targetType: r.target_type as AuditTargetType,
    targetId: (r.target_id as string | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    metadata: asJson(r.metadata),
    createdAt: String(r.created_at),
  };
}
