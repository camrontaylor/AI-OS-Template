import type {
  CompanyNavigationMembership,
  EffectiveTeamAccess,
} from "@/store/team-navigation-store";

export type CompanyTeamStatusFilter = "all" | "active" | "archived";
export type CompanyTeamAccessFilter = "all" | "full" | "none";

export interface CompanyPerson {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role?: string | null;
  status: string;
  protected?: boolean;
  accessSource?: EffectiveTeamAccess["source"] | null;
}

export interface CompanyTeam {
  id: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  archivedAt: string | null;
  archivedBy: string | null;
  owners: CompanyPerson[];
  memberCount: number;
  access: EffectiveTeamAccess | null;
  pendingRequest: boolean;
  members: CompanyPerson[];
}

export interface CompanyAdmin extends CompanyPerson {
  companyRole: "owner" | "admin";
  inviteUrl?: string | null;
}

export interface CompanyAccessRequest {
  id: string;
  teamId: string;
  teamName: string;
  userId: string;
  email: string;
  displayName: string;
  reason: string | null;
  status: string;
  createdAt: string | null;
  resolvedAt: string | null;
}

export type CompanyAdminTeamAccessSource = "company_grant" | "team_owner" | "team_admin";

export interface CompanyAdminTeamAccess {
  userId: string;
  teamId: string;
  source: CompanyAdminTeamAccessSource;
}

export interface CompanyAccessGrant {
  id: string;
  teamId: string;
  teamName: string;
  userId: string;
  email: string;
  displayName: string;
  status: string;
  protected: boolean;
}

export interface CompanyTeamsState {
  companyMembership: CompanyNavigationMembership | null;
  pendingAccessRequestCount: number;
  teams: CompanyTeam[];
  selectedTeam: CompanyTeam | null;
  eligibleOwners: CompanyPerson[];
  existingUsers: CompanyPerson[];
}

export interface CompanyMembershipsState {
  companyMembership: CompanyNavigationMembership | null;
  memberships: CompanyAdmin[];
  pendingInvitations: CompanyAdmin[];
  inviteUrl: string | null;
}

export interface CompanyAccessState {
  companyMembership: CompanyNavigationMembership | null;
  pendingAccessRequestCount: number;
  requests: CompanyAccessRequest[];
  grants: CompanyAccessGrant[];
  admins: CompanyAdmin[];
  teams: CompanyTeam[];
  adminTeamAccess: CompanyAdminTeamAccess[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function normalizeCompanyMembership(value: unknown): CompanyNavigationMembership | null {
  const item = record(value);
  if (item.role !== "owner" && item.role !== "admin") return null;
  return {
    id: nullableText(item.id),
    userId: nullableText(item.userId),
    role: item.role,
    status: text(item.status, "active"),
  };
}

export function normalizeEffectiveTeamAccess(value: unknown): EffectiveTeamAccess | null {
  const item = record(value);
  if (
    item.source !== "membership"
    && item.source !== "company_owner"
    && item.source !== "company_grant"
  ) return null;
  if (item.effectiveRole !== "owner" && item.effectiveRole !== "admin" && item.effectiveRole !== "member") return null;
  const membership = record(item.membership);
  return {
    companyRole: item.companyRole === "owner" || item.companyRole === "admin" ? item.companyRole : null,
    source: item.source,
    effectiveRole: item.effectiveRole,
    fullAccess: item.fullAccess === true,
    protected: item.protected === true,
    membership: Object.keys(membership).length ? {
      id: nullableText(membership.id),
      role: nullableText(membership.role),
      status: nullableText(membership.status),
    } : null,
  };
}

export function normalizeCompanyPerson(value: unknown): CompanyPerson | null {
  const item = record(value);
  const user = record(item.user);
  const userId = text(item.userId || user.id || item.id).trim();
  const email = text(item.email || user.email).trim();
  if (!userId && !email) return null;
  return {
    id: text(item.id, userId || email),
    userId: userId || email,
    email,
    displayName: text(item.displayName || item.name || user.displayName || user.name, email || userId),
    role: nullableText(item.role || item.effectiveRole),
    status: text(item.status, "active"),
    protected: item.protected === true,
    accessSource: item.source === "membership" || item.source === "company_owner" || item.source === "company_grant"
      ? item.source
      : null,
  };
}

function normalizePeople(value: unknown): CompanyPerson[] {
  if (!Array.isArray(value)) return [];
  const byUser = new Map<string, CompanyPerson>();
  for (const raw of value) {
    const person = normalizeCompanyPerson(raw);
    if (!person) continue;
    const key = person.userId || person.email.toLowerCase();
    const current = byUser.get(key);
    byUser.set(key, current ? {
      ...current,
      ...person,
      role: person.role === "owner" || current.role !== "owner" ? person.role : current.role,
      protected: current.protected || person.protected,
      accessSource: person.accessSource ?? current.accessSource,
    } : person);
  }
  return [...byUser.values()];
}

export function normalizeCompanyTeam(value: unknown): CompanyTeam | null {
  const item = record(value);
  const id = text(item.id).trim();
  if (!id) return null;
  const status = item.status === "archived" || nullableText(item.archivedAt) ? "archived" : "active";
  const members = normalizePeople(item.members);
  const owners = normalizePeople(item.owners).length
    ? normalizePeople(item.owners)
    : members.filter((member) => member.role === "owner" && member.status === "active");
  return {
    id,
    slug: text(item.slug, id),
    name: text(item.name, text(item.slug, id)),
    status,
    archivedAt: nullableText(item.archivedAt),
    archivedBy: nullableText(item.archivedBy),
    owners,
    memberCount: nonNegativeInteger(item.memberCount) || members.filter((member) => member.status === "active").length,
    access: normalizeEffectiveTeamAccess(item.access ?? item.effectiveAccess),
    pendingRequest: item.pendingRequest === true || record(item.pendingRequest).status === "pending",
    members,
  };
}

function normalizeTeams(value: unknown): CompanyTeam[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const team = normalizeCompanyTeam(item);
        return team ? [team] : [];
      })
    : [];
}

