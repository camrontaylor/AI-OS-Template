import { create } from "zustand";
import { notifyLocalProfileChange } from "../lib/profile-storage";
import type { BrowserLocalProfileV1, LocalProfileLockedCode } from "../lib/local-profile";

export const TEAM_CONTEXT_CHANGE_EVENT = "team-context-change";

export type CompanyRole = "owner" | "admin";
export type EffectiveTeamAccessSource = "membership" | "company_owner" | "company_grant";

export interface CompanyNavigationMembership {
  id?: string | null;
  userId?: string | null;
  role: CompanyRole;
  status: string;
}

export interface EffectiveTeamAccess {
  companyRole: CompanyRole | null;
  source: EffectiveTeamAccessSource;
  effectiveRole: "owner" | "admin" | "member";
  fullAccess: boolean;
  protected: boolean;
  membership?: {
    id?: string | null;
    role?: string | null;
    status?: string | null;
  } | null;
}

export interface TeamNavigationMembership {
  id: string;
  slug: string | null;
  name: string | null;
  membership: {
    role?: string | null;
    status?: string | null;
  };
  access?: EffectiveTeamAccess | null;
  pendingRequest?: boolean;
}

export interface TeamNavigationScopeLabels {
  version: 1;
  teams: Array<{
    id: string;
    name: string | null;
    slug: string | null;
    lastSeenAt: string;
  }>;
  clients: Array<{
    teamId: string;
    clientId: string;
    name: string | null;
    lastSeenAt: string;
  }>;
}

export interface TeamNavigationStatus {
  status: "signed_out" | "connected" | "blocked" | "unavailable";
  signedIn: boolean;
  apiUrl?: string;
  savedAt?: string | null;
  expiresAt?: string | null;
  tokenType?: string | null;
  authSource?: string | null;
  error?: string;
  user?: { email?: string | null; displayName?: string | null; id?: string };
  team?: { name?: string | null; slug?: string | null; id?: string };
  membership?: { role?: string | null; status?: string | null };
  companyMembership?: CompanyNavigationMembership | null;
  effectiveAccess?: EffectiveTeamAccess | null;
  pendingAccessRequestCount: number;
  health?: { backend?: string; embedder?: { model?: string; dim?: number } };
  clients: Array<{
    id: string;
    slug: string;
    name?: string | null;
    access: "read" | "write";
  }>;
  serverId: string | null;
  selectedTeamId: string | null;
  teams: TeamNavigationMembership[];
  scopeLabels: TeamNavigationScopeLabels;
  localProfile?: BrowserLocalProfileV1;
  localProfileError?: {
    code: "profile_locked";
    reason: LocalProfileLockedCode;
    message: string;
  };
}

interface TeamNavigationStore {
  status: TeamNavigationStatus;
  loading: boolean;
  switchingTeamId: string | null;
  error: string | null;
  refresh: () => Promise<TeamNavigationStatus | null>;
  selectTeam: (teamId: string) => Promise<boolean>;
  reset: () => void;
}

export const EMPTY_TEAM_NAVIGATION_STATUS: TeamNavigationStatus = {
  status: "signed_out",
  signedIn: false,
  clients: [],
  serverId: null,
  selectedTeamId: null,
  teams: [],
  scopeLabels: { version: 1, teams: [], clients: [] },
  pendingAccessRequestCount: 0,
};

let requestGeneration = 0;
let selectionIntent = 0;
let activeRefreshController: AbortController | null = null;
let selectionQueue: Promise<void> = Promise.resolve();
let lastPersistedTeamId: string | null = null;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeMembership(value: unknown): TeamNavigationMembership["membership"] {
  const record = asRecord(value);
  return {
    role: typeof record.role === "string" ? record.role : null,
    status: typeof record.status === "string" ? record.status : null,
  };
}

function normalizeCompanyMembership(value: unknown): CompanyNavigationMembership | null {
  const record = asRecord(value);
  if (record.role !== "owner" && record.role !== "admin") return null;
  const status = typeof record.status === "string" ? record.status : "active";
  return {
    id: nullableString(record.id),
    userId: nullableString(record.userId),
    role: record.role,
    status,
  };
}

function normalizeEffectiveAccess(value: unknown): EffectiveTeamAccess | null {
  const record = asRecord(value);
  const source = record.source;
  const effectiveRole = record.effectiveRole;
  if (
    source !== "membership"
    && source !== "company_owner"
    && source !== "company_grant"
  ) return null;
  if (effectiveRole !== "owner" && effectiveRole !== "admin" && effectiveRole !== "member") return null;
  const companyRole = record.companyRole === "owner" || record.companyRole === "admin"
    ? record.companyRole
    : null;
  return {
    companyRole,
    source,
    effectiveRole,
    fullAccess: record.fullAccess === true,
    protected: record.protected === true,
    membership: Object.keys(asRecord(record.membership)).length
      ? normalizeMembership(record.membership)
      : null,
  };
}

