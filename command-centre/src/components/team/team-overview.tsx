"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  FileText,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  MoreVertical,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { DeleteConfirmButton } from "@/components/shared/delete-confirm-button";
import { MarkdownPreview } from "@/components/shared/markdown-preview";
import { SyncConflictModal, type SyncConflict } from "@/components/team/sync-conflict-modal";
import { CompanyTeamsSection } from "@/components/team/company-teams-section";
import {
  CLIENT_SLUG_MAX_LENGTH,
  clientSlugValidationError,
  normalizeClientSlug,
  suggestClientSlug,
} from "@/lib/client-slug";
import type { SyncItemStatus, SyncStateFile, SyncStateSummary } from "@/lib/sync-state";
import { profileStorageKey } from "@/lib/profile-storage";
import {
  useTeamNavigationStore,
  type TeamNavigationStatus,
} from "@/store/team-navigation-store";

type GrantAccess = "read" | "write";
const SKILL_PERMISSIONS = ["skill.use", "skill.read", "skill.edit", "skill.admin"] as const;
type SkillPermission = (typeof SKILL_PERMISSIONS)[number];
type SkillSource = "server" | "managed" | "local";
type SkillLocalStatus = "ready" | "not_synced" | "orphaned" | "removing" | "unknown";
type SkillSort = "updated-desc" | "created-desc" | "name-asc" | "name-desc";

const TEAM_SKILLS_API = "/api/team/skills";
const SKILL_SYNC_API = "/api/team/sync-skill";
const TEAM_SECRETS_API = "/api/team/secrets";
const TEAM_SECRETS_SYNC_API = "/api/team/secrets/sync";
const TEAM_MEMORIES_API = "/api/team/memories";
const SKILL_PAGE_SIZE_STORAGE_KEY = "team-skills-page-size";

type TeamClient = {
  id: string;
  slug: string;
  name?: string | null;
  access?: GrantAccess;
};

type TeamStatus = TeamNavigationStatus;

type AdminMember = {
  id?: string | null;
  userId?: string | null;
  email?: string | null;
  displayName?: string | null;
  role?: string | null;
  status?: string | null;
  protected?: boolean;
  source?: "membership" | "company_owner" | "company_grant" | null;
  effectiveRole?: "owner" | "admin" | "member" | null;
  clients?: Array<{ id: string; slug: string; name?: string | null; access: GrantAccess }>;
};

type AdminClient = {
  id: string;
  slug: string;
  name?: string | null;
  status?: string | null;
};

type ClientGrant = {
  id: string;
  clientId: string;
  clientSlug: string;
  clientName?: string | null;
  userId: string;
  email: string;
  access: GrantAccess;
  status: string;
  implicit?: boolean;
  protected?: boolean;
};

type SkillGrant = {
  id: string;
  skillName: string;
  userId?: string | null;
  email: string;
  permission: SkillPermission;
  status: string;
  grantedAt?: string | null;
  revokedAt?: string | null;
};

type SkillCatalogItem = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  source: SkillSource;
  userPermission?: SkillPermission | null;
  localOnly?: boolean;
  managed?: boolean;
  hasLocal?: boolean;
  adoptable?: boolean;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type SkillRow = SkillCatalogItem & {
  grants: SkillGrant[];
  activeGrants: SkillGrant[];
  localStatus: SkillLocalStatus;
  hasLocal?: boolean;
  adoptable?: boolean;
  syncState?: SyncStateSummary;
};

type SkillSyncInfo = {
  slug: string;
  localStatus: SkillLocalStatus;
  managed?: boolean;
  hasAccess?: boolean;
  hasLocal?: boolean;
  adoptable?: boolean;
  syncState?: SyncStateSummary;
};

type TeamSecretGrant = {
  id: string;
  userId: string;
  email?: string | null;
  access: "read";
  status: string;
  grantedAt?: string | null;
};

type TeamSecret = {
  id: string;
  name: string;
  envKey: string;
  scope: "team" | "client";
  clientId?: string | null;
  clientSlug?: string | null;
  clientName?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  grantedToCurrentUser?: boolean;
  grants?: TeamSecretGrant[];
};

type AdminState = {
  members?: AdminMember[];
  clients?: AdminClient[];
  clientGrants?: ClientGrant[];
  skillGrants?: SkillGrant[];
  storage?: {
    workspaceRoot?: string;
    writable?: boolean;
    configuredRoot?: boolean;
    likelyPersistent?: boolean;
    warning?: string | null;
    backup?: {
      configured?: boolean;
      branch?: string;
      warning?: string | null;
    };
    error?: string | null;
  };
  invite?: { email: string; role: string; expiresAt: string; url: string };
  reset?: { email: string; expiresAt: string; url: string };
};

type ClientLocalStatus = "ready" | "not_synced";
type ClientSyncInfo = {
  localStatus: ClientLocalStatus;
  syncState?: SyncStateSummary;
};
type TeamSectionId = "dashboard" | "teams" | "members" | "clients" | "memories" | "secrets" | "skills";
type MemoryStatusFilter = "all" | "review" | "published" | "redacted";
type MemoryScopeFilter = "all" | "team" | "client";

type TeamMemoryScopeView = {
  teamId?: string | null;
  clientId?: string | null;
  clientSlug?: string | null;
  clientName?: string | null;
  userId?: string | null;
  visibility: "team" | "client";
};

type TeamMemoryReviewItem = {
  id: string;
  kind: "review";
  scope: TeamMemoryScopeView;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorDisplayName?: string | null;
  sessionId?: string | null;
  sourcePath?: string | null;
  sourceType?: string | null;
  title?: string | null;
  contentDate?: string | null;
  content?: string;
  contentAvailable?: boolean;
  status?: string | null;
  reason?: string | null;
  confidence?: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  processedAt?: string | null;
  redactedAt?: string | null;
};

type TeamMemoryPublishedItem = {
  id: string;
  kind: "published";
  scope: TeamMemoryScopeView;
  sourcePath?: string | null;
  sourceType?: string | null;
  title?: string | null;
  contentDate?: string | null;
  content?: string;
  chunkCount?: number;
  status?: string | null;
  errorMessage?: string | null;
  createdByUserId?: string | null;
  createdByEmail?: string | null;
  createdByDisplayName?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  indexedAt?: string | null;
  archivedAt?: string | null;
};

type TeamMemoryItem = TeamMemoryReviewItem | TeamMemoryPublishedItem;

type TeamMemoriesView = {
  admin: boolean;
  review: TeamMemoryReviewItem[];
  published: TeamMemoryPublishedItem[];
  counts?: {
    review?: number;
    redactedReview?: number;
    published?: number;
    team?: number;
    client?: number;
  };
};

type VisibleClient = {
  id: string;
  slug: string;
  name?: string | null;
  status?: string | null;
  access?: GrantAccess;
  localStatus: ClientLocalStatus;
  syncState?: SyncStateSummary;
  memberCount?: number;
  editorCount?: number;
  viewerCount?: number;
};

type TeamMemoryStatusView = {
  mode?: string;
  connected: boolean;
  apiUrl?: string;
  error?: string | null;
  outbox?: {
    byStatus?: Record<string, number>;
    queued?: number;
    syncing?: number;
    failed?: number;
    total?: number;
    error?: string | null;
  } | null;
  status?: {
    storeReady?: boolean;
    sources?: number;
    chunks?: number;
    jobs?: number;
    captureEvents?: number;
    byVisibility?: Record<string, number>;
    jobsByStatus?: Record<string, number>;
    captureEventsByStatus?: Record<string, number>;
    captureEligibility?: {
      pending?: number;
      eligiblePending?: number;
      waitingPending?: number;
      nextEligibleAt?: string | null;
      volumeThreshold?: number;
    };
    lastIndexedAt?: string | null;
    lastJob?: {
      sourcePath?: string;
      reason?: string;
      status?: string;
      errorMessage?: string | null;
      enqueuedAt?: string | null;
      startedAt?: string | null;
      finishedAt?: string | null;
    } | null;
  } | null;
};

const TEAM_SECTIONS: Array<{ id: TeamSectionId; label: string; detail: string; icon: typeof Activity; adminOnly?: boolean; companyOnly?: boolean }> = [
  { id: "dashboard", label: "Dashboard", detail: "Health and access", icon: LayoutDashboard },
  { id: "teams", label: "Teams", detail: "Company access", icon: Building2, companyOnly: true },
  { id: "members", label: "Members", detail: "People and invites", icon: UserPlus, adminOnly: true },
  { id: "clients", label: "Clients", detail: "Workspace access", icon: ShieldCheck },
  { id: "memories", label: "Memories", detail: "Review and recall", icon: Database, adminOnly: true },
  { id: "secrets", label: "Secrets", detail: "Shared keys", icon: KeyRound },
  { id: "skills", label: "Skills", detail: "Permissions and sync", icon: FileText },
];