function normalizeCompanyAdmin(value: unknown): CompanyAdmin | null {
  const item = record(value);
  const person = normalizeCompanyPerson(value);
  const role = item.companyRole ?? item.role;
  if (!person || (role !== "owner" && role !== "admin")) return null;
  return {
    ...person,
    companyRole: role,
    inviteUrl: nullableText(item.inviteUrl || item.url),
  };
}

function normalizeAdmins(value: unknown): CompanyAdmin[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const admin = normalizeCompanyAdmin(item);
        return admin ? [admin] : [];
      })
    : [];
}

function normalizeAccessRequest(value: unknown): CompanyAccessRequest | null {
  const item = record(value);
  const team = record(item.team);
  const user = record(item.user);
  const id = text(item.id).trim();
  const teamId = text(item.teamId || team.id).trim();
  if (!id || !teamId) return null;
  return {
    id,
    teamId,
    teamName: text(item.teamName || team.name || team.slug, teamId),
    userId: text(item.userId || user.id),
    email: text(item.email || user.email),
    displayName: text(item.displayName || user.displayName || user.name, text(item.email || user.email, "Unknown user")),
    reason: nullableText(item.reason),
    status: text(item.status, "pending"),
    createdAt: nullableText(item.createdAt || item.requestedAt),
    resolvedAt: nullableText(item.resolvedAt),
  };
}

function normalizeAdminTeamAccess(value: unknown): CompanyAdminTeamAccess[] {
  if (!Array.isArray(value)) return [];
  const rows = new Map<string, CompanyAdminTeamAccess>();
  const precedence: Record<CompanyAdminTeamAccessSource, number> = {
    company_grant: 1,
    team_admin: 2,
    team_owner: 3,
  };
  for (const raw of value) {
    const item = record(raw);
    const userId = text(item.userId).trim();
    const teamId = text(item.teamId).trim();
    const source = item.source;
    if (
      !userId
      || !teamId
      || (source !== "company_grant" && source !== "team_owner" && source !== "team_admin")
    ) continue;
    const normalizedSource = source as CompanyAdminTeamAccessSource;
    const key = `${userId}:${teamId}`;
    const current = rows.get(key);
    if (!current || precedence[normalizedSource] > precedence[current.source]) {
      rows.set(key, { userId, teamId, source: normalizedSource });
    }
  }
  return [...rows.values()];
}

