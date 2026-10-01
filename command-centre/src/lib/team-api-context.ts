import fs from "node:fs/promises";
import path from "node:path";

import { createEmbedder } from "@/lib/memory/embedder";
import { getTeamContextFilePath } from "./local-profile";
import {
  mergeScopeLabels,
  readScopeLabels,
  type ScopeLabelsV1,
} from "./scope-labels";

const TEAM_OS_EMBEDDING_MODEL = "bge-m3";
const TEAM_OS_EMBEDDING_DIM = 1024;

export interface TeamContextConfig {
  version?: number;
  apiUrl: string;
  token: string;
  tokenType?: "team-api-session" | "dev-token";
  authSource?: string;
  expiresAt?: string | null;
  savedAt?: string;
  user?: unknown;
  team?: unknown;
  membership?: unknown;
  serverId?: string | null;
  selectedTeamId?: string | null;
  teams?: TeamMembershipSummary[];
  companyMembership?: unknown;
  pendingAccessRequestCount?: number;
}

export interface TeamMembershipSummary {
  id: string;
  slug?: string | null;
  name?: string | null;
  membership: unknown;
  access?: unknown;
  pendingRequest?: boolean;
}

export interface TeamApiClient {
  id: string;
  slug: string;
  name?: string | null;
  access: "read" | "write";
}

export interface TeamMemorySearchHit {
  sourcePath: string;
  sourceType?: string | null;
  content: string;
  heading?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  score?: number | null;
  finalScore?: number | null;
}

export interface TeamMemorySearchResult {
  results: TeamMemorySearchHit[];
  visibilitySet: string[];
  eventId: string | null;
  requestedClientId: string | null;
}

export interface TeamContextSnapshotLayer {
  label: string;
  visibility: string;
  kind: string;
  path: string;
  sha256: string;
  source: string;
  updatedAt?: string | null;
}

export interface TeamContextAvailableFile {
  visibility: string;
  kind: string;
  path: string;
  title?: string | null;
  size?: number;
  source?: string;
  updatedAt?: string | null;
}

export interface TeamContextSnapshot {
  generatedAt: string;
  team: unknown;
  user: unknown;
  client: unknown;
  taskType?: string | null;
  layers: TeamContextSnapshotLayer[];
  availableContext: TeamContextAvailableFile[];
  markdown: string;
}

export interface TeamWorkspaceFile {
  path: string;
  client?: string;
  size?: number;
  sha256?: string;
  normalizedSha256?: string;
  updatedAt?: string;
  writable?: boolean;
  secret?: boolean;
  encoding?: "utf-8" | "base64";
}

export interface TeamWorkspaceManifest {
  files: TeamWorkspaceFile[];
  clients: TeamApiClient[];
  unsupportedFiles: number;
  secretFilesHidden: number;
}

export interface TeamSecretGrant {
  id: string;
  userId: string;
  email?: string | null;
  access: "read";
  status: string;
  grantedAt?: string | null;
}

export interface TeamSecretMetadata {
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
}

export interface TeamSecretsList {
  admin: boolean;
  secrets: TeamSecretMetadata[];
}

export interface TeamSecretValue {
  id: string;
  name: string;
  envKey: string;
  value: string;
}

export interface TeamSecretsSyncPayload {
  team: { secrets: TeamSecretValue[] };
  clients: Array<{ id: string; slug: string; name?: string | null; secrets: TeamSecretValue[] }>;
}

export interface TeamUserConfigFile {
  id?: string;
  path: string;
  content: string;
  sha256?: string;
  keyId?: string | null;
  algorithm?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export interface TeamWorkspaceFileContent {
  path?: string;
  content?: string;
  contentBase64?: string;
  encoding?: "utf-8" | "base64";
  size?: number;
  sha256?: string;
  normalizedSha256?: string;
  updatedAt?: string;
  secret?: boolean;
}

export interface TeamSkillSummary {
  slug: string;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  files?: number;
  grants?: number;
  userPermission?: "skill.use" | "skill.read" | "skill.edit" | "skill.admin" | null;
  writable?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TeamSkillManifest {
  skill: string;
  files: TeamWorkspaceFile[];
  unsupportedFiles: number;
}

export interface TeamBrandContextFile {
  path: string;
  size?: number;
  sha256?: string;
  updatedAt?: string;
}

export interface TeamContextDocument {
  id?: string;
  visibility: "team" | "client" | "private" | "system";
  path: string;
  kind?: string;
  sha256?: string;
  status?: string;
  content?: string;
  updatedAt?: string;
}

export interface TeamMemoryStatus {
  storeReady: boolean;
  scope?: {
    mode?: string;
    teamId?: string | null;
    userId?: string | null;
  };
  sources: number;
  chunks: number;
  jobs?: number;
  captureEvents?: number;
  byVisibility: Record<string, number>;
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
}

export interface TeamMemoryScopeView {
  teamId?: string | null;
  clientId?: string | null;
  clientSlug?: string | null;
  clientName?: string | null;
  userId?: string | null;
  visibility: "team" | "client";
}

export interface TeamMemoryReviewItem {
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
  status?: "review" | "redacted" | string;
  reason?: string | null;
  confidence?: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  processedAt?: string | null;
  redactedAt?: string | null;
}

export interface TeamMemoryPublishedItem {
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
}

export interface TeamMemoriesResponse {
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
}

export class TeamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TeamApiError";
  }
}

export type TeamApiStatus =
  | {
      status: "signed_out";
      signedIn: false;
      clients: TeamApiClient[];
      serverId: null;
      selectedTeamId: null;
      teams: TeamMembershipSummary[];
      scopeLabels: ScopeLabelsV1;
      companyMembership?: unknown;
      pendingAccessRequestCount?: number;
    }
  | {
      status: "connected";
      signedIn: true;
      apiUrl: string;
      savedAt: string | null;
      expiresAt: string | null;
      tokenType: string | null;
      authSource: string | null;
      health: unknown;
      clients: TeamApiClient[];
      user?: unknown;
      team?: unknown;
      membership?: unknown;
      serverId: string | null;
      selectedTeamId: string | null;
      teams: TeamMembershipSummary[];
      scopeLabels: ScopeLabelsV1;
      companyMembership?: unknown;
      pendingAccessRequestCount?: number;
    }
  | {
      // Authenticated, but the server rejected the request with 403 (e.g. a
      // suspended membership) — distinct from a network/5xx "unavailable" so
      // the UI can say "your access was blocked" instead of "server down".
      status: "blocked";
      signedIn: true;
      apiUrl: string;
      savedAt: string | null;
      expiresAt: string | null;
      tokenType: string | null;
      authSource: string | null;
      clients: TeamApiClient[];
      error: string;
      serverId: string | null;
      selectedTeamId: string | null;
      teams: TeamMembershipSummary[];
      scopeLabels: ScopeLabelsV1;
      companyMembership?: unknown;
      pendingAccessRequestCount?: number;
    }
  | {
      status: "unavailable";
      // A valid saved login stays signed in while the server is unreachable.
      // Expired or server-rejected credentials require signing in again.
      signedIn: boolean;
      apiUrl: string;
      savedAt: string | null;
      expiresAt: string | null;
      tokenType: string | null;
      authSource: string | null;
      clients: TeamApiClient[];
      error: string;
      serverId: string | null;
      selectedTeamId: string | null;
      teams: TeamMembershipSummary[];
      scopeLabels: ScopeLabelsV1;
      companyMembership?: unknown;
      pendingAccessRequestCount?: number;
    };