export function TeamOverview() {
  const status = useTeamNavigationStore((state) => state.status);
  const refreshTeamStatus = useTeamNavigationStore((state) => state.refresh);
  const [adminState, setAdminState] = useState<AdminState | null>(null);
  const [activeSection, setActiveSection] = useState<TeamSectionId>("dashboard");
  const [selectedCompanyTeamId, setSelectedCompanyTeamId] = useState<string | null>(readCompanyTeamIdFromUrl);
  const [compactTeamNav, setCompactTeamNav] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<TeamMemoryStatusView | null>(null);
  const [teamMemories, setTeamMemories] = useState<TeamMemoriesView | null>(null);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogItem[]>([]);
  const [skillSyncStatus, setSkillSyncStatus] = useState<Record<string, SkillSyncInfo>>({});
  const [secrets, setSecrets] = useState<TeamSecret[]>([]);
  const [secretsAdmin, setSecretsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [clientName, setClientName] = useState("");
  const [clientSlug, setClientSlug] = useState("");
  const [clientCreateError, setClientCreateError] = useState<string | null>(null);
  const [memberMenu, setMemberMenu] = useState<string | null>(null);
  const [grantMenu, setGrantMenu] = useState<string | null>(null);
  const [skillGrantMenu, setSkillGrantMenu] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedSkillSlug, setSelectedSkillSlug] = useState<string | null>(null);
  const [clientUserSearch, setClientUserSearch] = useState("");
  const [skillUserSearch, setSkillUserSearch] = useState("");
  const [skillMemberFilterSearch, setSkillMemberFilterSearch] = useState("");
  const [selectedSkillMemberIds, setSelectedSkillMemberIds] = useState<string[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [memorySearch, setMemorySearch] = useState("");
  const [memoryStatusFilter, setMemoryStatusFilter] = useState<MemoryStatusFilter>("all");
  const [memoryScopeFilter, setMemoryScopeFilter] = useState<MemoryScopeFilter>("all");
  const [memoryClientFilter, setMemoryClientFilter] = useState("all");
  const [selectedMemory, setSelectedMemory] = useState<TeamMemoryItem | null>(null);
  const [memoryModalError, setMemoryModalError] = useState<string | null>(null);
  const [skillSort, setSkillSort] = useState<SkillSort>("updated-desc");
  const [skillPage, setSkillPage] = useState(1);
  const [skillPageSize, setSkillPageSize] = useState(readPersistedSkillPageSize);
  const [skillAddPermission, setSkillAddPermission] = useState<SkillPermission>("skill.use");
  const [secretName, setSecretName] = useState("");
  const [secretEnvKey, setSecretEnvKey] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretScope, setSecretScope] = useState<"team" | "client">("team");
  const [secretClientId, setSecretClientId] = useState("");
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  const [secretUserSearch, setSecretUserSearch] = useState("");
  const [secretGrantMenu, setSecretGrantMenu] = useState<string | null>(null);
  const [syncingSecrets, setSyncingSecrets] = useState(false);
  const [clientModalError, setClientModalError] = useState<string | null>(null);
  const [skillModalError, setSkillModalError] = useState<string | null>(null);
  const [clientSyncStatus, setClientSyncStatus] = useState<Record<string, ClientSyncInfo>>({});
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [syncingClient, setSyncingClient] = useState<string | null>(null);
  const [syncingSkill, setSyncingSkill] = useState<string | null>(null);
  const [syncConflict, setSyncConflict] = useState<{ client: VisibleClient; direction: "pull" | "push"; conflicts: SyncConflict[] } | null>(null);
  const [skillSyncConflict, setSkillSyncConflict] = useState<{ skill: SkillRow; direction: "pull" | "push"; conflicts: SyncConflict[] } | null>(null);
  const prunedSkillCopiesRef = useRef<Set<string>>(new Set());
  const dashboardGenerationRef = useRef(0);
  const loadedTeamIdRef = useRef<string | null>(null);
  const mutationGenerationRef = useRef({ admin: 0, secrets: 0, memories: 0, clients: 0, skills: 0 });

  const isCompanyManager = Boolean(
    status.companyMembership
    && status.companyMembership.status === "active"
    && (status.companyMembership.role === "owner" || status.companyMembership.role === "admin"),
  );
  const effectiveRole = status.effectiveAccess?.effectiveRole ?? status.membership?.role;
  const isAdmin = effectiveRole === "owner" || effectiveRole === "admin" || status.effectiveAccess?.fullAccess === true;
  const members = adminState?.members ?? [];
  const clients = adminState?.clients ?? [];
  const clientGrants = adminState?.clientGrants ?? [];
  const suggestedClientSlug = suggestClientSlug(clientName);
  const clientSlugError = clientSlug.trim()
    ? clientSlugValidationError(clientSlug)
    : null;
  const visibleSections = TEAM_SECTIONS.filter((section) => (isAdmin || !section.adminOnly) && (isCompanyManager || !section.companyOnly));
  const activeSectionConfig = TEAM_SECTIONS.find((section) => section.id === activeSection);
  const currentSection: TeamSectionId = (!isAdmin && activeSectionConfig?.adminOnly) || (!isCompanyManager && activeSectionConfig?.companyOnly) ? "dashboard" : activeSection;
  const selectedClient = selectedClientId
    ? clients.find((client) => client.id === selectedClientId) ?? null
    : null;

  const switchSection = (section: TeamSectionId) => {
    const sectionConfig = TEAM_SECTIONS.find((item) => item.id === section);
    const next = (!isAdmin && sectionConfig?.adminOnly) || (!isCompanyManager && sectionConfig?.companyOnly) ? "dashboard" : section;
    setActiveSection(next);
    if (next !== "teams") setSelectedCompanyTeamId(null);
    updateTeamSectionUrl(next, next === "teams" ? selectedCompanyTeamId : null);
  };

  const isCurrentDashboardGeneration = (generation?: number) => (
    generation === undefined || generation === dashboardGenerationRef.current
  );

  const captureMutation = (domain: keyof typeof mutationGenerationRef.current) => ({
    domain,
    sequence: ++mutationGenerationRef.current[domain],
    teamId: useTeamNavigationStore.getState().status.selectedTeamId,
    dashboardGeneration: dashboardGenerationRef.current,
  });

  const isCurrentMutation = (token: ReturnType<typeof captureMutation>) => {
    const current = useTeamNavigationStore.getState().status;
    return mutationGenerationRef.current[token.domain] === token.sequence
      && current.selectedTeamId === token.teamId
      && dashboardGenerationRef.current === token.dashboardGeneration;
  };

  const loadDashboard = async (body: TeamStatus, options: { showFeedback?: boolean } = {}) => {
    const generation = ++dashboardGenerationRef.current;
    const changedTeam = loadedTeamIdRef.current !== body.selectedTeamId;
    loadedTeamIdRef.current = body.selectedTeamId;
    setLoading(true);
    setBusy(false);
    setSelectedMemory(null);
    setSyncConflict(null);
    setSkillSyncConflict(null);
    setMemberMenu(null);
    setGrantMenu(null);
    setSkillGrantMenu(null);
    setSecretGrantMenu(null);
    if (changedTeam) {
      setAdminState(null);
      setClientSyncStatus({});
      setSkillCatalog([]);
      setSkillSyncStatus({});
      setSecrets([]);
      setMemoryStatus(null);
      setTeamMemories(null);
      setAdminError(null);
      setSkillsError(null);
      setSecretsError(null);
      setMemoryError(null);
      setMemoriesError(null);
      setNotice(null);
      prunedSkillCopiesRef.current.clear();
    }
    if (options.showFeedback) {
      setAdminError(null);
      setNotice(null);
    }
    try {
      if (body.status === "connected" && !body.selectedTeamId) {
        if (!isCurrentDashboardGeneration(generation)) return;
        setAdminState(null);
        setClientSyncStatus({});
        setSkillCatalog([]);
        setSkillSyncStatus({});
        setSecrets([]);
        setSecretsAdmin(false);
        setMemoryStatus(null);
        setTeamMemories(null);
        setAdminError(null);
        setSkillsError(null);
        setSecretsError(null);
        setMemoryError(null);
        setMemoriesError(null);
        setLastRefreshedAt(new Date().toLocaleTimeString());
        return;
      }
      const dashboardRole = body.effectiveAccess?.effectiveRole ?? body.membership?.role;
      if (body.status === "connected" && (dashboardRole === "owner" || dashboardRole === "admin" || body.effectiveAccess?.fullAccess === true)) {
        const adminRes = await fetch("/api/team/admin", { cache: "no-store" });
        const adminBody = await adminRes.json().catch(() => ({}));
        if (!adminRes.ok) throw new Error(adminBody.error || "Team admin unavailable");
        if (!isCurrentDashboardGeneration(generation)) return;
        setAdminState(adminBody);
        setAdminError(null);
        await Promise.all([
          loadClientLocalStatus(generation),
          loadTeamSkills(adminBody, generation),
          loadTeamSecrets(generation),
          loadTeamMemoryStatus(generation),
          loadTeamMemories(generation),
        ]);
      } else {
        if (!isCurrentDashboardGeneration(generation)) return;
        setAdminState(null);
        setAdminError(null);
        if (body.status === "connected") {
          await loadClientLocalStatus(generation);
        } else {
          setClientSyncStatus({});
          setMemoryStatus(null);
          setMemoryError(null);
          setTeamMemories(null);
          setMemoriesError(null);
        }
        await loadTeamSkills(null, generation);
        if (body.status === "connected") {
          await Promise.all([
            loadTeamSecrets(generation),
            loadTeamMemoryStatus(generation),
          ]);
          if (!isCurrentDashboardGeneration(generation)) return;
          setTeamMemories(null);
          setMemoriesError(null);
        } else {
          setSecrets([]);
          setSecretsAdmin(false);
          setTeamMemories(null);
          setMemoriesError(null);
        }
      }
      if (!isCurrentDashboardGeneration(generation)) return;
      setLastRefreshedAt(new Date().toLocaleTimeString());
      if (options.showFeedback) setNotice("Team status updated.");
    } catch (error) {
      if (!isCurrentDashboardGeneration(generation)) return;
      const message = error instanceof Error ? error.message : "Team admin unavailable";
      setAdminError(message);
      if (options.showFeedback) setNotice(null);
    } finally {
      if (isCurrentDashboardGeneration(generation)) setLoading(false);
    }
  };

  const loadStatus = async (options: { showFeedback?: boolean } = {}) => {
    const refreshed = await refreshTeamStatus();
    if (refreshed) await loadDashboard(refreshed, options);
  };

  const loadClientLocalStatus = async (generation?: number) => {
    try {
      const response = await fetch("/api/team/sync-client", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.clients)) return;
      if (!isCurrentDashboardGeneration(generation)) return;
      const next: Record<string, ClientSyncInfo> = {};
      for (const client of body.clients) {
        if (typeof client.slug === "string" && (client.localStatus === "ready" || client.localStatus === "not_synced")) {
          next[client.slug] = {
            localStatus: client.localStatus,
            syncState: normalizeSyncState(asRecord(client).syncState),
          };
        }
      }
      setClientSyncStatus(next);
    } catch {
      if (isCurrentDashboardGeneration(generation)) setClientSyncStatus({});
    }
  };

  const loadTeamSkills = async (adminSnapshot: AdminState | null = adminState, generation?: number) => {
    if (isCurrentDashboardGeneration(generation)) {
      setSkillsLoading(true);
      setSkillsError(null);
    }
    try {
      const [serverResult, localResult, syncResult] = await Promise.allSettled([
        fetchOptionalJson(TEAM_SKILLS_API),
        fetchOptionalJson("/api/skills"),
        fetchOptionalJson(SKILL_SYNC_API),
      ]);

      const warnings: string[] = [];
      const serverBody = serverResult.status === "fulfilled" ? serverResult.value : null;
      if (serverResult.status === "rejected") warnings.push(`Team skills API is unavailable (${TEAM_SKILLS_API}).`);

      const localBody = localResult.status === "fulfilled" ? localResult.value : null;
      if (localResult.status === "rejected") warnings.push("Local skills could not be loaded.");

      const syncBody = syncResult.status === "fulfilled" ? syncResult.value : null;
      if (syncResult.status === "rejected") warnings.push(`Skill sync status is unavailable (${SKILL_SYNC_API}).`);

      if (!isCurrentDashboardGeneration(generation)) return;
      const syncItems = normalizeSkillSyncInfo(syncBody);
      setSkillSyncStatus(Object.fromEntries(syncItems.map((item) => [item.slug, item])));
      setSkillCatalog(normalizeSkillCatalog(serverBody, localBody, adminSnapshot?.skillGrants ?? [], syncItems));
      if (warnings.length > 0) setSkillsError(warnings[0]);
      void pruneLostSkillCopies(syncItems, generation);
    } finally {
      if (isCurrentDashboardGeneration(generation)) setSkillsLoading(false);
    }
  };

  const loadTeamSecrets = async (generation?: number) => {
    if (isCurrentDashboardGeneration(generation)) {
      setSecretsLoading(true);
      setSecretsError(null);
    }
    try {
      const response = await fetch(TEAM_SECRETS_API, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Team secrets unavailable");
      if (!isCurrentDashboardGeneration(generation)) return;
      setSecrets(normalizeTeamSecrets(body));
      setSecretsAdmin(body.admin === true);
    } catch (error) {
      if (!isCurrentDashboardGeneration(generation)) return;
      setSecretsError(error instanceof Error ? error.message : "Team secrets unavailable");
      setSecrets([]);
      setSecretsAdmin(false);
    } finally {
      if (isCurrentDashboardGeneration(generation)) setSecretsLoading(false);
    }
  };

  const loadTeamMemoryStatus = async (generation?: number) => {
    if (isCurrentDashboardGeneration(generation)) {
      setMemoryLoading(true);
      setMemoryError(null);
    }
    try {
      const response = await fetch("/api/team/memory-status", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Team memory status unavailable");
      if (!isCurrentDashboardGeneration(generation)) return;
      setMemoryStatus(normalizeTeamMemoryStatus(body));
    } catch (error) {
      if (!isCurrentDashboardGeneration(generation)) return;
      const message = error instanceof Error ? error.message : "Team memory status unavailable";
      setMemoryError(message);
      setMemoryStatus({ connected: false, error: message });
    } finally {
      if (isCurrentDashboardGeneration(generation)) setMemoryLoading(false);
    }
  };

  const loadTeamMemories = async (generation?: number) => {
    if (isCurrentDashboardGeneration(generation)) {
      setMemoriesLoading(true);
      setMemoriesError(null);
    }
    try {
      const response = await fetch(TEAM_MEMORIES_API, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Team memories unavailable");
      if (!isCurrentDashboardGeneration(generation)) return;
      setTeamMemories(normalizeTeamMemories(body));
    } catch (error) {
      if (!isCurrentDashboardGeneration(generation)) return;
      setMemoriesError(error instanceof Error ? error.message : "Team memories unavailable");
      setTeamMemories(null);
    } finally {
      if (isCurrentDashboardGeneration(generation)) setMemoriesLoading(false);
    }
  };

  const requestSkillSync = async (skillSlug: string, action: "pull" | "push" | "prune" | "adopt", options: { overwrite?: boolean } = {}) => {
    const response = await fetch(SKILL_SYNC_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skill: skillSlug, action, overwrite: options.overwrite === true }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error(`Skill sync API is not ready yet (${SKILL_SYNC_API}).`);
    if (response.status === 409 && Array.isArray(body.conflicts)) {
      const error = new Error(typeof body.error === "string" ? body.error : "Skill sync conflict") as Error & {
        conflicts?: SyncConflict[];
        direction?: "pull" | "push";
      };
      error.conflicts = body.conflicts;
      error.direction = body.direction === "push" ? "push" : "pull";
      throw error;
    }
    if (!response.ok) throw new Error(body.error || "Skill sync failed");
    return body as Record<string, unknown>;
  };

  const pruneLostSkillCopies = async (syncItems: SkillSyncInfo[], generation?: number) => {
    const expectedTeamId = useTeamNavigationStore.getState().status.selectedTeamId;
    const lostAccess = syncItems.filter((item) => item.managed && item.hasAccess === false);
    for (const item of lostAccess) {
      if (!isCurrentDashboardGeneration(generation) || useTeamNavigationStore.getState().status.selectedTeamId !== expectedTeamId) return;
      if (prunedSkillCopiesRef.current.has(item.slug)) continue;
      prunedSkillCopiesRef.current.add(item.slug);
      setSkillSyncStatus((current) => ({
        ...current,
        [item.slug]: { ...item, localStatus: "removing" },
      }));
      try {
        if (!isCurrentDashboardGeneration(generation) || useTeamNavigationStore.getState().status.selectedTeamId !== expectedTeamId) return;
        await requestSkillSync(item.slug, "prune");
      } catch {
        // The planned skill sync API may not exist yet. The UI calls it cleanly and stays usable.
      }
    }
  };

  useEffect(() => {
    void loadDashboard(status);
  }, [status.selectedTeamId, status.status, status.membership?.role, status.effectiveAccess?.source, status.effectiveAccess?.effectiveRole, status.effectiveAccess?.fullAccess]);

  useEffect(() => {
    const syncFromUrl = () => {
      setActiveSection(readTeamSectionFromUrl());
      setSelectedCompanyTeamId(readCompanyTeamIdFromUrl());
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const sync = () => setCompactTeamNav(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const sectionConfig = TEAM_SECTIONS.find((section) => section.id === activeSection);
    if (status.status === "signed_out" && !status.signedIn) return;
    if ((!isAdmin && sectionConfig?.adminOnly) || (!isCompanyManager && sectionConfig?.companyOnly)) {
      const fallback: TeamSectionId = isCompanyManager && !status.selectedTeamId ? "teams" : "dashboard";
      setActiveSection(fallback);
      updateTeamSectionUrl(fallback);
    }
  }, [activeSection, isAdmin, isCompanyManager, status.selectedTeamId, status.signedIn, status.status]);

  useEffect(() => {
    if (status.status === "connected" && !status.selectedTeamId && isCompanyManager && activeSection === "dashboard") {
      setActiveSection("teams");
      updateTeamSectionUrl("teams", selectedCompanyTeamId);
    }
  }, [activeSection, isCompanyManager, selectedCompanyTeamId, status.selectedTeamId, status.status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(profileStorageKey(SKILL_PAGE_SIZE_STORAGE_KEY), String(skillPageSize));
  }, [skillPageSize]);

  useEffect(() => {
    setSkillPage(1);
  }, [skillSearch, skillSort, selectedSkillMemberIds, skillPageSize]);

  const postAdmin = async (
    action: Record<string, unknown>,
    options: { errorTarget?: "page" | "client-form" | "client-modal" | "skill-modal" } = {},
  ) => {
    const mutation = captureMutation("admin");
    const errorTarget = options.errorTarget ?? "page";
    setBusy(true);
    setAdminError(null);
    if (errorTarget === "client-form") setClientCreateError(null);
    if (errorTarget === "client-modal") setClientModalError(null);
    if (errorTarget === "skill-modal") setSkillModalError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/team/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Team action failed");
      if (!isCurrentMutation(mutation)) return null;
      setAdminState(body);
      return body as AdminState;
    } catch (error) {
      if (!isCurrentMutation(mutation)) return null;
      const message = error instanceof Error ? error.message : "Team action failed";
      if (errorTarget === "client-form") {
        setClientCreateError(message);
      } else if (errorTarget === "client-modal") {
        setClientModalError(message);
      } else if (errorTarget === "skill-modal") {
        setSkillModalError(message);
      } else {
        setAdminError(message);
      }
      return null;
    } finally {
      if (isCurrentMutation(mutation)) setBusy(false);
    }
  };

  const postSecretAction = async (action: Record<string, unknown>) => {
    const mutation = captureMutation("secrets");
    setBusy(true);
    setSecretsError(null);
    setNotice(null);
    try {
      const response = await fetch(TEAM_SECRETS_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Team secret action failed");
      if (!isCurrentMutation(mutation)) return false;
      setSecrets(normalizeTeamSecrets(body));
      setSecretsAdmin(body.admin === true);
      return true;
    } catch (error) {
      if (!isCurrentMutation(mutation)) return false;
      setSecretsError(error instanceof Error ? error.message : "Team secret action failed");
      return false;
    } finally {
      if (isCurrentMutation(mutation)) setBusy(false);
    }
  };

  const postMemoryAction = async (action: Record<string, unknown>) => {
    const mutation = captureMutation("memories");
    setBusy(true);
    setMemoryModalError(null);
    setMemoriesError(null);
    setNotice(null);
    try {
      const response = await fetch(TEAM_MEMORIES_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Team memory action failed");
      if (!isCurrentMutation(mutation)) return false;
      await loadTeamMemories(mutation.dashboardGeneration);
      await loadTeamMemoryStatus(mutation.dashboardGeneration);
      if (!isCurrentMutation(mutation)) return false;
      const message = action.action === "discard"
        ? "Memory discarded."
        : action.action === "update"
          ? "Memory updated."
          : action.action === "delete"
            ? "Memory deleted."
            : "Memory accepted.";
      setNotice(message);
      return true;
    } catch (error) {
      if (!isCurrentMutation(mutation)) return false;
      setMemoryModalError(error instanceof Error ? error.message : "Team memory action failed");
      return false;
    } finally {
      if (isCurrentMutation(mutation)) setBusy(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setNotice(`${label} copied.`);
  };

  const inviteMember = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) {
      setAdminError("Enter a valid member email.");
      return;
    }
    const result = await postAdmin({ action: "invite-member", email: inviteEmail, role: inviteRole });
    if (result?.invite?.url) {
      setInviteEmail("");
      await copyText(result.invite.url, "Invite link");
    }
  };

  const createClient = async () => {
    const name = clientName.trim();
    if (!name) {
      setClientCreateError("Client name is required.");
      return;
    }
    const slug = normalizeClientSlug(clientSlug);
    const validationError = slug ? clientSlugValidationError(slug) : null;
    if (validationError) {
      setClientCreateError(validationError);
      return;
    }
    const result = await postAdmin(
      {
        action: "create-client",
        name,
        ...(slug ? { slug } : {}),
      },
      { errorTarget: "client-form" },
    );
    if (result) {
      setClientName("");
      setClientSlug("");
      setClientCreateError(null);
      setNotice("Client created.");
    }
  };

  const syncClient = async (client: VisibleClient, action: "pull" | "push" = "pull", overwrite = false) => {
    const mutation = captureMutation("clients");
    setBusy(true);
    setSyncingClient(client.id);
    setAdminError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/team/sync-client", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: client.slug, action, overwrite }),
      });
      const body = await response.json().catch(() => ({}));
      if (!isCurrentMutation(mutation)) return;
      if (response.status === 409 && Array.isArray(body.conflicts)) {
        setSyncConflict({ client, direction: body.direction === "push" ? "push" : "pull", conflicts: body.conflicts });
        return;
      }
      if (!response.ok) throw new Error(body.error || "Client sync failed");
      const changed = Number(body.filesChanged ?? 0);
      const pushed = Number(body.filesPushed ?? 0);
      const deleted = Number(body.filesDeleted ?? 0);
      setNotice(body.upToDate
        ? `${client.name || client.slug} is already up to date.`
        : action === "push"
          ? `${client.name || client.slug}: pushed ${pushed} file${pushed === 1 ? "" : "s"}${deleted ? ` and deleted ${deleted}` : ""}.`
          : `${client.name || client.slug}: pulled ${changed} file${changed === 1 ? "" : "s"}${deleted ? ` and deleted ${deleted}` : ""}.`);
      await loadClientLocalStatus(mutation.dashboardGeneration);
      if (!isCurrentMutation(mutation)) return;
      window.dispatchEvent(new Event("team-context-change"));
    } catch (error) {
      if (!isCurrentMutation(mutation)) return;
      setAdminError(error instanceof Error ? error.message : "Client sync failed");
    } finally {
      if (isCurrentMutation(mutation)) {
        setBusy(false);
        setSyncingClient(null);
      }
    }
  };

  const createSecret = async () => {
    const name = secretName.trim();
    const envKey = secretEnvKey.trim().toUpperCase();
    if (!name || !envKey || !secretValue) {
      setSecretsError("Name, env key, and value are required.");
      return;
    }
    if (secretScope === "client" && !secretClientId) {
      setSecretsError("Choose a client for this secret.");
      return;
    }
    const saved = await postSecretAction({
      action: "create-secret",
      name,
      envKey,
      value: secretValue,
      scope: secretScope,
      client: secretScope === "client" ? secretClientId : undefined,
    });
    if (saved) {
      setSecretName("");
      setSecretEnvKey("");
      setSecretValue("");
      setNotice("Secret saved.");
    }
  };

  const syncSecrets = async (overwriteConflicts = false) => {
    const mutation = captureMutation("secrets");
    setBusy(true);
    setSyncingSecrets(true);
    setSecretsError(null);
    setNotice(null);
    try {
      const response = await fetch(TEAM_SECRETS_SYNC_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overwriteConflicts }),
      });
      const body = await response.json().catch(() => ({}));
      if (!isCurrentMutation(mutation)) return;
      if (response.status === 409 && Array.isArray(body.conflicts)) {
        const keys = body.conflicts
          .flatMap((conflict: { keys?: string[] }) => conflict.keys ?? [])
          .join(", ");
        if (window.confirm(`These keys already exist outside the TeamOS block: ${keys}. Move them into the managed block?`)) {
          await syncSecrets(true);
        } else {
          setSecretsError("Secret sync cancelled. Local .env files were kept.");
        }
        return;
      }
      if (!response.ok) throw new Error(body.error || "Secret sync failed");
      const filesChanged = Number(body.filesChanged ?? 0);
      setNotice(filesChanged === 0 ? "Secrets are already up to date." : `Updated ${filesChanged} .env file${filesChanged === 1 ? "" : "s"}.`);
    } catch (error) {
      if (!isCurrentMutation(mutation)) return;
      setSecretsError(error instanceof Error ? error.message : "Secret sync failed");
    } finally {
      if (isCurrentMutation(mutation)) {
        setBusy(false);
        setSyncingSecrets(false);
      }
    }
  };

  const syncSkill = async (skill: SkillRow, action: "pull" | "push" | "prune" | "adopt", overwrite = false) => {
    const mutation = captureMutation("skills");
    setBusy(true);
    setSyncingSkill(`${skill.slug}:${action}`);
    setSkillModalError(null);
    setAdminError(null);
    setNotice(null);
    try {
      const body = await requestSkillSync(skill.slug, action, { overwrite });
      if (!isCurrentMutation(mutation)) return;
      const changed = Number(body.filesChanged ?? body.changed ?? 0);
      const deleted = Number(body.filesDeleted ?? body.deleted ?? 0);
      const label = skill.name || skill.slug;
      if (action === "push") {
        const pushed = Number(body.filesPushed ?? 0);
        setNotice(body.upToDate ? `${label} is already up to date.` : `${label}: pushed ${pushed} file${pushed === 1 ? "" : "s"}.`);
      } else if (action === "adopt" || body.adopted) {
        setNotice(`${label}: local copy adopted as synced.`);
      } else if (action === "prune") {
        setNotice(`${label}: local managed copy cleanup requested.`);
      } else {
        setNotice(body.upToDate
          ? `${label} is already up to date.`
          : `${label}: synced ${changed} file${changed === 1 ? "" : "s"}${deleted ? ` and removed ${deleted}` : ""}.`);
      }
      await loadTeamSkills(adminState, mutation.dashboardGeneration);
      if (!isCurrentMutation(mutation)) return;
      window.dispatchEvent(new Event("team-context-change"));
    } catch (error) {
      if (!isCurrentMutation(mutation)) return;
      const conflict = error as Error & { conflicts?: SyncConflict[]; direction?: "pull" | "push" };
      if (Array.isArray(conflict.conflicts)) {
        setSkillSyncConflict({ skill, conflicts: conflict.conflicts, direction: conflict.direction ?? (action === "push" ? "push" : "pull") });
        return;
      }
      setSkillModalError(error instanceof Error ? error.message : "Skill sync failed");
    } finally {
      if (isCurrentMutation(mutation)) {
        setBusy(false);
        setSyncingSkill(null);
      }
    }
  };

  const memberLabel = (member: AdminMember) => member.email || member.userId || "unknown";
  const memberName = (member: AdminMember) => member.displayName || member.email || member.userId || "Unknown user";

  const selectedClientGrants = selectedClient
    ? clientGrants.filter((grant) => grant.clientId === selectedClient.id && grant.status === "active")
    : [];
  const selectedGrantedIds = new Set(selectedClientGrants.map((grant) => grant.userId));
  const availableMembers = members
    .filter((member) => member.userId && !selectedGrantedIds.has(member.userId))
    .filter((member) => {
      const term = clientUserSearch.trim().toLowerCase();
      if (!term) return true;
      return `${member.displayName ?? ""} ${member.email ?? ""}`.toLowerCase().includes(term);
    })
    .slice(0, 8);

  const visibleClients: VisibleClient[] = isAdmin
    ? clients.map((client) => {
      const active = clientGrants.filter((grant) => grant.clientId === client.id && grant.status === "active");
      return {
        ...client,
        access: "write" as const,
        localStatus: clientSyncStatus[client.slug]?.localStatus ?? "not_synced",
        syncState: clientSyncStatus[client.slug]?.syncState,
        memberCount: active.length,
        editorCount: active.filter((grant) => grant.access === "write").length,
        viewerCount: active.filter((grant) => grant.access === "read").length,
      };
    })
    : status.clients.map((client) => ({
      id: client.id || client.slug,
      slug: client.slug,
      name: client.name ?? client.slug,
      access: client.access ?? "read",
      localStatus: clientSyncStatus[client.slug]?.localStatus ?? "not_synced",
      syncState: clientSyncStatus[client.slug]?.syncState,
    }));

  const skillRows = buildSkillRows(skillCatalog, adminState?.skillGrants ?? [], skillSyncStatus);
  const selectedSkill = selectedSkillSlug
    ? skillRows.find((skill) => skill.id === selectedSkillSlug) ?? null
    : null;
  const selectedSecret = selectedSecretId
    ? secrets.find((secret) => secret.id === selectedSecretId) ?? null
    : null;
  const selectedSecretGrants = selectedSecret?.grants?.filter((grant) => grant.status === "active") ?? [];
  const selectedSecretGrantIds = new Set(selectedSecretGrants.map((grant) => grant.userId));
  const secretAvailableMembers = members
    .filter((member) => member.userId && !selectedSecretGrantIds.has(member.userId))
    .filter((member) => {
      const term = secretUserSearch.trim().toLowerCase();
      if (!term) return true;
      return `${member.displayName ?? ""} ${member.email ?? ""} ${member.userId ?? ""}`.toLowerCase().includes(term);
    })
    .slice(0, 8);
  const selectedSkillGrantIds = new Set((selectedSkill?.activeGrants ?? []).map((grant) => grant.userId || grant.email));
  const selectedSkillMembers = selectedSkillMemberIds
    .map((id) => members.find((member) => memberIdentity(member) === id))
    .filter((member): member is AdminMember => Boolean(member));
  const skillMemberSuggestions = members
    .filter((member) => !selectedSkillMemberIds.includes(memberIdentity(member)))
    .filter((member) => {
      const term = skillMemberFilterSearch.trim().toLowerCase();
      if (!term) return false;
      return `${member.displayName ?? ""} ${member.email ?? ""} ${member.userId ?? ""}`.toLowerCase().includes(term);
    })
    .slice(0, 8);
  const skillAvailableMembers = members
    .filter((member) => {
      const id = member.userId || member.email;
      return typeof id === "string" && id !== "" && !selectedSkillGrantIds.has(id);
    })
    .filter((member) => {
      const term = skillUserSearch.trim().toLowerCase();
      if (!term) return true;
      return `${member.displayName ?? ""} ${member.email ?? ""} ${member.userId ?? ""}`.toLowerCase().includes(term);
    })
    .slice(0, 8);
  const filteredSkillRows = sortSkillRows(
    filterSkillRows(skillRows, skillSearch, selectedSkillMemberIds),
    skillSort,
  );
  const skillPageCount = Math.max(1, Math.ceil(filteredSkillRows.length / skillPageSize));
  const currentSkillPage = Math.min(skillPage, skillPageCount);
  const pagedSkillRows = filteredSkillRows.slice(
    (currentSkillPage - 1) * skillPageSize,
    currentSkillPage * skillPageSize,
  );
  const memoryItems = filterMemoryItems(
    [
      ...(teamMemories?.review ?? []),
      ...(teamMemories?.published ?? []),
    ],
    {
      query: memorySearch,
      status: memoryStatusFilter,
      scope: memoryScopeFilter,
      client: memoryClientFilter,
    },
  );
  const memoryClientOptions = memoryClientFilterOptions(teamMemories);
  const memoryReviewCount = teamMemories?.counts?.review ?? (teamMemories?.review ?? []).filter((item) => item.status === "review").length;

  return (
    <div style={pageStyle}>
      <section style={headerBandStyle}>
        <div>
          <h2 style={titleStyle}>Team</h2>
          <div style={subtleTextStyle}>
            {status.team?.name || status.team?.slug || "Team OS management"}
            {lastRefreshedAt ? ` · Updated ${lastRefreshedAt}` : ""}
          </div>
        </div>
        <button type="button" onClick={() => loadStatus({ showFeedback: true })} style={refreshButtonStyle} disabled={loading}>
          <RefreshCw size={15} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      <div style={teamLayoutStyle(compactTeamNav)}>
        <TeamSectionNav
          sections={visibleSections}
          activeSection={currentSection}
          compact={compactTeamNav}
          onSelect={switchSection}
        />

        <div style={teamContentStyle}>
          {currentSection === "dashboard" && (
            <TeamDashboard
              isAdmin={isAdmin}
              status={status}
              members={members}
              clients={visibleClients}
              secrets={secrets}
              skills={skillRows}
              storage={adminState?.storage}
              memoryStatus={memoryStatus}
              memoryLoading={memoryLoading}
              memoryError={memoryError}
              memoryReviewCount={memoryReviewCount}
              lastRefreshedAt={lastRefreshedAt}
              onSection={switchSection}
            />
          )}

          {currentSection === "teams" && isCompanyManager && (
            <CompanyTeamsSection
              selectedTeamId={selectedCompanyTeamId}
              onSelectedTeamId={(teamId) => {
                setSelectedCompanyTeamId(teamId);
                updateTeamSectionUrl("teams", teamId);
              }}
            />
          )}

          {currentSection === "members" && isAdmin && (
            <section style={sectionStyle}>
              <SectionHeader title="Members" detail="Manage team users and invites" icon={UserPlus} />
              <div style={sectionBodyStyle}>
                <div style={formRowStyle}>
                  <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="email@example.com" style={inputStyle} />
                  <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} style={selectStyle}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button type="button" style={primaryButtonStyle} disabled={busy} onClick={inviteMember}>
                    Invite
                  </button>
                </div>
                {adminState?.invite?.url && (
                  <LinkNotice label="Invite link" value={adminState.invite.url} onCopy={() => copyText(adminState.invite!.url, "Invite link")} />
                )}
                {adminState?.reset?.url && (
                  <LinkNotice label="Password reset link" value={adminState.reset.url} onCopy={() => copyText(adminState.reset!.url, "Password reset link")} />
                )}
                <MemberTable
                  members={members}
                  busy={busy}
                  openMenu={memberMenu}
                  setOpenMenu={setMemberMenu}
                  onRoleChange={(member, role) => postAdmin({ action: "set-member-role", user: memberLabel(member), role })}
                  onCopyInvite={async (member) => {
                    const result = await postAdmin({ action: "create-invite-link", user: memberLabel(member) });
                    if (result?.invite?.url) await copyText(result.invite.url, "Invite link");
                  }}
                  onCopyReset={async (member) => {
                    const result = await postAdmin({ action: "create-password-reset-link", user: memberLabel(member) });
                    if (result?.reset?.url) await copyText(result.reset.url, "Password reset link");
                  }}
                  onRemove={async (member) => {
                    if (!window.confirm(`Remove ${memberName(member)} from this team?`)) return;
                    await postAdmin({ action: "remove-member", user: memberLabel(member) });
                  }}
                />
              </div>
            </section>
          )}

          {currentSection === "clients" && (
            <section style={sectionStyle}>
              <SectionHeader title={isAdmin ? "Clients" : "My Clients"} detail={isAdmin ? "Server-side client access" : "Clients available to this account"} icon={ShieldCheck} />
              <div style={sectionBodyStyle}>
                {isAdmin && (
                  <div>
                    <div style={clientCreateFormStyle}>
                      <input
                        value={clientName}
                        onChange={(event) => {
                          setClientName(event.target.value);
                          setClientCreateError(null);
                        }}
                        placeholder="Client name"
                        aria-label="Client name"
                        style={inputStyle}
                      />
                      <div style={clientSlugFieldStyle}>
                        <input
                          value={clientSlug}
                          onChange={(event) => {
                            setClientSlug(event.target.value);
                            setClientCreateError(null);
                          }}
                          onBlur={() => setClientSlug((current) => current.trim() ? normalizeClientSlug(current) : "")}
                          placeholder={suggestedClientSlug}
                          aria-label="Client slug (optional)"
                          aria-describedby="client-slug-help"
                          aria-invalid={Boolean(clientSlugError)}
                          maxLength={CLIENT_SLUG_MAX_LENGTH}
                          style={clientSlugError ? { ...inputStyle, borderColor: "var(--cc-status-danger-bright)" } : inputStyle}
                        />
                        <div
                          id="client-slug-help"
                          role={clientSlugError ? "alert" : undefined}
                          style={clientSlugError ? clientSlugErrorStyle : clientSlugHintStyle}
                        >
                          {clientSlugError ?? `Optional slug. Leave blank to use "${suggestedClientSlug}" or the next available suffix.`}
                        </div>
                      </div>
                      <button
                        type="button"
                        style={primaryButtonStyle}
                        disabled={busy || Boolean(clientSlugError)}
                        onClick={createClient}
                      >
                        Create client
                      </button>
                    </div>
                    {clientCreateError && <div style={clientCreateErrorStyle}>{clientCreateError}</div>}
                  </div>
                )}
                <ClientTable
                  clients={visibleClients}
                  canManage={isAdmin}
                  busy={busy}
                  syncingClient={syncingClient}
                  onOpen={(client) => {
                    if (!isAdmin) return;
                    setSelectedClientId(client.id);
                    setClientUserSearch("");
                    setClientModalError(null);
                  }}
                  onSync={(client, action) => syncClient(client, action)}
                />
              </div>
            </section>
          )}

          {currentSection === "memories" && isAdmin && (
            <TeamMemoriesSection
              memories={teamMemories}
              memoryStatus={memoryStatus}
              rows={memoryItems}
              clients={memoryClientOptions}
              search={memorySearch}
              statusFilter={memoryStatusFilter}
              scopeFilter={memoryScopeFilter}
              clientFilter={memoryClientFilter}
              loading={memoriesLoading}
              error={memoriesError}
              onSearch={setMemorySearch}
              onStatusFilter={setMemoryStatusFilter}
              onScopeFilter={setMemoryScopeFilter}
              onClientFilter={setMemoryClientFilter}
              onRefresh={loadTeamMemories}
              onOpen={(memory) => {
                setSelectedMemory(memory);
                setMemoryModalError(null);
              }}
            />
          )}

          {currentSection === "secrets" && (
            <section style={sectionStyle}>
              <SectionHeader title={secretsAdmin ? "Secrets" : "My Secrets"} detail="Shared API keys synced into managed .env blocks" icon={KeyRound} />
              <div style={sectionBodyStyle}>
                <div style={secretToolbarStyle}>
                  <button type="button" style={secondaryButtonStyle} disabled={busy || syncingSecrets} onClick={() => syncSecrets()}>
                    <Download size={14} />
                    {syncingSecrets ? "Syncing..." : "Sync permitted secrets"}
                  </button>
                  <div style={subtleTextStyle}>Values stay hidden here. Sync writes only to the TeamOS managed block.</div>
                </div>
                {secretsAdmin && (
                  <div style={secretFormGridStyle}>
                    <input value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder="Display name" style={inputStyle} />
                    <input value={secretEnvKey} onChange={(event) => setSecretEnvKey(event.target.value.toUpperCase())} placeholder="FIRECRAWL_API_KEY" style={inputStyle} />
                    <input value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Secret value" type="password" style={inputStyle} />
                    <select value={secretScope} onChange={(event) => setSecretScope(event.target.value as "team" | "client")} style={selectStyle}>
                      <option value="team">Team</option>
                      <option value="client">Client</option>
                    </select>
                    {secretScope === "client" && (
                      <select value={secretClientId} onChange={(event) => setSecretClientId(event.target.value)} style={selectStyle}>
                        <option value="">Choose client</option>
                        {clients.map((client) => (
                          <option key={client.id} value={client.id}>{client.name || client.slug}</option>
                        ))}
                      </select>
                    )}
                    <button type="button" style={primaryButtonStyle} disabled={busy} onClick={createSecret}>
                      Save secret
                    </button>
                  </div>
                )}
                {secretsError && <div style={errorTextStyle}>{secretsError}</div>}
                <SecretTable
                  secrets={secrets}
                  loading={secretsLoading}
                  canManage={secretsAdmin}
                  onOpen={(secret) => {
                    setSelectedSecretId(secret.id);
                    setSecretUserSearch("");
                    setSecretGrantMenu(null);
                    setSecretsError(null);
                  }}
                />
              </div>
            </section>
          )}

          {currentSection === "skills" && (
            <section style={sectionStyle}>
              <SectionHeader title={isAdmin ? "Skills" : "My Skills"} detail={isAdmin ? "Server skills and member access" : "Skills available to this account"} icon={FileText} />
              <div style={sectionBodyStyle}>
                <SkillToolbar
                  search={skillSearch}
                  sort={skillSort}
                  members={selectedSkillMembers}
                  memberSearch={skillMemberFilterSearch}
                  suggestions={skillMemberSuggestions}
                  pageSize={skillPageSize}
                  canFilterMembers={isAdmin}
                  onSearch={setSkillSearch}
                  onSort={setSkillSort}
                  onMemberSearch={setSkillMemberFilterSearch}
                  onAddMemberFilter={(member) => {
                    const id = memberIdentity(member);
                    setSelectedSkillMemberIds((current) => current.includes(id) ? current : [...current, id]);
                    setSkillMemberFilterSearch("");
                  }}
                  onRemoveMemberFilter={(id) => {
                    setSelectedSkillMemberIds((current) => current.filter((value) => value !== id));
                  }}
                  onClearMemberFilters={() => setSelectedSkillMemberIds([])}
                  onPageSize={(size) => setSkillPageSize(size)}
                />
                {skillsError && <div style={subtleWarningStyle}>{skillsError}</div>}
                <SkillTable
                  skills={pagedSkillRows}
                  loading={skillsLoading}
                  showGrantColumns={isAdmin}
                  onOpen={(skill) => {
                    if (skill.source === "local") return;
                    setSelectedSkillSlug(skill.id);
                    setSkillUserSearch("");
                    setSkillModalError(null);
                    setSkillGrantMenu(null);
                  }}
                />
                <PaginationBar
                  page={currentSkillPage}
                  pageCount={skillPageCount}
                  pageSize={skillPageSize}
                  total={filteredSkillRows.length}
                  onPrevious={() => setSkillPage((page) => Math.max(1, page - 1))}
                  onNext={() => setSkillPage((page) => Math.min(skillPageCount, page + 1))}
                />
              </div>
            </section>
          )}
        </div>
      </div>

      {selectedMemory && (
        <MemoryModal
          memory={selectedMemory}
          error={memoryModalError}
          busy={busy}
          canManagePublished={teamMemories?.admin === true}
          onClose={() => {
            setSelectedMemory(null);
            setMemoryModalError(null);
          }}
          onAccept={async ({ title, content }) => {
            if (selectedMemory.kind !== "review") return false;
            const saved = await postMemoryAction({
              action: "accept",
              captureId: selectedMemory.id,
              title,
              content,
            });
            if (saved) setSelectedMemory(null);
            return saved;
          }}
          onDiscard={async () => {
            if (selectedMemory.kind !== "review") return false;
            const saved = await postMemoryAction({
              action: "discard",
              captureId: selectedMemory.id,
            });
            if (saved) setSelectedMemory(null);
            return saved;
          }}
          onUpdate={async ({ title, content }) => {
            if (selectedMemory.kind !== "published") return false;
            const saved = await postMemoryAction({
              action: "update",
              sourceId: selectedMemory.id,
              sourcePath: selectedMemory.sourcePath,
              title,
              content,
            });
            if (saved) {
              setSelectedMemory((current) => current && current.kind === "published"
                ? { ...current, title, content, updatedAt: new Date().toISOString() }
                : current);
            }
            return saved;
          }}
          onDelete={async () => {
            if (selectedMemory.kind !== "published") return false;
            const saved = await postMemoryAction({
              action: "delete",
              sourceId: selectedMemory.id,
            });
            if (saved) setSelectedMemory(null);
            return saved;
          }}
        />
      )}

      {selectedClient && (
        <ClientModal
          client={selectedClient}
          grants={selectedClientGrants}
          members={members}
          availableMembers={availableMembers}
          search={clientUserSearch}
          error={clientModalError}
          busy={busy}
          openMenu={grantMenu}
          setOpenMenu={setGrantMenu}
          setSearch={setClientUserSearch}
          onClose={() => {
            setSelectedClientId(null);
            setGrantMenu(null);
            setClientModalError(null);
          }}
          onGrant={async (member) => {
            if (!member.userId) {
              setClientModalError("This user is missing an account ID.");
              return;
            }
            const result = await postAdmin(
              { action: "grant-client", client: selectedClient.id, user: member.userId, access: "write" },
              { errorTarget: "client-modal" },
            );
            if (result) setClientUserSearch("");
          }}
          onChangeAccess={(grant, access) => {
            if (grant.protected || grant.implicit) return;
            return postAdmin(
              { action: "grant-client", client: selectedClient.id, user: grant.userId, access },
              { errorTarget: "client-modal" },
            );
          }}
          onRevoke={(grant) => {
            if (grant.protected || grant.implicit) return;
            return postAdmin(
              { action: "revoke-client", client: selectedClient.id, user: grant.userId },
              { errorTarget: "client-modal" },
            );
          }}
        />
      )}

      {selectedSecret && (
        <SecretModal
          secret={selectedSecret}
          members={members}
          grants={selectedSecretGrants}
          availableMembers={secretAvailableMembers}
          search={secretUserSearch}
          error={secretsError}
          busy={busy}
          openMenu={secretGrantMenu}
          setOpenMenu={setSecretGrantMenu}
          setSearch={setSecretUserSearch}
          onClose={() => {
            setSelectedSecretId(null);
            setSecretGrantMenu(null);
            setSecretsError(null);
          }}
          onGrant={async (member) => {
            const user = member.userId || member.email;
            if (!user) {
              setSecretsError("This user is missing an account ID.");
              return;
            }
            const saved = await postSecretAction({ action: "grant-secret", secret: selectedSecret.id, user });
            if (saved) setSecretUserSearch("");
          }}
          onRevoke={(grant) => postSecretAction({ action: "revoke-secret", secret: selectedSecret.id, user: grant.userId })}
          onArchive={async () => {
            if (!window.confirm(`Archive ${selectedSecret.envKey}?`)) return;
            const saved = await postSecretAction({ action: "archive-secret", secret: selectedSecret.id });
            if (saved) setSelectedSecretId(null);
          }}
        />
      )}

      {selectedSkill && (
        <SkillModal
          skill={selectedSkill}
          members={members}
          availableMembers={skillAvailableMembers}
          search={skillUserSearch}
          error={skillModalError}
          busy={busy}
          canManage={isAdmin}
          addPermission={skillAddPermission}
          syncingKey={syncingSkill}
          openMenu={skillGrantMenu}
          setOpenMenu={setSkillGrantMenu}
          setSearch={setSkillUserSearch}
          setAddPermission={setSkillAddPermission}
          onClose={() => {
            setSelectedSkillSlug(null);
            setSkillGrantMenu(null);
            setSkillModalError(null);
          }}
          onGrant={async (member) => {
            const user = member.userId || member.email;
            if (!user) {
              setSkillModalError("This user is missing an account ID.");
              return;
            }
            const result = await postAdmin(
              { action: "grant-skill", skillName: selectedSkill.slug, user, permission: skillAddPermission },
              { errorTarget: "skill-modal" },
            );
            if (result) {
              setSkillUserSearch("");
              await loadTeamSkills(result);
            }
          }}
          onChangePermission={async (grant, permission) => {
            if (grant.permission === permission) return;
            const user = grant.userId || grant.email;
            const granted = await postAdmin(
              { action: "grant-skill", skillName: selectedSkill.slug, user, permission },
              { errorTarget: "skill-modal" },
            );
            if (!granted) return;
            const revoked = await postAdmin(
              { action: "revoke-skill", skillName: selectedSkill.slug, user, permission: grant.permission },
              { errorTarget: "skill-modal" },
            );
            if (revoked) await loadTeamSkills(revoked);
          }}
          onRevoke={async (grant) => {
            const user = grant.userId || grant.email;
            const result = await postAdmin(
              { action: "revoke-skill", skillName: selectedSkill.slug, user, permission: grant.permission },
              { errorTarget: "skill-modal" },
            );
            if (result) {
              void requestSkillSync(selectedSkill.slug, "prune").catch(() => undefined);
              await loadTeamSkills(result);
            }
          }}
          onSync={(action) => syncSkill(selectedSkill, action)}
        />
      )}

      {syncConflict && (
        <SyncConflictModal
          title={syncConflict.direction === "push" ? "Review client push changes" : "Review client pull conflicts"}
          direction={syncConflict.direction}
          conflicts={syncConflict.conflicts}
          busy={busy}
          onCancel={() => {
            setSyncConflict(null);
            setAdminError("Client sync cancelled. Local files were kept.");
          }}
          onOverwrite={() => {
            const client = syncConflict.client;
            const direction = syncConflict.direction;
            setSyncConflict(null);
            void syncClient(client, direction, true);
          }}
        />
      )}

      {skillSyncConflict && (
        <SyncConflictModal
          title={skillSyncConflict.direction === "push" ? "Review skill push changes" : "Review skill pull conflicts"}
          direction={skillSyncConflict.direction}
          conflicts={skillSyncConflict.conflicts}
          busy={busy}
          onCancel={() => {
            setSkillSyncConflict(null);
            setSkillModalError("Skill sync cancelled. Local files were kept.");
          }}
          onOverwrite={() => {
            const { skill, direction } = skillSyncConflict;
            setSkillSyncConflict(null);
            void syncSkill(skill, direction, true);
          }}
        />
      )}

      {(adminError || notice) && (
        <div style={adminError ? errorTextStyle : noticeStyle}>{adminError || notice}</div>
      )}
    </div>
  );
}