function normalizeTeams(value: unknown): TeamNavigationMembership[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) return [];
    return [{
      id,
      slug: nullableString(record.slug),
      name: nullableString(record.name),
      membership: normalizeMembership(record.membership),
      access: normalizeEffectiveAccess(record.access ?? record.effectiveAccess),
      pendingRequest: record.pendingRequest === true,
    }];
  });
}

function normalizeScopeLabels(value: unknown): TeamNavigationScopeLabels {
  const record = asRecord(value);
  const teams = Array.isArray(record.teams)
    ? record.teams.flatMap((item) => {
        const team = asRecord(item);
        const id = nullableString(team.id);
        const lastSeenAt = nullableString(team.lastSeenAt);
        if (!id || !lastSeenAt) return [];
        return [{
          id,
          name: nullableString(team.name),
          slug: nullableString(team.slug),
          lastSeenAt,
        }];
      })
    : [];
  const clients = Array.isArray(record.clients)
    ? record.clients.flatMap((item) => {
        const client = asRecord(item);
        const teamId = nullableString(client.teamId);
        const clientId = nullableString(client.clientId);
        const lastSeenAt = nullableString(client.lastSeenAt);
        if (!teamId || !clientId || !lastSeenAt) return [];
        return [{
          teamId,
          clientId,
          name: nullableString(client.name),
          lastSeenAt,
        }];
      })
    : [];
  return { version: 1, teams, clients };
}

const LOCAL_PROFILE_LOCK_REASONS = new Set<LocalProfileLockedCode>([
  "corrupt_context",
  "identity_incomplete",
  "reauthentication_required",
  "profile_metadata_invalid",
  "profile_missing",
  "profile_migration_failed",
]);

function normalizeLocalProfile(value: unknown): BrowserLocalProfileV1 | undefined {
  const profile = asRecord(value);
  if (
    profile.version !== 1
    || (profile.mode !== "solo" && profile.mode !== "team")
    || typeof profile.profileKey !== "string"
    || typeof profile.sessionId !== "string"
  ) {
    return undefined;
  }
  return {
    version: 1,
    mode: profile.mode,
    profileKey: profile.profileKey,
    sessionId: profile.sessionId,
  };
}

function normalizeLocalProfileError(value: unknown): TeamNavigationStatus["localProfileError"] {
  const error = asRecord(value);
  if (
    error.code !== "profile_locked"
    || typeof error.reason !== "string"
    || !LOCAL_PROFILE_LOCK_REASONS.has(error.reason as LocalProfileLockedCode)
    || typeof error.message !== "string"
  ) {
    return undefined;
  }
  return {
    code: "profile_locked",
    reason: error.reason as LocalProfileLockedCode,
    message: error.message,
  };
}

export function isLocalProfileLocked(status: TeamNavigationStatus): boolean {
  return Boolean(
    status.localProfileError
    || status.localProfile?.profileKey === "locked"
    || status.localProfile?.sessionId === "locked"
  );
}

export function isTeamNavigationAvailable(status: TeamNavigationStatus): boolean {
  return status.status === "connected" && !isLocalProfileLocked(status);
}

export function canReconnectLocalProfile(status: TeamNavigationStatus): boolean {
  if (!isLocalProfileLocked(status)) return false;
  const reason = status.localProfileError?.reason;
  return reason !== "profile_missing" && reason !== "profile_migration_failed";
}

function isUsableLocalProfile(profile: BrowserLocalProfileV1 | undefined): profile is BrowserLocalProfileV1 {
  return Boolean(profile && profile.profileKey !== "locked" && profile.sessionId !== "locked");
}