function mergeScopeLabelsSafely(input: Parameters<typeof mergeScopeLabels>[0]): ScopeLabelsV1 {
  try {
    return mergeScopeLabels(input);
  } catch (error) {
    console.warn(
      "[team-api-context] Could not update display-only scope labels:",
      error instanceof Error ? error.message : error,
    );
    return readScopeLabels();
  }
}

let teamContextMutationQueue: Promise<void> = Promise.resolve();

function withTeamContextMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = teamContextMutationQueue.then(operation, operation);
  teamContextMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function teamConfigPath(): string {
  return getTeamContextFilePath();
}

function normalizeApiUrl(value: string): string {
  const apiUrl = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiUrl)) {
    throw new Error("Server URL must start with http:// or https://");
  }
  return apiUrl;
}

export async function writeTeamContext(config: TeamContextConfig): Promise<void> {
  const filePath = teamConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify({ ...config, version: 3, savedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function clearTeamContext(): Promise<void> {
  await fs.rm(teamConfigPath(), { force: true });
}

export async function logoutTeamContext(): Promise<void> {
  const config = await readTeamContext();
  if (config) {
    await revokeTeamContext(config).catch(() => undefined);
  }
  await clearTeamContext();
}

export async function revokeTeamContext(config: TeamContextConfig): Promise<void> {
  await teamFetch(config, "/v1/auth/logout", { method: "POST", teamId: null });
}

export async function readTeamContext(): Promise<TeamContextConfig | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(teamConfigPath(), "utf-8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.apiUrl !== "string" ||
      typeof parsed.token !== "string"
    ) {
      return null;
    }
    const apiUrl = parsed.apiUrl.trim().replace(/\/+$/, "");
    const token = parsed.token.trim();
    if (!/^https?:\/\//i.test(apiUrl) || token === "") return null;
    const savedTeam = asRecord(parsed.team);
    const savedTeamId = typeof savedTeam.id === "string" && savedTeam.id.trim()
      ? savedTeam.id.trim()
      : null;
    return {
      version: typeof parsed.version === "number" ? parsed.version : undefined,
      apiUrl,
      token,
      tokenType: parsed.tokenType === "team-api-session" || parsed.tokenType === "dev-token"
        ? parsed.tokenType
        : undefined,
      authSource: typeof parsed.authSource === "string" ? parsed.authSource : undefined,
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : undefined,
      user: parsed.user,
      team: parsed.team,
      membership: parsed.membership,
      serverId: typeof parsed.serverId === "string" ? parsed.serverId : null,
      selectedTeamId: typeof parsed.selectedTeamId === "string"
        ? parsed.selectedTeamId
        : savedTeamId,
      teams: normalizeTeamMemberships(parsed.teams),
      companyMembership: parsed.companyMembership,
      pendingAccessRequestCount: typeof parsed.pendingAccessRequestCount === "number"
        ? Math.max(0, Math.trunc(parsed.pendingAccessRequestCount))
        : 0,
    };
  } catch {
    return null;
  }
}

export async function saveValidatedTeamContext(
  apiUrlInput: string,
  tokenInput: string,
): Promise<TeamContextConfig> {
  const config = await validateTeamTokenContext(apiUrlInput, tokenInput);
  await writeTeamContext(config);
  return config;
}

export async function validateTeamTokenContext(
  apiUrlInput: string,
  tokenInput: string,
): Promise<TeamContextConfig> {
  const apiUrl = normalizeApiUrl(apiUrlInput);
  const token = tokenInput.trim();
  if (!token) throw new Error("Token is required");

  const provisional: TeamContextConfig = {
    version: 3,
    apiUrl,
    token,
    tokenType: "dev-token",
    savedAt: new Date().toISOString(),
  };
  const whoami = asRecord(await teamFetch(provisional, "/v1/team/whoami"));
  const team = asRecord(whoami.team);
  const selectedTeamId = typeof team.id === "string" ? team.id : null;
  const server = asRecord(whoami.server);
  const config: TeamContextConfig = {
    ...provisional,
    user: whoami.user,
    team: whoami.team,
    membership: whoami.membership,
    serverId: typeof server.id === "string" ? server.id : null,
    selectedTeamId,
    teams: selectedTeamId ? [{
      id: selectedTeamId,
      slug: typeof team.slug === "string" ? team.slug : null,
      name: typeof team.name === "string" ? team.name : null,
      membership: whoami.membership,
    }] : [],
  };
  return config;
}

export async function saveTeamEmailLogin(
  apiUrlInput: string,
  emailInput: string,
  passwordInput: string,
  teamInput?: string,
): Promise<TeamContextConfig> {
  const config = await validateTeamEmailLogin(apiUrlInput, emailInput, passwordInput, teamInput);
  await writeTeamContext(config);
  return config;
}

export async function validateTeamEmailLogin(
  apiUrlInput: string,
  emailInput: string,
  passwordInput: string,
  teamInput?: string,
): Promise<TeamContextConfig> {
  const apiUrl = normalizeApiUrl(apiUrlInput);
  const email = emailInput.trim();
  const password = passwordInput.trim();
  if (!email) throw new Error("Email is required");
  if (!password) throw new Error("Password is required");

  const response = await fetch(`${apiUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      team: teamInput?.trim() || null,
      authSource: "browser-session",
    }),
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = asRecord(body);
    const error = asRecord(record.error);
    throw new Error(
      typeof error.message === "string"
        ? error.message
        : `Team login failed (${response.status})`,
    );
  }
  const record = asRecord(body);
  const token = typeof record.token === "string" ? record.token.trim() : "";
  if (!token) throw new Error("Team login did not return a session token");

  const config: TeamContextConfig = {
    version: 3,
    apiUrl,
    token,
    tokenType: "team-api-session",
    authSource: typeof record.authSource === "string" ? record.authSource : "browser-session",
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
    savedAt: new Date().toISOString(),
    user: record.user,
    team: record.team,
    membership: record.membership,
    serverId: typeof asRecord(record.server).id === "string"
      ? String(asRecord(record.server).id)
      : null,
    selectedTeamId: typeof record.defaultTeamId === "string"
      ? record.defaultTeamId
      : typeof asRecord(record.team).id === "string" ? String(asRecord(record.team).id) : null,
    teams: [],
    companyMembership: record.companyMembership,
    pendingAccessRequestCount: typeof record.pendingAccessRequestCount === "number"
      ? Math.max(0, Math.trunc(record.pendingAccessRequestCount))
      : 0,
  };
  const memberships = asRecord(await teamFetch(config, "/v1/auth/teams", { teamId: null }));
  config.serverId = typeof asRecord(memberships.server).id === "string"
    ? String(asRecord(memberships.server).id)
    : config.serverId;
  config.teams = normalizeTeamMemberships(memberships.teams);
  config.companyMembership = memberships.companyMembership ?? config.companyMembership;
  config.pendingAccessRequestCount = typeof memberships.pendingAccessRequestCount === "number"
    ? Math.max(0, Math.trunc(memberships.pendingAccessRequestCount))
    : 0;
  if (!config.selectedTeamId && typeof memberships.defaultTeamId === "string") {
    config.selectedTeamId = memberships.defaultTeamId;
  }
  return config;
}

function selectedTeamSnapshot(team: TeamMembershipSummary | undefined): Record<string, unknown> | null {
  if (!team) return null;
  return {
    id: team.id,
    slug: team.slug ?? null,
    name: team.name ?? null,
  };
}

function reconcileTeamContext(
  config: TeamContextConfig,
  membershipsRecord: Record<string, unknown>,
): TeamContextConfig {
  const teams = normalizeTeamMemberships(membershipsRecord.teams);
  const defaultTeamId = typeof membershipsRecord.defaultTeamId === "string"
    ? membershipsRecord.defaultTeamId.trim()
    : "";
  const savedSelection = config.selectedTeamId?.trim() || "";
  const selected = teams.find((team) => team.id === savedSelection)
    ?? teams.find((team) => team.id === defaultTeamId)
    ?? teams[0];

  return {
    ...config,
    version: 3,
    serverId: typeof asRecord(membershipsRecord.server).id === "string"
      ? String(asRecord(membershipsRecord.server).id)
      : config.serverId ?? null,
    selectedTeamId: selected?.id ?? null,
    teams,
    team: selectedTeamSnapshot(selected),
    membership: selected?.membership ?? null,
    companyMembership: membershipsRecord.companyMembership ?? config.companyMembership,
    pendingAccessRequestCount: typeof membershipsRecord.pendingAccessRequestCount === "number"
      ? Math.max(0, Math.trunc(membershipsRecord.pendingAccessRequestCount))
      : 0,
  };
}

function teamContextChanged(left: TeamContextConfig, right: TeamContextConfig): boolean {
  return (
    left.version !== right.version
    || left.serverId !== right.serverId
    || left.selectedTeamId !== right.selectedTeamId
    || JSON.stringify(left.teams ?? []) !== JSON.stringify(right.teams ?? [])
    || JSON.stringify(left.team ?? null) !== JSON.stringify(right.team ?? null)
    || JSON.stringify(left.membership ?? null) !== JSON.stringify(right.membership ?? null)
    || JSON.stringify(left.companyMembership ?? null) !== JSON.stringify(right.companyMembership ?? null)
    || left.pendingAccessRequestCount !== right.pendingAccessRequestCount
  );
}

function isSameSavedLogin(left: TeamContextConfig, right: TeamContextConfig): boolean {
  return left.apiUrl === right.apiUrl && left.token === right.token;
}

export async function selectTeamContext(teamIdInput: string): Promise<TeamContextConfig> {
  const teamId = teamIdInput.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId)) {
    throw new TeamApiError("A valid teamId is required", 400, "invalid_team_scope");
  }

  return withTeamContextMutation(async () => {
    const config = await readTeamContext();
    if (!config || isExpired(config)) {
      throw new TeamApiError("A valid Team OS login is required", 401, "unauthorized");
    }

    const membershipsRecord = asRecord(
      await teamFetch(config, "/v1/auth/teams", { teamId: null }),
    );
    const teams = normalizeTeamMemberships(membershipsRecord.teams);
    const selected = teams.find((team) => team.id === teamId);
    if (!selected) {
      throw new TeamApiError(
        "Active team membership is required",
        403,
        "forbidden",
      );
    }

    const next: TeamContextConfig = {
      ...config,
      version: 3,
      serverId: typeof asRecord(membershipsRecord.server).id === "string"
        ? String(asRecord(membershipsRecord.server).id)
        : config.serverId ?? null,
      selectedTeamId: selected.id,
      teams,
      team: selectedTeamSnapshot(selected),
      membership: selected.membership,
    };
    await writeTeamContext(next);
    return next;
  });
}

export async function teamFetch(
  config: TeamContextConfig,
  pathname: string,
  options: { method?: string; body?: unknown; teamId?: string | null } = {},
): Promise<unknown> {
  if (process.env.AI_OS_TEAM_ENRICHMENT === "conversation_only") {
    throw new TeamApiError(
      "This existing chat is continuing without Team OS enrichment.",
      403,
      "team_enrichment_disabled",
    );
  }
  const headers: Record<string, string> = { authorization: `Bearer ${config.token}` };
  const savedTeam = asRecord(config.team);
  const processWorkMode = process.env.AI_OS_WORK_MODE?.trim();
  const processTeamId = processWorkMode === "solo"
    ? null
    : process.env.AI_OS_TEAM_ID?.trim() || null;
  const teamId = options.teamId !== undefined
    ? options.teamId
    : processWorkMode === "solo"
      ? null
      : processTeamId ?? config.selectedTeamId ?? (typeof savedTeam.id === "string" ? savedTeam.id : null);
  if (teamId) headers["x-ai-team-id"] = teamId;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${config.apiUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const error = record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : {};
    throw new TeamApiError(
      typeof error.message === "string"
        ? error.message
        : `Team API request failed (${response.status})`,
      response.status,
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return body;
}

async function healthFetch(apiUrl: string): Promise<unknown> {
  const response = await fetch(`${apiUrl}/v1/health`, {
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  return response.json().catch(() => ({ ok: response.ok }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeTeamMemberships(value: unknown): TeamMembershipSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) return [];
    return [{
      id,
      slug: typeof record.slug === "string" ? record.slug : null,
      name: typeof record.name === "string" ? record.name : null,
      membership: record.membership ?? null,
      access: record.access ?? record.effectiveAccess ?? null,
      pendingRequest: record.pendingRequest === true,
    }];
  });
}

function isExpired(config: TeamContextConfig): boolean {
  return typeof config.expiresAt === "string" && Date.parse(config.expiresAt) <= Date.now();
}

function hasActiveCompanyMembership(value: unknown): boolean {
  const membership = asRecord(value);
  return (membership.role === "owner" || membership.role === "admin")
    && membership.status === "active";
}

function normalizeTeamClients(value: unknown): TeamApiClient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const slug = typeof record.slug === "string" ? record.slug.trim() : "";
    if (slug === "") return [];
    const id = typeof record.id === "string" && record.id.trim() !== ""
      ? record.id.trim()
      : slug;
    const access = record.access === "write" ? "write" : "read";
    return [{
      id,
      slug,
      name: typeof record.name === "string" ? record.name : null,
      access,
    }];
  });
}

function normalizeMemoryHits(value: unknown): TeamMemorySearchHit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const sourcePath = typeof record.sourcePath === "string" ? record.sourcePath.trim() : "";
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (sourcePath === "" || content === "") return [];

    const score = typeof record.score === "number" ? record.score : null;
    const finalScore = typeof record.finalScore === "number" ? record.finalScore : null;
    const startLine = typeof record.startLine === "number" ? record.startLine : null;
    const endLine = typeof record.endLine === "number" ? record.endLine : null;

    return [{
      sourcePath,
      sourceType: typeof record.sourceType === "string" ? record.sourceType : null,
      content,
      heading: typeof record.heading === "string" ? record.heading : null,
      startLine,
      endLine,
      score,
      finalScore,
    }];
  });
}

function normalizeContextSnapshotLayers(value: unknown): TeamContextSnapshotLayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const pathValue = typeof record.path === "string" ? record.path.trim() : "";
    if (pathValue === "") return [];
    return [{
      label: typeof record.label === "string" ? record.label : "Context",
      visibility: typeof record.visibility === "string" ? record.visibility : "system",
      kind: typeof record.kind === "string" ? record.kind : "other",
      path: pathValue,
      sha256: typeof record.sha256 === "string" ? record.sha256 : "",
      source: typeof record.source === "string" ? record.source : "database",
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    }];
  });
}

function normalizeContextAvailableFiles(value: unknown): TeamContextAvailableFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const pathValue = typeof record.path === "string" ? record.path.trim() : "";
    if (pathValue === "") return [];
    return [{
      visibility: typeof record.visibility === "string" ? record.visibility : "team",
      kind: typeof record.kind === "string" ? record.kind : "other",
      path: pathValue,
      title: typeof record.title === "string" ? record.title : null,
      size: typeof record.size === "number" ? record.size : undefined,
      source: typeof record.source === "string" ? record.source : "database",
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    }];
  });
}

function normalizeContextDocuments(value: unknown): TeamContextDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const pathValue = typeof record.path === "string" ? record.path.trim() : "";
    const visibility = typeof record.visibility === "string" ? record.visibility : "";
    if (
      pathValue === "" ||
      !["team", "client", "private", "system"].includes(visibility)
    ) {
      return [];
    }
    return [{
      id: typeof record.id === "string" ? record.id : undefined,
      visibility: visibility as TeamContextDocument["visibility"],
      path: pathValue,
      kind: typeof record.kind === "string" ? record.kind : undefined,
      sha256: typeof record.sha256 === "string" ? record.sha256 : undefined,
      status: typeof record.status === "string" ? record.status : undefined,
      content: typeof record.content === "string" ? record.content : undefined,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    }];
  });
}

export async function fetchTeamContextSnapshot(
  clientId: string | null,
  taskType?: string | null,
  options: { teamId?: string | null } = {},
): Promise<TeamContextSnapshot | null> {
  const config = await readTeamContext();
  if (!config || isExpired(config)) return null;

  const params = new URLSearchParams();
  const trimmedClientId = clientId?.trim() ?? "";
  if (trimmedClientId !== "" && trimmedClientId !== "root") {
    params.set("client", trimmedClientId);
  }
  if (taskType?.trim()) params.set("taskType", taskType.trim());
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const body = await teamFetch(config, `/v1/context/snapshot${suffix}`, {
    teamId: options.teamId,
  });
  const record = asRecord(body);
  const snapshotRecord = asRecord(record.snapshot);
  const markdown = typeof snapshotRecord.markdown === "string" ? snapshotRecord.markdown : "";
  return {
    generatedAt: typeof snapshotRecord.generatedAt === "string"
      ? snapshotRecord.generatedAt
      : new Date().toISOString(),
    team: snapshotRecord.team ?? config.team ?? null,
    user: snapshotRecord.user ?? config.user ?? null,
    client: snapshotRecord.client ?? null,
    taskType: typeof snapshotRecord.taskType === "string" ? snapshotRecord.taskType : null,
    layers: normalizeContextSnapshotLayers(snapshotRecord.layers),
    availableContext: normalizeContextAvailableFiles(snapshotRecord.availableContext),
    markdown,
  };
}

export async function fetchTeamStatus(): Promise<TeamApiStatus> {
  const config = await readTeamContext();
  if (!config) {
    return {
      status: "signed_out",
      signedIn: false,
      clients: [],
      serverId: null,
      selectedTeamId: null,
      teams: [],
      scopeLabels: readScopeLabels(),
    };
  }

  if (isExpired(config)) {
    return {
      status: "unavailable",
      signedIn: false,
      apiUrl: config.apiUrl,
      savedAt: config.savedAt ?? null,
      expiresAt: config.expiresAt ?? null,
      tokenType: config.tokenType ?? null,
      authSource: config.authSource ?? null,
      clients: [],
      error: "Saved Team OS login expired. Sign in again.",
      serverId: config.serverId ?? null,
      selectedTeamId: config.selectedTeamId ?? null,
      teams: config.teams ?? [],
      scopeLabels: readScopeLabels(),
    };
  }

  let latestConfig = config;
  try {
    const [health, membershipsResult] = await Promise.all([
      healthFetch(config.apiUrl),
      teamFetch(config, "/v1/auth/teams", { teamId: null }),
    ]);
    const membershipsRecord = asRecord(membershipsResult);
    const refreshed = await withTeamContextMutation(async () => {
      const current = await readTeamContext();
      if (!current || !isSameSavedLogin(config, current)) {
        throw new TeamApiError("Team OS login changed while refreshing", 409, "stale_team_context");
      }
      const next = reconcileTeamContext(current, membershipsRecord);
      if (teamContextChanged(current, next)) await writeTeamContext(next);
      return next;
    });
    latestConfig = refreshed;
    if (!refreshed.teams?.length) {
      if (hasActiveCompanyMembership(refreshed.companyMembership)) {
        return {
          status: "connected",
          signedIn: true,
          apiUrl: config.apiUrl,
          savedAt: config.savedAt ?? null,
          expiresAt: config.expiresAt ?? null,
          tokenType: config.tokenType ?? null,
          authSource: config.authSource ?? null,
          health,
          clients: [],
          user: refreshed.user ?? config.user,
          team: null,
          membership: null,
          serverId: refreshed.serverId ?? null,
          selectedTeamId: null,
          teams: [],
          companyMembership: refreshed.companyMembership,
          pendingAccessRequestCount: refreshed.pendingAccessRequestCount ?? 0,
          scopeLabels: readScopeLabels(),
        };
      }
      return {
        status: "blocked",
        signedIn: true,
        apiUrl: config.apiUrl,
        savedAt: config.savedAt ?? null,
        expiresAt: config.expiresAt ?? null,
        tokenType: config.tokenType ?? null,
        authSource: config.authSource ?? null,
        clients: [],
        serverId: refreshed.serverId ?? null,
        selectedTeamId: null,
        teams: [],
        scopeLabels: readScopeLabels(),
        error: "No active team memberships are available for this account.",
        companyMembership: refreshed.companyMembership,
        pendingAccessRequestCount: refreshed.pendingAccessRequestCount ?? 0,
      };
    }
    const [whoami, clientResult] = await Promise.all([
      teamFetch(refreshed, "/v1/team/whoami"),
      teamFetch(refreshed, "/v1/team/clients"),
    ]);
    const whoamiRecord = asRecord(whoami);
    const clientsRecord = asRecord(clientResult);

    const clients = normalizeTeamClients(clientsRecord.clients);
    const scopeLabels = mergeScopeLabelsSafely({
      teams: refreshed.teams ?? [],
      selectedTeamId: refreshed.selectedTeamId ?? null,
      clients,
    });

    return {
      status: "connected",
      signedIn: true,
      apiUrl: config.apiUrl,
      savedAt: config.savedAt ?? null,
      expiresAt: config.expiresAt ?? null,
      tokenType: config.tokenType ?? null,
      authSource: config.authSource ?? null,
      health,
      user: whoamiRecord.user ?? config.user,
      team: whoamiRecord.team ?? config.team,
      membership: whoamiRecord.membership ?? config.membership,
      serverId: refreshed.serverId ?? null,
      selectedTeamId: refreshed.selectedTeamId ?? null,
      teams: refreshed.teams ?? [],
      companyMembership: refreshed.companyMembership,
      pendingAccessRequestCount: refreshed.pendingAccessRequestCount ?? 0,
      clients,
      scopeLabels,
    };
  } catch (error) {
    if (error instanceof TeamApiError && error.status === 403) {
      return {
        status: "blocked",
        signedIn: true,
        apiUrl: config.apiUrl,
        savedAt: config.savedAt ?? null,
        expiresAt: config.expiresAt ?? null,
        tokenType: config.tokenType ?? null,
        authSource: config.authSource ?? null,
        clients: [],
        serverId: latestConfig.serverId ?? null,
        selectedTeamId: latestConfig.selectedTeamId ?? null,
        teams: latestConfig.teams ?? [],
        scopeLabels: readScopeLabels(),
        error: error.message,
        companyMembership: latestConfig.companyMembership,
        pendingAccessRequestCount: latestConfig.pendingAccessRequestCount ?? 0,
      };
    }
    return {
      status: "unavailable",
      signedIn: !(error instanceof TeamApiError && error.status === 401),
      apiUrl: config.apiUrl,
      savedAt: config.savedAt ?? null,
      expiresAt: config.expiresAt ?? null,
      tokenType: config.tokenType ?? null,
      authSource: config.authSource ?? null,
      clients: [],
      error: error instanceof Error ? error.message : "Team API unavailable",
      companyMembership: latestConfig.companyMembership,
      pendingAccessRequestCount: latestConfig.pendingAccessRequestCount ?? 0,
      serverId: latestConfig.serverId ?? null,
      selectedTeamId: latestConfig.selectedTeamId ?? null,
      teams: latestConfig.teams ?? [],
      scopeLabels: readScopeLabels(),
    };
  }
}

export async function searchTeamMemory(
  query: string,
  clientId: string | null,
  topK = 5,
  options: { teamId?: string | null } = {},
): Promise<TeamMemorySearchResult | null> {
  const config = await readTeamContext();
  if (!config) return null;

  const trimmedClientId = clientId?.trim() ?? "";
  const normalizedClientId =
    trimmedClientId !== "" && trimmedClientId !== "root" ? trimmedClientId : null;
  const include = normalizedClientId
    ? ["system", "team", "private", "client"]
    : ["system", "team", "private"];
  const emb = await createEmbedder({ kind: TEAM_OS_EMBEDDING_MODEL });
  if (emb.model !== TEAM_OS_EMBEDDING_MODEL || emb.dim !== TEAM_OS_EMBEDDING_DIM) {
    throw new Error(
      `Team OS memory requires ${TEAM_OS_EMBEDDING_MODEL}/${TEAM_OS_EMBEDDING_DIM} embeddings`,
    );
  }
  const [queryEmbedding] = await emb.embed([query]);

  const body = await teamFetch(config, "/v1/memory/search", {
    method: "POST",
    teamId: options.teamId,
    body: {
      query,
      queryEmbedding,
      embeddingModel: emb.model,
      embeddingDim: emb.dim,
      topK,
      storeQueryText: false,
      scope: {
        teamId: null,
        clientId: normalizedClientId,
        userId: null,
        include,
      },
    },
  });
  const record = asRecord(body);
  const rawVisibilitySet = Array.isArray(record.visibilitySet)
    ? record.visibilitySet
    : include;

  return {
    results: normalizeMemoryHits(record.results),
    visibilitySet: rawVisibilitySet.filter((value): value is string => typeof value === "string"),
    eventId: typeof record.eventId === "string" ? record.eventId : null,
    requestedClientId: normalizedClientId,
  };
}

function normalizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    out[key] = normalizeNumber(raw);
  }
  return out;
}

export async function fetchTeamMemoryStatus(): Promise<TeamMemoryStatus | null> {
  const config = await readTeamContext();
  if (!config) return null;

  const body = await teamFetch(config, "/v1/memory/status");
  const record = asRecord(body);
  const scope = asRecord(record.scope);
  const lastJobRecord = record.lastJob == null ? null : asRecord(record.lastJob);
  const captureEligibility = asRecord(record.captureEligibility);

  return {
    storeReady: record.storeReady === true,
    scope: {
      mode: typeof scope.mode === "string" ? scope.mode : undefined,
      teamId: typeof scope.teamId === "string" ? scope.teamId : null,
      userId: typeof scope.userId === "string" ? scope.userId : null,
    },
    sources: normalizeNumber(record.sources),
    chunks: normalizeNumber(record.chunks),
    jobs: normalizeNumber(record.jobs),
    captureEvents: normalizeNumber(record.captureEvents),
    byVisibility: normalizeNumberRecord(record.byVisibility),
    jobsByStatus: normalizeNumberRecord(record.jobsByStatus),
    captureEventsByStatus: normalizeNumberRecord(record.captureEventsByStatus),
    captureEligibility: {
      pending: typeof captureEligibility.pending === "number" ? captureEligibility.pending : undefined,
      eligiblePending: typeof captureEligibility.eligiblePending === "number" ? captureEligibility.eligiblePending : undefined,
      waitingPending: typeof captureEligibility.waitingPending === "number" ? captureEligibility.waitingPending : undefined,
      nextEligibleAt: typeof captureEligibility.nextEligibleAt === "string" ? captureEligibility.nextEligibleAt : null,
      volumeThreshold: typeof captureEligibility.volumeThreshold === "number" ? captureEligibility.volumeThreshold : undefined,
    },
    lastIndexedAt: typeof record.lastIndexedAt === "string" ? record.lastIndexedAt : null,
    lastJob: lastJobRecord
      ? {
          sourcePath: typeof lastJobRecord.sourcePath === "string" ? lastJobRecord.sourcePath : undefined,
          reason: typeof lastJobRecord.reason === "string" ? lastJobRecord.reason : undefined,
          status: typeof lastJobRecord.status === "string" ? lastJobRecord.status : undefined,
          errorMessage: typeof lastJobRecord.errorMessage === "string" ? lastJobRecord.errorMessage : null,
          enqueuedAt: typeof lastJobRecord.enqueuedAt === "string" ? lastJobRecord.enqueuedAt : null,
          startedAt: typeof lastJobRecord.startedAt === "string" ? lastJobRecord.startedAt : null,
          finishedAt: typeof lastJobRecord.finishedAt === "string" ? lastJobRecord.finishedAt : null,
        }
      : null,
  };
}

export async function fetchTeamMemories(): Promise<TeamMemoriesResponse> {
  const config = await readTeamContext();
  if (!config) throw new Error("Sign in to Team OS first");
  if (isExpired(config)) throw new Error("Saved Team OS login expired. Sign in again.");
  return teamFetch(config, "/v1/memory/memories") as Promise<TeamMemoriesResponse>;
}

export async function postTeamMemoryAction(action: Record<string, unknown>): Promise<unknown> {
  const config = await readTeamContext();
  if (!config) throw new Error("Sign in to Team OS first");
  if (isExpired(config)) throw new Error("Saved Team OS login expired. Sign in again.");
  return teamFetch(config, "/v1/memory/memories", { method: "POST", body: action });
}

export async function fetchTeamAdminState(): Promise<unknown> {
  const config = await readTeamContext();
  if (!config) throw new Error("Sign in to Team OS first");
  if (isExpired(config)) throw new Error("Saved Team OS login expired. Sign in again.");
  return teamFetch(config, "/v1/team/admin");
}

export async function postTeamAdminAction(action: Record<string, unknown>): Promise<unknown> {
  const config = await readTeamContext();
  if (!config) throw new Error("Sign in to Team OS first");
  if (isExpired(config)) throw new Error("Saved Team OS login expired. Sign in again.");
  return teamFetch(config, "/v1/team/admin", { method: "POST", body: action });
}

async function requireCompanyContext(): Promise<TeamContextConfig> {
  const config = await readTeamContext();
  if (!config) throw new TeamApiError("Team OS sign-in is required", 401, "unauthorized");
  if (isExpired(config)) throw new TeamApiError("Saved Team OS login expired. Sign in again.", 401, "unauthorized");
  return config;
}

function companyPath(pathname: "teams" | "memberships" | "access", teamId?: string | null): string {
  if (pathname !== "teams" || !teamId) return `/v1/company/${pathname}`;
  const query = new URLSearchParams({ teamId });
  return `/v1/company/teams?${query.toString()}`;
}

export async function fetchCompanyState(
  pathname: "teams" | "memberships" | "access",
  teamId?: string | null,
): Promise<unknown> {
  const config = await requireCompanyContext();
  return teamFetch(config, companyPath(pathname, teamId), { teamId: null });
}

export async function postCompanyAction(
  pathname: "teams" | "memberships" | "access",
  action: Record<string, unknown>,
): Promise<unknown> {
  const config = await requireCompanyContext();
  return teamFetch(config, companyPath(pathname), { method: "POST", body: action, teamId: null });
}

function normalizeFileList(value: unknown): TeamWorkspaceFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (typeof record.path !== "string") return [];
    return [{
      path: record.path,
      client: typeof record.client === "string" ? record.client : undefined,
      size: typeof record.size === "number" ? record.size : undefined,
      sha256: typeof record.sha256 === "string" ? record.sha256 : undefined,
      normalizedSha256: typeof record.normalizedSha256 === "string" ? record.normalizedSha256 : undefined,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
      writable: typeof record.writable === "boolean" ? record.writable : undefined,
      secret: typeof record.secret === "boolean" ? record.secret : undefined,
      encoding: record.encoding === "base64" ? "base64" : record.encoding === "utf-8" ? "utf-8" : undefined,
    }];
  });
}

function normalizeSecretGrants(value: unknown): TeamSecretGrant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof record.id === "string" ? record.id : "";
    const userId = typeof record.userId === "string" ? record.userId : "";
    if (!id || !userId) return [];
    return [{
      id,
      userId,
      email: typeof record.email === "string" ? record.email : null,
      access: "read",
      status: typeof record.status === "string" ? record.status : "active",
      grantedAt: typeof record.grantedAt === "string" ? record.grantedAt : null,
    }];
  });
}

function normalizeSecretsList(value: unknown): TeamSecretsList {
  const record = asRecord(value);
  const rawSecrets = Array.isArray(record.secrets) ? record.secrets : [];
  return {
    admin: record.admin === true,
    secrets: rawSecrets.flatMap((item) => {
      const secret = asRecord(item);
      const id = typeof secret.id === "string" ? secret.id : "";
      const envKey = typeof secret.envKey === "string" ? secret.envKey : "";
      if (!id || !envKey) return [];
      return [{
        id,
        name: typeof secret.name === "string" ? secret.name : envKey,
        envKey,
        scope: secret.scope === "client" ? "client" : "team",
        clientId: typeof secret.clientId === "string" ? secret.clientId : null,
        clientSlug: typeof secret.clientSlug === "string" ? secret.clientSlug : null,
        clientName: typeof secret.clientName === "string" ? secret.clientName : null,
        status: typeof secret.status === "string" ? secret.status : null,
        updatedAt: typeof secret.updatedAt === "string" ? secret.updatedAt : null,
        createdAt: typeof secret.createdAt === "string" ? secret.createdAt : null,
        grantedToCurrentUser: secret.grantedToCurrentUser === true,
        grants: normalizeSecretGrants(secret.grants),
      }];
    }),
  };
}

function normalizeSecretValues(value: unknown): TeamSecretValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = typeof record.id === "string" ? record.id : "";
    const envKey = typeof record.envKey === "string" ? record.envKey : "";
    const value = typeof record.value === "string" ? record.value : null;
    if (!id || !envKey || value == null) return [];
    return [{
      id,
      envKey,
      value,
      name: typeof record.name === "string" ? record.name : envKey,
    }];
  });
}

function normalizeSecretsSync(value: unknown): TeamSecretsSyncPayload {
  const record = asRecord(value);
  const team = asRecord(record.team);
  const rawClients = Array.isArray(record.clients) ? record.clients : [];
  return {
    team: { secrets: normalizeSecretValues(team.secrets) },
    clients: rawClients.flatMap((item) => {
      const client = asRecord(item);
      const slug = typeof client.slug === "string" ? client.slug : "";
      if (!slug) return [];
      return [{
        id: typeof client.id === "string" ? client.id : slug,
        slug,
        name: typeof client.name === "string" ? client.name : null,
        secrets: normalizeSecretValues(client.secrets),
      }];
    }),
  };
}

function normalizeUserConfigFile(value: unknown): TeamUserConfigFile | null {
  const record = asRecord(value);
  const file = record.file == null ? null : asRecord(record.file);
  if (!file) return null;
  const filePath = typeof file.path === "string" ? file.path : "";
  const content = typeof file.content === "string" ? file.content : null;
  if (!filePath || content == null) return null;
  return {
    id: typeof file.id === "string" ? file.id : undefined,
    path: filePath,
    content,
    sha256: typeof file.sha256 === "string" ? file.sha256 : undefined,
    keyId: typeof file.keyId === "string" ? file.keyId : null,
    algorithm: typeof file.algorithm === "string" ? file.algorithm : null,
    updatedAt: typeof file.updatedAt === "string" ? file.updatedAt : null,
    createdAt: typeof file.createdAt === "string" ? file.createdAt : null,
  };
}

function normalizeSkillSummaries(value: unknown): TeamSkillSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const slug = typeof record.slug === "string" ? record.slug.trim() : "";
    if (slug === "") return [];
    const permission =
      record.userPermission === "skill.admin" ||
      record.userPermission === "skill.edit" ||
      record.userPermission === "skill.read" ||
      record.userPermission === "skill.use"
        ? record.userPermission
        : null;
    return [{
      slug,
      name: typeof record.name === "string" ? record.name : null,
      description: typeof record.description === "string" ? record.description : null,
      status: typeof record.status === "string" ? record.status : null,
      files: typeof record.files === "number" ? record.files : undefined,
      grants: typeof record.grants === "number" ? record.grants : undefined,
      userPermission: permission,
      writable: record.writable === true,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    }];
  });
}

function requireActiveTeamConfig(): Promise<TeamContextConfig> {
  return readTeamContext().then((config) => {
    if (!config) throw new Error("Sign in to Team OS first");
    if (isExpired(config)) throw new Error("Saved Team OS login expired. Sign in again.");
    return config;
  });
}

export async function fetchTeamWorkspaceManifest(client: string): Promise<TeamWorkspaceManifest> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ client });
  const body = await teamFetch(config, `/v1/workspace/manifest?${q.toString()}`);
  const record = asRecord(body);
  return {
    files: normalizeFileList(record.files),
    clients: normalizeTeamClients(record.clients),
    unsupportedFiles: typeof record.unsupportedFiles === "number" ? record.unsupportedFiles : 0,
    secretFilesHidden: typeof record.secretFilesHidden === "number" ? record.secretFilesHidden : 0,
  };
}

export async function fetchTeamSecrets(client?: string | null): Promise<TeamSecretsList> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams();
  if (client?.trim()) q.set("client", client.trim());
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return normalizeSecretsList(await teamFetch(config, `/v1/team/secrets${suffix}`));
}

export async function postTeamSecretsAction(action: Record<string, unknown>): Promise<TeamSecretsList> {
  const config = await requireActiveTeamConfig();
  return normalizeSecretsList(await teamFetch(config, "/v1/team/secrets", {
    method: "POST",
    body: action,
  }));
}

export async function fetchTeamSecretsForSync(client?: string | null): Promise<TeamSecretsSyncPayload> {
  const config = await requireActiveTeamConfig();
  return normalizeSecretsSync(await teamFetch(config, "/v1/team/secrets/sync", {
    method: "POST",
    body: client?.trim() ? { client: client.trim() } : {},
  }));
}

export async function fetchTeamUserConfigFile(filePath: string): Promise<TeamUserConfigFile | null> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  return normalizeUserConfigFile(await teamFetch(config, `/v1/user/config-file?${q.toString()}`));
}

export async function writeTeamUserConfigFile(
  filePath: string,
  content: string,
  expectedSha256?: string,
): Promise<{ sha256?: string; updatedAt?: string | null }> {
  const config = await requireActiveTeamConfig();
  const body = await teamFetch(config, "/v1/user/config-file", {
    method: "PUT",
    body: {
      path: filePath,
      content,
      ...(expectedSha256 ? { expectedSha256 } : {}),
    },
  });
  const record = asRecord(body);
  const file = asRecord(record.file);
  return {
    sha256: typeof file.sha256 === "string" ? file.sha256 : undefined,
    updatedAt: typeof file.updatedAt === "string" ? file.updatedAt : null,
  };
}

export async function fetchTeamWorkspaceFile(filePath: string): Promise<TeamWorkspaceFileContent> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  const body = await teamFetch(config, `/v1/workspace/file?${q.toString()}`);
  const record = asRecord(body);
  return {
    path: typeof record.path === "string" ? record.path : filePath,
    content: typeof record.content === "string" ? record.content : undefined,
    contentBase64: typeof record.contentBase64 === "string" ? record.contentBase64 : undefined,
    encoding: record.encoding === "base64" ? "base64" : "utf-8",
    size: typeof record.size === "number" ? record.size : undefined,
    sha256: typeof record.sha256 === "string" ? record.sha256 : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    secret: record.secret === true,
  };
}

export async function writeTeamWorkspaceFile(
  filePath: string,
  payload: { content?: string; contentBase64?: string; expectedSha256?: string },
): Promise<unknown> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  return teamFetch(config, `/v1/workspace/file?${q.toString()}`, {
    method: "PUT",
    body: payload,
  });
}

export async function deleteTeamWorkspaceFile(filePath: string, expectedSha256?: string): Promise<unknown> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  if (expectedSha256) q.set("expectedSha256", expectedSha256);
  return teamFetch(config, `/v1/workspace/file?${q.toString()}`, { method: "DELETE" });
}

export async function fetchTeamSkills(teamId?: string | null): Promise<TeamSkillSummary[]> {
  const config = await requireActiveTeamConfig();
  const body = await teamFetch(config, "/v1/team/skills", { teamId });
  return normalizeSkillSummaries(asRecord(body).skills);
}

export async function fetchTeamSkillManifest(skill: string, teamId?: string | null): Promise<TeamSkillManifest> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ skill });
  const body = await teamFetch(config, `/v1/team/skills/manifest?${q.toString()}`, { teamId });
  const record = asRecord(body);
  return {
    skill: typeof record.skill === "string" ? record.skill : skill,
    files: normalizeFileList(record.files),
    unsupportedFiles: typeof record.unsupportedFiles === "number" ? record.unsupportedFiles : 0,
  };
}

export async function fetchTeamSkillFile(filePath: string, teamId?: string | null): Promise<TeamWorkspaceFileContent> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  const body = await teamFetch(config, `/v1/team/skills/file?${q.toString()}`, { teamId });
  const record = asRecord(body);
  return {
    path: typeof record.path === "string" ? record.path : filePath,
    content: typeof record.content === "string" ? record.content : undefined,
    contentBase64: typeof record.contentBase64 === "string" ? record.contentBase64 : undefined,
    encoding: record.encoding === "base64" ? "base64" : "utf-8",
    size: typeof record.size === "number" ? record.size : undefined,
    sha256: typeof record.sha256 === "string" ? record.sha256 : undefined,
    normalizedSha256: typeof record.normalizedSha256 === "string" ? record.normalizedSha256 : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

export async function writeTeamSkillFile(
  filePath: string,
  payload: { content?: string; contentBase64?: string; expectedSha256?: string },
): Promise<unknown> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  return teamFetch(config, `/v1/team/skills/file?${q.toString()}`, {
    method: "PUT",
    body: payload,
  });
}

export async function deleteTeamSkillFile(filePath: string, expectedSha256?: string): Promise<unknown> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  if (expectedSha256) q.set("expectedSha256", expectedSha256);
  return teamFetch(config, `/v1/team/skills/file?${q.toString()}`, { method: "DELETE" });
}

export async function fetchTeamBrandContextManifest(): Promise<{ files: TeamBrandContextFile[]; writable: boolean }> {
  const config = await requireActiveTeamConfig();
  const body = await teamFetch(config, "/v1/team/brand-context/manifest");
  const record = asRecord(body);
  return {
    files: normalizeFileList(record.files),
    writable: record.writable === true,
  };
}

export async function fetchTeamBrandContextFile(filePath: string): Promise<{ content: string; sha256?: string; updatedAt?: string }> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  const body = await teamFetch(config, `/v1/team/brand-context/file?${q.toString()}`);
  const record = asRecord(body);
  return {
    content: typeof record.content === "string" ? record.content : "",
    sha256: typeof record.sha256 === "string" ? record.sha256 : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

export async function writeTeamBrandContextFile(filePath: string, content: string, expectedSha256?: string): Promise<unknown> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ path: filePath });
  return teamFetch(config, `/v1/team/brand-context/file?${q.toString()}`, {
    method: "PUT",
    body: {
      content,
      ...(expectedSha256 ? { expectedSha256 } : {}),
    },
  });
}

export async function fetchTeamContextDocuments(
  visibility: TeamContextDocument["visibility"],
  client?: string | null,
): Promise<TeamContextDocument[]> {
  const config = await requireActiveTeamConfig();
  const q = new URLSearchParams({ visibility });
  if (client) q.set("client", client);
  const body = await teamFetch(config, `/v1/context/documents?${q.toString()}`);
  const record = asRecord(body);
  return normalizeContextDocuments(record.documents);
}

export async function writeTeamContextDocument(input: {
  visibility: "team" | "client" | "private";
  path: string;
  kind?: string;
  content: string;
  expectedSha256?: string;
  client?: string | null;
}): Promise<unknown> {
  const config = await requireActiveTeamConfig();
  return teamFetch(config, "/v1/context/document", {
    method: "PUT",
    body: {
      visibility: input.visibility,
      path: input.path,
      content: input.content,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.expectedSha256 ? { expectedSha256: input.expectedSha256 } : {}),
      ...(input.client ? { client: input.client } : {}),
    },
  });
}