function TeamSectionNav({
  sections,
  activeSection,
  compact,
  onSelect,
}: {
  sections: Array<{ id: TeamSectionId; label: string; detail: string; icon: typeof Activity }>;
  activeSection: TeamSectionId;
  compact: boolean;
  onSelect: (section: TeamSectionId) => void;
}) {
  return (
    <aside style={teamNavStyle(compact)} aria-label="Team sections">
      {sections.map((section) => {
        const Icon = section.icon;
        const active = activeSection === section.id;
        return (
          <button
            key={section.id}
            type="button"
            style={teamNavItemStyle(active, compact)}
            onClick={() => onSelect(section.id)}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={16} />
            <span style={teamNavTextWrapStyle}>
              <span style={teamNavLabelStyle}>{section.label}</span>
              {!compact && <span style={teamNavDetailStyle}>{section.detail}</span>}
            </span>
          </button>
        );
      })}
    </aside>
  );
}

function TeamDashboard({
  isAdmin,
  status,
  members,
  clients,
  secrets,
  skills,
  storage,
  memoryStatus,
  memoryLoading,
  memoryError,
  memoryReviewCount,
  lastRefreshedAt,
  onSection,
}: {
  isAdmin: boolean;
  status: TeamStatus;
  members: AdminMember[];
  clients: VisibleClient[];
  secrets: TeamSecret[];
  skills: SkillRow[];
  storage?: AdminState["storage"];
  memoryStatus: TeamMemoryStatusView | null;
  memoryLoading: boolean;
  memoryError: string | null;
  memoryReviewCount: number;
  lastRefreshedAt: string | null;
  onSection: (section: TeamSectionId) => void;
}) {
  const teamName = status.team?.name || status.team?.slug || "No team selected";
  const userName = status.user?.displayName || status.user?.email || "No account";
  const role = status.membership?.role || (status.signedIn ? "member" : "signed out");
  const pendingInvites = members.filter((member) => member.status === "invited").length;
  const clientsNeedSync = clients.filter((client) => client.localStatus !== "ready").length;
  const skillsNeedSync = skills.filter((skill) => skill.localStatus !== "ready").length;
  const memory = memoryStatus?.status ?? null;
  const outbox = memoryStatus?.outbox ?? null;
  const failedMemoryJobs = countStatus(memory?.jobsByStatus, ["failed", "error"]);
  const pendingMemoryJobs = countStatus(memory?.jobsByStatus, ["pending", "queued", "running"]);
  const failedCaptureEvents = countStatus(memory?.captureEventsByStatus, ["failed"]);
  const eligibleCaptureEvents = memory?.captureEligibility?.eligiblePending ?? 0;
  const failedOutboxItems = outbox?.failed ?? 0;
  const waitingOutboxItems = (outbox?.queued ?? 0) + (outbox?.syncing ?? 0);
  const memoryProblem = Boolean(memoryError || memoryStatus?.connected === false || memory?.storeReady === false || failedMemoryJobs > 0 || failedOutboxItems > 0 || failedCaptureEvents > 0 || memory?.lastJob?.errorMessage);

  return (
    <section style={sectionStyle}>
      <SectionHeader title="Dashboard" detail={isAdmin ? "Team health and access overview" : "Your team access and sync status"} icon={LayoutDashboard} />
      <div style={dashboardBodyStyle}>
        {isAdmin && storage && (
          <div style={dashboardGridStyle}>
            <DashboardTile
              icon={HardDrive}
              label="Workspace"
              value={storage.likelyPersistent ? "Persistent" : "Needs check"}
              detail={storage.warning || storage.workspaceRoot || "Workspace path unavailable"}
              tone={storage.likelyPersistent ? "success" : "danger"}
            />
            <DashboardTile
              icon={ShieldCheck}
              label="Writable"
              value={storage.writable ? "Writable" : "Not writable"}
              detail={storage.error || "Server can write sync files"}
              tone={storage.writable ? "success" : "danger"}
            />
            <DashboardTile
              icon={Upload}
              label="GitHub backup"
              value={storage.backup?.configured ? "Configured" : "Not configured"}
              detail={storage.backup?.warning || `Branch: ${storage.backup?.branch || "main"}`}
              tone={storage.backup?.configured ? "success" : "danger"}
            />
          </div>
        )}

        <div style={dashboardGridStyle}>
          <DashboardTile
            icon={ShieldCheck}
            label="Team connection"
            value={
              status.status === "connected" ? "Connected"
              : status.status === "blocked" ? "Access blocked"
              : status.status === "unavailable" ? "Unavailable"
              : "Signed out"
            }
            detail={
              status.status === "blocked"
                ? status.error || "Your team access was blocked."
                : `${teamName} · ${roleLabel(role)}${lastRefreshedAt ? ` · Updated ${lastRefreshedAt}` : ""}`
            }
            tone={status.status === "connected" ? "success" : "danger"}
          />
          <DashboardTile
            icon={Users}
            label={isAdmin ? "Members" : "Account"}
            value={isAdmin ? String(members.length) : roleLabel(role)}
            detail={isAdmin ? `${pendingInvites} pending invite${pendingInvites === 1 ? "" : "s"}` : userName}
            tone={pendingInvites > 0 ? "danger" : "neutral"}
            onClick={isAdmin ? () => onSection("members") : undefined}
          />
          <DashboardTile
            icon={ShieldCheck}
            label={isAdmin ? "Clients" : "My clients"}
            value={String(clients.length)}
            detail={clientsNeedSync > 0 ? `${clientsNeedSync} need sync` : "Local state ready"}
            tone={clientsNeedSync > 0 ? "danger" : "success"}
            onClick={() => onSection("clients")}
          />
          <DashboardTile
            icon={KeyRound}
            label={isAdmin ? "Secrets" : "My secrets"}
            value={String(secrets.length)}
            detail={secrets.length === 0 ? "No permitted secrets" : "Values stay hidden"}
            tone="neutral"
            onClick={() => onSection("secrets")}
          />
          <DashboardTile
            icon={FileText}
            label={isAdmin ? "Skills" : "My skills"}
            value={String(skills.length)}
            detail={skillsNeedSync > 0 ? `${skillsNeedSync} need sync` : "Local state ready"}
            tone={skillsNeedSync > 0 ? "danger" : "success"}
            onClick={() => onSection("skills")}
          />
          <DashboardTile
            icon={Database}
            label="Memory"
            value={memoryLoading ? "Checking..." : failedOutboxItems > 0 ? `${failedOutboxItems} failed sync` : waitingOutboxItems > 0 ? `${waitingOutboxItems} waiting to sync` : eligibleCaptureEvents > 0 ? `${eligibleCaptureEvents} ready` : memory?.storeReady ? "Ready" : "Needs check"}
            detail={memoryReviewCount > 0 ? `${memoryReviewCount} need review · ${memorySummary(memoryStatus, memoryError, pendingMemoryJobs)}` : memorySummary(memoryStatus, memoryError, pendingMemoryJobs)}
            tone={memoryProblem || memoryReviewCount > 0 ? "danger" : "success"}
            onClick={isAdmin ? () => onSection("memories") : undefined}
          />
        </div>
      </div>
    </section>
  );
}

