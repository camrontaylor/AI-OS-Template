/**
 * AIOS Team Platform — authorization helpers.
 *
 * The small, shared decision layer the team flows build on: resolve a user's
 * active role in a team and require a minimum role before a privileged action.
 * Kept dependency-light (pure reads over the identity store) so the invite/join,
 * grant/revoke, and enforcement layers all gate on the same rules.
 *
 * Roles are ranked owner > admin > member. Effective access combines active
 * Company authority with active Team memberships while archived Teams remain
 * blocked from normal runtime access.
 */

import type { IdentityStore } from "./store";
import type {
  ClientGrantRow,
  EffectiveTeamAccess,
  GrantAccess,
  MembershipRow,
  Role,
  SkillGrantRow,
  SkillPermission,
} from "./types";

/** Numeric rank for the role hierarchy. Higher outranks lower. */
export const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

/** Thrown when a caller lacks the role required for an action. */
export class PermissionError extends Error {
  readonly code = "forbidden";
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

/** The authenticated actor after the backend has resolved session/API-key state. */
export interface Principal {
  userId: string;
  teamId: string;
  membership: MembershipRow | null;
  access: EffectiveTeamAccess;
  authSource?: "browser-session" | "cli-device-token" | "api-key" | "dev-token" | "test";
  teamScopeSource?: "explicit-header" | "legacy-session" | "legacy-api-key" | "locked-token";
}

export interface ResolveEffectiveTeamAccessOptions {
  /** Company management may inspect archived Teams; normal runtime access may not. */
  includeArchived?: boolean;
}

export interface ResolvePrincipalInput {
  teamId: string;
  userId: string;
  authSource?: Principal["authSource"];
}

/** The caller's active membership of a team, or null if absent/invited/suspended. */
export async function getActiveMembership(
  store: IdentityStore,
  teamId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const membership = await store.getMembership(teamId, userId);
  return membership && membership.status === "active" ? membership : null;
}

/**
 * Resolve a Principal from backend-trusted identity data. Callers must pass
 * identity derived from a session, API key, device flow, or server config - not
 * from an arbitrary request body.
 */
export async function resolvePrincipal(
  store: IdentityStore,
  input: ResolvePrincipalInput,
): Promise<Principal> {
  const access = await requireEffectiveTeamRole(
    store,
    input.teamId,
    input.userId,
    "member",
  );
  return {
    userId: input.userId,
    teamId: input.teamId,
    membership: access.membership,
    access,
    authSource: input.authSource,
  };
}

/** True iff `role` meets or exceeds `minRole` in the hierarchy. */
export function roleMeets(role: Role, minRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/**
 * Resolve Team authority with the documented precedence:
 * Company Owner, direct Team Owner/Admin, Company Admin grant, Team Member.
 */
export async function resolveEffectiveTeamAccess(
  store: IdentityStore,
  teamId: string,
  userId: string,
  options: ResolveEffectiveTeamAccessOptions = {},
): Promise<EffectiveTeamAccess | null> {
  const [team, user] = await Promise.all([
    store.getTeam(teamId),
    store.getUserById(userId),
  ]);
  if (
    !team ||
    !user ||
    user.status !== "active" ||
    (!options.includeArchived && team.status !== "active")
  ) return null;

  const [membershipRow, companyMembershipRow, grantRow] = await Promise.all([
    store.getMembership(teamId, userId),
    store.getCompanyMembership(userId),
    store.getActiveCompanyTeamAccessGrant(teamId, userId),
  ]);
  const membership = membershipRow?.status === "active" ? membershipRow : null;
  const companyMembership = companyMembershipRow?.status === "active"
    ? companyMembershipRow
    : null;
  const grant = grantRow?.status === "active" ? grantRow : null;
  const companyRole = companyMembership?.role ?? null;

  if (companyRole === "owner") {
    return {
      companyRole,
      source: "company_owner",
      effectiveRole: "owner",
      fullAccess: true,
      protected: true,
      membership,
      companyMembership,
      grant,
    };
  }
  if (membership && (membership.role === "owner" || membership.role === "admin")) {
    return {
      companyRole,
      source: "membership",
      effectiveRole: membership.role,
      fullAccess: true,
      protected: false,
      membership,
      companyMembership,
      grant,
    };
  }
  if (companyRole === "admin" && grant) {
    return {
      companyRole,
      source: "company_grant",
      effectiveRole: "admin",
      fullAccess: true,
      protected: true,
      membership,
      companyMembership,
      grant,
    };
  }
  if (membership?.role === "member") {
    return {
      companyRole,
      source: "membership",
      effectiveRole: "member",
      fullAccess: false,
      protected: false,
      membership,
      companyMembership,
      grant,
    };
  }
  return null;
}

/** Require effective Team authority, including Company-level access. */
export async function requireEffectiveTeamRole(
  store: IdentityStore,
  teamId: string,
  userId: string,
  minRole: Role,
  options: ResolveEffectiveTeamAccessOptions = {},
): Promise<EffectiveTeamAccess> {
  const access = await resolveEffectiveTeamAccess(store, teamId, userId, options);
  if (!access || !roleMeets(access.effectiveRole, minRole)) {
    throw new PermissionError(`requires ${minRole} role on this team`);
  }
  return access;
}

/**
 * Require that `userId` holds at least `minRole` in `teamId`, returning the
 * membership when satisfied. Throws {@link PermissionError} otherwise — the single
 * gate the privileged flows call before mutating team state.
 */
export async function requireTeamRole(
  store: IdentityStore,
  teamId: string,
  userId: string,
  minRole: Role,
): Promise<MembershipRow> {
  const membership = await getActiveMembership(store, teamId, userId);
  if (!membership || !roleMeets(membership.role, minRole)) {
    throw new PermissionError(`requires ${minRole} role on this team`);
  }
  return membership;
}

/** True iff the held client grant satisfies the required access. */
export function grantAccessMeets(held: GrantAccess, required: GrantAccess): boolean {
  return held === "write" || required === "read";
}

/** Require a client grant unless Full access already covers the whole Team. */
export async function requireClientAccess(
  store: IdentityStore,
  principal: Principal,
  clientId: string,
  required: GrantAccess,
): Promise<ClientGrantRow | null> {
  if (principal.access.fullAccess) return null;
  const grant = await store.getActiveGrant(principal.teamId, clientId, principal.userId);
  if (!grant || !grantAccessMeets(grant.access, required)) {
    throw new PermissionError(`requires ${required} access to this client`);
  }
  return grant;
}

const SKILL_PERMISSION_RANK: Record<SkillPermission, number> = {
  "skill.use": 1,
  "skill.read": 2,
  "skill.edit": 3,
  "skill.admin": 4,
};

/** True iff the held skill permission satisfies the required permission. */
export function skillPermissionMeets(
  held: SkillPermission,
  required: SkillPermission,
): boolean {
  return SKILL_PERMISSION_RANK[held] >= SKILL_PERMISSION_RANK[required];
}

/** Require one skill permission unless Full access already covers the Team. */
export async function requireSkillAccess(
  store: IdentityStore,
  principal: Principal,
  skillName: string,
  required: SkillPermission,
): Promise<SkillGrantRow | null> {
  if (principal.access.fullAccess) return null;
  const grants = await store.listActiveSkillGrants(principal.teamId, skillName, principal.userId);
  const match = grants.find((grant) => skillPermissionMeets(grant.permission, required));
  if (!match) {
    throw new PermissionError(`requires ${required} on skill ${skillName}`);
  }
  return match;
}