function normalizeAccessGrant(value: unknown): CompanyAccessGrant | null {
  const item = record(value);
  const team = record(item.team);
  const user = record(item.user);
  const id = text(item.id).trim();
  const teamId = text(item.teamId || team.id).trim();
  if (!id || !teamId) return null;
  return {
    id,
    teamId,
    teamName: text(item.teamName || team.name || team.slug, teamId),
    userId: text(item.userId || user.id),
    email: text(item.email || user.email),
    displayName: text(item.displayName || user.displayName || user.name, text(item.email || user.email, "Unknown user")),
    status: text(item.status, "active"),
    protected: item.protected === true,
  };
}

export function normalizeCompanyTeamsState(value: unknown): CompanyTeamsState {
  const body = record(value);
  const selected = normalizeCompanyTeam(body.selectedTeam);
  const teams = normalizeTeams(body.teams);
  const eligibleOwners = normalizePeople(body.eligibleOwners ?? body.users);
  const existingUsers = normalizePeople(body.existingUsers);
  return {
    companyMembership: normalizeCompanyMembership(body.companyMembership),
    pendingAccessRequestCount: nonNegativeInteger(body.pendingAccessRequestCount),
    teams,
    selectedTeam: selected ?? null,
    eligibleOwners,
    existingUsers: existingUsers.length ? existingUsers : eligibleOwners,
  };
}

export function normalizeCompanyMembershipsState(value: unknown): CompanyMembershipsState {
  const body = record(value);
  const invite = record(body.invite);
  return {
    companyMembership: normalizeCompanyMembership(body.companyMembership),
    memberships: normalizeAdmins(body.memberships),
    pendingInvitations: normalizeAdmins(body.pendingInvitations),
    inviteUrl: nullableText(body.inviteUrl || invite.url),
  };
}

export function normalizeCompanyAccessState(value: unknown): CompanyAccessState {
  const body = record(value);
  return {
    companyMembership: normalizeCompanyMembership(body.companyMembership),
    pendingAccessRequestCount: nonNegativeInteger(body.pendingAccessRequestCount),
    requests: Array.isArray(body.requests)
      ? body.requests.flatMap((item) => {
          const request = normalizeAccessRequest(item);
          return request ? [request] : [];
        })
      : [],
    grants: Array.isArray(body.grants)
      ? body.grants.flatMap((item) => {
          const grant = normalizeAccessGrant(item);
          return grant ? [grant] : [];
        })
      : [],
    admins: normalizeAdmins(body.admins),
    teams: normalizeTeams(body.teams),
    adminTeamAccess: normalizeAdminTeamAccess(body.adminTeamAccess),
  };
}

export function filterCompanyTeams(
  teams: CompanyTeam[],
  query: string,
  status: CompanyTeamStatusFilter,
  access: CompanyTeamAccessFilter,
): CompanyTeam[] {
  const term = query.trim().toLowerCase();
  return teams.filter((team) => {
    if (status !== "all" && team.status !== status) return false;
    if (access === "full" && team.access?.fullAccess !== true) return false;
    if (access === "none" && team.access?.fullAccess === true) return false;
    if (!term) return true;
    return [team.name, team.slug, ...team.owners.flatMap((owner) => [owner.displayName, owner.email])]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });
}

export function filterExistingUsers(
  people: CompanyPerson[],
  query: string,
  limit = 8,
): CompanyPerson[] {
  const term = query.trim().toLowerCase();
  if (!term || limit <= 0) return [];
  return people
    .filter((person) => `${person.displayName} ${person.email}`.toLowerCase().includes(term))
    .slice(0, limit);
}

export function slugifyTeamName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function canPermanentlyDeleteTeam(team: CompanyTeam, now = Date.now()): boolean {
  if (team.status !== "archived" || !team.archivedAt) return false;
  const archivedAt = Date.parse(team.archivedAt);
  return Number.isFinite(archivedAt) && now - archivedAt >= 30 * 24 * 60 * 60 * 1000;
}

export function accessLabel(access: EffectiveTeamAccess | null): string {
  if (access?.source === "membership" && access.effectiveRole === "member") return "Member access";
  if (!access?.fullAccess) return "No access";
  if (access.source === "company_owner") return "Company Owner";
  if (access.source === "company_grant") return "Full access";
  return access.effectiveRole === "owner" ? "Team Owner" : "Team Admin";
}

export function companyAdminMutationNotice(value: unknown): string {
  return record(value).promoted === true
    ? "Company Admin added."
    : "Company Admin invite created.";
}