export function normalizeTeamNavigationStatus(value: unknown): TeamNavigationStatus {
  const record = asRecord(value);
  const rawStatus = record.status;
  const status = rawStatus === "connected" || rawStatus === "blocked" || rawStatus === "unavailable"
    ? rawStatus
    : "signed_out";
  const user = asRecord(record.user);
  const team = asRecord(record.team);
  const membership = asRecord(record.membership);
  const companyMembership = normalizeCompanyMembership(record.companyMembership);
  const health = asRecord(record.health);
  const embedder = asRecord(health.embedder);
  const clients = Array.isArray(record.clients)
    ? record.clients.flatMap((item) => {
        const client = asRecord(item);
        return typeof client.slug === "string"
          ? [{
              id: typeof client.id === "string" ? client.id : client.slug,
              slug: client.slug,
              name: nullableString(client.name),
              access: client.access === "write" ? "write" as const : "read" as const,
            }]
          : [];
      })
    : [];

  return {
    status,
    signedIn: record.signedIn === true,
    apiUrl: optionalString(record.apiUrl),
    savedAt: nullableString(record.savedAt),
    expiresAt: nullableString(record.expiresAt),
    tokenType: nullableString(record.tokenType),
    authSource: nullableString(record.authSource),
    error: optionalString(record.error),
    user: Object.keys(user).length ? {
      email: nullableString(user.email),
      displayName: nullableString(user.displayName),
      id: optionalString(user.id),
    } : undefined,
    team: Object.keys(team).length ? {
      name: nullableString(team.name),
      slug: nullableString(team.slug),
      id: optionalString(team.id),
    } : undefined,
    membership: Object.keys(membership).length ? normalizeMembership(membership) : undefined,
    companyMembership,
    effectiveAccess: normalizeEffectiveAccess(record.effectiveAccess)
      ?? normalizeTeams(record.teams).find((item) => item.id === nullableString(record.selectedTeamId))?.access
      ?? null,
    pendingAccessRequestCount: typeof record.pendingAccessRequestCount === "number"
      ? Math.max(0, Math.trunc(record.pendingAccessRequestCount))
      : typeof record.pendingRequestCount === "number"
        ? Math.max(0, Math.trunc(record.pendingRequestCount))
        : 0,
    health: Object.keys(health).length ? {
      backend: optionalString(health.backend),
      embedder: Object.keys(embedder).length ? {
        model: optionalString(embedder.model),
        dim: typeof embedder.dim === "number" ? embedder.dim : undefined,
      } : undefined,
    } : undefined,
    clients,
    serverId: nullableString(record.serverId),
    selectedTeamId: nullableString(record.selectedTeamId),
    teams: normalizeTeams(record.teams),
    scopeLabels: normalizeScopeLabels(record.scopeLabels),
    localProfile: normalizeLocalProfile(record.localProfile),
    localProfileError: normalizeLocalProfileError(record.localProfileError),
  };
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = asRecord(await response.json().catch(() => ({})));
  const error = body.error;
  if (typeof error === "string") return error;
  const errorRecord = asRecord(error);
  return typeof errorRecord.message === "string" ? errorRecord.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function notifyTeamContextChange(selectedTeamId: string | null = null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TEAM_CONTEXT_CHANGE_EVENT, {
    detail: { selectedTeamId },
  }));
}

export const useTeamNavigationStore = create<TeamNavigationStore>((set, get) => ({
  status: EMPTY_TEAM_NAVIGATION_STATUS,
  loading: false,
  switchingTeamId: null,
  error: null,

  refresh: async () => {
    const generation = ++requestGeneration;
    activeRefreshController?.abort();
    const controller = new AbortController();
    activeRefreshController = controller;
    set({ loading: true });

    try {
      const response = await fetch("/api/team/status", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response, "Team status unavailable"));
      const status = normalizeTeamNavigationStatus(await response.json());
      if (generation !== requestGeneration) return null;
      lastPersistedTeamId = status.selectedTeamId;
      set({ status, loading: false, error: status.error ?? null });
      if (isUsableLocalProfile(status.localProfile)) {
        notifyLocalProfileChange(status.localProfile);
      }
      return status;
    } catch (error) {
      if (generation !== requestGeneration || isAbortError(error)) return null;
      const message = error instanceof Error ? error.message : "Team status unavailable";
      set({ loading: false, error: message });
      return null;
    } finally {
      if (activeRefreshController === controller) activeRefreshController = null;
    }
  },

  selectTeam: async (teamId) => {
    const intent = ++selectionIntent;
    ++requestGeneration;
    activeRefreshController?.abort();
    set({ switchingTeamId: teamId, error: null });

    let resolveResult!: (value: boolean) => void;
    const result = new Promise<boolean>((resolve) => {
      resolveResult = resolve;
    });

    selectionQueue = selectionQueue.then(async () => {
      try {
        const response = await fetch("/api/team/session", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ teamId }),
        });
        if (!response.ok) throw new Error(await responseError(response, "Could not select team"));
        const status = normalizeTeamNavigationStatus(await response.json());
        lastPersistedTeamId = status.selectedTeamId;
        if (intent === selectionIntent) {
          set({ status, switchingTeamId: null, loading: false, error: status.error ?? null });
          notifyTeamContextChange(status.selectedTeamId);
        }
        resolveResult(true);
      } catch (error) {
        if (intent === selectionIntent) {
          const confirmedTeamId = get().status.selectedTeamId;
          if (confirmedTeamId && lastPersistedTeamId && lastPersistedTeamId !== confirmedTeamId) {
            try {
              const restoreResponse = await fetch("/api/team/session", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ teamId: confirmedTeamId }),
              });
              if (restoreResponse.ok) {
                const restored = normalizeTeamNavigationStatus(await restoreResponse.json());
                lastPersistedTeamId = restored.selectedTeamId;
              }
            } catch {
              // Keep the last confirmed UI state. The next status refresh reconciles the server state.
            }
          }
          if (intent === selectionIntent) {
            set({
              switchingTeamId: null,
              error: error instanceof Error ? error.message : "Could not select team",
            });
          }
        }
        resolveResult(false);
      }
    });

    return result;
  },

  reset: () => {
    ++requestGeneration;
    ++selectionIntent;
    activeRefreshController?.abort();
    lastPersistedTeamId = null;
    set({
      status: EMPTY_TEAM_NAVIGATION_STATUS,
      loading: false,
      switchingTeamId: null,
      error: null,
    });
  },
}));