function DashboardTile({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone: "success" | "danger" | "neutral";
  onClick?: () => void;
}) {
  const content = (
    <>
      <div style={panelIconStyle(tone)}><Icon size={18} /></div>
      <div style={{ minWidth: 0 }}>
        <div style={panelLabelStyle}>{label}</div>
        <div style={panelValueStyle}>{value}</div>
        <div style={panelDetailStyle}>{detail}</div>
      </div>
    </>
  );
  if (!onClick) return <div style={panelStyle(tone)}>{content}</div>;
  return (
    <button type="button" style={dashboardTileButtonStyle(tone)} onClick={onClick}>
      {content}
    </button>
  );
}

function TeamMemoriesSection({
  memories,
  memoryStatus,
  rows,
  clients,
  search,
  statusFilter,
  scopeFilter,
  clientFilter,
  loading,
  error,
  onSearch,
  onStatusFilter,
  onScopeFilter,
  onClientFilter,
  onRefresh,
  onOpen,
}: {
  memories: TeamMemoriesView | null;
  memoryStatus: TeamMemoryStatusView | null;
  rows: TeamMemoryItem[];
  clients: Array<{ value: string; label: string }>;
  search: string;
  statusFilter: MemoryStatusFilter;
  scopeFilter: MemoryScopeFilter;
  clientFilter: string;
  loading: boolean;
  error: string | null;
  onSearch: (value: string) => void;
  onStatusFilter: (value: MemoryStatusFilter) => void;
  onScopeFilter: (value: MemoryScopeFilter) => void;
  onClientFilter: (value: string) => void;
  onRefresh: () => void;
  onOpen: (memory: TeamMemoryItem) => void;
}) {
  const reviewCount = memories?.counts?.review ?? (memories?.review ?? []).filter((item) => item.status === "review").length;
  const redactedCount = memories?.counts?.redactedReview ?? (memories?.review ?? []).filter((item) => item.status === "redacted").length;
  const publishedCount = memories?.counts?.published ?? memories?.published.length ?? 0;
  const teamCount = memories?.counts?.team ?? (memories?.published ?? []).filter((item) => item.scope.visibility === "team").length;
  const clientCount = memories?.counts?.client ?? (memories?.published ?? []).filter((item) => item.scope.visibility === "client").length;
  const captureSummary = memoryCaptureSummary(memoryStatus);

  return (
    <section style={sectionStyle}>
      <SectionHeader title="Memories" detail="Review pending memories and read published team memory" icon={Database} />
      <div style={sectionBodyStyle}>
        <div style={dashboardGridStyle}>
          <DashboardTile icon={Database} label="Review" value={String(reviewCount)} detail={redactedCount > 0 ? `${redactedCount} redacted item${redactedCount === 1 ? "" : "s"}` : "Waiting for admin decision"} tone={reviewCount > 0 ? "danger" : "success"} />
          <DashboardTile icon={FileText} label="Published" value={String(publishedCount)} detail={`${teamCount} team · ${clientCount} client`} tone="neutral" />
          <DashboardTile icon={RefreshCw} label="Status" value={loading ? "Refreshing..." : captureSummary.value} detail={error || captureSummary.detail} tone={error ? "danger" : captureSummary.tone} />
        </div>

        <div style={memoryToolbarStyle}>
          <label style={toolbarSearchStyle}>
            <Search size={15} />
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search memories..." style={searchInputStyle} />
          </label>
          <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value as MemoryStatusFilter)} style={compactSelectStyle}>
            <option value="all">All statuses</option>
            <option value="review">Needs review</option>
            <option value="published">Published</option>
            <option value="redacted">Redacted</option>
          </select>
          <select value={scopeFilter} onChange={(event) => onScopeFilter(event.target.value as MemoryScopeFilter)} style={compactSelectStyle}>
            <option value="all">All scopes</option>
            <option value="team">Team</option>
            <option value="client">Client</option>
          </select>
          <select value={clientFilter} onChange={(event) => onClientFilter(event.target.value)} style={compactSelectStyle}>
            <option value="all">All clients</option>
            {clients.map((client) => (
              <option key={client.value} value={client.value}>{client.label}</option>
            ))}
          </select>
          <button type="button" style={secondaryButtonStyle} disabled={loading} onClick={onRefresh}>
            <RefreshCw size={14} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error && <div style={subtleWarningStyle}>{error}</div>}
        {!error && captureSummary.notice && <div style={subtleWarningStyle}>{captureSummary.notice}</div>}
        <MemoryTable rows={rows} loading={loading} onOpen={onOpen} />
      </div>
    </section>
  );
}

function MemoryTable({
  rows,
  loading,
  onOpen,
}: {
  rows: TeamMemoryItem[];
  loading: boolean;
  onOpen: (memory: TeamMemoryItem) => void;
}) {
  return (
    <div style={tableStyle}>
      <div style={memoryHeaderStyle}>
        <div>Memory</div>
        <div>Scope</div>
        <div>Status</div>
        <div>Updated</div>
      </div>
      {loading ? (
        <div style={emptyStyle}>Loading memories...</div>
      ) : rows.length === 0 ? (
        <div style={emptyStyle}>No memories match these filters.</div>
      ) : rows.map((memory) => (
        <button key={`${memory.kind}:${memory.id}`} type="button" style={memoryRowStyle} onClick={() => onOpen(memory)}>
          <div style={{ minWidth: 0 }}>
            <div style={strongTextStyle}>{memoryTitle(memory)}</div>
            <div style={memoryPreviewStyle}>{memoryPreview(memory)}</div>
          </div>
          <div style={tableCellStyle}>{memoryScopeLabel(memory)}</div>
          <div style={tableCellStyle}><MemoryStatusBadge memory={memory} /></div>
          <div style={mutedCellStyle}>{formatShortDateTime(memory.updatedAt || memory.createdAt || "")}</div>
        </button>
      ))}
    </div>
  );
}

function MemoryModal({
  memory,
  error,
  busy,
  canManagePublished,
  onClose,
  onAccept,
  onDiscard,
  onUpdate,
  onDelete,
}: {
  memory: TeamMemoryItem;
  error: string | null;
  busy: boolean;
  canManagePublished: boolean;
  onClose: () => void;
  onAccept: (input: { title: string; content: string }) => Promise<boolean>;
  onDiscard: () => Promise<boolean>;
  onUpdate: (input: { title: string; content: string }) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const originalContent = stripFrontmatter(memory.content ?? "");
  const [content, setContent] = useState(originalContent);
  const [isEditingPublished, setIsEditingPublished] = useState(false);
  const canManageReview = memory.kind === "review" && memory.status === "review" && memory.contentAvailable !== false;
  const canEditPublished = canManagePublished && memory.kind === "published" && memory.status !== "archived";
  const hasEdits = content.trim() !== originalContent.trim();
  const actionTitle = memoryTitleFromContent(content) || memoryTitle(memory);

  useEffect(() => {
    setContent(stripFrontmatter(memory.content ?? ""));
    setIsEditingPublished(false);
  }, [memory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={modalOverlayStyle} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-detail-title"
        style={modalStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <div>
            <h3 id="memory-detail-title" style={modalTitleStyle}>{memoryTitle(memory)}</h3>
            <div style={modalMetaRowStyle}>
              <MemoryStatusBadge memory={memory} />
              <span style={subtleTextStyle}>{memoryScopeLabel(memory)}</span>
              {memory.sourcePath && <span style={subtleTextStyle}>{memory.sourcePath}</span>}
            </div>
          </div>
          <div style={modalHeaderActionsStyle}>
            {memory.kind === "review" && (
              <button type="button" style={secondaryButtonStyle} disabled={busy || memory.status !== "review"} onClick={() => { void onDiscard(); }}>
                <Trash2 size={14} />
                Discard
              </button>
            )}
            {memory.kind === "review" && (
              <button type="button" style={primaryButtonStyle} disabled={busy || !canManageReview || content.trim().length === 0} onClick={() => { void onAccept({ title: actionTitle, content }); }}>
                <Check size={14} />
                {hasEdits ? "Edit + Accept" : "Accept"}
              </button>
            )}
            {canEditPublished && !isEditingPublished && (
              <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => setIsEditingPublished(true)}>
                <Pencil size={14} />
                Edit
              </button>
            )}
            {canEditPublished && isEditingPublished && (
              <>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={busy}
                  onClick={() => {
                    setContent(originalContent);
                    setIsEditingPublished(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={busy || !hasEdits || content.trim().length === 0}
                  onClick={() => {
                    void onUpdate({ title: actionTitle, content }).then((saved) => {
                      if (saved) setIsEditingPublished(false);
                    });
                  }}
                >
                  <Check size={14} />
                  {busy ? "Saving..." : "Save"}
                </button>
              </>
            )}
            {canEditPublished && !isEditingPublished && (
              <DeleteConfirmButton
                ariaLabel={`Delete memory ${memoryTitle(memory)}`}
                onConfirm={async () => {
                  await onDelete();
                }}
                variant="labeled"
                size="labeled"
                disabled={busy}
                idleColor="var(--cc-text-secondary)"
                idleBackground="var(--cc-surface-muted)"
                hoverBackground="var(--cc-surface-danger-soft)"
              />
            )}
            <button type="button" style={iconButtonStyle} onClick={onClose} aria-label="Close memory detail">
              <X size={16} />
            </button>
          </div>
        </div>

        {error && <div style={modalErrorStyle}>{error}</div>}
        {memory.kind === "review" && memory.status === "redacted" && (
          <div style={modalDescriptionStyle}>The original text has been redacted. This item can no longer be accepted.</div>
        )}

        <div style={memoryModalBodyStyle}>
          {memory.kind === "review" ? (
            <>
              <div style={memoryReasonRowStyle}>
                <div style={memoryMetaBoxStyle}>
                  <div style={panelLabelStyle}>Reason</div>
                  <div style={panelDetailStyle}>{memory.reason || "Needs review"}</div>
                </div>
              </div>
              <label style={memoryFieldStyle}>
                <span style={panelLabelStyle}>Memory text</span>
                <textarea value={content} onChange={(event) => setContent(event.target.value)} style={memoryTextareaStyle} disabled={memory.status === "redacted"} />
              </label>
              <div style={memoryPreviewBoxStyle}>
                <MarkdownPreview content={content || "_No readable text available._"} showFrontmatter={false} />
              </div>
            </>
          ) : isEditingPublished ? (
            <>
              <label style={memoryFieldStyle}>
                <span style={panelLabelStyle}>Memory text</span>
                <textarea value={content} onChange={(event) => setContent(event.target.value)} style={memoryTextareaStyle} disabled={busy} />
              </label>
              <div style={memoryPreviewBoxStyle}>
                <MarkdownPreview content={content || "_No readable text available._"} showFrontmatter={false} />
              </div>
            </>
          ) : (
            <div style={memoryPreviewBoxStyle}>
              <MarkdownPreview content={stripFrontmatter(memory.content || "_No readable text available._")} showFrontmatter={false} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MemberTable({
  members,
  busy,
  openMenu,
  setOpenMenu,
  onRoleChange,
  onCopyInvite,
  onCopyReset,
  onRemove,
}: {
  members: AdminMember[];
  busy: boolean;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  onRoleChange: (member: AdminMember, role: string) => void;
  onCopyInvite: (member: AdminMember) => void;
  onCopyReset: (member: AdminMember) => void;
  onRemove: (member: AdminMember) => void;
}) {
  if (members.length === 0) return <div style={emptyStyle}>No members found.</div>;
  return (
    <div style={tableStyle}>
      <div style={memberHeaderStyle}>
        <div>User</div>
        <div>Account Type</div>
        <div>Status</div>
        <div>Clients</div>
        <div />
      </div>
      {members.map((member) => {
        const key = member.userId || member.email || member.id || "member";
        const displayedRole = member.effectiveRole || member.role;
        const isOwner = displayedRole === "owner";
        const protectedAccess = member.protected === true || member.source === "company_owner" || member.source === "company_grant";
        const isPending = member.status === "invited";
        return (
          <div key={key} style={memberRowStyle}>
            <UserCell name={member.displayName || member.email || "Unknown user"} email={member.email || member.userId || ""} pending={isPending} />
            <div>
              {isOwner ? (
                <span style={roleTextStyle}>Owner</span>
              ) : protectedAccess ? (
                <div>
                  <span style={roleTextStyle}>Admin</span>
                  <div style={protectedAccessTextStyle}>Protected by company access</div>
                </div>
              ) : (
                <select value={member.role || "member"} disabled={busy} onChange={(event) => onRoleChange(member, event.target.value)} style={inlineSelectStyle}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              )}
            </div>
            <div><StatusBadge status={member.status || "unknown"} /></div>
            <div style={mutedCellStyle}>{clientSummary(member.clients ?? [])}</div>
            <div style={actionCellStyle}>
              {!isOwner && !protectedAccess && (
                <RowMenu
                  id={key}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  items={[
                    isPending
                      ? { label: "Copy Invite Link", onClick: () => onCopyInvite(member) }
                      : { label: "Copy Password Reset Link", onClick: () => onCopyReset(member) },
                    { label: "Delete User", onClick: () => onRemove(member), danger: true },
                  ]}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClientTable({
  clients,
  canManage,
  busy,
  syncingClient,
  onOpen,
  onSync,
}: {
  clients: VisibleClient[];
  canManage: boolean;
  busy: boolean;
  syncingClient: string | null;
  onOpen: (client: VisibleClient) => void;
  onSync: (client: VisibleClient, action: "pull" | "push") => void;
}) {
  if (clients.length === 0) return <div style={emptyStyle}>No server-side clients found.</div>;
  return (
    <div style={tableStyle}>
      <div style={clientHeaderStyle(canManage)}>
        <div>Client</div>
        {canManage ? (
          <>
            <div>Members</div>
            <div>Editors</div>
            <div>Viewers</div>
          </>
        ) : (
          <div>Access</div>
        )}
        <div>Local</div>
        <div />
      </div>
      {clients.map((client) => {
        const status = client.localStatus;
        const syncing = syncingClient === client.id;
        const canPush = (client.access ?? "read") === "write";
        return (
          <div
            key={client.id}
            role={canManage ? "button" : undefined}
            tabIndex={canManage ? 0 : undefined}
            style={clientRowStyle(canManage)}
            onClick={() => canManage && onOpen(client)}
            onKeyDown={(event) => {
              if (!canManage) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(client);
              }
            }}
          >
            <div>
              <div style={strongTextStyle}>{client.name || client.slug}</div>
              <div style={subtleTextStyle}>{client.slug}</div>
            </div>
            {canManage ? (
              <>
                <div>{client.memberCount ?? 0}</div>
                <div>{client.editorCount ?? 0}</div>
                <div>{client.viewerCount ?? 0}</div>
              </>
            ) : (
              <div style={tableCellStyle}>{accessLabel(client.access ?? "read")}</div>
            )}
            <div>
              <StatusBadge status={clientSyncStatusLabel(client)} />
              {client.syncState && client.syncState.changedFiles > 0 && (
                <div style={subtleTextStyle}>{client.syncState.changedFiles} file{client.syncState.changedFiles === 1 ? "" : "s"}</div>
              )}
            </div>
            <div style={actionCellStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onSync(client, "pull");
                }}
              >
                {syncing ? "Syncing..." : status === "ready" ? "Sync" : "Pull"}
              </button>
              {canPush && (
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSync(client, "push");
                  }}
                >
                  {syncing ? "Syncing..." : "Push"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SecretTable({
  secrets,
  loading,
  canManage,
  onOpen,
}: {
  secrets: TeamSecret[];
  loading: boolean;
  canManage: boolean;
  onOpen: (secret: TeamSecret) => void;
}) {
  if (loading && secrets.length === 0) return <div style={emptyStyle}>Loading secrets...</div>;
  if (secrets.length === 0) return <div style={emptyStyle}>No shared secrets available.</div>;
  return (
    <div style={tableStyle}>
      <div style={secretHeaderStyle}>
        <div>Secret</div>
        <div>Scope</div>
        <div>Members</div>
        <div>Status</div>
        <div />
      </div>
      {secrets.map((secret) => (
        <div
          key={secret.id}
          role={canManage ? "button" : undefined}
          tabIndex={canManage ? 0 : undefined}
          style={{ ...secretRowStyle, cursor: canManage ? "pointer" : "default" }}
          onClick={() => canManage && onOpen(secret)}
          onKeyDown={(event) => {
            if (!canManage) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(secret);
            }
          }}
        >
          <div>
            <div style={strongTextStyle}>{secret.name || secret.envKey}</div>
            <div style={subtleTextStyle}>{secret.envKey}</div>
          </div>
          <div style={tableCellStyle}>{secret.scope === "client" ? secret.clientName || secret.clientSlug || "Client" : "Team"}</div>
          <div style={tableCellStyle}>{secret.grants?.length ?? (secret.grantedToCurrentUser ? 1 : 0)}</div>
          <div><StatusBadge status={secret.status || "active"} /></div>
          <div style={actionCellStyle}>{canManage ? "Manage" : ""}</div>
        </div>
      ))}
    </div>
  );
}

function SecretModal({
  secret,
  members,
  grants,
  availableMembers,
  search,
  error,
  busy,
  openMenu,
  setOpenMenu,
  setSearch,
  onClose,
  onGrant,
  onRevoke,
  onArchive,
}: {
  secret: TeamSecret;
  members: AdminMember[];
  grants: TeamSecretGrant[];
  availableMembers: AdminMember[];
  search: string;
  error: string | null;
  busy: boolean;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  setSearch: (value: string) => void;
  onClose: () => void;
  onGrant: (member: AdminMember) => void;
  onRevoke: (grant: TeamSecretGrant) => void;
  onArchive: () => void;
}) {
  const memberById = new Map(members.map((member) => [member.userId, member]));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={modalOverlayStyle} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="secret-permissions-title"
        style={modalStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <div>
            <h3 id="secret-permissions-title" style={modalTitleStyle}>{secret.name || secret.envKey}</h3>
            <div style={subtleTextStyle}>{secret.envKey} · {secret.scope === "client" ? secret.clientName || secret.clientSlug : "Team"}</div>
          </div>
          <div style={modalHeaderActionsStyle}>
            <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onArchive}>Archive</button>
            <button type="button" style={iconButtonStyle} onClick={onClose} aria-label="Close secret permissions">
              <X size={16} />
            </button>
          </div>
        </div>
        <label style={searchBoxStyle}>
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Grant to members..." style={searchInputStyle} />
        </label>
        {error && <div style={modalErrorStyle}>{error}</div>}
        {search.trim() && (
          <div style={suggestionBoxStyle}>
            {availableMembers.length === 0 ? (
              <div style={emptyStyle}>No available members found.</div>
            ) : availableMembers.map((member) => (
              <div key={member.userId || member.email || "member"} style={suggestionRowStyle}>
                <UserCell name={member.displayName || member.email || "Unknown user"} email={member.email || member.userId || ""} pending={member.status === "invited"} compact />
                <div style={suggestionActionsStyle}>
                  <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => onGrant(member)}>Grant</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={modalTableStyle}>
          <div style={modalTableHeaderStyle}>
            <div>Member</div>
            <div>Access</div>
            <div />
          </div>
          {grants.length === 0 ? (
            <div style={emptyStyle}>No explicit grants yet.</div>
          ) : grants.map((grant) => {
            const member = memberById.get(grant.userId);
            return (
              <div key={grant.id} style={modalTableRowStyle}>
                <UserCell name={member?.displayName || grant.email || grant.userId} email={grant.email || grant.userId} pending={member?.status === "invited"} compact />
                <div style={tableCellStyle}>Can sync</div>
                <div style={actionCellStyle}>
                  <RowMenu
                    id={grant.id}
                    openMenu={openMenu}
                    setOpenMenu={setOpenMenu}
                    items={[{ label: "Remove grant", onClick: () => onRevoke(grant), danger: true }]}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SkillToolbar({
  search,
  sort,
  members,
  memberSearch,
  suggestions,
  pageSize,
  canFilterMembers,
  onSearch,
  onSort,
  onMemberSearch,
  onAddMemberFilter,
  onRemoveMemberFilter,
  onClearMemberFilters,
  onPageSize,
}: {
  search: string;
  sort: SkillSort;
  members: AdminMember[];
  memberSearch: string;
  suggestions: AdminMember[];
  pageSize: number;
  canFilterMembers: boolean;
  onSearch: (value: string) => void;
  onSort: (value: SkillSort) => void;
  onMemberSearch: (value: string) => void;
  onAddMemberFilter: (member: AdminMember) => void;
  onRemoveMemberFilter: (id: string) => void;
  onClearMemberFilters: () => void;
  onPageSize: (value: number) => void;
}) {
  return (
    <div style={skillToolbarStyle(canFilterMembers)}>
      <label style={toolbarSearchStyle}>
        <Search size={15} />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search skill name or slug..." style={searchInputStyle} />
      </label>
      <select value={sort} onChange={(event) => onSort(event.target.value as SkillSort)} style={selectStyle} aria-label="Sort skills">
        <option value="updated-desc">Sort by last updated</option>
        <option value="created-desc">Sort by last created</option>
        <option value="name-asc">Sort by name (A-Z)</option>
        <option value="name-desc">Sort by name (Z-A)</option>
      </select>
      {canFilterMembers && (
        <div style={memberFilterStyle}>
          <label style={memberFilterInputStyle}>
            <Users size={15} />
            <input value={memberSearch} onChange={(event) => onMemberSearch(event.target.value)} placeholder="Filter members..." style={searchInputStyle} />
          </label>
          {memberSearch.trim() && (
            <div style={filterSuggestionBoxStyle}>
              {suggestions.length === 0 ? (
                <div style={emptyStyle}>No matching members.</div>
              ) : suggestions.map((member) => (
                <button
                  key={memberIdentity(member)}
                  type="button"
                  style={filterSuggestionButtonStyle}
                  onClick={() => onAddMemberFilter(member)}
                >
                  <UserCell name={member.displayName || member.email || "Unknown user"} email={member.email || member.userId || ""} pending={member.status === "invited"} compact />
                </button>
              ))}
            </div>
          )}
          {members.length > 0 && (
            <div style={filterChipRowStyle}>
              {members.map((member) => {
                const id = memberIdentity(member);
                return (
                  <span key={id} style={filterChipStyle}>
                    {member.displayName || member.email || id}
                    <button type="button" style={chipRemoveButtonStyle} onClick={() => onRemoveMemberFilter(id)} aria-label={`Remove ${member.displayName || member.email || id}`}>
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
              <button type="button" style={clearFiltersButtonStyle} onClick={onClearMemberFilters}>Clear</button>
            </div>
          )}
        </div>
      )}
      <label style={pageSizeControlStyle}>
        Rows
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} style={compactSelectStyle} aria-label="Rows per page">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
    </div>
  );
}

function SkillTable({ skills, loading, showGrantColumns, onOpen }: { skills: SkillRow[]; loading: boolean; showGrantColumns: boolean; onOpen: (skill: SkillRow) => void }) {
  if (loading && skills.length === 0) return <div style={emptyStyle}>Loading skills...</div>;
  if (skills.length === 0) return <div style={emptyStyle}>No skills match the current filters.</div>;
  return (
    <div style={tableStyle}>
      <div style={skillHeaderStyle(showGrantColumns)}>
        <div>Skill</div>
        <div>Source</div>
        {showGrantColumns ? (
          <>
            <div>Members</div>
            <div>Top Permission</div>
          </>
        ) : (
          <div>Permission</div>
        )}
        <div>Local</div>
      </div>
      {skills.map((skill) => (
        <div
          key={skill.id}
          role={skill.source === "local" ? undefined : "button"}
          tabIndex={skill.source === "local" ? -1 : 0}
          style={skillRowStyle(showGrantColumns)}
          onClick={() => { if (skill.source !== "local") onOpen(skill); }}
          onKeyDown={(event) => {
            if (skill.source === "local") return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(skill);
            }
          }}
        >
          <div>
            <div style={strongTextStyle}>{skill.name || skill.slug}</div>
            <div style={subtleTextStyle}>{skill.slug}</div>
          </div>
          <div>{skillSourceBadge(skill)}</div>
          {showGrantColumns ? (
            <>
              <div style={tableCellStyle}>{skill.activeGrants.length}</div>
              <div style={tableCellStyle}>{permissionSummary(skill.activeGrants)}</div>
            </>
          ) : (
            <div style={tableCellStyle}>{skill.source === "local" ? "Installation" : skill.userPermission ? permissionLabel(skill.userPermission) : "Granted"}</div>
          )}
          <div>
            <StatusBadge status={localSkillStatusLabel(skill)} />
            {skill.syncState && skill.syncState.changedFiles > 0 && (
              <div style={subtleTextStyle}>{skill.syncState.changedFiles} file{skill.syncState.changedFiles === 1 ? "" : "s"}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaginationBar({
  page,
  pageCount,
  pageSize,
  total,
  onPrevious,
  onNext,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div style={paginationStyle}>
      <div style={subtleTextStyle}>
        {start}-{end} of {total}
      </div>
      <div style={paginationActionsStyle}>
        <button type="button" style={iconButtonStyle} disabled={page <= 1} onClick={onPrevious} aria-label="Previous skills page">
          <ChevronLeft size={16} />
        </button>
        <span style={paginationTextStyle}>Page {page} of {pageCount}</span>
        <button type="button" style={iconButtonStyle} disabled={page >= pageCount} onClick={onNext} aria-label="Next skills page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function SkillModal({
  skill,
  members,
  availableMembers,
  search,
  error,
  busy,
  canManage,
  addPermission,
  syncingKey,
  openMenu,
  setOpenMenu,
  setSearch,
  setAddPermission,
  onClose,
  onGrant,
  onChangePermission,
  onRevoke,
  onSync,
}: {
  skill: SkillRow;
  members: AdminMember[];
  availableMembers: AdminMember[];
  search: string;
  error: string | null;
  busy: boolean;
  canManage: boolean;
  addPermission: SkillPermission;
  syncingKey: string | null;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  setSearch: (value: string) => void;
  setAddPermission: (value: SkillPermission) => void;
  onClose: () => void;
  onGrant: (member: AdminMember) => void;
  onChangePermission: (grant: SkillGrant, permission: SkillPermission) => void;
  onRevoke: (grant: SkillGrant) => void;
  onSync: (action: "pull" | "push" | "adopt") => void;
}) {
  const memberById = new Map(members.map((member) => [member.userId || member.email, member]));
  const syncingPull = syncingKey === `${skill.slug}:pull`;
  const syncingAdopt = syncingKey === `${skill.slug}:adopt`;
  const syncingPush = syncingKey === `${skill.slug}:push`;
  const primarySyncAction: "pull" | "adopt" = skill.adoptable && !skill.managed ? "adopt" : "pull";
  const primarySyncing = primarySyncAction === "adopt" ? syncingAdopt : syncingPull;
  const primarySyncLabel = primarySyncing
    ? "Syncing..."
    : primarySyncAction === "adopt"
      ? "Adopt"
      : skill.localStatus === "ready"
        ? "Sync"
        : "Pull";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={modalOverlayStyle} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-permissions-title"
        style={modalStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <div>
            <h3 id="skill-permissions-title" style={modalTitleStyle}>{skill.name || skill.slug}</h3>
            <div style={modalMetaRowStyle}>
              <span style={subtleTextStyle}>{skill.slug}</span>
              {skillSourceBadge(skill)}
            </div>
          </div>
          <div style={modalHeaderActionsStyle}>
            <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => onSync(primarySyncAction)}>
              <Download size={14} />
              {primarySyncLabel}
            </button>
            {canManage && (
              <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => onSync("push")}>
                <Upload size={14} />
                {syncingPush ? "Pushing..." : "Push"}
              </button>
            )}
            <button type="button" style={iconButtonStyle} onClick={onClose} aria-label="Close skill permissions">
              <X size={16} />
            </button>
          </div>
        </div>
        {skill.description && <div style={modalDescriptionStyle}>{skill.description}</div>}
        {canManage ? (
          <>
            <div style={modalFormRowStyle}>
              <div style={{ ...searchBoxStyle, flex: 1, margin: 0 }}>
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Add members..." aria-label="Add skill members" style={searchInputStyle} />
              </div>
              <select value={addPermission} onChange={(event) => setAddPermission(event.target.value as SkillPermission)} style={inlineSelectStyle} aria-label="Permission for new member">
                {SKILL_PERMISSIONS.map((permission) => <option key={permission} value={permission}>{permissionLabel(permission)}</option>)}
              </select>
            </div>
            {search.trim() && (
              <div style={suggestionBoxStyle}>
                {availableMembers.length === 0 ? (
                  <div style={emptyStyle}>No available members found.</div>
                ) : availableMembers.map((member) => (
                  <div key={memberIdentity(member)} style={suggestionRowStyle}>
                    <UserCell name={member.displayName || member.email || "Unknown user"} email={member.email || member.userId || ""} pending={member.status === "invited"} compact />
                    <div style={suggestionActionsStyle}>
                      <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => onGrant(member)}>Add</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={emptyStyle}>Only owners and admins can manage skill permissions.</div>
        )}
        {error && <div style={modalErrorStyle}>{error}</div>}

        <div style={modalTableStyle}>
          <div style={modalTableHeaderStyle}>
            <div>Member</div>
            <div>Permission</div>
            <div />
          </div>
          {skill.activeGrants.length === 0 ? (
            <div style={emptyStyle}>No members have access to this skill.</div>
          ) : skill.activeGrants.map((grant) => {
            const member = memberById.get(grant.userId || grant.email);
            return (
              <div key={grant.id} style={modalTableRowStyle}>
                <UserCell name={member?.displayName || grant.email} email={grant.email} pending={member?.status === "invited"} compact />
                <div>
                  <select value={grant.permission} disabled={busy || !canManage} style={inlineSelectStyle} onChange={(event) => onChangePermission(grant, event.target.value as SkillPermission)}>
                    {SKILL_PERMISSIONS.map((permission) => <option key={permission} value={permission}>{permissionLabel(permission)}</option>)}
                  </select>
                </div>
                <div style={actionCellStyle}>
                  {canManage && (
                    <RowMenu
                      id={grant.id}
                      openMenu={openMenu}
                      setOpenMenu={setOpenMenu}
                      items={[{ label: "Remove member", onClick: () => onRevoke(grant), danger: true }]}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ClientModal({
  client,
  grants,
  members,
  availableMembers,
  search,
  error,
  busy,
  openMenu,
  setOpenMenu,
  setSearch,
  onClose,
  onGrant,
  onChangeAccess,
  onRevoke,
}: {
  client: AdminClient;
  grants: ClientGrant[];
  members: AdminMember[];
  availableMembers: AdminMember[];
  search: string;
  error: string | null;
  busy: boolean;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  setSearch: (value: string) => void;
  onClose: () => void;
  onGrant: (member: AdminMember) => void;
  onChangeAccess: (grant: ClientGrant, access: GrantAccess) => void;
  onRevoke: (grant: ClientGrant) => void;
}) {
  const memberById = new Map(members.map((member) => [member.userId, member]));
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={modalOverlayStyle} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-permissions-title"
        style={modalStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <div>
            <h3 id="client-permissions-title" style={modalTitleStyle}>{client.name || client.slug}</h3>
            <div style={subtleTextStyle}>{client.slug}</div>
          </div>
          <button type="button" style={iconButtonStyle} onClick={onClose} aria-label="Close client permissions">
            <X size={16} />
          </button>
        </div>
        <label style={searchBoxStyle}>
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Add users..." style={searchInputStyle} />
        </label>
        {error && <div style={modalErrorStyle}>{error}</div>}
        {search.trim() && (
          <div style={suggestionBoxStyle}>
            {availableMembers.length === 0 ? (
              <div style={emptyStyle}>No available users found.</div>
            ) : availableMembers.map((member) => (
              <div key={member.userId || member.email || "member"} style={suggestionRowStyle}>
                <UserCell name={member.displayName || member.email || "Unknown user"} email={member.email || ""} pending={member.status === "invited"} compact />
                <div style={suggestionActionsStyle}>
                  <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => onGrant(member)}>Add</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={modalTableStyle}>
          <div style={modalTableHeaderStyle}>
            <div>User</div>
            <div>Role</div>
            <div />
          </div>
          {grants.length === 0 ? (
            <div style={emptyStyle}>No users have access to this client.</div>
          ) : grants.map((grant) => {
            const member = memberById.get(grant.userId);
            const locked = Boolean(grant.protected || grant.implicit);
            return (
              <div key={grant.id} style={modalTableRowStyle}>
                <UserCell name={member?.displayName || grant.email} email={grant.email} pending={member?.status === "invited"} compact />
                <div>
                  <select value={grant.access} disabled={busy || locked} style={inlineSelectStyle} onChange={(event) => onChangeAccess(grant, event.target.value as GrantAccess)}>
                    <option value="read">Client Viewer</option>
                    <option value="write">Client Editor</option>
                  </select>
                  {locked && <div style={subtleTextStyle}>Protected by team role</div>}
                </div>
                <div style={actionCellStyle}>
                  {!locked && (
                    <RowMenu
                      id={grant.id}
                      openMenu={openMenu}
                      setOpenMenu={setOpenMenu}
                      items={[{ label: "Remove user", onClick: () => onRevoke(grant), danger: true }]}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function UserCell({ name, email, pending, compact = false }: { name: string; email: string; pending?: boolean; compact?: boolean }) {
  const initials = initialsFor(name || email);
  return (
    <div style={userCellStyle}>
      <div style={avatarStyle(compact)}>{initials}</div>
      <div style={{ minWidth: 0 }}>
        <div style={userNameStyle}>
          {name}
          {pending && <span style={pendingBadgeStyle}>Pending</span>}
        </div>
        <div style={subtleTextStyle}>{email}</div>
      </div>
    </div>
  );
}

function RowMenu({
  id,
  openMenu,
  setOpenMenu,
  items,
}: {
  id: string;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  items: Array<{ label: string; onClick: () => void; danger?: boolean }>;
}) {
  const open = openMenu === id;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: Math.round(rect.bottom + 6),
        left: Math.max(12, Math.round(rect.right - 190)),
      });
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && buttonRef.current?.contains(target)) return;
      const menu = document.querySelector(`[data-row-menu="${id}"]`);
      if (target && menu?.contains(target)) return;
      setOpenMenu(null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [id, open, setOpenMenu]);

  const menu = open && typeof document !== "undefined"
    ? createPortal(
      <div data-row-menu={id} style={rowMenuStyle(position)}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            style={menuItemStyle(item.danger)}
            onClick={() => {
              setOpenMenu(null);
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>,
      document.body,
    )
    : null;

  return (
    <div style={rowMenuWrapStyle}>
      <button ref={buttonRef} type="button" style={iconButtonStyle} onClick={() => setOpenMenu(open ? null : id)} aria-label="Open row actions">
        <MoreVertical size={16} />
      </button>
      {menu}
    </div>
  );
}

function LinkNotice({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div style={linkNoticeStyle}>
      <div>
        <div style={panelLabelStyle}>{label}</div>
        <div style={linkValueStyle}>{value}</div>
      </div>
      <button type="button" style={secondaryButtonStyle} onClick={onCopy}>
        <Copy size={14} />
        Copy
      </button>
    </div>
  );
}

function SectionHeader({ title, detail, icon: Icon }: { title: string; detail: string; icon: typeof Activity }) {
  return (
    <div style={sectionHeaderStyle}>
      <div>
        <h3 style={sectionTitleStyle}>{title}</h3>
        <div style={subtleTextStyle}>{detail}</div>
      </div>
      <Icon size={18} color="var(--cc-brand-primary)" />
    </div>
  );
}

function BoundaryPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={boundaryPanelStyle}>
      <div style={strongTextStyle}>{title}</div>
      <ul style={boundaryListStyle}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function SimpleTable({ columns, rows, empty }: { columns: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <div style={emptyStyle}>{empty}</div>;
  return (
    <div style={tableStyle}>
      <div style={simpleHeaderStyle(columns.length)}>
        {columns.map((column) => <div key={column}>{column}</div>)}
      </div>
      {rows.map((row, index) => (
        <div key={`${row.join("-")}-${index}`} style={simpleRowStyle(columns.length)}>
          {row.map((cell, cellIndex) => <div key={`${cell}-${cellIndex}`} style={tableCellStyle}>{cell}</div>)}
        </div>
      ))}
    </div>
  );
}

function StatusPanel({ icon: Icon, label, value, detail, tone }: { icon: typeof Activity; label: string; value: string; detail: string; tone: "success" | "warning" | "neutral" }) {
  return (
    <div style={panelStyle(tone)}>
      <div style={panelIconStyle(tone)}><Icon size={18} /></div>
      <div style={{ minWidth: 0 }}>
        <div style={panelLabelStyle}>{label}</div>
        <div style={panelValueStyle}>{value}</div>
        <div style={panelDetailStyle}>{detail}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span style={statusBadgeStyle(status)}>{status}</span>;
}

function MemoryStatusBadge({ memory }: { memory: TeamMemoryItem }) {
  return <span style={memoryStatusBadgeStyle(memory)}>{memoryStatusLabel(memory)}</span>;
}

function initialsFor(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (value.trim().slice(0, 2) || "?").toUpperCase();
}

function accessLabel(access: GrantAccess): string {
  return access === "write" ? "Client Editor" : "Client Viewer";
}

function roleLabel(role: string | null | undefined): string {
  if (!role) return "Member";
  return role.split(/[\s_-]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function clientSummary(clients: Array<{ name?: string | null; slug: string; access: GrantAccess }>): string {
  if (clients.length === 0) return "No clients";
  if (clients.length <= 2) return clients.map((client) => client.name || client.slug).join(", ");
  return `${clients.slice(0, 2).map((client) => client.name || client.slug).join(", ")} + ${clients.length - 2}`;
}

function countStatus(record: Record<string, number> | undefined, keys: string[]): number {
  if (!record) return 0;
  return keys.reduce((total, key) => total + (record[key] ?? 0), 0);
}

function memorySummary(memoryStatus: TeamMemoryStatusView | null, error: string | null, pendingJobs: number): string {
  if (error) return error;
  const status = memoryStatus?.status;
  if (!status) return "Status unavailable";
  const outbox = memoryStatus?.outbox;
  if ((outbox?.failed ?? 0) > 0) return `${outbox?.failed ?? 0} failed sync · ${status.sources ?? 0} sources · ${status.chunks ?? 0} chunks`;
  if (((outbox?.queued ?? 0) + (outbox?.syncing ?? 0)) > 0) {
    return `${(outbox?.queued ?? 0) + (outbox?.syncing ?? 0)} waiting to sync · ${status.sources ?? 0} sources · ${status.chunks ?? 0} chunks`;
  }
  const captureEligibility = status.captureEligibility;
  if ((captureEligibility?.eligiblePending ?? 0) > 0) {
    return `${captureEligibility?.eligiblePending ?? 0} captures ready for local consolidation`;
  }
  if ((captureEligibility?.waitingPending ?? 0) > 0) {
    return `${captureEligibility?.waitingPending ?? 0} captures waiting for quiet period`;
  }
  const indexed = status.lastIndexedAt ? ` · Last indexed ${formatShortDateTime(status.lastIndexedAt)}` : "";
  const pending = pendingJobs > 0 ? ` · ${pendingJobs} pending` : "";
  return `${status.sources ?? 0} sources · ${status.chunks ?? 0} chunks${pending}${indexed}`;
}

function memoryCaptureSummary(memoryStatus: TeamMemoryStatusView | null): {
  value: string;
  detail: string;
  notice: string | null;
  tone: "success" | "danger" | "neutral";
} {
  const status = memoryStatus?.status;
  const eligibility = status?.captureEligibility;
  const byStatus = status?.captureEventsByStatus ?? {};
  const pending = eligibility?.pending ?? byStatus.pending ?? 0;
  const eligible = eligibility?.eligiblePending ?? 0;
  const waiting = eligibility?.waitingPending ?? 0;
  const review = byStatus.review ?? 0;
  const failed = byStatus.failed ?? 0;
  if (failed > 0) {
    return {
      value: `${failed} failed`,
      detail: `${pending} pending capture${pending === 1 ? "" : "s"}`,
      notice: `${failed} memory capture${failed === 1 ? "" : "s"} failed during consolidation.`,
      tone: "danger",
    };
  }
  if (eligible > 0) {
    return {
      value: `${eligible} ready`,
      detail: "Local consolidation is queued",
      notice: `${eligible} capture${eligible === 1 ? " is" : "s are"} ready for local consolidation. This machine will process them in the background.`,
      tone: "danger",
    };
  }
  if (waiting > 0) {
    const next = eligibility?.nextEligibleAt ? ` Next check after ${formatShortDateTime(eligibility.nextEligibleAt)}.` : "";
    return {
      value: `${waiting} waiting`,
      detail: "Waiting for capture quiet period",
      notice: `${waiting} capture${waiting === 1 ? " is" : "s are"} waiting for the quiet period before local consolidation.${next}`,
      tone: "neutral",
    };
  }
  if (review > 0) {
    return {
      value: "Loaded",
      detail: `${review} review item${review === 1 ? "" : "s"} available`,
      notice: null,
      tone: "success",
    };
  }
  return {
    value: "Loaded",
    detail: "Team and client memories",
    notice: null,
    tone: "success",
  };
}

function normalizeTeamMemories(value: unknown): TeamMemoriesView {
  const record = asPlainRecord(value);
  return {
    admin: record.admin === true,
    review: normalizeMemoryArray(record.review, "review") as TeamMemoryReviewItem[],
    published: normalizeMemoryArray(record.published, "published") as TeamMemoryPublishedItem[],
    counts: asPlainRecord(record.counts) as TeamMemoriesView["counts"],
  };
}

function normalizeMemoryArray(value: unknown, kind: "review" | "published"): TeamMemoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<TeamMemoryItem>((item) => {
    const record = asPlainRecord(item);
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) return [];
    const scopeRecord = asPlainRecord(record.scope);
    const scope: TeamMemoryScopeView = {
      teamId: typeof scopeRecord.teamId === "string" ? scopeRecord.teamId : null,
      clientId: typeof scopeRecord.clientId === "string" ? scopeRecord.clientId : null,
      clientSlug: typeof scopeRecord.clientSlug === "string" ? scopeRecord.clientSlug : null,
      clientName: typeof scopeRecord.clientName === "string" ? scopeRecord.clientName : null,
      userId: typeof scopeRecord.userId === "string" ? scopeRecord.userId : null,
      visibility: scopeRecord.visibility === "client" ? "client" : "team",
    };
    const base = {
      id,
      kind,
      scope,
      sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : null,
      sourceType: typeof record.sourceType === "string" ? record.sourceType : null,
      title: typeof record.title === "string" ? record.title : null,
      contentDate: typeof record.contentDate === "string" ? record.contentDate : null,
      content: typeof record.content === "string" ? record.content : "",
      status: typeof record.status === "string" ? record.status : null,
      metadata: asPlainRecord(record.metadata),
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    };
    if (kind === "review") {
      return [{
        ...base,
        kind: "review" as const,
        actorUserId: typeof record.actorUserId === "string" ? record.actorUserId : null,
        actorEmail: typeof record.actorEmail === "string" ? record.actorEmail : null,
        actorDisplayName: typeof record.actorDisplayName === "string" ? record.actorDisplayName : null,
        sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
        contentAvailable: record.contentAvailable !== false,
        reason: typeof record.reason === "string" ? record.reason : null,
        confidence: record.confidence,
        processedAt: typeof record.processedAt === "string" ? record.processedAt : null,
        redactedAt: typeof record.redactedAt === "string" ? record.redactedAt : null,
      }];
    }
    return [{
      ...base,
      kind: "published" as const,
      chunkCount: typeof record.chunkCount === "number" ? record.chunkCount : 0,
      errorMessage: typeof record.errorMessage === "string" ? record.errorMessage : null,
      createdByUserId: typeof record.createdByUserId === "string" ? record.createdByUserId : null,
      createdByEmail: typeof record.createdByEmail === "string" ? record.createdByEmail : null,
      createdByDisplayName: typeof record.createdByDisplayName === "string" ? record.createdByDisplayName : null,
      indexedAt: typeof record.indexedAt === "string" ? record.indexedAt : null,
      archivedAt: typeof record.archivedAt === "string" ? record.archivedAt : null,
    }];
  });
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

function cleanMemoryPlainText(content: string): string {
  return stripFrontmatter(content)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function memoryTitleFromContent(content: string): string | null {
  return cleanMemoryPlainText(content).split(/\r?\n/).find(Boolean)?.slice(0, 90) || null;
}

function memoryTitle(memory: TeamMemoryItem): string {
  const contentTitle = memoryTitleFromContent(memory.content ?? "");
  if (memory.kind === "review") return contentTitle || "Memory review item";
  return memory.title?.trim()
    || contentTitle
    || memory.sourcePath
    || "Published memory";
}

function memoryPreview(memory: TeamMemoryItem): string {
  const text = cleanMemoryPlainText(memory.content ?? "");
  if (!text) {
    if (memory.kind === "review" && memory.status === "redacted") return "Original text was redacted.";
    return "No readable preview available.";
  }
  return text.length > 180 ? `${text.slice(0, 180).trim()}...` : text;
}

function memoryScopeLabel(memory: TeamMemoryItem): string {
  if (memory.scope.visibility === "team") return "Team";
  return memory.scope.clientName || memory.scope.clientSlug || memory.scope.clientId || "Client";
}

function memoryStatusLabel(memory: TeamMemoryItem): string {
  if (memory.kind === "published") return "Published";
  if (memory.status === "redacted") return "Redacted";
  return "Needs review";
}

function memoryClientKey(memory: TeamMemoryItem): string {
  return memory.scope.clientSlug || memory.scope.clientId || "";
}

function memoryClientFilterOptions(memories: TeamMemoriesView | null): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const memory of [...(memories?.review ?? []), ...(memories?.published ?? [])]) {
    if (memory.scope.visibility !== "client") continue;
    const key = memoryClientKey(memory);
    if (!key || seen.has(key)) continue;
    seen.set(key, memory.scope.clientName || memory.scope.clientSlug || memory.scope.clientId || key);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function filterMemoryItems(
  items: TeamMemoryItem[],
  filters: { query: string; status: MemoryStatusFilter; scope: MemoryScopeFilter; client: string },
): TeamMemoryItem[] {
  const query = filters.query.trim().toLowerCase();
  return items
    .filter((memory) => {
      if (filters.status === "review" && !(memory.kind === "review" && memory.status === "review")) return false;
      if (filters.status === "published" && memory.kind !== "published") return false;
      if (filters.status === "redacted" && !(memory.kind === "review" && memory.status === "redacted")) return false;
      if (filters.scope !== "all" && memory.scope.visibility !== filters.scope) return false;
      if (filters.client !== "all" && memoryClientKey(memory) !== filters.client) return false;
      if (!query) return true;
      return [
        memoryTitle(memory),
        memoryPreview(memory),
        memory.sourcePath ?? "",
        memoryScopeLabel(memory),
        memory.kind === "review" ? memory.reason ?? "" : "",
      ].join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const kindRank = (memory: TeamMemoryItem) => memory.kind === "review" ? 0 : 1;
      if (a.kind !== b.kind) return kindRank(a) - kindRank(b);
      const bTime = Date.parse(b.updatedAt || b.createdAt || "");
      const aTime = Date.parse(a.updatedAt || a.createdAt || "");
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
}

function formatShortDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readTeamSectionFromUrl(): TeamSectionId {
  if (typeof window === "undefined") return "dashboard";
  return parseTeamSection(new URLSearchParams(window.location.search).get("section"));
}

function parseTeamSection(value: string | null): TeamSectionId {
  if (value === "teams" || value === "members" || value === "clients" || value === "memories" || value === "secrets" || value === "skills") return value;
  return "dashboard";
}

function readCompanyTeamIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("teamId")?.trim();
  return value || null;
}

function updateTeamSectionUrl(section: TeamSectionId, teamId: string | null = null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  if (section === "teams" && teamId) url.searchParams.set("teamId", teamId);
  else url.searchParams.delete("teamId");
  window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}

function readPersistedSkillPageSize(): number {
  if (typeof window === "undefined") return 10;
  const value = Number(window.localStorage.getItem(profileStorageKey(SKILL_PAGE_SIZE_STORAGE_KEY)));
  return [10, 25, 50, 100].includes(value) ? value : 10;
}

async function fetchOptionalJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : `${url} failed`;
    throw new Error(error);
  }
  return body;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function memberIdentity(member: AdminMember): string {
  return member.userId || member.email || member.id || "member";
}

function normalizeSkillSyncInfo(value: unknown): SkillSyncInfo[] {
  const record = asRecord(value);
  const rawSkills = Array.isArray(record.skills) ? record.skills : [];
  return rawSkills.flatMap((item) => {
    const row = asRecord(item);
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    if (!slug) return [];
    const localStatus = row.localStatus === "ready" || row.localStatus === "not_synced" || row.localStatus === "orphaned" || row.localStatus === "removing"
      ? row.localStatus
      : "unknown";
    return [{
      slug,
      localStatus,
      managed: row.managed === true,
      hasAccess: typeof row.hasAccess === "boolean" ? row.hasAccess : undefined,
      hasLocal: row.hasLocal === true,
      adoptable: row.adoptable === true,
      syncState: normalizeSyncState(row.syncState),
    }];
  });
}

function normalizeSyncState(value: unknown): SyncStateSummary | undefined {
  const record = asRecord(value);
  const status = normalizeSyncItemStatus(record.status);
  if (!status) return undefined;
  const rawFiles = Array.isArray(record.files) ? record.files : [];
  const files = rawFiles.flatMap((item): SyncStateFile[] => {
    const file = asRecord(item);
    const filePath = typeof file.path === "string" ? file.path : "";
    const fileStatus = normalizeSyncItemStatus(file.status);
    if (!filePath || !fileStatus) return [];
    return [{
      path: filePath,
      status: fileStatus,
      localSha256: typeof file.localSha256 === "string" ? file.localSha256 : undefined,
      remoteSha256: typeof file.remoteSha256 === "string" ? file.remoteSha256 : undefined,
      localSize: typeof file.localSize === "number" ? file.localSize : undefined,
      remoteSize: typeof file.remoteSize === "number" ? file.remoteSize : undefined,
      localUpdatedAt: typeof file.localUpdatedAt === "string" ? file.localUpdatedAt : undefined,
      remoteUpdatedAt: typeof file.remoteUpdatedAt === "string" ? file.remoteUpdatedAt : undefined,
      secret: file.secret === true,
    }];
  });
  return {
    status,
    counts: normalizeSyncCounts(record.counts),
    files,
    changedFiles: typeof record.changedFiles === "number" ? record.changedFiles : files.filter((file) => file.status !== "synced").length,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : new Date().toISOString(),
  };
}

function normalizeSyncCounts(value: unknown): Record<SyncItemStatus, number> {
  const record = asRecord(value);
  return {
    synced: typeof record.synced === "number" ? record.synced : 0,
    local_changes: typeof record.local_changes === "number" ? record.local_changes : 0,
    server_changes: typeof record.server_changes === "number" ? record.server_changes : 0,
    diverged: typeof record.diverged === "number" ? record.diverged : 0,
    not_synced: typeof record.not_synced === "number" ? record.not_synced : 0,
  };
}

function normalizeSyncItemStatus(value: unknown): SyncItemStatus | null {
  return value === "synced" ||
    value === "local_changes" ||
    value === "server_changes" ||
    value === "diverged" ||
    value === "not_synced"
    ? value
    : null;
}

function normalizeTeamSecrets(value: unknown): TeamSecret[] {
  const rawSecrets = Array.isArray(asRecord(value).secrets) ? asRecord(value).secrets as unknown[] : [];
  return rawSecrets.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof record.id === "string" ? record.id : "";
    const envKey = typeof record.envKey === "string" ? record.envKey : "";
    if (!id || !envKey) return [];
    const rawGrants = Array.isArray(record.grants) ? record.grants : [];
    const grants = rawGrants.flatMap((grantItem) => {
      const grant = asRecord(grantItem);
      const grantId = typeof grant.id === "string" ? grant.id : "";
      const userId = typeof grant.userId === "string" ? grant.userId : "";
      if (!grantId || !userId) return [];
      return [{
        id: grantId,
        userId,
        email: typeof grant.email === "string" ? grant.email : null,
        access: "read" as const,
        status: typeof grant.status === "string" ? grant.status : "active",
        grantedAt: typeof grant.grantedAt === "string" ? grant.grantedAt : null,
      }];
    });
    return [{
      id,
      name: typeof record.name === "string" && record.name.trim() ? record.name : envKey,
      envKey,
      scope: record.scope === "client" ? "client" : "team",
      clientId: typeof record.clientId === "string" ? record.clientId : null,
      clientSlug: typeof record.clientSlug === "string" ? record.clientSlug : null,
      clientName: typeof record.clientName === "string" ? record.clientName : null,
      status: typeof record.status === "string" ? record.status : "active",
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      grantedToCurrentUser: record.grantedToCurrentUser === true,
      grants,
    }];
  });
}

function normalizeTeamMemoryStatus(value: unknown): TeamMemoryStatusView {
  const record = asRecord(value);
  const status = asRecord(record.status);
  const outbox = record.outbox == null ? null : asRecord(record.outbox);
  const lastJob = status.lastJob == null ? null : asRecord(status.lastJob);
  const captureEligibility = asRecord(status.captureEligibility);
  return {
    mode: typeof record.mode === "string" ? record.mode : undefined,
    connected: record.connected !== false,
    apiUrl: typeof record.apiUrl === "string" ? record.apiUrl : undefined,
    error: typeof record.error === "string" ? record.error : null,
    outbox: outbox
      ? {
        byStatus: normalizeNumberRecord(outbox.byStatus),
        queued: typeof outbox.queued === "number" ? outbox.queued : undefined,
        syncing: typeof outbox.syncing === "number" ? outbox.syncing : undefined,
        failed: typeof outbox.failed === "number" ? outbox.failed : undefined,
        total: typeof outbox.total === "number" ? outbox.total : undefined,
        error: typeof outbox.error === "string" ? outbox.error : null,
      }
      : null,
    status: {
      storeReady: typeof status.storeReady === "boolean" ? status.storeReady : undefined,
      sources: typeof status.sources === "number" ? status.sources : undefined,
      chunks: typeof status.chunks === "number" ? status.chunks : undefined,
      jobs: typeof status.jobs === "number" ? status.jobs : undefined,
      captureEvents: typeof status.captureEvents === "number" ? status.captureEvents : undefined,
      byVisibility: normalizeNumberRecord(status.byVisibility),
      jobsByStatus: normalizeNumberRecord(status.jobsByStatus),
      captureEventsByStatus: normalizeNumberRecord(status.captureEventsByStatus),
      captureEligibility: {
        pending: typeof captureEligibility.pending === "number" ? captureEligibility.pending : undefined,
        eligiblePending: typeof captureEligibility.eligiblePending === "number" ? captureEligibility.eligiblePending : undefined,
        waitingPending: typeof captureEligibility.waitingPending === "number" ? captureEligibility.waitingPending : undefined,
        nextEligibleAt: typeof captureEligibility.nextEligibleAt === "string" ? captureEligibility.nextEligibleAt : null,
        volumeThreshold: typeof captureEligibility.volumeThreshold === "number" ? captureEligibility.volumeThreshold : undefined,
      },
      lastIndexedAt: typeof status.lastIndexedAt === "string" ? status.lastIndexedAt : null,
      lastJob: lastJob
        ? {
          sourcePath: typeof lastJob.sourcePath === "string" ? lastJob.sourcePath : undefined,
          reason: typeof lastJob.reason === "string" ? lastJob.reason : undefined,
          status: typeof lastJob.status === "string" ? lastJob.status : undefined,
          errorMessage: typeof lastJob.errorMessage === "string" ? lastJob.errorMessage : null,
          enqueuedAt: typeof lastJob.enqueuedAt === "string" ? lastJob.enqueuedAt : null,
          startedAt: typeof lastJob.startedAt === "string" ? lastJob.startedAt : null,
          finishedAt: typeof lastJob.finishedAt === "string" ? lastJob.finishedAt : null,
        }
        : null,
    },
  };
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

function normalizeSkillPermission(value: unknown): SkillPermission {
  return SKILL_PERMISSIONS.includes(value as SkillPermission) ? value as SkillPermission : "skill.use";
}

function normalizeSkillGrants(grants: SkillGrant[]): SkillGrant[] {
  return grants.map((grant) => ({
    ...grant,
    permission: normalizeSkillPermission(grant.permission),
  }));
}

function normalizeSkillCatalog(
  serverBody: unknown,
  localBody: unknown,
  grants: SkillGrant[],
  syncItems: SkillSyncInfo[],
): SkillCatalogItem[] {
  const syncBySlug = new Map(syncItems.map((item) => [item.slug, item]));
  const byId = new Map<string, SkillCatalogItem>();
  const serverSkills = Array.isArray(asRecord(serverBody).skills) ? asRecord(serverBody).skills as unknown[] : [];

  for (const item of serverSkills) {
    const record = asRecord(item);
    const slug = typeof record.slug === "string" ? record.slug.trim() : "";
    if (!slug) continue;
    const sync = syncBySlug.get(slug);
    byId.set(`team:${slug}`, {
      id: `team:${slug}`,
      slug,
      name: typeof record.name === "string" && record.name.trim() ? record.name : slug,
      description: typeof record.description === "string" ? record.description : null,
      source: sync?.managed ? "managed" : "server",
      userPermission: record.userPermission == null ? null : normalizeSkillPermission(record.userPermission),
      managed: sync?.managed === true,
      hasLocal: sync?.hasLocal === true,
      adoptable: sync?.adoptable === true,
      status: typeof record.status === "string" ? record.status : "active",
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    });
  }

  const localSkills = Array.isArray(localBody) ? localBody : [];
  for (const item of localSkills) {
    const record = asRecord(item);
    const slug = typeof record.folderName === "string" ? record.folderName.trim() : "";
    const origins = Array.isArray(record.availableOrigins) ? record.availableOrigins.map(asRecord) : [];
    const localOrigin = origins.find((origin) => origin.origin === "local" || origin.origin === "client");
    if (!slug || (!localOrigin && record.effectiveOrigin !== "local" && record.effectiveOrigin !== "client")) continue;
    byId.set(`local:${slug}`, {
      id: `local:${slug}`,
      slug,
      name: typeof record.name === "string" && record.name.trim() ? record.name : slug,
      description: typeof record.description === "string" ? record.description : null,
      source: "local",
      localOnly: true,
      hasLocal: true,
      status: "local",
    });
  }

  for (const grant of normalizeSkillGrants(grants)) {
    if (byId.has(`team:${grant.skillName}`)) continue;
    byId.set(`team:${grant.skillName}`, {
      id: `team:${grant.skillName}`,
      slug: grant.skillName,
      name: grant.skillName,
      source: "server",
      status: "granted",
    });
  }

  for (const item of syncItems) {
    if (item.hasAccess !== false || byId.has(`team:${item.slug}`)) continue;
    byId.set(`team:${item.slug}`, {
      id: `team:${item.slug}`,
      slug: item.slug,
      name: item.slug,
      source: "managed",
      managed: true,
      hasLocal: item.hasLocal === true,
      adoptable: item.adoptable === true,
      status: "access removed",
    });
  }

  return Array.from(byId.values());
}

function buildSkillRows(
  catalog: SkillCatalogItem[],
  grants: SkillGrant[],
  syncStatus: Record<string, SkillSyncInfo>,
): SkillRow[] {
  const normalizedGrants = normalizeSkillGrants(grants);
  return catalog.map((skill) => {
    const skillGrants = normalizedGrants.filter((grant) => grant.skillName === skill.slug);
    return {
      ...skill,
      grants: skillGrants,
      activeGrants: skillGrants.filter((grant) => grant.status === "active"),
      localStatus: skill.source === "local" ? "ready" : syncStatus[skill.slug]?.localStatus ?? "not_synced",
      hasLocal: skill.source === "local" ? true : syncStatus[skill.slug]?.hasLocal ?? skill.hasLocal,
      adoptable: skill.source === "local" ? false : syncStatus[skill.slug]?.adoptable ?? skill.adoptable,
      syncState: skill.source === "local" ? undefined : syncStatus[skill.slug]?.syncState,
    };
  });
}

function filterSkillRows(rows: SkillRow[], search: string, memberIds: string[]): SkillRow[] {
  const term = search.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesSearch = !term || `${row.name} ${row.slug}`.toLowerCase().includes(term);
    if (!matchesSearch) return false;
    if (memberIds.length === 0) return true;
    const grantedIds = new Set(row.activeGrants.map((grant) => grant.userId || grant.email).filter(Boolean));
    return memberIds.every((id) => grantedIds.has(id));
  });
}

function sortSkillRows(rows: SkillRow[], sort: SkillSort): SkillRow[] {
  return [...rows].sort((a, b) => {
    if (sort === "updated-desc") return Date.parse(b.updatedAt ?? "0") - Date.parse(a.updatedAt ?? "0");
    if (sort === "created-desc") return Date.parse(b.createdAt ?? "0") - Date.parse(a.createdAt ?? "0");
    if (sort === "name-desc") return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function permissionLabel(permission: SkillPermission): string {
  if (permission === "skill.admin") return "Skill Admin";
  if (permission === "skill.edit") return "Skill Editor";
  if (permission === "skill.read") return "Skill Reader";
  return "Skill User";
}

function permissionSummary(grants: SkillGrant[]): string {
  if (grants.length === 0) return "-";
  const ranked = [...grants].sort((a, b) => SKILL_PERMISSIONS.indexOf(b.permission) - SKILL_PERMISSIONS.indexOf(a.permission));
  return permissionLabel(ranked[0].permission);
}

function localSkillStatusLabel(skill: SkillRow): string {
  if (skill.syncState) return syncStatusLabel(skill.syncState.status);
  if (skill.source === "local") return "local";
  if (skill.localStatus === "ready") return "synced";
  if (skill.localStatus === "orphaned") return "local changes";
  if (skill.localStatus === "removing") return "removing";
  return "server";
}

function skillSourceBadge(skill: SkillCatalogItem & { localStatus?: SkillLocalStatus }) {
  const syncState = "syncState" in skill ? skill.syncState as SyncStateSummary | undefined : undefined;
  const label = syncState && syncState.status !== "synced"
    ? syncStatusLabel(syncState.status)
    : skill.source === "local"
    ? "Local"
    : skill.localStatus === "orphaned"
      ? "Local changes"
    : skill.managed || skill.adoptable
      ? "Synced"
      : skill.hasLocal
        ? "Local changes"
        : "Server";
  const source = label.toLowerCase() === "synced"
    ? "managed"
    : label.toLowerCase().includes("changes") || label.toLowerCase() === "both changed"
      ? "local"
      : skill.source;
  return <span style={sourceBadgeStyle(source)}>{label}</span>;
}

function clientSyncStatusLabel(client: VisibleClient): string {
  if (client.syncState) return syncStatusLabel(client.syncState.status);
  return client.localStatus === "ready" ? "synced" : "not synced";
}

function syncStatusLabel(status: SyncItemStatus): string {
  if (status === "local_changes") return "local changes";
  if (status === "server_changes") return "server updates";
  if (status === "diverged") return "both changed";
  if (status === "not_synced") return "not synced";
  return "synced";
}

const pageStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 16, minHeight: "calc(100vh - 140px)" };
const headerBandStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: 18, border: "1px solid var(--cc-line-alpha-15)", borderRadius: 8, background: "var(--cc-surface)" };
const titleStyle: CSSProperties = { margin: 0, color: "var(--cc-text-primary)", fontFamily: "var(--font-epilogue), Epilogue, sans-serif", fontSize: 24, fontWeight: 700, lineHeight: 1.15 };
const subtleTextStyle: CSSProperties = { color: "var(--cc-text-tertiary)", fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" };
const refreshButtonStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", border: "1px solid var(--cc-line-alpha-20)", borderRadius: 6, background: "var(--cc-surface-muted)", color: "var(--cc-text-secondary)", cursor: "pointer", fontSize: 13, fontWeight: 600 };
function teamLayoutStyle(compact: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: compact ? "minmax(0, 1fr)" : "220px minmax(0, 1fr)",
    gap: 16,
    alignItems: "start",
  };
}
function teamNavStyle(compact: boolean): CSSProperties {
  return {
    position: compact ? "static" : "sticky",
    top: compact ? undefined : 84,
    display: "flex",
    flexDirection: compact ? "row" : "column",
    gap: compact ? 8 : 6,
    padding: compact ? 0 : 8,
    border: compact ? "none" : "1px solid var(--cc-line-alpha-15)",
    borderRadius: 8,
    background: compact ? "transparent" : "var(--cc-surface)",
    overflowX: compact ? "auto" : "visible",
    minWidth: 0,
  };
}
function teamNavItemStyle(active: boolean, compact: boolean): CSSProperties {
  const edgeBorder = active
    ? "1px solid var(--cc-line-alpha-20)"
    : "1px solid transparent";

  return {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: compact ? "auto" : "100%",
    minWidth: compact ? 132 : 0,
    minHeight: compact ? 38 : 46,
    padding: compact ? "0 12px" : "8px 10px",
    borderTop: edgeBorder,
    borderRight: edgeBorder,
    borderBottom: edgeBorder,
    borderLeft: compact
      ? edgeBorder
      : active
        ? "3px solid var(--cc-brand-primary)"
        : "3px solid transparent",
    borderRadius: 6,
    background: active ? "var(--cc-brand-alpha-08)" : "transparent",
    color: active ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
    cursor: "pointer",
    textAlign: "left",
    transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
    flexShrink: 0,
  };
}
const teamNavTextWrapStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 };
const teamNavLabelStyle: CSSProperties = { color: "inherit", fontSize: 13, fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap" };
const teamNavDetailStyle: CSSProperties = { color: "var(--cc-text-tertiary)", fontSize: 11, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const teamContentStyle: CSSProperties = { minWidth: 0, display: "flex", flexDirection: "column", gap: 16 };
const innerPanelGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, padding: 16 };
const sectionStyle: CSSProperties = { border: "1px solid var(--cc-line-alpha-15)", borderRadius: 8, background: "var(--cc-surface)", overflow: "hidden" };
const sectionHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: 16, borderBottom: "1px solid var(--cc-line-alpha-10)" };
const sectionTitleStyle: CSSProperties = { margin: 0, color: "var(--cc-text-primary)", fontSize: 16, fontWeight: 700 };
const sectionBodyStyle: CSSProperties = { padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const dashboardBodyStyle: CSSProperties = { padding: 16, display: "flex", flexDirection: "column", gap: 14 };
const dashboardGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
function dashboardTileButtonStyle(tone: "success" | "danger" | "neutral"): CSSProperties {
  return {
    ...panelStyle(tone),
    width: "100%",
    cursor: "pointer",
    textAlign: "left",
  };
}
const formRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const clientCreateFormStyle: CSSProperties = { ...formRowStyle, alignItems: "flex-start" };
const clientSlugFieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const clientSlugHintStyle: CSSProperties = { maxWidth: 320, color: "var(--cc-text-tertiary)", fontSize: 11, lineHeight: 1.35 };
const clientSlugErrorStyle: CSSProperties = { ...clientSlugHintStyle, color: "var(--cc-status-danger-bright)" };
const clientCreateErrorStyle: CSSProperties = { color: "var(--cc-status-danger-bright)", fontSize: 13, marginTop: 6 };
const inputStyle: CSSProperties = { height: 34, minWidth: 210, padding: "0 10px", border: "1px solid var(--cc-line-alpha-30)", borderRadius: 6, background: "var(--cc-surface)", color: "var(--cc-text-primary)", fontSize: 13, outline: "none" };
const selectStyle: CSSProperties = { ...inputStyle, minWidth: 130 };
const inlineSelectStyle: CSSProperties = { height: 32, minWidth: 128, padding: "0 8px", border: "1px solid var(--cc-line-alpha-20)", borderRadius: 6, background: "var(--cc-surface)", color: "var(--cc-text-primary)", fontSize: 13 };
const primaryButtonStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 34, padding: "0 12px", border: "none", borderRadius: 6, background: "var(--cc-brand-primary)", color: "var(--cc-surface)", cursor: "pointer", fontSize: 13, fontWeight: 700 };
const secondaryButtonStyle: CSSProperties = { ...primaryButtonStyle, border: "1px solid var(--cc-line-alpha-25)", background: "var(--cc-surface-muted)", color: "var(--cc-text-secondary)" };
const emptyStyle: CSSProperties = { padding: 14, color: "var(--cc-text-tertiary)", fontSize: 13 };
const strongTextStyle: CSSProperties = { color: "var(--cc-text-primary)", fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" };
const syncGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, padding: 16 };
const boundaryPanelStyle: CSSProperties = { padding: 14, borderRadius: 8, border: "1px solid var(--cc-line-alpha-15)", background: "var(--cc-surface-muted)" };
const boundaryListStyle: CSSProperties = { margin: "8px 0 0", paddingLeft: 18, color: "var(--cc-text-secondary)", fontSize: 13, lineHeight: 1.55 };
const tableStyle: CSSProperties = { border: "1px solid var(--cc-line-alpha-12)", borderRadius: 8, overflow: "visible" };
const memberHeaderStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px, 1.4fr) minmax(130px, 0.7fr) minmax(90px, 0.5fr) minmax(160px, 1fr) 48px", gap: 8, padding: "10px 12px", background: "var(--cc-surface-muted)", color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
const memberRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px, 1.4fr) minmax(130px, 0.7fr) minmax(90px, 0.5fr) minmax(160px, 1fr) 48px", gap: 8, alignItems: "center", minHeight: 64, padding: "10px 12px", borderTop: "1px solid var(--cc-line-alpha-08)" };
function clientHeaderStyle(canManage: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: canManage ? "minmax(220px, 1.5fr) repeat(3, minmax(80px, 0.45fr)) minmax(100px, 0.55fr) minmax(84px, 0.45fr)" : "minmax(220px, 1.5fr) minmax(120px, 0.7fr) minmax(100px, 0.55fr) minmax(84px, 0.45fr)", gap: 8, padding: "10px 12px", background: "var(--cc-surface-muted)", color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
}
function clientRowStyle(canManage: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: canManage ? "minmax(220px, 1.5fr) repeat(3, minmax(80px, 0.45fr)) minmax(100px, 0.55fr) minmax(84px, 0.45fr)" : "minmax(220px, 1.5fr) minmax(120px, 0.7fr) minmax(100px, 0.55fr) minmax(84px, 0.45fr)", gap: 8, alignItems: "center", width: "100%", minHeight: 58, padding: "10px 12px", border: "none", borderTop: "1px solid var(--cc-line-alpha-08)", background: "transparent", color: "var(--cc-text-secondary)", textAlign: "left", cursor: canManage ? "pointer" : "default", fontSize: 13 };
}
const subtleWarningStyle: CSSProperties = { padding: 10, border: "1px solid rgba(131, 131, 131, 0.28)", borderRadius: 8, background: "rgba(131, 131, 131, 0.08)", color: "#717171", fontSize: 13 };
const secretToolbarStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const secretFormGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, alignItems: "center" };
const secretHeaderStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px, 1.5fr) minmax(120px, 0.7fr) minmax(80px, 0.45fr) minmax(100px, 0.55fr) minmax(84px, 0.45fr)", gap: 8, padding: "10px 12px", background: "var(--cc-surface-muted)", color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
const secretRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px, 1.5fr) minmax(120px, 0.7fr) minmax(80px, 0.45fr) minmax(100px, 0.55fr) minmax(84px, 0.45fr)", gap: 8, alignItems: "center", width: "100%", minHeight: 58, padding: "10px 12px", border: "none", borderTop: "1px solid var(--cc-line-alpha-08)", background: "transparent", color: "var(--cc-text-secondary)", textAlign: "left", cursor: "pointer", fontSize: 13 };
const memoryToolbarStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px, 1fr) repeat(3, minmax(130px, 170px)) auto", gap: 8, alignItems: "center" };
const memoryHeaderStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(260px, 1.6fr) minmax(120px, 0.55fr) minmax(110px, 0.5fr) minmax(130px, 0.55fr)", gap: 8, padding: "10px 12px", background: "var(--cc-surface-muted)", color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
const memoryRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(260px, 1.6fr) minmax(120px, 0.55fr) minmax(110px, 0.5fr) minmax(130px, 0.55fr)", gap: 8, alignItems: "center", width: "100%", minHeight: 68, padding: "10px 12px", border: "none", borderTop: "1px solid var(--cc-line-alpha-08)", background: "transparent", color: "var(--cc-text-secondary)", textAlign: "left", cursor: "pointer", fontSize: 13 };
const memoryPreviewStyle: CSSProperties = { color: "var(--cc-text-tertiary)", fontSize: 12, lineHeight: 1.35, marginTop: 3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" };
const memoryModalBodyStyle: CSSProperties = { padding: 16, display: "flex", flexDirection: "column", gap: 14 };
const memoryReasonRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(180px, 320px)", justifyContent: "end" };
const memoryFieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const memoryMetaBoxStyle: CSSProperties = { minHeight: 58, padding: 10, border: "1px solid var(--cc-line-alpha-12)", borderRadius: 8, background: "var(--cc-surface-muted)" };
const memoryTextareaStyle: CSSProperties = { width: "100%", minHeight: 190, padding: 12, border: "1px solid var(--cc-line-alpha-20)", borderRadius: 8, background: "var(--cc-surface)", color: "var(--cc-text-primary)", fontSize: 13, lineHeight: 1.5, fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace", outline: "none", resize: "vertical" };
const memoryPreviewBoxStyle: CSSProperties = { padding: 14, border: "1px solid var(--cc-line-alpha-12)", borderRadius: 8, background: "var(--cc-surface-muted)", overflow: "auto" };
function skillToolbarStyle(canFilterMembers: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: canFilterMembers ? "minmax(220px, 1fr) minmax(180px, 220px) minmax(240px, 0.9fr) auto" : "minmax(220px, 1fr) minmax(180px, 220px) auto", gap: 8, alignItems: "start" };
}
const toolbarSearchStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 10px", border: "1px solid var(--cc-line-alpha-25)", borderRadius: 6, background: "var(--cc-surface)", color: "var(--cc-text-tertiary)" };
const memberFilterStyle: CSSProperties = { position: "relative", display: "flex", flexDirection: "column", gap: 6 };
const memberFilterInputStyle: CSSProperties = { ...toolbarSearchStyle, width: "100%" };
const filterSuggestionBoxStyle: CSSProperties = { position: "absolute", top: 40, left: 0, right: 0, zIndex: 40, border: "1px solid var(--cc-line-alpha-15)", borderRadius: 8, background: "var(--cc-surface)", boxShadow: "0 14px 34px var(--cc-neutral-alpha-16)", overflow: "hidden" };
const filterSuggestionButtonStyle: CSSProperties = { display: "block", width: "100%", padding: 10, border: "none", borderTop: "1px solid var(--cc-line-alpha-08)", background: "transparent", textAlign: "left", cursor: "pointer" };
const filterChipRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const filterChipStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 24, padding: "0 6px", border: "1px solid var(--cc-line-alpha-20)", borderRadius: 6, background: "var(--cc-surface-muted)", color: "var(--cc-text-secondary)", fontSize: 12 };
const chipRemoveButtonStyle: CSSProperties = { width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, border: "none", background: "transparent", color: "var(--cc-text-tertiary)", cursor: "pointer" };
const clearFiltersButtonStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--cc-brand-primary)", cursor: "pointer", fontSize: 12, fontWeight: 700 };
const pageSizeControlStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--cc-text-tertiary)", fontSize: 12 };
const compactSelectStyle: CSSProperties = { height: 34, padding: "0 8px", border: "1px solid var(--cc-line-alpha-25)", borderRadius: 6, background: "var(--cc-surface)", color: "var(--cc-text-primary)", fontSize: 13 };
function skillHeaderStyle(showGrantColumns: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: showGrantColumns ? "minmax(220px, 1.5fr) minmax(110px, 0.55fr) minmax(80px, 0.4fr) minmax(130px, 0.6fr) minmax(100px, 0.5fr)" : "minmax(220px, 1.5fr) minmax(110px, 0.55fr) minmax(130px, 0.65fr) minmax(100px, 0.5fr)", gap: 8, padding: "10px 12px", background: "var(--cc-surface-muted)", color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
}
function skillRowStyle(showGrantColumns: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: showGrantColumns ? "minmax(220px, 1.5fr) minmax(110px, 0.55fr) minmax(80px, 0.4fr) minmax(130px, 0.6fr) minmax(100px, 0.5fr)" : "minmax(220px, 1.5fr) minmax(110px, 0.55fr) minmax(130px, 0.65fr) minmax(100px, 0.5fr)", gap: 8, alignItems: "center", width: "100%", minHeight: 58, padding: "10px 12px", border: "none", borderTop: "1px solid var(--cc-line-alpha-08)", background: "transparent", color: "var(--cc-text-secondary)", textAlign: "left", cursor: "pointer", fontSize: 13 };
}
const paginationStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 4 };
const paginationActionsStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const paginationTextStyle: CSSProperties = { color: "var(--cc-text-secondary)", fontSize: 12, minWidth: 84, textAlign: "center" };
const tableCellStyle: CSSProperties = { color: "var(--cc-text-secondary)", fontSize: 13, overflowWrap: "anywhere", minWidth: 0 };
const mutedCellStyle: CSSProperties = { ...tableCellStyle, color: "var(--cc-text-tertiary)" };
const actionCellStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 6, position: "relative", flexWrap: "wrap" };
const roleTextStyle: CSSProperties = { color: "var(--cc-text-primary)", fontSize: 13, fontWeight: 700 };
const errorTextStyle: CSSProperties = { color: "var(--cc-status-danger-bright)", fontSize: 13 };
const noticeStyle: CSSProperties = { color: "#6F6F6F", fontSize: 13 };
const userCellStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, minWidth: 0 };
const userNameStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, color: "var(--cc-text-primary)", fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" };
const pendingBadgeStyle: CSSProperties = { padding: "1px 5px", border: "1px solid var(--cc-line-alpha-30)", borderRadius: 4, color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 700 };
const protectedAccessTextStyle: CSSProperties = { marginTop: 3, color: "var(--cc-text-tertiary)", fontSize: 10, lineHeight: 1.25 };
const rowMenuWrapStyle: CSSProperties = { position: "relative" };
const iconButtonStyle: CSSProperties = { width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--cc-line-alpha-15)", borderRadius: 6, background: "var(--cc-surface-muted)", color: "var(--cc-text-secondary)", cursor: "pointer" };
function rowMenuStyle(position: { top: number; left: number }): CSSProperties {
  return { position: "fixed", left: position.left, top: position.top, zIndex: 2600, minWidth: 190, padding: 6, border: "1px solid var(--cc-line-alpha-15)", borderRadius: 8, background: "var(--cc-surface)", boxShadow: "0 14px 34px var(--cc-neutral-alpha-16)" };
}
const linkNoticeStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 10, border: "1px solid var(--cc-line-alpha-12)", borderRadius: 8, background: "var(--cc-surface-muted)" };
const linkValueStyle: CSSProperties = { color: "var(--cc-text-secondary)", fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" };
const modalOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 2400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(24, 24, 24, 0.42)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" };
const modalStyle: CSSProperties = { width: "min(880px, calc(100vw - 40px))", maxHeight: "calc(100vh - 56px)", overflow: "auto", border: "1px solid var(--cc-line-alpha-15)", borderRadius: 8, background: "var(--cc-surface)", boxShadow: "0 24px 72px var(--cc-neutral-alpha-24)" };
const modalHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: 16, borderBottom: "1px solid var(--cc-line-alpha-10)" };
const modalTitleStyle: CSSProperties = { margin: 0, color: "var(--cc-text-primary)", fontSize: 18, fontWeight: 800 };
const modalMetaRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" };
const modalHeaderActionsStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" };
const modalDescriptionStyle: CSSProperties = { padding: "12px 16px 0", color: "var(--cc-text-secondary)", fontSize: 13, lineHeight: 1.5 };
const modalFormRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: 16, flexWrap: "wrap" };
const modalErrorStyle: CSSProperties = { ...errorTextStyle, margin: "-6px 16px 12px" };
const searchBoxStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, height: 40, margin: 16, padding: "0 10px", border: "1px solid var(--cc-brand-primary)", borderRadius: 6, color: "var(--cc-text-tertiary)" };
const searchInputStyle: CSSProperties = { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--cc-text-primary)", fontSize: 14 };
const suggestionBoxStyle: CSSProperties = { margin: "-8px 16px 16px", border: "1px solid var(--cc-line-alpha-15)", borderRadius: 8, overflow: "hidden" };
const suggestionRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 10, borderTop: "1px solid var(--cc-line-alpha-08)" };
const suggestionActionsStyle: CSSProperties = { display: "flex", gap: 8, flexShrink: 0 };
const modalTableStyle: CSSProperties = { margin: "0 16px 16px", border: "1px solid var(--cc-line-alpha-12)", borderRadius: 8, overflow: "visible" };
const modalTableHeaderStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(160px, 0.6fr) 48px", gap: 8, padding: "10px 12px", background: "var(--cc-surface-muted)", color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
const modalTableRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(160px, 0.6fr) 48px", gap: 8, alignItems: "center", minHeight: 62, padding: "10px 12px", borderTop: "1px solid var(--cc-line-alpha-08)" };

function avatarStyle(compact: boolean): CSSProperties {
  return {
    width: compact ? 32 : 38,
    height: compact ? 32 : 38,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    background: "linear-gradient(135deg, #7C7C7C, #A0A0A0)",
    color: "#fff",
    fontSize: compact ? 11 : 12,
    fontWeight: 800,
  };
}

function menuItemStyle(danger?: boolean): CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "9px 10px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: danger ? "var(--cc-status-danger-bright)" : "var(--cc-text-secondary)",
    textAlign: "left",
    cursor: "pointer",
    fontSize: 13,
  };
}

function simpleHeaderStyle(columns: number): CSSProperties {
  return { display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8, padding: "10px 12px", background: "var(--cc-surface-muted)", color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };
}

function simpleRowStyle(columns: number): CSSProperties {
  return { display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8, padding: "10px 12px", borderTop: "1px solid var(--cc-line-alpha-08)" };
}

function panelStyle(tone: "success" | "warning" | "danger" | "neutral"): CSSProperties {
  const border = tone === "success"
    ? "rgba(111, 111, 111, 0.28)"
    : tone === "danger"
      ? "rgba(114, 114, 114, 0.36)"
      : tone === "warning"
        ? "rgba(131, 131, 131, 0.3)"
        : "var(--cc-line-alpha-15)";
  return { display: "flex", gap: 12, alignItems: "flex-start", padding: 16, border: `1px solid ${border}`, borderRadius: 8, background: "var(--cc-surface)", minWidth: 0 };
}

function panelIconStyle(tone: "success" | "warning" | "danger" | "neutral"): CSSProperties {
  const color = tone === "success"
    ? "#6F6F6F"
    : tone === "danger"
      ? "var(--cc-status-danger-bright)"
      : tone === "warning"
        ? "#717171"
        : "var(--cc-brand-primary)";
  return { width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cc-surface-muted)", color, flexShrink: 0 };
}

function statusBadgeStyle(status: string): CSSProperties {
  const normalized = status.toLowerCase();
  const pending = normalized === "invited" || normalized === "not synced" || normalized === "server";
  const warning = normalized === "local changes" || normalized === "server updates" || normalized === "both changed" || normalized === "removing";
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 24,
    padding: "0 8px",
    border: warning
      ? "1px solid var(--cc-border-warning)"
      : pending
        ? "1px solid var(--cc-line-alpha-30)"
        : "1px solid rgba(111, 111, 111, 0.28)",
    borderRadius: 999,
    background: warning
      ? "var(--cc-status-warning-bg)"
      : pending
        ? "var(--cc-surface-muted)"
        : "rgba(111, 111, 111, 0.08)",
    color: warning
      ? "var(--cc-status-warning-strong)"
      : pending
        ? "var(--cc-text-tertiary)"
        : "#6F6F6F",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "capitalize",
  };
}

function memoryStatusBadgeStyle(memory: TeamMemoryItem): CSSProperties {
  const redacted = memory.kind === "review" && memory.status === "redacted";
  const published = memory.kind === "published";
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 24,
    padding: "0 8px",
    border: published
      ? "1px solid var(--cc-border-success)"
      : redacted
        ? "1px solid var(--cc-line-alpha-30)"
        : "1px solid var(--cc-border-warning)",
    borderRadius: 999,
    background: published
      ? "var(--cc-status-success-bg)"
      : redacted
        ? "var(--cc-surface-muted)"
        : "var(--cc-status-warning-bg)",
    color: published
      ? "var(--cc-status-success-strong)"
      : redacted
        ? "var(--cc-text-tertiary)"
        : "var(--cc-status-warning-strong)",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
}

function sourceBadgeStyle(source: SkillSource): CSSProperties {
  const local = source === "local";
  const managed = source === "managed";
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 24,
    padding: "0 8px",
    border: local ? "1px solid var(--cc-line-alpha-25)" : managed ? "1px solid rgba(111, 111, 111, 0.28)" : "1px solid rgba(124, 124, 124, 0.25)",
    borderRadius: 999,
    background: local ? "var(--cc-surface-muted)" : managed ? "rgba(111, 111, 111, 0.08)" : "rgba(124, 124, 124, 0.08)",
    color: local ? "var(--cc-text-secondary)" : managed ? "#6F6F6F" : "var(--cc-brand-primary)",
    fontSize: 12,
    fontWeight: 700,
  };
}

const panelLabelStyle: CSSProperties = { color: "var(--cc-text-tertiary)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0 };
const panelValueStyle: CSSProperties = { color: "var(--cc-text-primary)", fontSize: 16, fontWeight: 700, marginTop: 4, overflowWrap: "anywhere" };
const panelDetailStyle: CSSProperties = { ...subtleTextStyle, marginTop: 3 };
