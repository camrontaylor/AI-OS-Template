/**
 * Memory Schema — hosted memory API handlers.
 *
 * The transport-agnostic core of the hosted ingest/search API. Each handler is
 * a plain async function `(deps, body) → { status, body }` — no HTTP types, no
 * framework. server.ts mounts them on node:http; they could be mounted as
 * Next.js route handlers with a dozen lines. That keeps the contract testable
 * without a network and keeps this module focused on the two things the task
 * demands: scope validation and response shaping.
 *
 * Scope rules (the reason this API exists):
 *   - search REQUIRES an explicit `scope` object — same semantics as the CLI's
 *     buildSearchScope: identity fields set teamId/clientId/userId, and the
 *     searched visibility layers derive from them with `system` always present,
 *     unless `include` pins them explicitly. A request without a scope is a 400,
 *     never an implicit "search everything".
 *   - ingest validates its scope through assertValidScope — the same invariants
 *     the store and the DB CHECK constraints enforce.
 *
 * The handlers NEVER reimplement filtering or the pipeline: search goes through
 * searchMemory (scope.ts buildScopeWhere is the only leak boundary) and ingest
 * goes through ingestContent (the same pipeline the filesystem indexer uses).
 *
 * Audit: unlike the local CLI (--no-events), the hosted API always records
 * search_events — a shared source of truth does not let callers opt out of the
 * audit trail. `storeQueryText` stays opt-in (max-privacy default).
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

import { searchMemory } from "./search";
import { expandMemoryChunk } from "./expand";
import {
  buildChunkKey,
  ingestPreparedContent,
  sha256Hex,
  type PreparedIngestChunk,
} from "./ingest";
import { isExcludedSkillSyncPath } from "../skill-sync-rules";
import {
  ConnectorImportError,
  prepareConnectorImport,
  type ConnectorDescriptor,
  type PreparedConnectorImport,
} from "./connectors";
import { assertValidScope } from "./scope";
import type { MemoryStore } from "./store";
import type { RerankConfig } from "./reranker";
import {
  acceptInviteWithCredential,
  inviteMember,
  InvalidInviteError,
} from "../identity/invites";
import {
  PermissionError,
  resolveEffectiveTeamAccess,
} from "../identity/permissions";
import type { IdentityStore } from "../identity/store";
import {
  clientSlugValidationError,
  normalizeClientSlug,
  suggestClientSlug,
} from "../client-slug";
import {
  decryptSecretValue,
  encryptSecretValue,
  SecretCryptoError,
} from "../identity/secret-crypto";
import {
  authenticateTeamLogin,
  createCompanySessionForUser,
  createPasswordResetTokenForUser,
  createTeamSessionForUser,
  hasUsablePlatformCredential,
  revokeTeamAuthToken,
  resetPasswordWithToken,
  setUserPassword,
  TeamAuthError,
} from "../identity/team-auth";
import type {
  AuditAction,
  AuditTargetType,
  CompanyMembershipRow,
  EffectiveTeamAccess,
  GrantAccess,
  MembershipStatus,
  Role,
  SkillPermission,
  SecretScope,
  TeamApiAuthSource,
} from "../identity/types";
import type {
  ContextDocumentRow,
  ContextKind,
  IndexJobReason,
  Scope,
  SearchScope,
  SourceType,
  Visibility,
} from "./types";
import type { Embedder } from "./embedder";

/** Everything a handler needs — owned by the server, injected per call. */
export interface MemoryApiDeps {
  store: MemoryStore;
  expectedEmbeddingModel?: string;
  expectedEmbeddingDim?: number;
  /** Optional hosted search embedder. When present, /v1/memory/search accepts embeddingMode="server". */
  serverEmbedder?: () => Promise<Embedder>;
  rerankConfig?: RerankConfig;
  /**
   * Absolute AI-OS workspace root. Required for workspace file sync routes.
   */
  workspaceRoot?: string;
  /**
   * Optional identity store. When provided with a request principal, search and
   * ingest are authorized against backend-owned memberships and grants before
   * memory scope filters are built.
   */
  identityStore?: MemoryApiIdentityStore;
}

/** A transport-neutral response: HTTP status + JSON-serializable body. */
export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Principal resolved from server-trusted auth state, never from the request body. */
export interface MemoryApiPrincipal {
  teamId: string;
  userId: string;
  access?: EffectiveTeamAccess | null;
  authSource?: "browser-session" | "cli-device-token" | "api-key" | "dev-token" | "test";
  teamScopeSource?: "explicit-header" | "legacy-session" | "legacy-api-key" | "locked-token";
}

export interface MemoryApiUserPrincipal {
  userId: string;
  authSource?: MemoryApiPrincipal["authSource"];
  credentialKind?: "better-auth-session" | "user-api-key" | "legacy-team-token" | "dev-token";
  legacyTeamId?: string | null;
}

export interface MemoryApiRequestContext {
  principal?: MemoryApiPrincipal | null;
  userPrincipal?: MemoryApiUserPrincipal | null;
  publicBaseUrl?: string | null;
}

interface IdentityMembership {
  id?: string;
  teamId?: string;
  userId?: string;
  status: string;
  role?: string;
  invitedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface IdentityClient {
  id: string;
  slug: string;
  name?: string | null;
  status?: string;
}

interface IdentityGrant {
  access: GrantAccess;
  status: string;
}

interface IdentityTeamSecret {
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
  status: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
  metadata?: Record<string, unknown>;
}

interface IdentitySecretGrant {
  id: string;
  teamId: string;
  secretId: string;
  userId: string;
  access: "read";
  status: string;
  grantedAt?: string;
  revokedAt?: string | null;
}

interface IdentityUserConfigFile {
  id: string;
  teamId: string;
  userId: string;
  path: string;
  encryptedValue: string;
  encryptionKeyId: string;
  nonce: string;
  authTag: string;
  valueSha256: string;
  status: string;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
  metadata?: Record<string, unknown>;
}

interface WorkspaceClientGrant {
  client: IdentityClient;
  grant: IdentityGrant;
}

interface WorkspaceManifestResult {
  files: Array<Record<string, unknown>>;
  unsupportedFiles: number;
  secretFilesHidden: number;
}

interface SkillManifestResult {
  files: Array<Record<string, unknown>>;
  filesCount: number;
  manifestHash: string;
  unsupportedFiles: number;
}

interface IdentityTeam {
  id: string;
  slug: string;
  name: string;
  status?: string;
  archivedAt?: string | null;
  archivedBy?: string | null;
}

interface IdentityUser {
  id: string;
  email: string;
  displayName?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryApiIdentityStore {
  getServerIdentity?(): Promise<{ serverId: string; createdAt?: string }>;
  getMembership(teamId: string, userId: string): Promise<IdentityMembership | null>;
  getTeam?(teamId: string): Promise<IdentityTeam | null>;
  getTeamBySlug?(slug: string): Promise<IdentityTeam | null>;
  getUserById?(userId: string): Promise<IdentityUser | null>;
  getUserByEmail?(email: string): Promise<IdentityUser | null>;
  listMemberships?(teamId: string): Promise<IdentityMembership[]>;
  listMembershipsForUser?(userId: string): Promise<IdentityMembership[]>;
  listClients?(teamId: string): Promise<IdentityClient[]>;
  createClient?(input: {
    teamId: string;
    slug: string;
    name: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }): Promise<IdentityClient | null>;
  upsertClient?(input: {
    teamId: string;
    slug: string;
    name: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }): Promise<IdentityClient>;
  getClientById?(id: string): Promise<IdentityClient | null>;
  getClientBySlug(teamId: string, slug: string): Promise<IdentityClient | null>;
  getActiveGrant(teamId: string, clientId: string, userId: string): Promise<IdentityGrant | null>;
  grantClientAccess?(input: {
    teamId: string;
    clientId: string;
    userId: string;
    access?: GrantAccess;
    grantedBy?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  revokeClientAccess?(input: {
    teamId: string;
    clientId: string;
    userId: string;
    revokedBy?: string | null;
  }): Promise<unknown>;
  listGrants?(filter: { teamId: string; clientId?: string; userId?: string }): Promise<Array<{
    id: string;
    teamId: string;
    clientId: string;
    userId: string;
    access: GrantAccess;
    status: string;
    grantedAt?: string;
    revokedAt?: string | null;
  }>>;
  grantSkillAccess?(input: {
    teamId: string;
    skillName: string;
    userId: string;
    permission: SkillPermission;
    grantedBy?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  revokeSkillAccess?(input: {
    teamId: string;
    skillName: string;
    userId: string;
    permission?: SkillPermission;
    revokedBy?: string | null;
  }): Promise<unknown>;
  listSkillGrants?(filter: { teamId: string; skillName?: string; userId?: string }): Promise<Array<{
    id: string;
    teamId: string;
    skillName: string;
    userId: string;
    permission: SkillPermission;
    status: string;
    grantedAt?: string;
    revokedAt?: string | null;
  }>>;
  upsertTeamSecret?(input: {
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
  }): Promise<IdentityTeamSecret>;
  getTeamSecret?(teamId: string, secretId: string): Promise<IdentityTeamSecret | null>;
  listTeamSecrets?(filter: {
    teamId: string;
    clientId?: string | null;
    includeArchived?: boolean;
  }): Promise<IdentityTeamSecret[]>;
  archiveTeamSecret?(input: {
    teamId: string;
    secretId: string;
    actorUserId?: string | null;
  }): Promise<IdentityTeamSecret | null>;
  grantSecretAccess?(input: {
    teamId: string;
    secretId: string;
    userId: string;
    grantedBy?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<IdentitySecretGrant>;
  revokeSecretAccess?(input: {
    teamId: string;
    secretId: string;
    userId: string;
    revokedBy?: string | null;
  }): Promise<IdentitySecretGrant | null>;
  getActiveSecretGrant?(
    teamId: string,
    secretId: string,
    userId: string,
  ): Promise<IdentitySecretGrant | null>;
  listSecretGrants?(filter: {
    teamId: string;
    secretId?: string;
    userId?: string;
  }): Promise<IdentitySecretGrant[]>;
  upsertUserConfigFile?(input: {
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
  }): Promise<IdentityUserConfigFile>;
  getUserConfigFile?(
    teamId: string,
    userId: string,
    path: string,
  ): Promise<IdentityUserConfigFile | null>;
  setRole?(teamId: string, userId: string, role: Role): Promise<IdentityMembership | null>;
  setMembershipStatus?(
    teamId: string,
    userId: string,
    status: MembershipStatus,
  ): Promise<IdentityMembership | null>;
  listAuditEvents?(filter: {
    teamId: string;
    targetType?: AuditTargetType;
    targetId?: string;
    limit?: number;
  }): Promise<Array<{
    id: string;
    action: AuditAction;
    targetType: AuditTargetType;
    targetId: string | null;
    summary: string | null;
    createdAt: string;
    actorUserId: string | null;
    metadata: Record<string, unknown>;
  }>>;
  upsertUser?(input: {
    email: string;
    displayName?: string | null;
    status?: string;
    metadata?: Record<string, unknown>;
  }): Promise<IdentityUser>;
  createTeamApiSession?(input: {
    teamId: string;
    userId: string;
    tokenHash: string;
    authSource: TeamApiAuthSource;
    expiresAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  getActiveTeamApiSessionByHash?(tokenHash: string): Promise<unknown>;
  revokeTeamApiSessionByHash?(tokenHash: string): Promise<unknown>;
  recordAuditEvent(input: {
    teamId: string;
    actorUserId?: string | null;
    action: AuditAction;
    targetType: AuditTargetType;
    targetId?: string | null;
    summary?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Client errors carry the status + machine-readable code the transport emits. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class WorkspaceRestoreError extends ApiError {
  constructor(readonly recoveryRef: string | null) {
    super(
      500,
      "workspace_restore_failed",
      "Team deletion failed and staged workspace files could not be fully restored",
    );
    this.name = "WorkspaceRestoreError";
  }
}

const MAX_TOP_K = 100;
const MAX_WORKSPACE_FILE_BYTES = 25 * 1024 * 1024;
const CLIENT_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const PUBLIC_URL_PLACEHOLDER = "https://your-team-os-server.example.com";
const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".conf",
  ".csv",
  ".env.example",
  ".gitignore",
  ".js",
  ".json",
  ".jsonl",
  ".local.md",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const TEXT_FILE_NAMES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "SKILL.md",
  "SKILL.local.md",
]);
const EXCLUDED_DIR_NAMES = new Set([
  ".AI-OS",
  ".command-centre",
  ".git",
  ".memsearch",
  ".next",
  "backups",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "transcripts",
]);
const EXCLUDED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".mcp.json",
]);
// Runtime mirrors of the types.ts unions (which are erased at compile time).
// Same pattern as scope.ts's VISIBILITY_RULES and the CLI's VALID_VISIBILITIES.
const VALID_VISIBILITIES: readonly Visibility[] = ["private", "client", "team", "system"];
const VALID_SOURCE_TYPES: readonly SourceType[] = [
  "memory",
  "learnings",
  "brand",
  "transcript",
  "session",
  "other",
];
const VALID_CONTEXT_KINDS: readonly ContextKind[] = [
  "agents",
  "user",
  "brand",
  "memory",
  "learnings",
  "preferences",
  "other",
];
const VALID_REASONS: readonly IndexJobReason[] = [
  "manual",
  "file_change",
  "session_capture",
  "refresh",
  "backfill",
];
const VALID_IMPORT_STATUSES = ["queued", "indexing", "indexed", "failed", "skipped"] as const;
const VALID_ROLES: readonly Role[] = ["owner", "admin", "member"];
const VALID_MEMBER_STATUSES: readonly MembershipStatus[] = ["active", "invited", "suspended"];
const VALID_GRANT_ACCESS: readonly GrantAccess[] = ["read", "write"];
const VALID_SKILL_PERMISSIONS: readonly SkillPermission[] = [
  "skill.use",
  "skill.read",
  "skill.edit",
  "skill.admin",
];
const VALID_SECRET_SCOPES: readonly SecretScope[] = ["team", "client"];
const VALID_AUTH_SOURCES: readonly TeamApiAuthSource[] = [
  "browser-session",
  "cli-device-token",
  "api-key",
];
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_EXPECTED_EMBEDDING_MODEL = "bge-m3";
const DEFAULT_EXPECTED_EMBEDDING_DIM = 1024;

type ManualImportStatus = (typeof VALID_IMPORT_STATUSES)[number];

interface ExpectedEmbeddingSpec {
  model: string;
  dim: number;
}

interface ParsedPreparedChunk extends PreparedIngestChunk {
  chunkKey: string | null;
}

interface ManualImportInput {
  scope: Scope;
  sourcePath: string;
  sourceType: SourceType;
  title: string | null;
  contentDate: string | null;
  authorityWeight: number | undefined;
  content: string;
  contentSha256: string;
  byteSize: number;
  embeddingModel: string;
  embeddingDim: number;
  chunks: ParsedPreparedChunk[];
  metadata: Record<string, unknown>;
  force: boolean;
}

interface ManualImportRow {
  id: string;
  team_id: string | null;
  client_id: string | null;
  user_id: string | null;
  visibility: Visibility;
  actor_user_id: string | null;
  source_path: string;
  source_type: SourceType;
  title: string | null;
  content_date: string | null;
  authority_weight: number | null;
  content: string;
  content_sha256: string;
  status: ManualImportStatus;
  attempts: number;
  source_id: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
}

interface MemoryCaptureRow {
  id: string;
  team_id: string;
  client_id: string | null;
  actor_user_id: string;
  visibility: "team" | "client";
  session_id: string;
  source_hash: string;
  source_path: string | null;
  source_type: SourceType;
  title: string | null;
  content_date: string | null;
  content: string;
  content_sha256: string;
  byte_size: number | null;
  status: "pending" | "claimed" | "processed" | "review" | "failed" | "redacted";
  sync_status: "local_pending" | "synced" | "sync_failed";
  eligible_after: string;
  claimed_batch_id: string | null;
  processed_at: string | null;
  redacted_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface MemoryConsolidationBatchRow {
  id: string;
  team_id: string;
  client_id: string | null;
  visibility: "team" | "client";
  status: "claimed" | "completed" | "failed" | "review";
  claimed_by_user_id: string | null;
  claim_token: string;
  capture_count: number;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  completed_at: string | null;
}

/** Shape an {@link ApiError} as the transport-level error body. */
export function errorResponse(error: ApiError): ApiResponse {
  return {
    status: error.status,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error instanceof WorkspaceRestoreError && error.recoveryRef
          ? { recoveryRef: error.recoveryRef }
          : {}),
      },
    },
  };
}

// ── field validators ─────────────────────────────────────────────────────────

function asRecord(value: unknown, code: string, what: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, code, `${what} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function optionalId(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  if (value == null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "invalid_scope", `scope.${key} must be a non-empty string or null`);
  }
  return value.trim();
}

function requiredString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "invalid_request", `${key} is required and must be a non-empty string`);
  }
  return value;
}

function optionalString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_request", `${key} must be a string or null`);
  }
  return value;
}

function optionalTrimmedString(raw: Record<string, unknown>, key: string): string | null {
  const value = optionalString(raw, key);
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseEnumValue<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = optionalTrimmedString(raw, key);
  if (value == null) return fallback;
  if (!allowed.includes(value as T)) {
    throw new ApiError(400, "invalid_request", `${key} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function optionalMetadata(raw: Record<string, unknown>, key = "metadata"): Record<string, unknown> {
  const value = raw[key];
  if (value == null) return {};
  return asRecord(value, "invalid_request", key);
}

function parseSourceType(raw: unknown): SourceType {
  if (raw == null) return "other";
  if (!VALID_SOURCE_TYPES.includes(raw as SourceType)) {
    throw new ApiError(
      400,
      "invalid_request",
      `sourceType must be one of ${VALID_SOURCE_TYPES.join(", ")}`,
    );
  }
  return raw as SourceType;
}

function parseContentDate(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string" || !DATE_RE.test(raw)) {
    throw new ApiError(400, "invalid_request", "contentDate must be YYYY-MM-DD");
  }
  return raw;
}

function parseAuthorityWeight(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const w = Number(raw);
  if (!Number.isFinite(w) || w <= 0) {
    throw new ApiError(400, "invalid_request", "authorityWeight must be a positive number");
  }
  return w;
}

function expectedEmbeddingSpec(deps: MemoryApiDeps): ExpectedEmbeddingSpec {
  return {
    model: deps.expectedEmbeddingModel ?? DEFAULT_EXPECTED_EMBEDDING_MODEL,
    dim: deps.expectedEmbeddingDim ?? DEFAULT_EXPECTED_EMBEDDING_DIM,
  };
}

function parseEmbeddingSpec(
  deps: MemoryApiDeps,
  body: Record<string, unknown>,
): ExpectedEmbeddingSpec {
  const expected = expectedEmbeddingSpec(deps);
  const model = requiredString(body, "embeddingModel").trim();
  const dim = Number(body.embeddingDim);
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new ApiError(400, "invalid_embedding", "embeddingDim must be a positive integer");
  }
  if (model !== expected.model || dim !== expected.dim) {
    throw new ApiError(
      400,
      "invalid_embedding",
      `expected client-provided ${expected.model}/${expected.dim} embeddings`,
    );
  }
  if (deps.store.embedDim !== expected.dim) {
    throw new ApiError(
      500,
      "invalid_embedding_store",
      `memory store dimension ${deps.store.embedDim} does not match expected ${expected.dim}`,
    );
  }
  return { model, dim };
}

async function resolveServerSearchEmbedder(
  deps: MemoryApiDeps,
): Promise<Embedder> {
  const expected = expectedEmbeddingSpec(deps);
  if (!deps.serverEmbedder) {
    throw new ApiError(
      400,
      "server_embedding_disabled",
      "server-side search embeddings are disabled; send queryEmbedding or set MEMORY_API_SERVER_EMBEDDINGS=1 on the hosted API",
    );
  }
  if (deps.store.embedDim !== expected.dim) {
    throw new ApiError(
      500,
      "invalid_embedding_store",
      `memory store dimension ${deps.store.embedDim} does not match expected ${expected.dim}`,
    );
  }
  const embedder = await deps.serverEmbedder();
  if (embedder.model !== expected.model || embedder.dim !== expected.dim) {
    throw new ApiError(
      500,
      "invalid_embedding",
      `server embedder must be ${expected.model}/${expected.dim}; got ${embedder.model}/${embedder.dim}`,
    );
  }
  return embedder;
}

function parseEmbeddingVector(
  raw: unknown,
  expectedDim: number,
  pathName: string,
): number[] {
  if (!Array.isArray(raw)) {
    throw new ApiError(400, "invalid_embedding", `${pathName} must be an array`);
  }
  if (raw.length !== expectedDim) {
    throw new ApiError(
      400,
      "invalid_embedding",
      `${pathName} must contain ${expectedDim} numbers`,
    );
  }
  return raw.map((value, index) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new ApiError(
        400,
        "invalid_embedding",
        `${pathName}[${index}] must be a finite number`,
      );
    }
    return n;
  });
}

function parseClientProvidedChunks(
  deps: MemoryApiDeps,
  body: Record<string, unknown>,
): { spec: ExpectedEmbeddingSpec; chunks: ParsedPreparedChunk[] } {
  const spec = parseEmbeddingSpec(deps, body);
  const rawChunks = body.chunks;
  if (!Array.isArray(rawChunks) || rawChunks.length === 0) {
    throw new ApiError(
      400,
      "invalid_embedding",
      "chunks with client-provided embeddings are required; the hosted Memory API does not embed content server-side",
    );
  }

  const chunks = rawChunks.map((rawChunk, index): ParsedPreparedChunk => {
    const chunk = asRecord(rawChunk, "invalid_embedding", `chunks[${index}]`);
    const content = requiredString(chunk, "content");
    const rawIndex = chunk.index ?? index;
    const chunkIndex = Number(rawIndex);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new ApiError(400, "invalid_embedding", `chunks[${index}].index must be a non-negative integer`);
    }
    const startLine = Number(chunk.startLine);
    const endLine = Number(chunk.endLine);
    if (!Number.isInteger(startLine) || startLine < 1) {
      throw new ApiError(400, "invalid_embedding", `chunks[${index}].startLine must be a positive integer`);
    }
    if (!Number.isInteger(endLine) || endLine < startLine) {
      throw new ApiError(400, "invalid_embedding", `chunks[${index}].endLine must be >= startLine`);
    }
    const tokenCount = Number(chunk.tokenCount);
    if (!Number.isInteger(tokenCount) || tokenCount < 1) {
      throw new ApiError(400, "invalid_embedding", `chunks[${index}].tokenCount must be a positive integer`);
    }
    const contentHash = optionalTrimmedString(chunk, "contentHash") ?? sha256Hex(content);
    const providedHash = optionalTrimmedString(chunk, "contentHash");
    if (providedHash && providedHash !== sha256Hex(content)) {
      throw new ApiError(400, "invalid_embedding", `chunks[${index}].contentHash does not match content`);
    }
    return {
      index: chunkIndex,
      content,
      heading: optionalString(chunk, "heading"),
      headingLevel: chunk.headingLevel == null ? null : Number(chunk.headingLevel),
      startLine,
      endLine,
      contentHash,
      chunkKey: optionalTrimmedString(chunk, "chunkKey"),
      tokenCount,
      embedding: parseEmbeddingVector(chunk.embedding, spec.dim, `chunks[${index}].embedding`),
    };
  });

  for (const [index, chunk] of chunks.entries()) {
    if (
      chunk.headingLevel != null &&
      (!Number.isInteger(chunk.headingLevel) || chunk.headingLevel < 1 || chunk.headingLevel > 6)
    ) {
      throw new ApiError(400, "invalid_embedding", `chunks[${index}].headingLevel must be in [1, 6] or null`);
    }
  }
  return { spec, chunks };
}

function parseContentSha256AndByteSize(
  body: Record<string, unknown>,
): { content: string | null; contentSha256: string; byteSize: number } {
  const content = optionalString(body, "content");
  const rawSha = optionalTrimmedString(body, "contentSha256");
  if (!rawSha && content == null) {
    throw new ApiError(
      400,
      "invalid_request",
      "contentSha256 is required when content is not sent",
    );
  }
  const contentSha256 = rawSha ?? sha256Hex(content ?? "");
  if (!/^[a-f0-9]{64}$/i.test(contentSha256)) {
    throw new ApiError(400, "invalid_request", "contentSha256 must be a SHA-256 hex digest");
  }
  const byteSize = body.byteSize == null
    ? Buffer.byteLength(content ?? "", "utf-8")
    : Number(body.byteSize);
  if (!Number.isInteger(byteSize) || byteSize < 0) {
    throw new ApiError(400, "invalid_request", "byteSize must be a non-negative integer");
  }
  if (content != null && contentSha256 !== sha256Hex(content)) {
    throw new ApiError(400, "invalid_request", "contentSha256 does not match content");
  }
  return { content, contentSha256, byteSize };
}

function parseIsoTimestamp(raw: unknown, field: string): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
    throw new ApiError(400, "invalid_request", `${field} must be an ISO timestamp`);
  }
  return raw;
}

function parsePositiveInt(raw: unknown, field: string, fallback: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(400, "invalid_request", `${field} must be a positive integer`);
  }
  return Math.min(n, max);
}

function parseCaptureScopeFromBody(rawScope: unknown): Scope {
  const scope = buildIngestScopeFromBody(rawScope);
  if (scope.visibility !== "team" && scope.visibility !== "client") {
    throw new ApiError(400, "invalid_scope", "capture staging accepts only team or client visibility");
  }
  return scope;
}

function parseCaptureIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError(400, "invalid_request", "captureIds must be a non-empty array");
  }
  const ids = raw.map((value, index) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ApiError(400, "invalid_request", `captureIds[${index}] must be a non-empty string`);
    }
    return value.trim();
  });
  return [...new Set(ids)];
}

function pgArrayLiteral(values: string[]): string {
  const escaped = values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${escaped.join(",")}}`;
}

function grantAccessMeets(held: GrantAccess, required: GrantAccess): boolean {
  return held === "write" || required === "read";
}

function normalizePublicBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function getPublicBaseUrl(context: MemoryApiRequestContext = {}): string {
  return (
    normalizePublicBaseUrl(process.env.MEMORY_API_PUBLIC_URL) ??
    normalizePublicBaseUrl(process.env.TEAM_OS_PUBLIC_URL) ??
    normalizePublicBaseUrl(context.publicBaseUrl) ??
    normalizePublicBaseUrl(process.env.BETTER_AUTH_URL) ??
    PUBLIC_URL_PLACEHOLDER
  );
}

function buildHostedUrl(
  context: MemoryApiRequestContext,
  pathname: string,
  params: Record<string, string>,
): string {
  const url = new URL(pathname, `${getPublicBaseUrl(context)}/`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

async function createClientWithGeneratedSlug(
  deps: MemoryApiDeps,
  teamId: string,
  name: string,
): Promise<IdentityClient> {
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = suggestClientSlug(name, attempt);
    if (clientSlugValidationError(candidate)) continue;
    const created = await deps.identityStore!.createClient!({
      teamId,
      slug: candidate,
      name,
    });
    if (created) return created;
  }
  throw new ApiError(409, "conflict", "could not generate a unique client slug");
}

function scopeForAudit(scope: SearchScope | Scope): Record<string, unknown> {
  const out: Record<string, unknown> = { teamId: scope.teamId };
  if ("visibility" in scope) out.visibility = scope.visibility;
  if (scope.clientId != null) out.clientId = scope.clientId;
  if (scope.userId != null) out.userId = scope.userId;
  if ("include" in scope && scope.include != null) out.include = scope.include;
  return out;
}

async function recordDeniedAccess(
  deps: MemoryApiDeps,
  action: "access.denied_search" | "access.denied_ingest",
  principal: MemoryApiPrincipal,
  targetType: "team" | "client",
  targetId: string | null,
  reason: string,
  requestedScope: SearchScope | Scope,
): Promise<void> {
  if (!deps.identityStore) return;
  await deps.identityStore.recordAuditEvent({
    teamId: principal.teamId,
    actorUserId: principal.userId,
    action,
    targetType,
    targetId,
    summary: `${action} denied: ${reason}`,
    metadata: {
      reason,
      requestedScope: scopeForAudit(requestedScope),
      authSource: principal.authSource ?? null,
    },
  });
}

async function assertActivePrincipal(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  action: "access.denied_search" | "access.denied_ingest",
  requestedScope: SearchScope | Scope,
): Promise<IdentityMembership | null> {
  if (!deps.identityStore) return null;
  const runtimeStore = deps.identityStore as unknown as Record<string, unknown>;
  const supportsCompanyAccess =
    typeof runtimeStore.getTeam === "function" &&
    typeof runtimeStore.getCompanyMembership === "function" &&
    typeof runtimeStore.getActiveCompanyTeamAccessGrant === "function";
  const directMembership = await deps.identityStore.getMembership(principal.teamId, principal.userId);
  const access: EffectiveTeamAccess | null = supportsCompanyAccess
    ? await resolveEffectiveTeamAccess(
        deps.identityStore as unknown as IdentityStore,
        principal.teamId,
        principal.userId,
      )
    : directMembership?.status === "active"
      ? {
          companyRole: null,
          source: "membership" as const,
          effectiveRole: (
            directMembership.role === "owner" || directMembership.role === "admin"
              ? directMembership.role
              : "member"
          ) as EffectiveTeamAccess["effectiveRole"],
          fullAccess: directMembership.role === "owner" || directMembership.role === "admin",
          protected: false,
          membership: directMembership as EffectiveTeamAccess["membership"],
          companyMembership: null,
          grant: null,
        }
      : null;
  principal.access = access;
  if (!access) {
    await recordDeniedAccess(deps, action, principal, "team", principal.teamId, "inactive_team_access", requestedScope);
    throw new ApiError(403, "forbidden", "active team access is required");
  }
  return access.membership ?? {
    teamId: principal.teamId,
    userId: principal.userId,
    status: "active",
    role: access.effectiveRole,
  };
}

function hasSharedIngestAuthority(membership: IdentityMembership | null): boolean {
  return membership?.role === "owner" || membership?.role === "admin";
}

/**
 * A revoked grant and a never-granted client used to surface as the same 404
 * "client not found" — indistinguishable to the caller. If the user has no
 * active grant at all, and a grant row for them was explicitly revoked, that
 * row proves they already knew the client existed, so it's safe to say
 * "revoked" instead of falling back to the not-found anti-oracle. An active
 * grant that's merely insufficient for the requested access (e.g. read
 * trying to write) stays a plain 404, same as never-granted — otherwise a
 * read-only user could tell a secret file exists just by being denied
 * differently than for a nonexistent one.
 */
async function resolveClientGrantOrThrow(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  client: IdentityClient,
  required: GrantAccess,
  onDenied: (reason: string) => Promise<void>,
): Promise<IdentityGrant> {
  const active = await deps.identityStore!.getActiveGrant(principal.teamId, client.id, principal.userId);
  if (active && active.status === "active" && grantAccessMeets(active.access, required)) {
    return active;
  }

  if (!active) {
    const history = deps.identityStore!.listGrants
      ? await deps.identityStore!.listGrants({ teamId: principal.teamId, clientId: client.id, userId: principal.userId })
      : [];
    if (history.some((row) => row.status !== "active")) {
      await onDenied("revoked_client_grant");
      throw new ApiError(403, "access_revoked", "your access to this client was revoked");
    }
  }
  await onDenied("missing_client_grant");
  throw new ApiError(404, "not_found", "client not found");
}

async function requireClientGrantForMemory(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  requestedScope: SearchScope | Scope,
  action: "access.denied_search" | "access.denied_ingest",
  clientSlug: string | null | undefined,
  required: GrantAccess,
): Promise<IdentityClient> {
  if (!deps.identityStore) {
    throw new ApiError(500, "internal", "identity store is required for client authorization");
  }
  if (!clientSlug) {
    await recordDeniedAccess(deps, action, principal, "team", principal.teamId, "missing_client_scope", requestedScope);
    throw new ApiError(400, "invalid_scope", "client scope requires scope.clientId");
  }

  const client = await deps.identityStore.getClientBySlug(principal.teamId, clientSlug);
  if (!client) {
    await recordDeniedAccess(deps, action, principal, "team", principal.teamId, "unknown_client", requestedScope);
    throw new ApiError(404, "not_found", "client not found");
  }
  if (client.status && client.status !== "active") {
    await recordDeniedAccess(deps, action, principal, "client", client.id, "inactive_client", requestedScope);
    throw new ApiError(404, "not_found", "client not found");
  }

  const membership = await deps.identityStore.getMembership(principal.teamId, principal.userId);
  if (hasFullTeamAccess(principal, membership)) {
    return client;
  }

  await resolveClientGrantOrThrow(deps, principal, client, required, async (reason) => {
    await recordDeniedAccess(deps, action, principal, "client", client.id, reason, requestedScope);
  });

  return client;
}

async function authorizeSearchScope(
  deps: MemoryApiDeps,
  requestedScope: SearchScope,
  context: MemoryApiRequestContext,
): Promise<SearchScope> {
  if (!deps.identityStore) return requestedScope;

  const principal = context.principal ?? null;
  if (!principal) {
    throw new ApiError(401, "unauthorized", "authenticated principal is required");
  }

  await assertActivePrincipal(deps, principal, "access.denied_search", requestedScope);

  const include = requestedScope.include ?? ["system"];
  let clientSlug: string | null = null;
  if (include.includes("client")) {
    const client = await requireClientGrantForMemory(
      deps,
      principal,
      requestedScope,
      "access.denied_search",
      requestedScope.clientId,
      "read",
    );
    clientSlug = client.slug;
  }

  return {
    teamId: principal.teamId,
    clientId: clientSlug,
    userId: include.includes("private") ? principal.userId : null,
    include,
  };
}

async function authorizeIngestScope(
  deps: MemoryApiDeps,
  requestedScope: Scope,
  context: MemoryApiRequestContext,
): Promise<Scope> {
  if (!deps.identityStore) return requestedScope;

  const principal = context.principal ?? null;
  if (!principal) {
    throw new ApiError(401, "unauthorized", "authenticated principal is required");
  }

  const membership = await assertActivePrincipal(
    deps,
    principal,
    "access.denied_ingest",
    requestedScope,
  );

  if (requestedScope.visibility === "client") {
    const client = await requireClientGrantForMemory(
      deps,
      principal,
      requestedScope,
      "access.denied_ingest",
      requestedScope.clientId,
      "write",
    );
    return {
      teamId: principal.teamId,
      clientId: client.slug,
      userId: null,
      visibility: "client",
    };
  }

  if (requestedScope.visibility === "private") {
    return {
      teamId: principal.teamId,
      clientId: null,
      userId: principal.userId,
      visibility: "private",
    };
  }

  if (
    (requestedScope.visibility === "team" || requestedScope.visibility === "system") &&
    !hasSharedIngestAuthority(membership)
  ) {
    await recordDeniedAccess(
      deps,
      "access.denied_ingest",
      principal,
      "team",
      principal.teamId,
      "shared_scope_requires_admin",
      requestedScope,
    );
    throw new ApiError(403, "forbidden", "shared memory ingest requires admin access");
  }

  return {
    teamId: principal.teamId,
    clientId: null,
    userId: null,
    visibility: requestedScope.visibility,
  };
}

async function authorizeCaptureScope(
  deps: MemoryApiDeps,
  requestedScope: Scope,
  context: MemoryApiRequestContext,
): Promise<{ principal: MemoryApiPrincipal | null; membership: IdentityMembership | null; scope: Scope }> {
  if (!deps.identityStore) {
    return { principal: null, membership: null, scope: requestedScope };
  }

  const principal = context.principal ?? null;
  if (!principal) {
    throw new ApiError(401, "unauthorized", "authenticated principal is required");
  }

  const membership = await assertActivePrincipal(
    deps,
    principal,
    "access.denied_ingest",
    requestedScope,
  );

  if (requestedScope.visibility === "client") {
    const client = await requireClientGrantForMemory(
      deps,
      principal,
      requestedScope,
      "access.denied_ingest",
      requestedScope.clientId,
      "write",
    );
    return {
      principal,
      membership,
      scope: {
        teamId: principal.teamId,
        clientId: client.slug,
        userId: null,
        visibility: "client",
      },
    };
  }

  if (requestedScope.visibility !== "team") {
    throw new ApiError(400, "invalid_scope", "capture staging accepts only team or client visibility");
  }

  return {
    principal,
    membership,
    scope: {
      teamId: principal.teamId,
      clientId: null,
      userId: null,
      visibility: "team",
    },
  };
}

async function authorizeConsolidatedMemoryScope(
  deps: MemoryApiDeps,
  requestedScope: Scope,
  context: MemoryApiRequestContext,
): Promise<{ principal: MemoryApiPrincipal | null; scope: Scope }> {
  if (!deps.identityStore) return { principal: null, scope: requestedScope };

  const principal = context.principal ?? null;
  if (!principal) {
    throw new ApiError(401, "unauthorized", "authenticated principal is required");
  }

  await assertActivePrincipal(deps, principal, "access.denied_ingest", requestedScope);

  if (requestedScope.visibility === "client") {
    const client = await requireClientGrantForMemory(
      deps,
      principal,
      requestedScope,
      "access.denied_ingest",
      requestedScope.clientId,
      "write",
    );
    return {
      principal,
      scope: {
        teamId: principal.teamId,
        clientId: client.slug,
        userId: null,
        visibility: "client",
      },
    };
  }

  if (requestedScope.visibility !== "team") {
    throw new ApiError(400, "invalid_scope", "consolidated memory accepts only team or client visibility");
  }

  return {
    principal,
    scope: {
      teamId: principal.teamId,
      clientId: null,
      userId: null,
      visibility: "team",
    },
  };
}

async function requireManualImportAdmin(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext,
  requestedScope: SearchScope | Scope,
): Promise<MemoryApiPrincipal | null> {
  if (!deps.identityStore) return null;

  const principal = context.principal ?? null;
  if (!principal) {
    throw new ApiError(401, "unauthorized", "authenticated principal is required");
  }

  const membership = await assertActivePrincipal(
    deps,
    principal,
    "access.denied_ingest",
    requestedScope,
  );
  if (!hasSharedIngestAuthority(membership)) {
    await recordDeniedAccess(
      deps,
      "access.denied_ingest",
      principal,
      "team",
      principal.teamId,
      "manual_import_requires_admin",
      requestedScope,
    );
    throw new ApiError(403, "forbidden", "manual shared imports require admin access");
  }
  return principal;
}

async function requireMemoryManagementAdmin(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext,
  requestedScope: SearchScope | Scope,
): Promise<MemoryApiPrincipal | null> {
  if (!deps.identityStore) return null;

  const principal = context.principal ?? null;
  if (!principal) {
    throw new ApiError(401, "unauthorized", "authenticated principal is required");
  }

  const membership = await assertActivePrincipal(
    deps,
    principal,
    "access.denied_ingest",
    requestedScope,
  );
  if (!hasSharedIngestAuthority(membership)) {
    await recordDeniedAccess(
      deps,
      "access.denied_ingest",
      principal,
      "team",
      principal.teamId,
      "memory_management_requires_admin",
      requestedScope,
    );
    throw new ApiError(403, "forbidden", "memory management requires admin access");
  }
  return principal;
}

async function authorizeManualImportScope(
  deps: MemoryApiDeps,
  requestedScope: Scope,
  context: MemoryApiRequestContext,
): Promise<{ principal: MemoryApiPrincipal | null; scope: Scope }> {
  if (requestedScope.visibility !== "team" && requestedScope.visibility !== "client") {
    throw new ApiError(
      400,
      "invalid_scope",
      "manual imports publish only shared team or client memory",
    );
  }

  const principal = await requireManualImportAdmin(deps, context, requestedScope);
  if (!deps.identityStore || !principal) {
    return { principal: null, scope: requestedScope };
  }

  if (requestedScope.visibility === "client") {
    if (!requestedScope.clientId) {
      await recordDeniedAccess(
        deps,
        "access.denied_ingest",
        principal,
        "team",
        principal.teamId,
        "missing_client_scope",
        requestedScope,
      );
      throw new ApiError(400, "invalid_scope", "client scope requires scope.clientId");
    }
    const client = await deps.identityStore.getClientBySlug(
      principal.teamId,
      requestedScope.clientId,
    );
    if (!client || (client.status && client.status !== "active")) {
      await recordDeniedAccess(
        deps,
        "access.denied_ingest",
        principal,
        "team",
        principal.teamId,
        "unknown_client",
        requestedScope,
      );
      throw new ApiError(404, "not_found", "client not found");
    }
    return {
      principal,
      scope: {
        teamId: principal.teamId,
        clientId: client.slug,
        userId: null,
        visibility: "client",
      },
    };
  }

  return {
    principal,
    scope: {
      teamId: principal.teamId,
      clientId: null,
      userId: null,
      visibility: requestedScope.visibility,
    },
  };
}

async function requireTeamApiPrincipal(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext,
): Promise<MemoryApiPrincipal> {
  if (!deps.identityStore) {
    throw new ApiError(500, "internal", "identity store is required for Team API routes");
  }
  const principal = context.principal ?? null;
  if (!principal) {
    throw new ApiError(401, "unauthorized", "authenticated principal is required");
  }
  await assertActivePrincipal(deps, principal, "access.denied_search", {
    teamId: principal.teamId,
    clientId: null,
    userId: principal.userId,
    include: ["team"],
  });
  return principal;
}

async function requireAdminPrincipal(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext,
): Promise<MemoryApiPrincipal> {
  const principal = await requireTeamApiPrincipal(deps, context);
  const membership = principal.access?.membership
    ?? await deps.identityStore!.getMembership(principal.teamId, principal.userId);
  if (!hasFullTeamAccess(principal, membership)) {
    throw new ApiError(403, "forbidden", "owner or admin role is required");
  }
  return principal;
}

function authErrorResponse(error: unknown): ApiResponse | null {
  if (error instanceof ApiError) return errorResponse(error);
  if (error instanceof TeamAuthError) {
    return errorResponse(new ApiError(error.status, error.code, error.message));
  }
  if (error instanceof InvalidInviteError) {
    return errorResponse(new ApiError(400, "invalid_invite", error.message));
  }
  if (error instanceof PermissionError) {
    return errorResponse(new ApiError(403, "forbidden", error.message));
  }
  return null;
}

function shapeSessionResult(result: {
  token: string;
  expiresAt: string;
  authSource: TeamApiAuthSource;
  user: IdentityUser;
  team: IdentityTeam | null;
  membership: IdentityMembership | null;
  companyMembership?: CompanyMembershipRow | null;
  access?: EffectiveTeamAccess | null;
}, serverId: string | null, pendingAccessRequestCount = 0): Record<string, unknown> {
  return {
    token: result.token,
    expiresAt: result.expiresAt,
    authSource: result.authSource,
    user: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.displayName ?? null,
    },
    team: result.team ? {
      id: result.team.id,
      slug: result.team.slug,
      name: result.team.name,
    } : null,
    membership: result.membership ? {
      id: result.membership.id ?? null,
      role: result.membership.role ?? null,
      status: result.membership.status ?? null,
    } : null,
    companyMembership: shapeCompanyMembership(result.companyMembership ?? null),
    access: shapeEffectiveTeamAccess(result.access ?? null),
    pendingAccessRequestCount,
    server: { id: serverId },
    defaultTeamId: result.team?.id ?? null,
  };
}

function shapeCompanyMembership(
  membership: CompanyMembershipRow | null | undefined,
): Record<string, unknown> | null {
  if (!membership || membership.status !== "active") return null;
  return {
    id: membership.id,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
  };
}

function shapeEffectiveTeamAccess(
  access: EffectiveTeamAccess | null | undefined,
): Record<string, unknown> | null {
  if (!access) return null;
  return {
    companyRole: access.companyRole,
    source: access.source,
    effectiveRole: access.effectiveRole,
    fullAccess: access.fullAccess,
    protected: access.protected,
    membership: access.membership ? {
      id: access.membership.id,
      role: access.membership.role,
      status: access.membership.status,
    } : null,
  };
}

async function pendingAccessRequestCount(
  store: IdentityStore,
  userId: string,
  companyMembership: CompanyMembershipRow | null | undefined,
): Promise<number> {
  if (!companyMembership || companyMembership.status !== "active") return 0;
  const requests = await store.listCompanyAccessRequests({
    status: "pending",
    ...(companyMembership.role === "owner" ? {} : { userId }),
  });
  return requests.length;
}

async function readServerId(deps: MemoryApiDeps): Promise<string | null> {
  const identity = await deps.identityStore?.getServerIdentity?.();
  return identity?.serverId ?? null;
}

export async function handleTeamLoginRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
): Promise<ApiResponse> {
  try {
    if (!deps.identityStore) {
      throw new ApiError(500, "internal", "identity store is required for Team OS login");
    }
    const raw = asRecord(rawBody, "invalid_request", "body");
    const authSource = parseEnumValue(
      raw,
      "authSource",
      VALID_AUTH_SOURCES,
      "browser-session",
    );
    const result = await authenticateTeamLogin(deps.identityStore as never, {
      email: requiredString(raw, "email"),
      password: requiredString(raw, "password"),
      team: optionalTrimmedString(raw, "team"),
      authSource,
    });
    const store = deps.identityStore as unknown as IdentityStore;
    return {
      status: 200,
      body: shapeSessionResult(
        result,
        await readServerId(deps),
        await pendingAccessRequestCount(store, result.user.id, result.companyMembership),
      ),
    };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleTeamJoinRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
): Promise<ApiResponse> {
  try {
    if (!deps.identityStore) {
      throw new ApiError(500, "internal", "identity store is required for Team OS join");
    }
    const store = deps.identityStore as never;
    const raw = asRecord(rawBody, "invalid_request", "body");
    const teamRef = requiredString(raw, "team").trim();
    const email = requiredString(raw, "email").trim();
    const team = teamRef.match(/^[0-9a-f-]{36}$/i)
      ? await deps.identityStore.getTeam?.(teamRef)
      : await deps.identityStore.getTeamBySlug?.(teamRef);
    if (!team) throw new ApiError(404, "not_found", "team not found");

    const invitedUser = await deps.identityStore.getUserByEmail?.(email);
    const pendingMembership = invitedUser
      ? await (deps.identityStore as unknown as IdentityStore).getMembership(team.id, invitedUser.id)
      : null;
    const recoveringCredential = pendingMembership?.status === "invited" &&
      pendingMembership.metadata?._inviteCredentialReady === true;
    if (
      invitedUser &&
      (
        await hasProtectedCredentialAuthority(deps, team.id, invitedUser.id) ||
        (!recoveringCredential && await hasUsablePlatformCredential(deps.identityStore as never, email))
      )
    ) {
      // Keep the public response generic. Most importantly, reject before the
      // invite is consumed or any password mutation is attempted.
      throw new ApiError(400, "invalid_invite", "invitation is invalid or expired");
    }
    const password = requiredString(raw, "password");
    if (password.length < 8) {
      throw new ApiError(400, "invalid_request", "password must be at least 8 characters");
    }
    const authSource = parseEnumValue(
      raw,
      "authSource",
      VALID_AUTH_SOURCES,
      "browser-session",
    );
    const displayName = optionalTrimmedString(raw, "displayName");

    const membership = await acceptInviteWithCredential(
      store,
      {
        teamId: team.id,
        email,
        token: requiredString(raw, "token").trim(),
      },
      async (claimedUser) => {
        let credentialUser = claimedUser;
        if (displayName && deps.identityStore!.upsertUser) {
          credentialUser = await deps.identityStore!.upsertUser({
            email,
            displayName,
            status: claimedUser.status,
            metadata: claimedUser.metadata,
          }) as never;
        }
        await setUserPassword(store, credentialUser as never, password);
      },
    );
    const user = await deps.identityStore.getUserByEmail?.(email);
    if (!user) throw new ApiError(500, "internal", "joined user could not be loaded");
    const result = await createTeamSessionForUser(store, {
      user: user as never,
      team: team as never,
      membership: membership as never,
      authSource,
    });
    return { status: 200, body: shapeSessionResult(result, await readServerId(deps)) };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleTeamPasswordResetRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
): Promise<ApiResponse> {
  try {
    if (!deps.identityStore) {
      throw new ApiError(500, "internal", "identity store is required for password reset");
    }
    const raw = asRecord(rawBody, "invalid_request", "body");
    await resetPasswordWithToken(
      deps.identityStore as never,
      requiredString(raw, "token"),
      requiredString(raw, "password"),
    );
    return { status: 200, body: { ok: true } };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleTeamLogoutRequest(
  deps: MemoryApiDeps,
  token: string,
): Promise<ApiResponse> {
  if (!deps.identityStore) {
    return { status: 200, body: { ok: true } };
  }
  await revokeTeamAuthToken(deps.identityStore as never, token);
  return { status: 200, body: { ok: true } };
}

export async function handleTeamWhoamiRequest(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireTeamApiPrincipal(deps, context);
    const membership = principal.access?.membership
      ?? await deps.identityStore!.getMembership(principal.teamId, principal.userId);
    const runtimeStore = deps.identityStore as unknown as Record<string, unknown>;
    const companyMembership = typeof runtimeStore.getCompanyMembership === "function"
      ? await (deps.identityStore as unknown as IdentityStore).getCompanyMembership(principal.userId)
      : null;
    const team = deps.identityStore!.getTeam
      ? await deps.identityStore!.getTeam(principal.teamId)
      : null;
    const user = deps.identityStore!.getUserById
      ? await deps.identityStore!.getUserById(principal.userId)
      : null;

    return {
      status: 200,
      body: {
        user: {
          id: principal.userId,
          email: user?.email ?? null,
          displayName: user?.displayName ?? null,
        },
        team: {
          id: principal.teamId,
          slug: team?.slug ?? null,
          name: team?.name ?? null,
        },
        membership: {
          id: membership?.id ?? null,
          role: membership?.role ?? null,
          status: membership?.status ?? null,
        },
        companyMembership: shapeCompanyMembership(companyMembership),
        access: shapeEffectiveTeamAccess(principal.access),
        authSource: principal.authSource ?? null,
        server: { id: await readServerId(deps) },
        teamScopeSource: principal.teamScopeSource ?? null,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleTeamMembershipsRequest(
  deps: MemoryApiDeps,
  userPrincipal: MemoryApiUserPrincipal,
): Promise<ApiResponse> {
  try {
    if (!deps.identityStore) {
      throw new ApiError(500, "internal", "identity store is required for Team OS memberships");
    }
    const store = deps.identityStore as unknown as IdentityStore;
    const runtimeStore = deps.identityStore as unknown as Record<string, unknown>;
    const supportsCompanyAccess =
      typeof runtimeStore.listTeams === "function" &&
      typeof runtimeStore.getCompanyMembership === "function" &&
      typeof runtimeStore.getActiveCompanyTeamAccessGrant === "function";
    const user = await store.getUserById(userPrincipal.userId);
    if (!user || (user.status && user.status !== "active")) {
      throw new ApiError(401, "unauthorized", "missing or invalid bearer token");
    }

    const companyMembership = supportsCompanyAccess
      ? await store.getCompanyMembership(userPrincipal.userId)
      : null;
    const teams: Array<Record<string, unknown>> = [];
    if (supportsCompanyAccess) {
      for (const team of await store.listTeams()) {
        const access = await resolveEffectiveTeamAccess(store, team.id, userPrincipal.userId);
        if (!access) continue;
        teams.push({
          id: team.id,
          slug: team.slug,
          name: team.name,
          membership: access.membership ? {
            id: access.membership.id,
            role: access.membership.role,
            status: access.membership.status,
          } : null,
          access: shapeEffectiveTeamAccess(access),
        });
      }
    } else {
      for (const membership of await deps.identityStore.listMembershipsForUser?.(userPrincipal.userId) ?? []) {
        if (membership.status !== "active" || !membership.teamId) continue;
        const team = await deps.identityStore.getTeam?.(membership.teamId);
        if (!team || team.status === "archived") continue;
        teams.push({
          id: team.id,
          slug: team.slug,
          name: team.name,
          membership: {
            id: membership.id ?? null,
            role: membership.role ?? null,
            status: membership.status,
          },
          access: {
            companyRole: null,
            source: "membership",
            effectiveRole: membership.role ?? "member",
            fullAccess: membership.role === "owner" || membership.role === "admin",
            protected: false,
            membership: {
              id: membership.id ?? null,
              role: membership.role ?? null,
              status: membership.status,
            },
          },
        });
      }
    }

    const activeIds = new Set(teams.map((team) => String(team.id)));
    const defaultTeamId = userPrincipal.legacyTeamId && activeIds.has(userPrincipal.legacyTeamId)
      ? userPrincipal.legacyTeamId
      : teams.length ? String(teams[0].id) : null;
    return {
      status: 200,
      body: {
        server: { id: await readServerId(deps) },
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName ?? null,
        },
        companyMembership: shapeCompanyMembership(companyMembership),
        pendingAccessRequestCount: supportsCompanyAccess
          ? await pendingAccessRequestCount(store, userPrincipal.userId, companyMembership)
          : 0,
        teams,
        defaultTeamId,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

// ── Company administration ──────────────────────────────────────────────────

const COMPANY_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TEAM_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

async function requireCompanyActor(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext,
): Promise<{
  store: IdentityStore;
  user: Awaited<ReturnType<IdentityStore["getUserById"]>> & {};
  membership: CompanyMembershipRow;
}> {
  if (!deps.identityStore) {
    throw new ApiError(500, "internal", "identity store is required for Company routes");
  }
  const userId = context.userPrincipal?.userId ?? context.principal?.userId ?? null;
  if (!userId) throw new ApiError(401, "unauthorized", "authenticated user is required");
  const store = deps.identityStore as unknown as IdentityStore;
  const [user, membership] = await Promise.all([
    store.getUserById(userId),
    store.getCompanyMembership(userId),
  ]);
  if (!user || user.status !== "active") {
    throw new ApiError(401, "unauthorized", "authenticated user is inactive");
  }
  if (!membership || membership.status !== "active") {
    throw new ApiError(403, "forbidden", "Company Owner or Company Admin role is required");
  }
  return { store, user, membership };
}

function requireCompanyOwner(membership: CompanyMembershipRow): void {
  if (membership.role !== "owner") {
    throw new ApiError(403, "forbidden", "Company Owner role is required");
  }
}

const COMPANY_BAD_REQUEST_MESSAGES = new Set([
  "Team name confirmation does not match",
  "Team name is required",
  "Team Owner must be an active user",
  "Team Owner replacement role must be member or admin",
  "Team member role must be member or admin",
  "Team slug is invalid",
  "an active user is required for Company access",
  "initial Team Owner must be an active user",
  "new Company Owner must be a different user",
]);

const COMPANY_FORBIDDEN_MESSAGES = new Set([
  "Company Owner role is required",
  "Company role is required",
  "Full access to Team is required",
  "active Company role is required",
  "current Company Owner must perform the transfer",
  "request owner or Company Owner is required",
]);

const COMPANY_CONFLICT_MESSAGES = new Set([
  "Company Admin membership is required",
  "Company Admin membership changed while it was being promoted",
  "Company Admin promotion requires an active user",
  "Company Admin removal must use removeCompanyAdmin",
  "Company Owner cannot be promoted to Company Admin",
  "Company Owner can only be assigned through recovery or ownership transfer",
  "Company Ownership can only change through transferCompanyOwnership",
  "Team must be archived before permanent deletion",
  "Team must be archived for 30 days before deletion",
  "active Company Admin role is required",
  "active Company Admins can only be removed through removeCompanyAdmin",
  "active Company Owner was not found",
  "active Team is required",
  "an active Company Owner already exists",
  "at least one active Team Owner is required",
  "Company-protected access cannot be replaced by a Team membership",
  "ownership can only transfer between active users",
  "ownership can only transfer to an active Company Admin",
  "Team member already has an active or invited membership",
  "Team member must be an active user",
  "Team membership changed while it was being added",
  "user is already an active or invited Company Admin",
]);

/** Convert only known, user-correctable Company store failures to API errors. */
function companyOperationErrorResponse(error: unknown): ApiResponse | null {
  const knownResponse = authErrorResponse(error);
  if (knownResponse) return knownResponse;
  if (!(error instanceof Error)) return null;

  if (COMPANY_BAD_REQUEST_MESSAGES.has(error.message)) {
    return errorResponse(new ApiError(400, "invalid_request", error.message));
  }
  if (COMPANY_FORBIDDEN_MESSAGES.has(error.message)) {
    return errorResponse(new ApiError(403, "forbidden", error.message));
  }
  if (COMPANY_CONFLICT_MESSAGES.has(error.message)) {
    return errorResponse(new ApiError(409, "conflict", error.message));
  }
  if (error.message === "Team not found") {
    return errorResponse(new ApiError(404, "not_found", "team not found"));
  }

  const databaseCode = "code" in error ? String((error as Error & { code?: unknown }).code ?? "") : "";
  if (databaseCode === "23505") {
    return errorResponse(new ApiError(409, "conflict", "Company operation conflicts with existing state"));
  }
  if (databaseCode === "23503") {
    return errorResponse(new ApiError(400, "invalid_request", "Company operation references an invalid record"));
  }
  if (databaseCode === "22P02" || isInvalidUserIdLookupError(error)) {
    return errorResponse(new ApiError(400, "invalid_request", "Company operation contains an invalid id"));
  }
  return null;
}

interface StagedTeamWorkspaceDirectory {
  originalPath: string;
  stagedPath: string;
}

interface StagedTeamWorkspacePurge {
  stagingRoot: string | null;
  recoveryRef: string | null;
  staged: StagedTeamWorkspaceDirectory[];
  files: number;
  clientDirectories: number;
  sharedClientDirectoriesSkipped: number;
  unsafeClientDirectoriesSkipped: number;
}

function emptyTeamWorkspacePurge(): StagedTeamWorkspacePurge {
  return {
    stagingRoot: null,
    recoveryRef: null,
    staged: [],
    files: 0,
    clientDirectories: 0,
    sharedClientDirectoriesSkipped: 0,
    unsafeClientDirectoriesSkipped: 0,
  };
}

async function lstatOrNull(fullPath: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.lstat(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isContainedPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function countFilesWithoutFollowingLinks(directory: string): Promise<number> {
  let count = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      count += await countFilesWithoutFollowingLinks(fullPath);
    } else {
      // Symlinks and other non-directory entries count as one active workspace
      // item. We never follow them, so a link cannot expand the purge boundary.
      count += 1;
    }
  }
  return count;
}

/**
 * Move provably Team-owned client directories out of the active workspace.
 *
 * Files under root brand_context/ and .claude/skills are company-shared and are
 * intentionally untouched. A clients/{slug} directory is staged only when the
 * database confirms that no other Team uses that case-insensitive slug. The
 * move happens before the DB transaction; a failed DB deletion restores every
 * staged directory.
 */
async function stageTeamWorkspacePurge(
  deps: MemoryApiDeps,
  store: IdentityStore,
  teamId: string,
): Promise<StagedTeamWorkspacePurge> {
  const purge = emptyTeamWorkspacePurge();
  if (!deps.workspaceRoot) return purge;

  const configuredRoot = path.resolve(deps.workspaceRoot);
  const rootStat = await lstatOrNull(configuredRoot);
  if (!rootStat || !rootStat.isDirectory()) return purge;
  const realRoot = await fs.realpath(configuredRoot);
  const clientsRoot = path.join(realRoot, "clients");
  const clientsRootStat = await lstatOrNull(clientsRoot);
  if (!clientsRootStat) return purge;
  const clients = await store.listClients(teamId);
  if (!clientsRootStat.isDirectory() || clientsRootStat.isSymbolicLink()) {
    // A reparse point could lead outside the configured workspace. Nothing
    // beneath it is safe to attribute or remove.
    purge.unsafeClientDirectoriesSkipped = clients.length;
    return purge;
  }

  const realClientsRoot = await fs.realpath(clientsRoot);
  if (!isContainedPath(realRoot, realClientsRoot)) {
    purge.unsafeClientDirectoriesSkipped = clients.length;
    return purge;
  }

  const candidates: Array<{ source: string; slug: string; files: number }> = [];
  const seen = new Set<string>();
  for (const client of clients) {
    if (!CLIENT_SLUG_RE.test(client.slug)) {
      purge.unsafeClientDirectoriesSkipped += 1;
      continue;
    }
    const source = path.resolve(realClientsRoot, client.slug);
    const relative = path.relative(realClientsRoot, source);
    if (
      !isContainedPath(realClientsRoot, source) ||
      relative.includes(path.sep)
    ) {
      purge.unsafeClientDirectoriesSkipped += 1;
      continue;
    }
    const sourceKey = process.platform === "win32" ? source.toLowerCase() : source;
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);

    const sourceStat = await lstatOrNull(source);
    if (!sourceStat) continue;
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      purge.unsafeClientDirectoriesSkipped += 1;
      continue;
    }
    const realSource = await fs.realpath(source);
    if (!isContainedPath(realClientsRoot, realSource)) {
      purge.unsafeClientDirectoriesSkipped += 1;
      continue;
    }
    if (!await store.isClientWorkspaceSlugExclusiveToTeam(teamId, client.slug)) {
      purge.sharedClientDirectoriesSkipped += 1;
      continue;
    }
    candidates.push({
      source,
      slug: client.slug,
      files: await countFilesWithoutFollowingLinks(source),
    });
  }

  if (candidates.length === 0) return purge;
  const recoveryRef = crypto.randomUUID();
  const stagingRoot = path.join(realRoot, `.team-os-purge-${recoveryRef}`);
  if (!isContainedPath(realRoot, stagingRoot)) {
    throw new ApiError(500, "workspace_purge_failed", "workspace purge staging path is unsafe");
  }
  await fs.mkdir(path.join(stagingRoot, "clients"), { recursive: true });
  const stagingStat = await fs.lstat(stagingRoot);
  if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()) {
    throw new ApiError(500, "workspace_purge_failed", "workspace purge staging path is unsafe");
  }
  purge.stagingRoot = stagingRoot;
  purge.recoveryRef = recoveryRef;

  try {
    for (const candidate of candidates) {
      const stagedPath = path.join(stagingRoot, "clients", candidate.slug);
      await fs.rename(candidate.source, stagedPath);
      purge.staged.push({ originalPath: candidate.source, stagedPath });
      purge.files += candidate.files;
      purge.clientDirectories += 1;
    }
  } catch (error) {
    try {
      await restoreStagedTeamWorkspacePurge(purge);
    } catch (restoreError) {
      throw restoreError;
    }
    throw error;
  }
  return purge;
}

async function restoreStagedTeamWorkspacePurge(purge: StagedTeamWorkspacePurge): Promise<void> {
  const failures: unknown[] = [];
  const unrestored = new Set<StagedTeamWorkspaceDirectory>();
  for (const directory of [...purge.staged].reverse()) {
    try {
      if (await lstatOrNull(directory.originalPath)) {
        throw new Error("active workspace path was recreated during deletion");
      }
      await fs.mkdir(path.dirname(directory.originalPath), { recursive: true });
      await fs.rename(directory.stagedPath, directory.originalPath);
    } catch (error) {
      failures.push(error);
      unrestored.add(directory);
    }
  }
  purge.staged = purge.staged.filter((directory) => unrestored.has(directory));

  // A collision or failed rename means the staged copy is now the recovery
  // copy. Never remove its root. Directories restored successfully have already
  // disappeared from staging through fs.rename, while failed ones remain intact.
  if (failures.length > 0) {
    throw new WorkspaceRestoreError(purge.recoveryRef);
  }
  if (purge.stagingRoot) {
    try {
      await fs.rm(purge.stagingRoot, { recursive: true, force: true });
    } catch {
      throw new WorkspaceRestoreError(purge.recoveryRef);
    }
  }
}

async function finalizeStagedTeamWorkspacePurge(
  purge: StagedTeamWorkspacePurge,
): Promise<boolean> {
  if (!purge.stagingRoot) return false;
  try {
    await fs.rm(purge.stagingRoot, { recursive: true, force: true });
    return false;
  } catch {
    // The active client paths are already gone. Report the inactive staging
    // copy so an operator can apply the server's normal local retention policy.
    return true;
  }
}

async function resolveCompanyUser(store: IdentityStore, reference: string) {
  const trimmed = reference.trim();
  const user = /^[0-9a-f-]{36}$/i.test(trimmed)
    ? await store.getUserById(trimmed)
    : await store.getUserByEmail(trimmed);
  if (!user) throw new ApiError(404, "not_found", "user not found");
  return user;
}

async function requireManagedTeam(
  actor: Awaited<ReturnType<typeof requireCompanyActor>>,
  teamId: string,
) {
  const team = await actor.store.getTeam(teamId);
  if (!team) throw new ApiError(404, "not_found", "team not found");
  const access = await resolveEffectiveTeamAccess(
    actor.store,
    team.id,
    actor.user.id,
    { includeArchived: true },
  );
  if (!access?.fullAccess) {
    throw new ApiError(403, "forbidden", "Full access to this Team is required");
  }
  return { team, access };
}

async function companyTeamSummary(
  actor: Awaited<ReturnType<typeof requireCompanyActor>>,
  team: Awaited<ReturnType<IdentityStore["getTeam"]>> & {},
  includeMembers = false,
): Promise<Record<string, unknown>> {
  const memberships = await actor.store.listMemberships(team.id);
  const visible = memberships.filter((membership) => membership.status !== "suspended");
  const membershipPeople = await Promise.all(visible.map(async (membership) => {
    const user = await actor.store.getUserById(membership.userId);
    return {
      id: membership.id,
      userId: membership.userId,
      email: user?.email ?? membership.userId,
      displayName: user?.displayName ?? user?.email ?? membership.userId,
      role: membership.role,
      status: membership.status,
      protected: false,
      source: "membership",
    };
  }));
  const peopleByUserId = new Map(membershipPeople.map((person) => [person.userId, person]));
  const [companyMemberships, companyGrants] = await Promise.all([
    actor.store.listCompanyMemberships(),
    actor.store.listCompanyTeamAccessGrants({ teamId: team.id, status: "active" }),
  ]);
  const protectedAdminIds = new Set(companyGrants.map((grant) => grant.userId));
  for (const companyMembership of companyMemberships) {
    if (companyMembership.status !== "active") continue;
    const source = companyMembership.role === "owner"
      ? "company_owner"
      : protectedAdminIds.has(companyMembership.userId)
        ? "company_grant"
        : null;
    if (!source) continue;
    const user = await actor.store.getUserById(companyMembership.userId);
    if (!user || user.status !== "active") continue;
    const current = peopleByUserId.get(user.id);
    peopleByUserId.set(user.id, {
      id: current?.id ?? `company:${team.id}:${user.id}`,
      userId: user.id,
      email: user.email,
      displayName: user.displayName ?? user.email,
      role: current?.role === "owner" ? "owner" : "admin",
      status: "active",
      protected: true,
      source,
    });
  }
  const people = [...peopleByUserId.values()];
  const access = await resolveEffectiveTeamAccess(
    actor.store,
    team.id,
    actor.user.id,
    { includeArchived: true },
  );
  const pending = await actor.store.listCompanyAccessRequests({
    teamId: team.id,
    userId: actor.user.id,
    status: "pending",
  });
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    status: team.status,
    archivedAt: team.archivedAt,
    archivedBy: team.archivedBy,
    owners: people.filter((person) => memberships.some((membership) =>
      membership.userId === person.userId && membership.role === "owner" && membership.status === "active")),
    memberCount: people.filter((person) => person.status === "active").length,
    access: shapeEffectiveTeamAccess(access),
    pendingRequest: pending.length > 0,
    members: includeMembers && access?.fullAccess ? people : [],
  };
}

async function shapeCompanyTeamsState(
  actor: Awaited<ReturnType<typeof requireCompanyActor>>,
  selectedTeamId?: string | null,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const teams = await actor.store.listTeams({ includeArchived: true });
  const summaries = await Promise.all(teams.map((team) =>
    companyTeamSummary(actor, team, team.id === selectedTeamId)));
  const users = await actor.store.listUsers({ status: "active" });
  // Lightweight route tests use a partial identity-store double. Production
  // always has getUserByEmail; keep the legacy eligibleOwners response usable
  // for those doubles while enforcing credential checks on the real store.
  const canResolveCredentials = typeof (actor.store as unknown as {
    getUserByEmail?: unknown;
  }).getUserByEmail === "function";
  const existingUsers = canResolveCredentials
    ? (await Promise.all(users.map(async (user) => ({
        user,
        usable: await hasUsablePlatformCredential(actor.store, user.email),
      })))).filter(({ usable }) => usable).map(({ user }) => user)
    : users;
  const shapePerson = (user: (typeof users)[number]) => ({
    id: user.id,
    userId: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email,
    status: user.status,
  });
  return {
    companyMembership: shapeCompanyMembership(actor.membership),
    pendingAccessRequestCount: await pendingAccessRequestCount(
      actor.store,
      actor.user.id,
      actor.membership,
    ),
    teams: summaries,
    selectedTeam: selectedTeamId
      ? summaries.find((team) => team.id === selectedTeamId) ?? null
      : null,
    existingUsers: existingUsers.map(shapePerson),
    eligibleOwners: users.map(shapePerson),
    ...extra,
  };
}

export async function handleCompanyTeamsRequest(
  deps: MemoryApiDeps,
  query: { teamId?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const actor = await requireCompanyActor(deps, context);
    return { status: 200, body: await shapeCompanyTeamsState(actor, query.teamId) };
  } catch (error) {
    const response = companyOperationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleCompanyTeamsActionRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const actor = await requireCompanyActor(deps, context);
    const raw = asRecord(rawBody, "invalid_request", "body");
    const action = requiredString(raw, "action").trim();
    let selectedTeamId = optionalTrimmedString(raw, "teamId");
    let responseExtra: Record<string, unknown> = {};

    if (action === "create-team") {
      const slug = requiredString(raw, "slug").trim().toLowerCase();
      if (!TEAM_SLUG_RE.test(slug)) throw new ApiError(400, "invalid_request", "team slug is invalid");
      const owner = await resolveCompanyUser(actor.store, requiredString(raw, "ownerUserId"));
      if (owner.status !== "active") throw new ApiError(400, "invalid_request", "initial Team Owner must be active");
      const created = await actor.store.createTeamWithOwner({
        slug,
        name: requiredString(raw, "name").trim(),
        ownerUserId: owner.id,
        creatorUserId: actor.user.id,
      });
      selectedTeamId = created.team.id;
    } else {
      if (!selectedTeamId) throw new ApiError(400, "invalid_request", "teamId is required");
      const managed = await requireManagedTeam(actor, selectedTeamId);
      const changesTeamAuthority = new Set([
        "add-team-owner",
        "remove-team-owner",
        "add-member",
        "invite-member",
        "set-member-role",
        "set-member-status",
        "remove-member",
      ]).has(action);
      if (changesTeamAuthority && managed.team.status !== "active") {
        throw new ApiError(409, "team_archived", "archived Team is blocked");
      }
      if (action === "update-team") {
        await actor.store.updateTeam({
          teamId: selectedTeamId,
          name: requiredString(raw, "name").trim(),
          actorUserId: actor.user.id,
        });
      } else if (action === "archive-team") {
        await actor.store.archiveTeam({ teamId: selectedTeamId, actorUserId: actor.user.id });
      } else if (action === "reactivate-team") {
        await actor.store.reactivateTeam({ teamId: selectedTeamId, actorUserId: actor.user.id });
      } else if (action === "delete-team") {
        requireCompanyOwner(actor.membership);
        if (raw.confirm !== true) throw new ApiError(400, "invalid_request", "delete confirmation is required");
        const expectedName = requiredString(raw, "expectedName");
        if (managed.team.name !== expectedName) {
          throw new ApiError(400, "invalid_request", "Team name confirmation does not match");
        }
        if (managed.team.status !== "archived" || !managed.team.archivedAt) {
          throw new ApiError(409, "team_not_deletable", "Team must be archived before permanent deletion");
        }
        const eligibleAt = new Date(managed.team.archivedAt).getTime() + 30 * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(eligibleAt) || Date.now() < eligibleAt) {
          throw new ApiError(
            409,
            "team_not_deletable",
            "Team must be archived for 30 days before deletion",
          );
        }
        const purge = await stageTeamWorkspacePurge(deps, actor.store, selectedTeamId);
        try {
          const deleted = await actor.store.deleteTeamPermanently({
            teamId: selectedTeamId,
            actorUserId: actor.user.id,
            expectedName,
            workspacePurge: {
              files: purge.files,
              clientDirectories: purge.clientDirectories,
              sharedClientDirectoriesSkipped: purge.sharedClientDirectoriesSkipped,
              unsafeClientDirectoriesSkipped: purge.unsafeClientDirectoriesSkipped,
            },
          });
          if (!deleted) throw new ApiError(404, "not_found", "team not found");
        } catch (error) {
          try {
            await restoreStagedTeamWorkspacePurge(purge);
          } catch (restoreError) {
            throw restoreError;
          }
          throw error;
        }
        const cleanupPending = await finalizeStagedTeamWorkspacePurge(purge);
        responseExtra = {
          workspacePurge: {
            files: purge.files,
            clientDirectories: purge.clientDirectories,
            sharedClientDirectoriesSkipped: purge.sharedClientDirectoriesSkipped,
            unsafeClientDirectoriesSkipped: purge.unsafeClientDirectoriesSkipped,
            cleanupPending,
          },
        };
        selectedTeamId = null;
      } else if (action === "add-team-owner") {
        const user = await resolveCompanyUser(actor.store, requiredString(raw, "user"));
        await actor.store.addTeamOwner({ teamId: selectedTeamId, userId: user.id, actorUserId: actor.user.id });
      } else if (action === "remove-team-owner") {
        const user = await resolveCompanyUser(actor.store, requiredString(raw, "user"));
        const replacementRole = parseEnumValue(raw, "replacementRole", VALID_ROLES, "admin");
        if (replacementRole === "owner") {
          throw new ApiError(400, "invalid_request", "replacementRole must be member or admin");
        }
        await actor.store.removeTeamOwner({
          teamId: selectedTeamId,
          userId: user.id,
          actorUserId: actor.user.id,
          replacementRole,
        });
      } else if (action === "add-member") {
        const role = parseEnumValue(raw, "role", VALID_ROLES, "member");
        if (role === "owner") {
          throw new ApiError(400, "invalid_request", "use add-team-owner for Team Owners");
        }
        const user = await resolveCompanyUser(actor.store, requiredString(raw, "user"));
        if (user.status !== "active") {
          throw new ApiError(409, "inactive_user", "only active users can be added to a Team");
        }
        const current = await actor.store.getMembership(selectedTeamId, user.id);
        if (current?.status === "active" || current?.status === "invited") {
          throw new ApiError(409, "duplicate_membership", "user already has an active or invited Team membership");
        }
        if (
          current?.role === "owner" ||
          await hasProtectedCompanyTeamAccess(deps, selectedTeamId, user.id)
        ) {
          throw new ApiError(409, "protected_authority", "protected Company access cannot be replaced by a Team membership");
        }
        if (!await hasUsablePlatformCredential(actor.store, user.email)) {
          throw new ApiError(409, "missing_credential", "user does not have a usable platform account");
        }
        await actor.store.addTeamMember({
          teamId: selectedTeamId,
          userId: user.id,
          actorUserId: actor.user.id,
          role,
        });
      } else if (action === "invite-member") {
        const role = parseEnumValue(raw, "role", VALID_ROLES, "member");
        if (role === "owner") throw new ApiError(400, "invalid_request", "use add-team-owner for Team Owners");
        const email = requiredString(raw, "email").trim().toLowerCase();
        const existingUser = await actor.store.getUserByEmail(email);
        if (existingUser) {
          await requireManageableTeamCredential(deps, selectedTeamId, existingUser.id);
        }
        await requireInvitationOnlyAccount(actor.store, email);
        const invite = await inviteMember(actor.store, {
          teamId: selectedTeamId,
          actorUserId: actor.user.id,
          email,
          role,
        });
        const state = await shapeCompanyTeamsState(actor, selectedTeamId, {
          invite: {
            email: invite.user.email,
            expiresAt: invite.expiresAt,
            url: buildHostedUrl(context, "/team/join", {
              team: managed.team.slug,
              email: invite.user.email,
              token: invite.token,
            }),
          },
        });
        return { status: 200, body: state };
      } else if (action === "set-member-role") {
        const user = await resolveCompanyUser(actor.store, requiredString(raw, "user"));
        const membership = await actor.store.getMembership(selectedTeamId, user.id);
        const role = parseEnumValue(raw, "role", VALID_ROLES, "member");
        if (!membership) throw new ApiError(404, "not_found", "member not found");
        if (
          membership.role === "owner" ||
          role === "owner" ||
          await hasProtectedCompanyTeamAccess(deps, selectedTeamId, user.id)
        ) {
          throw new ApiError(403, "forbidden", "Team Owners are managed by Company Owner only");
        }
        await actor.store.setRole(selectedTeamId, user.id, role);
      } else if (action === "set-member-status" || action === "remove-member") {
        const user = await resolveCompanyUser(actor.store, requiredString(raw, "user"));
        const membership = await actor.store.getMembership(selectedTeamId, user.id);
        if (!membership) throw new ApiError(404, "not_found", "member not found");
        if (
          membership.role === "owner" ||
          await hasProtectedCompanyTeamAccess(deps, selectedTeamId, user.id)
        ) {
          throw new ApiError(403, "forbidden", "Team Owners are managed by Company Owner only");
        }
        const status = action === "remove-member"
          ? "suspended"
          : parseEnumValue(raw, "status", VALID_MEMBER_STATUSES, "active");
        await actor.store.setMembershipStatus(selectedTeamId, user.id, status);
      } else {
        throw new ApiError(400, "invalid_request", `unknown Company Team action: ${action}`);
      }
    }

    return { status: 200, body: await shapeCompanyTeamsState(actor, selectedTeamId, responseExtra) };
  } catch (error) {
    const response = companyOperationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

async function shapeCompanyMembershipState(
  actor: Awaited<ReturnType<typeof requireCompanyActor>>,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const rows = await actor.store.listCompanyMemberships();
  const shaped = await Promise.all(rows.filter((row) => row.status !== "removed").map(async (row) => {
    const user = await actor.store.getUserById(row.userId);
    return {
      id: row.id,
      userId: row.userId,
      email: user?.email ?? row.userId,
      displayName: user?.displayName ?? user?.email ?? row.userId,
      companyRole: row.role,
      role: row.role,
      status: row.status,
    };
  }));
  return {
    companyMembership: shapeCompanyMembership(actor.membership),
    memberships: shaped.filter((row) => row.status === "active"),
    pendingInvitations: shaped.filter((row) => row.status === "invited"),
    ...extra,
  };
}

async function inviteCompanyAdmin(
  actor: Awaited<ReturnType<typeof requireCompanyActor>>,
  email: string,
  context: MemoryApiRequestContext,
): Promise<Record<string, unknown>> {
  requireCompanyOwner(actor.membership);
  const normalizedEmail = email.trim().toLowerCase();
  let user = await actor.store.getUserByEmail(normalizedEmail);
  if (!user) user = await actor.store.upsertUser({ email: normalizedEmail, status: "active" });
  if (user.status !== "active") {
    throw new ApiError(409, "inactive_user", "a disabled user cannot become Company Admin");
  }
  const existingCompanyMembership = await actor.store.getCompanyMembership(user.id);
  if (existingCompanyMembership?.status === "active" && existingCompanyMembership.role === "owner") {
    throw new ApiError(409, "conflict", "Company Owner cannot be invited as Company Admin");
  }
  if (existingCompanyMembership?.status === "active" && existingCompanyMembership.role === "admin") {
    return { promoted: true, email: normalizedEmail, inviteUrl: null, existing: true };
  }
  const hasPlatformCredential = await hasUsablePlatformCredential(actor.store, normalizedEmail);
  if (hasPlatformCredential) {
    await actor.store.upsertCompanyMembership({
      userId: user.id,
      role: "admin",
      status: "active",
      invitedBy: actor.user.id,
      acceptedAt: new Date().toISOString(),
      inviteTokenHash: null,
      inviteExpiresAt: null,
    });
    return { promoted: true, email: normalizedEmail, inviteUrl: null };
  }
  const ownsAnyTeam = (await actor.store.listMembershipsForUser(user.id)).some(
    (membership) => membership.status === "active" && membership.role === "owner",
  );
  if (ownsAnyTeam) {
    throw new ApiError(409, "protected_authority", "Team Owners cannot use a Company invitation link");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + COMPANY_INVITE_TTL_MS).toISOString();
  await actor.store.upsertCompanyMembership({
    userId: user.id,
    role: "admin",
    status: "invited",
    invitedBy: actor.user.id,
    inviteTokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    inviteExpiresAt: expiresAt,
    acceptedAt: null,
    removedAt: null,
  });
  const inviteUrl = buildHostedUrl(context, "/company/join", {
    email: normalizedEmail,
    token,
  });
  return { promoted: false, email: normalizedEmail, expiresAt, inviteUrl };
}

export async function handleCompanyMembershipsRequest(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const actor = await requireCompanyActor(deps, context);
    return { status: 200, body: await shapeCompanyMembershipState(actor) };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleCompanyMembershipsActionRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const actor = await requireCompanyActor(deps, context);
    requireCompanyOwner(actor.membership);
    const raw = asRecord(rawBody, "invalid_request", "body");
    const action = requiredString(raw, "action").trim();
    if (action === "invite-admin" || action === "create-invite-link") {
      const invite = await inviteCompanyAdmin(actor, requiredString(raw, "email"), context);
      return { status: 200, body: await shapeCompanyMembershipState(actor, invite) };
    }
    const user = await resolveCompanyUser(actor.store, requiredString(raw, "user"));
    if (action === "promote-admin") {
      if (user.status !== "active") {
        throw new ApiError(409, "inactive_user", "only an active user can become Company Admin");
      }
      const current = await actor.store.getCompanyMembership(user.id);
      if (current?.status === "active" || current?.status === "invited") {
        throw new ApiError(
          409,
          current.role === "owner" ? "protected_authority" : "duplicate_membership",
          current.role === "owner"
            ? "Company Owner cannot be promoted to Company Admin"
            : "user is already an active or invited Company Admin",
        );
      }
      if (!await hasUsablePlatformCredential(actor.store, user.email)) {
        throw new ApiError(409, "missing_credential", "user does not have a usable platform account");
      }
      await actor.store.promoteCompanyAdmin({
        userId: user.id,
        actorUserId: actor.user.id,
        acceptedAt: new Date().toISOString(),
      });
      return {
        status: 200,
        body: await shapeCompanyMembershipState(actor, {
          promoted: true,
          email: user.email,
          inviteUrl: null,
        }),
      };
    } else if (action === "remove-admin") {
      await actor.store.removeCompanyAdmin({ userId: user.id, actorUserId: actor.user.id });
    } else if (action === "transfer-ownership") {
      if (user.status !== "active") {
        throw new ApiError(409, "inactive_user", "Company Ownership requires an active user");
      }
      await actor.store.transferCompanyOwnership({
        currentOwnerUserId: actor.user.id,
        newOwnerUserId: user.id,
        actorUserId: actor.user.id,
      });
    } else {
      throw new ApiError(400, "invalid_request", `unknown Company membership action: ${action}`);
    }
    const refreshed = await requireCompanyActor(deps, context);
    return { status: 200, body: await shapeCompanyMembershipState(refreshed) };
  } catch (error) {
    const response = companyOperationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleCompanyInvitationAcceptRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
): Promise<ApiResponse> {
  try {
    if (!deps.identityStore) throw new ApiError(500, "internal", "identity store is required");
    const store = deps.identityStore as unknown as IdentityStore;
    const raw = asRecord(rawBody, "invalid_request", "body");
    const email = requiredString(raw, "email").trim().toLowerCase();
    let user = await store.getUserByEmail(email);
    if (!user) throw new ApiError(400, "invalid_invite", "invitation is invalid or expired");
    const tokenHash = crypto.createHash("sha256")
      .update(requiredString(raw, "token").trim())
      .digest("hex");
    const invited = await store.getCompanyMembership(user.id);
    const storedHash = invited?.inviteTokenHash ?? "";
    const validHash = storedHash.length === tokenHash.length && crypto.timingSafeEqual(
      Buffer.from(storedHash),
      Buffer.from(tokenHash),
    );
    if (
      !invited ||
      invited.status !== "invited" ||
      !validHash ||
      !invited.inviteExpiresAt ||
      Date.parse(invited.inviteExpiresAt) <= Date.now()
    ) {
      throw new ApiError(400, "invalid_invite", "invitation is invalid or expired");
    }
    const recoveringCredential = invited.metadata._inviteCredentialReady === true;
    const ownsAnyTeam = (await store.listMembershipsForUser(user.id)).some(
      (membership) => membership.status === "active" && membership.role === "owner",
    );
    if (
      user.status !== "active" ||
      ownsAnyTeam ||
      (!recoveringCredential && await hasUsablePlatformCredential(store, email))
    ) {
      throw new ApiError(400, "invalid_invite", "invitation is invalid or expired");
    }
    const password = requiredString(raw, "password");
    if (password.length < 8) {
      throw new ApiError(400, "invalid_request", "password must be at least 8 characters");
    }
    const authSource = parseEnumValue(raw, "authSource", VALID_AUTH_SOURCES, "browser-session");
    const displayName = optionalTrimmedString(raw, "displayName");
    const claimId = crypto.randomBytes(24).toString("base64url");
    const claimed = await store.claimCompanyInvitation({
      userId: user.id,
      tokenHash,
      claimId,
    });
    if (!claimed) throw new ApiError(409, "invite_already_used", "invitation is already being accepted or was used");
    if (claimed.metadata._inviteCredentialReady !== true) {
      try {
        if (displayName) {
          user = await store.upsertUser({
            email: user.email,
            displayName,
            status: user.status,
            metadata: user.metadata,
          });
        }
        user = await setUserPassword(store, user, password);
      } catch (error) {
        await store.releaseCompanyInvitationClaim({ userId: user.id, claimId });
        throw error;
      }
      const marked = await store.markCompanyInvitationCredentialReady({ userId: user.id, claimId });
      if (!marked) throw new ApiError(409, "invite_claim_lost", "invitation claim could not be completed");
    }
    const companyMembership = await store.finalizeCompanyInvitation({ userId: user.id, claimId });
    if (!companyMembership) throw new ApiError(409, "invite_claim_lost", "invitation claim could not be finalized");
    const session = await createCompanySessionForUser(store, {
      user,
      companyMembership,
      authSource,
    });
    return {
      status: 200,
      body: shapeSessionResult(session, await readServerId(deps), 0),
    };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

async function shapeCompanyAccessState(
  actor: Awaited<ReturnType<typeof requireCompanyActor>>,
): Promise<Record<string, unknown>> {
  const owner = actor.membership.role === "owner";
  const requests = await actor.store.listCompanyAccessRequests({
    ...(owner ? {} : { userId: actor.user.id }),
  });
  const grants = await actor.store.listCompanyTeamAccessGrants({
    ...(owner ? {} : { userId: actor.user.id }),
  });
  const memberships = await actor.store.listCompanyMemberships();
  const teams = await actor.store.listTeams({ includeArchived: true });
  const userIds = new Set([
    ...requests.map((row) => row.userId),
    ...grants.map((row) => row.userId),
    ...memberships.map((row) => row.userId),
  ]);
  const users = new Map<string, Awaited<ReturnType<IdentityStore["getUserById"]>>>();
  await Promise.all([...userIds].map(async (userId) => users.set(userId, await actor.store.getUserById(userId))));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const admins = memberships.filter((row) => row.status !== "removed").map((row) => ({
    id: row.id,
    userId: row.userId,
    email: users.get(row.userId)?.email ?? row.userId,
    displayName: users.get(row.userId)?.displayName ?? users.get(row.userId)?.email ?? row.userId,
    companyRole: row.role,
    role: row.role,
    status: row.status,
  }));
  const accessAdminUserIds = new Set(
    memberships
      .filter((row) =>
        row.role === "admin" &&
        row.status !== "removed" &&
        (owner || row.userId === actor.user.id))
      .map((row) => row.userId),
  );
  const directAdminMemberships = (
    await Promise.all([...accessAdminUserIds].map((userId) => actor.store.listMembershipsForUser(userId)))
  ).flat();
  const adminTeamAccessByKey = new Map<string, {
    userId: string;
    teamId: string;
    source: "company_grant" | "team_owner" | "team_admin";
  }>();
  const addAdminTeamAccess = (entry: {
    userId: string;
    teamId: string;
    source: "company_grant" | "team_owner" | "team_admin";
  }) => {
    // One effective row per Admin and Team. Direct Team authority is applied
    // after grants below, so Team Owner/Admin takes precedence over a redundant
    // company grant and the UI never mistakes protected direct access for an
    // editable grant.
    adminTeamAccessByKey.set(`${entry.userId}:${entry.teamId}`, entry);
  };
  for (const grant of grants) {
    if (grant.status !== "active" || !accessAdminUserIds.has(grant.userId)) continue;
    addAdminTeamAccess({ userId: grant.userId, teamId: grant.teamId, source: "company_grant" });
  }
  for (const membership of directAdminMemberships) {
    if (membership.status !== "active" || !["owner", "admin"].includes(membership.role)) continue;
    addAdminTeamAccess({
      userId: membership.userId,
      teamId: membership.teamId,
      source: membership.role === "owner" ? "team_owner" : "team_admin",
    });
  }
  const adminTeamAccess = [...adminTeamAccessByKey.values()].sort((left, right) =>
    left.userId.localeCompare(right.userId) ||
    left.teamId.localeCompare(right.teamId) ||
    left.source.localeCompare(right.source));
  return {
    companyMembership: shapeCompanyMembership(actor.membership),
    pendingAccessRequestCount: requests.filter((row) => row.status === "pending").length,
    requests: requests.map((row) => ({
      ...row,
      resolvedAt: row.resolvedAt ?? null,
      teamName: teamById.get(row.teamId)?.name ?? row.teamId,
      email: users.get(row.userId)?.email ?? row.userId,
      displayName: users.get(row.userId)?.displayName ?? users.get(row.userId)?.email ?? row.userId,
    })),
    grants: grants.map((row) => ({
      ...row,
      teamName: teamById.get(row.teamId)?.name ?? row.teamId,
      email: users.get(row.userId)?.email ?? row.userId,
      displayName: users.get(row.userId)?.displayName ?? users.get(row.userId)?.email ?? row.userId,
      protected: true,
    })),
    admins,
    adminTeamAccess,
    teams: await Promise.all(teams.map((team) => companyTeamSummary(actor, team, false))),
  };
}

export async function handleCompanyAccessRequest(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const actor = await requireCompanyActor(deps, context);
    return { status: 200, body: await shapeCompanyAccessState(actor) };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleCompanyAccessActionRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const actor = await requireCompanyActor(deps, context);
    const raw = asRecord(rawBody, "invalid_request", "body");
    const action = requiredString(raw, "action").trim();
    if (action === "request-access") {
      if (actor.membership.role !== "admin") throw new ApiError(400, "invalid_request", "Company Owner already has access");
      const teamId = requiredString(raw, "teamId");
      const team = await actor.store.getTeam(teamId);
      if (!team || team.status !== "active") throw new ApiError(404, "not_found", "active team not found");
      if ((await resolveEffectiveTeamAccess(actor.store, teamId, actor.user.id))?.fullAccess) {
        throw new ApiError(409, "conflict", "Full access already exists");
      }
      await actor.store.createCompanyAccessRequest({
        teamId,
        userId: actor.user.id,
        reason: optionalTrimmedString(raw, "reason"),
      });
    } else if (action === "cancel-request") {
      const request = await actor.store.getCompanyAccessRequest(requiredString(raw, "requestId"));
      if (!request || request.userId !== actor.user.id) throw new ApiError(404, "not_found", "access request not found");
      await actor.store.updateCompanyAccessRequest({
        requestId: request.id,
        status: "canceled",
        actorUserId: actor.user.id,
      });
    } else if (action === "approve-request" || action === "deny-request") {
      requireCompanyOwner(actor.membership);
      await actor.store.updateCompanyAccessRequest({
        requestId: requiredString(raw, "requestId"),
        status: action === "approve-request" ? "approved" : "denied",
        actorUserId: actor.user.id,
      });
    } else if (action === "grant-access" || action === "grant-access-bulk") {
      requireCompanyOwner(actor.membership);
      const user = await resolveCompanyUser(actor.store, requiredString(raw, "user"));
      const companyMembership = await actor.store.getCompanyMembership(user.id);
      if (!companyMembership || !["active", "invited"].includes(companyMembership.status) || companyMembership.role !== "admin") {
        throw new ApiError(400, "invalid_request", "target must be a Company Admin");
      }
      const teamIds = action === "grant-access"
        ? [requiredString(raw, "teamId")]
        : Array.isArray(raw.teamIds) ? raw.teamIds.map(String) : [];
      if (!teamIds.length) throw new ApiError(400, "invalid_request", "at least one teamId is required");
      const uniqueTeamIds = [...new Set(teamIds)];
      if (action === "grant-access") {
        if (!await actor.store.getTeam(uniqueTeamIds[0])) throw new ApiError(404, "not_found", "team not found");
        await actor.store.grantCompanyTeamAccess({
          teamId: uniqueTeamIds[0],
          userId: user.id,
          grantedBy: actor.user.id,
        });
      } else {
        await actor.store.grantCompanyTeamAccessBulk({
          teamIds: uniqueTeamIds,
          userId: user.id,
          grantedBy: actor.user.id,
        });
      }
    } else if (action === "revoke-access") {
      const user = raw.user ? await resolveCompanyUser(actor.store, String(raw.user)) : actor.user;
      if (actor.membership.role !== "owner" && user.id !== actor.user.id) {
        throw new ApiError(403, "forbidden", "Company Admin may revoke only their own access");
      }
      await actor.store.revokeCompanyTeamAccess({
        teamId: requiredString(raw, "teamId"),
        userId: user.id,
        revokedBy: actor.user.id,
      });
    } else {
      throw new ApiError(400, "invalid_request", `unknown Company access action: ${action}`);
    }
    return { status: 200, body: await shapeCompanyAccessState(actor) };
  } catch (error) {
    const response = companyOperationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleTeamClientsRequest(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireTeamApiPrincipal(deps, context);
    const membership = await deps.identityStore!.getMembership(principal.teamId, principal.userId);
    const clients = deps.identityStore!.listClients
      ? await deps.identityStore!.listClients(principal.teamId)
      : [];
    const allowed: Array<Record<string, unknown>> = [];

    for (const client of clients) {
      if (client.status && client.status !== "active") continue;
      if (hasFullTeamAccess(principal, membership)) {
        allowed.push({
          id: client.id,
          slug: client.slug,
          name: client.name ?? client.slug,
          access: "write",
          implicit: true,
          protected: true,
        });
        continue;
      }
      const grant = await deps.identityStore!.getActiveGrant(
        principal.teamId,
        client.id,
        principal.userId,
      );
      if (!grant || grant.status !== "active") continue;
      allowed.push({
        id: client.id,
        slug: client.slug,
        name: client.name ?? client.slug,
        access: grant.access,
      });
    }

    return {
      status: 200,
      body: { clients: allowed },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

async function resolveAdminUser(
  deps: MemoryApiDeps,
  userRef: string,
): Promise<IdentityUser> {
  const trimmed = userRef.trim();
  let user: IdentityUser | null | undefined = null;
  if (deps.identityStore!.getUserById) {
    try {
      user = await deps.identityStore!.getUserById(trimmed);
    } catch (error) {
      if (!isInvalidUserIdLookupError(error)) throw error;
    }
  }
  user ??= await deps.identityStore!.getUserByEmail?.(trimmed);
  if (!user) throw new ApiError(404, "not_found", "user not found");
  return user;
}

function isInvalidUserIdLookupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("uuid") && (
    message.includes("invalid input")
    || message.includes("invalid syntax")
    || message.includes("invalid uuid")
  );
}

async function resolveAdminClient(
  deps: MemoryApiDeps,
  teamId: string,
  clientRef: string,
): Promise<IdentityClient> {
  const trimmed = clientRef.trim();
  const client = trimmed.match(/^[0-9a-f-]{36}$/i)
    ? await deps.identityStore!.getClientById?.(trimmed)
    : await deps.identityStore!.getClientBySlug(teamId, trimmed);
  if (!client || client.id == null) throw new ApiError(404, "not_found", "client not found");
  return client;
}

async function shapeInviteResult(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  context: MemoryApiRequestContext,
  result: {
    user: IdentityUser;
    membership: IdentityMembership;
    token: string;
    expiresAt: string;
  },
): Promise<Record<string, unknown>> {
  const team = await deps.identityStore!.getTeam?.(principal.teamId);
  const teamRef = team?.slug ?? principal.teamId;
  return {
    invite: {
      email: result.user.email,
      role: result.membership.role,
      expiresAt: result.expiresAt,
      url: buildHostedUrl(context, "/team/join", {
        team: teamRef,
        email: result.user.email,
        token: result.token,
      }),
    },
  };
}

function isVisibleMembership(membership: IdentityMembership): boolean {
  return membership.status !== "suspended";
}

function isAutoClientMember(membership: IdentityMembership): boolean {
  return membership.status === "active" && (membership.role === "owner" || membership.role === "admin");
}

function isTeamAdminMembership(membership: IdentityMembership | null | undefined): boolean {
  return Boolean(membership && isAutoClientMember(membership));
}

function hasFullTeamAccess(
  principal: MemoryApiPrincipal,
  membership?: IdentityMembership | null,
): boolean {
  return principal.access?.fullAccess === true || isTeamAdminMembership(membership);
}

async function hasProtectedCompanyTeamAccess(
  deps: MemoryApiDeps,
  teamId: string,
  userId: string,
): Promise<boolean> {
  if (!deps.identityStore) return false;
  const store = deps.identityStore as unknown as IdentityStore;
  const companyMembership = await store.getCompanyMembership(userId);
  if (!companyMembership || companyMembership.status !== "active") return false;
  if (companyMembership.role === "owner") return true;
  return Boolean(await store.getActiveCompanyTeamAccessGrant(teamId, userId));
}

/**
 * Credential management is stricter than Team membership management. Company
 * authority is protected company-wide (even without a grant on this Team), and
 * Team Owner credentials are managed outside the normal Members invite/reset
 * controls.
 */
async function hasProtectedCredentialAuthority(
  deps: MemoryApiDeps,
  _teamId: string,
  userId: string,
): Promise<boolean> {
  if (!deps.identityStore) return false;
  const store = deps.identityStore as unknown as IdentityStore;
  const [companyMembership, memberships] = await Promise.all([
    store.getCompanyMembership(userId),
    store.listMembershipsForUser(userId),
  ]);
  return companyMembership?.status === "active" || memberships.some(
    (membership) => membership.status === "active" && membership.role === "owner",
  );
}

async function requireManageableTeamCredential(
  deps: MemoryApiDeps,
  teamId: string,
  userId: string,
): Promise<void> {
  if (await hasProtectedCredentialAuthority(deps, teamId, userId)) {
    throw new ApiError(
      403,
      "forbidden",
      "Team Owner and Company authority credentials cannot be managed here",
    );
  }
}

async function requireInvitationOnlyAccount(store: IdentityStore, email: string): Promise<void> {
  if (await hasUsablePlatformCredential(store, email.trim().toLowerCase())) {
    throw new ApiError(
      409,
      "existing_account",
      "this user already has a platform account and cannot use an invitation link",
    );
  }
}

function skillPermissionRank(permission: SkillPermission): number {
  if (permission === "skill.admin") return 4;
  if (permission === "skill.edit") return 3;
  if (permission === "skill.read") return 2;
  return 1;
}

function skillPermissionMeets(held: SkillPermission, required: SkillPermission): boolean {
  return skillPermissionRank(held) >= skillPermissionRank(required);
}

function normalizeSkillName(rawSkillName: unknown): string {
  if (typeof rawSkillName !== "string" || rawSkillName.trim() === "") {
    throw new ApiError(400, "invalid_request", "skill name is required");
  }
  const skillName = rawSkillName.trim();
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new ApiError(400, "invalid_request", "skill name is invalid");
  }
  return skillName;
}

function parseSkillMarkdown(raw: string, fallbackName: string): { name: string; description: string } {
  try {
    const parsed = matter(raw);
    const name = typeof parsed.data.name === "string" && parsed.data.name.trim() ? parsed.data.name.trim() : fallbackName;
    const description = typeof parsed.data.description === "string" ? parsed.data.description.trim() : "";
    return { name, description };
  } catch {
    return { name: fallbackName, description: "" };
  }
}

function skillRoot(root: string, skillName: string): string {
  return path.join(root, ".claude", "skills", skillName);
}

function resolveSkillPath(root: string, relativePath: string): string {
  const fullPath = path.resolve(root, ...relativePath.split("/"));
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (fullPath !== root && !fullPath.startsWith(rootWithSep)) {
    throw new ApiError(400, "invalid_request", "path escapes workspace root");
  }
  return fullPath;
}

function normalizeSkillFilePath(rawPath: unknown): string {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new ApiError(400, "invalid_request", "path is required");
  }
  const input = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    input.includes("\0") ||
    path.posix.isAbsolute(input) ||
    path.win32.isAbsolute(input)
  ) {
    throw new ApiError(400, "invalid_request", "path must be relative");
  }
  const parts = input.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new ApiError(400, "invalid_request", "path cannot contain traversal segments");
  }
  if (parts[0] !== ".claude" || parts[1] !== "skills" || !parts[2] || parts.length < 4) {
    throw new ApiError(400, "invalid_request", "path must be under .claude/skills/{skill}/...");
  }
  normalizeSkillName(parts[2]);
  return parts.join("/");
}

function skillNameFromSkillPath(relativePath: string): string {
  return relativePath.split("/")[2]!;
}

async function skillDirectoryExists(root: string, skillName: string): Promise<boolean> {
  const stat = await statFileOrNull(skillRoot(root, skillName));
  return Boolean(stat && stat.isDirectory());
}

async function requireSkillServerAccess(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  skillName: string,
  required: SkillPermission,
  options: { allowTeamAdmin?: boolean } = {},
): Promise<{ membership: IdentityMembership | null; admin: boolean }> {
  if (!deps.identityStore) {
    throw new ApiError(500, "internal", "identity store is required for skill sync");
  }
  const membership = await deps.identityStore.getMembership(principal.teamId, principal.userId);
  const admin = hasFullTeamAccess(principal, membership);
  if (admin && options.allowTeamAdmin !== false) return { membership, admin };

  const grants = deps.identityStore.listSkillGrants
    ? await deps.identityStore.listSkillGrants({ teamId: principal.teamId, skillName, userId: principal.userId })
    : [];
  const activeMatches = grants.filter((grant) => grant.status === "active");
  const match = activeMatches.find(
    (grant) => grant.status === "active" && skillPermissionMeets(grant.permission, required),
  );
  if (!match) {
    await deps.identityStore.recordAuditEvent({
      teamId: principal.teamId,
      actorUserId: principal.userId,
      action: required === "skill.use"
        ? "access.denied_use"
        : required === "skill.read"
          ? "access.denied_read"
          : "access.denied_edit",
      targetType: "skill",
      targetId: null,
      summary: `denied ${required} on skill ${skillName}`,
      metadata: { skillName, required, authSource: principal.authSource ?? null },
    });
    if (activeMatches.length > 0) {
      throw new ApiError(403, "forbidden", `${required} permission is required for this skill`);
    }
    throw new ApiError(404, "not_found", "skill not found");
  }
  return { membership, admin };
}

async function collectSkillManifest(root: string, skillName: string): Promise<SkillManifestResult> {
  const base = skillRoot(root, skillName);
  const files: Array<Record<string, unknown>> = [];
  let unsupportedFiles = 0;
  const start = await statFileOrNull(base);
  if (!start || !start.isDirectory()) return { files, filesCount: 0, manifestHash: sha256("[]"), unsupportedFiles };

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, "/");
      if (isExcludedSkillSyncPath(rel)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        unsupportedFiles += 1;
        continue;
      }
      const stat = await fs.stat(fullPath);
      if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
        unsupportedFiles += 1;
        continue;
      }
      const content = await fs.readFile(fullPath);
      const text = isLikelyTextBuffer(rel, content);
      files.push({
        path: rel,
        size: stat.size,
        sha256: sha256(content),
        ...(text ? { normalizedSha256: normalizedTextSha256(content) } : {}),
        updatedAt: stat.mtime.toISOString(),
        encoding: text ? "utf-8" : "base64",
      });
    }
  }

  await walk(base);
  files.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  const hashInput = files.map((file) => ({
    path: file.path,
    size: file.size,
    sha256: file.sha256,
  }));
  return {
    files,
    filesCount: files.length,
    manifestHash: sha256(JSON.stringify(hashInput)),
    unsupportedFiles,
  };
}

async function listServerSkillSummaries(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
): Promise<Array<Record<string, unknown>>> {
  const root = deps.workspaceRoot ? path.resolve(deps.workspaceRoot) : null;
  if (!root) return [];
  const membership = deps.identityStore
    ? await deps.identityStore.getMembership(principal.teamId, principal.userId)
    : null;
  const admin = hasFullTeamAccess(principal, membership);
  const skillsDir = path.join(root, ".claude", "skills");
  const activeGrants = deps.identityStore?.listSkillGrants
    ? (await deps.identityStore.listSkillGrants({ teamId: principal.teamId })).filter((grant) => grant.status === "active")
    : [];
  const allowedByGrant = new Map<string, SkillPermission[]>();
  for (const grant of activeGrants) {
    if (!admin && grant.userId !== principal.userId) continue;
    const current = allowedByGrant.get(grant.skillName) ?? [];
    current.push(grant.permission);
    allowedByGrant.set(grant.skillName, current);
  }
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  const out: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "_catalog") continue;
    if (!admin) {
      const permissions = allowedByGrant.get(entry.name) ?? [];
      // The desktop runtime must fetch the skill package in order to execute
      // it as a session plugin. A use grant therefore includes transport of
      // the executable package, while edit/admin still control mutations.
      if (!permissions.some((permission) => skillPermissionMeets(permission, "skill.use"))) continue;
    }
    const fullPath = path.join(skillsDir, entry.name);
    const stat = await fs.stat(fullPath);
    const skillMdPath = path.join(fullPath, "SKILL.md");
    const raw = await fs.readFile(skillMdPath, "utf-8").catch(() => "");
    const parsed = parseSkillMarkdown(raw, entry.name);
    const manifest = await collectSkillManifest(root, entry.name);
    const grants = activeGrants.filter((grant) => grant.skillName === entry.name);
    out.push({
      slug: entry.name,
      name: parsed.name,
      description: parsed.description,
      status: "active",
      files: manifest.files.length,
      filesCount: manifest.filesCount,
      grants: grants.length,
      grantsCount: grants.length,
      manifestHash: manifest.manifestHash,
      userPermission: admin
        ? "skill.admin"
        : (allowedByGrant.get(entry.name) ?? []).sort((a, b) => skillPermissionRank(b) - skillPermissionRank(a))[0] ?? null,
      writable: admin || (allowedByGrant.get(entry.name) ?? []).some((permission) => skillPermissionMeets(permission, "skill.admin")),
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    });
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

async function serverStorageStatus(deps: MemoryApiDeps): Promise<Record<string, unknown>> {
  const backupRemote = (
    process.env.TEAM_OS_GITHUB_BACKUP_REMOTE ||
    process.env.TEAM_OS_WORKSPACE_BACKUP_REMOTE ||
    process.env.TEAM_OS_GIT_BACKUP_REMOTE ||
    ""
  ).trim();
  const backupToken = (
    process.env.TEAM_OS_GITHUB_BACKUP_TOKEN ||
    process.env.TEAM_OS_WORKSPACE_BACKUP_TOKEN ||
    process.env.TEAM_OS_GIT_BACKUP_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    ""
  ).trim();
  const backupBranch = (
    process.env.TEAM_OS_GITHUB_BACKUP_BRANCH ||
    process.env.TEAM_OS_WORKSPACE_BACKUP_BRANCH ||
    "main"
  ).trim();
  const backupConfigured = backupRemote !== "" && backupToken !== "";
  const backupWarning =
    backupRemote === ""
      ? "GitHub backup for server workspace files is not configured."
      : backupToken === ""
        ? "GitHub backup token is not configured."
        : null;

  const root = deps.workspaceRoot ? path.resolve(deps.workspaceRoot) : null;
  if (!root) {
    return {
      workspaceRoot: null,
      writable: false,
      configuredRoot: false,
      likelyPersistent: false,
      warning: "AI_OS_DIR is not configured for the memory API server.",
      backup: {
        configured: backupConfigured,
        remoteConfigured: backupRemote !== "",
        tokenConfigured: backupToken !== "",
        branch: backupBranch,
        warning: backupWarning,
      },
      error: null,
    };
  }
  const markerDir = path.join(root, ".command-centre");
  const markerPath = path.join(markerDir, "storage-check.tmp");
  let writable = false;
  let error: string | null = null;
  try {
    await fs.mkdir(markerDir, { recursive: true });
    await fs.writeFile(markerPath, String(Date.now()), "utf-8");
    await fs.rm(markerPath, { force: true });
    writable = true;
  } catch (writeError) {
    error = writeError instanceof Error ? writeError.message : "storage write failed";
  }
  const configuredRoot = Boolean((process.env.AI_OS_DIR ?? "").trim());
  const normalizedRoot = root.replace(/\\/g, "/").toLowerCase();
  const likelyAppDir = normalizedRoot === "/app" || normalizedRoot.startsWith("/app/");
  return {
    workspaceRoot: root,
    writable,
    configuredRoot,
    likelyPersistent: writable && configuredRoot && !likelyAppDir,
    warning: !writable
      ? "Server workspace is not writable. Sync cannot safely persist files."
      : !configuredRoot
        ? "AI_OS_DIR is not configured. The server may write inside the deployed app directory."
        : likelyAppDir
          ? "AI_OS_DIR appears to be inside /app. Mount a persistent volume and point AI_OS_DIR there."
          : null,
    backup: {
      configured: backupConfigured,
      remoteConfigured: backupRemote !== "",
      tokenConfigured: backupToken !== "",
      branch: backupBranch,
      warning: backupWarning,
    },
    error,
  };
}

async function shapeTeamAdminState(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const team = await deps.identityStore!.getTeam?.(principal.teamId);
  const memberships = deps.identityStore!.listMemberships
    ? await deps.identityStore!.listMemberships(principal.teamId)
    : [];
  const clients = deps.identityStore!.listClients
    ? await deps.identityStore!.listClients(principal.teamId)
    : [];
  const clientGrants = deps.identityStore!.listGrants
    ? await deps.identityStore!.listGrants({ teamId: principal.teamId })
    : [];
  const activeClientGrants = clientGrants.filter((grant) => grant.status === "active");
  const skillGrants = deps.identityStore!.listSkillGrants
    ? await deps.identityStore!.listSkillGrants({ teamId: principal.teamId })
    : [];
  const audit = deps.identityStore!.listAuditEvents
    ? await deps.identityStore!.listAuditEvents({ teamId: principal.teamId, limit: 20 })
    : [];
  const companyStore = deps.identityStore as unknown as IdentityStore;
  const companyMemberships = await companyStore.listCompanyMemberships();
  const companyGrants = await companyStore.listCompanyTeamAccessGrants({
    teamId: principal.teamId,
    status: "active",
  });
  const serverSkills = await listServerSkillSummaries(deps, principal);
  const storage = await serverStorageStatus(deps);

  const userById = new Map<string, IdentityUser>();
  const visibleMemberships = memberships.filter(isVisibleMembership);
  const protectedCompanyAccess = new Map<string, "company_owner" | "company_grant">();
  const grantedCompanyAdminIds = new Set(companyGrants.map((grant) => grant.userId));
  for (const companyMembership of companyMemberships) {
    if (companyMembership.status !== "active") continue;
    if (companyMembership.role === "owner") {
      protectedCompanyAccess.set(companyMembership.userId, "company_owner");
    } else if (grantedCompanyAdminIds.has(companyMembership.userId)) {
      protectedCompanyAccess.set(companyMembership.userId, "company_grant");
    }
  }
  for (const membership of visibleMemberships) {
    if (!membership.userId || userById.has(membership.userId)) continue;
    const user = await deps.identityStore!.getUserById?.(membership.userId);
    if (user) userById.set(membership.userId, user);
  }
  for (const grant of [...activeClientGrants, ...skillGrants]) {
    if (userById.has(grant.userId)) continue;
    const user = await deps.identityStore!.getUserById?.(grant.userId);
    if (user) userById.set(grant.userId, user);
  }
  for (const userId of protectedCompanyAccess.keys()) {
    if (userById.has(userId)) continue;
    const user = await deps.identityStore!.getUserById?.(userId);
    if (user) userById.set(userId, user);
  }

  type EffectiveAdminMember = IdentityMembership & {
    protected: boolean;
    source: "membership" | "company_owner" | "company_grant";
  };
  const effectiveMembersByUserId = new Map<string, EffectiveAdminMember>();
  for (const membership of visibleMemberships) {
    if (!membership.userId) continue;
    effectiveMembersByUserId.set(membership.userId, {
      ...membership,
      protected: false,
      source: "membership",
    });
  }
  for (const [userId, source] of protectedCompanyAccess) {
    const current = effectiveMembersByUserId.get(userId);
    effectiveMembersByUserId.set(userId, {
      ...(current ?? { id: `company:${principal.teamId}:${userId}`, teamId: principal.teamId, userId }),
      role: current?.role === "owner" ? "owner" : "admin",
      status: "active",
      protected: true,
      source,
    });
  }
  const effectiveMembers = [...effectiveMembersByUserId.values()];
  const autoClientMemberships = effectiveMembers.filter(isAutoClientMember);

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const activeClients = clients.filter((client) => !client.status || client.status === "active");
  const explicitGrantKey = (clientId: string, userId: string) => `${clientId}:${userId}`;
  const explicitActiveGrantKeys = new Set(activeClientGrants.map((grant) => explicitGrantKey(grant.clientId, grant.userId)));
  const effectiveClientGrants = [
    ...activeClientGrants.map((grant) => ({
      id: grant.id,
      clientId: grant.clientId,
      userId: grant.userId,
      access: grant.access,
      status: grant.status,
      grantedAt: grant.grantedAt ?? null,
      revokedAt: grant.revokedAt ?? null,
      implicit: false,
      protected: false,
    })),
    ...autoClientMemberships.flatMap((membership) =>
      activeClients.flatMap((client) => {
        const userId = membership.userId;
        if (!userId) return [];
        if (explicitActiveGrantKeys.has(explicitGrantKey(client.id, userId))) return [];
        return [{
          id: `auto:${client.id}:${userId}`,
          clientId: client.id,
          userId,
          access: "write" as GrantAccess,
          status: "active",
          grantedAt: null,
          revokedAt: null,
          implicit: true,
          protected: true,
        }];
      }),
    ),
  ];

  return {
    team: team
      ? { id: team.id, slug: team.slug, name: team.name }
      : { id: principal.teamId, slug: null, name: null },
    members: effectiveMembers.map((membership) => {
      const user = membership.userId ? userById.get(membership.userId) : null;
      return {
        id: membership.id ?? null,
        userId: membership.userId ?? null,
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
        role: membership.role ?? null,
        status: membership.status,
        protected: membership.protected,
        source: membership.source,
        invitedBy: membership.invitedBy ?? null,
        createdAt: membership.createdAt ?? null,
        updatedAt: membership.updatedAt ?? null,
        clients: effectiveClientGrants
          .filter((grant) => grant.userId === membership.userId)
          .map((grant) => {
            const client = clientById.get(grant.clientId);
            return {
              id: grant.clientId,
              slug: client?.slug ?? grant.clientId,
              name: client?.name ?? client?.slug ?? grant.clientId,
              access: grant.access,
              implicit: grant.implicit,
              protected: grant.protected,
            };
          }),
      };
    }),
    clients: clients.map((client) => ({
      id: client.id,
      slug: client.slug,
      name: client.name ?? client.slug,
      status: client.status ?? "active",
    })),
    clientGrants: effectiveClientGrants.map((grant) => {
      const user = userById.get(grant.userId);
      const client = clientById.get(grant.clientId);
      return {
        id: grant.id,
        clientId: grant.clientId,
        clientSlug: client?.slug ?? grant.clientId,
        clientName: client?.name ?? client?.slug ?? grant.clientId,
        userId: grant.userId,
        email: user?.email ?? grant.userId,
        access: grant.access,
        status: grant.status,
        grantedAt: grant.grantedAt,
        revokedAt: grant.revokedAt,
        implicit: grant.implicit,
        protected: grant.protected,
      };
    }),
    skillGrants: skillGrants.map((grant) => {
      const user = userById.get(grant.userId);
      return {
        id: grant.id,
        skillName: grant.skillName,
        userId: grant.userId,
        email: user?.email ?? grant.userId,
        permission: grant.permission,
        status: grant.status,
        grantedAt: grant.grantedAt ?? null,
        revokedAt: grant.revokedAt ?? null,
      };
    }),
    serverSkills,
    storage,
    audit,
    ...extra,
  };
}

export async function handleTeamAdminRequest(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireAdminPrincipal(deps, context);
    return { status: 200, body: await shapeTeamAdminState(deps, principal) };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleTeamAdminActionRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireAdminPrincipal(deps, context);
    const raw = asRecord(rawBody, "invalid_request", "body");
    const action = requiredString(raw, "action").trim();

    if (action === "invite-member") {
      const role = parseEnumValue(raw, "role", VALID_ROLES, "member");
      if (role === "owner") throw new ApiError(400, "invalid_request", "owner is not invitable");
      const email = requiredString(raw, "email").trim().toLowerCase();
      const existingUser = await deps.identityStore!.getUserByEmail?.(email);
      if (existingUser) {
        await requireManageableTeamCredential(deps, principal.teamId, existingUser.id);
      }
      await requireInvitationOnlyAccount(deps.identityStore as unknown as IdentityStore, email);
      const result = await inviteMember(deps.identityStore as never, {
        teamId: principal.teamId,
        actorUserId: principal.userId,
        email,
        role,
      });
      return {
        status: 200,
        body: await shapeTeamAdminState(
          deps,
          principal,
          await shapeInviteResult(deps, principal, context, result),
        ),
      };
    }

    if (action === "create-invite-link") {
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      await requireManageableTeamCredential(deps, principal.teamId, user.id);
      const membership = await deps.identityStore!.getMembership(principal.teamId, user.id);
      if (!membership || membership.status !== "invited") {
        throw new ApiError(400, "invalid_request", "user does not have a pending invite");
      }
      if (membership.role === "owner") {
        throw new ApiError(400, "invalid_request", "owner is not invitable");
      }
      await requireInvitationOnlyAccount(deps.identityStore as unknown as IdentityStore, user.email);
      const result = await inviteMember(deps.identityStore as never, {
        teamId: principal.teamId,
        actorUserId: principal.userId,
        email: user.email,
        role: membership.role === "admin" ? "admin" : "member",
      });
      return {
        status: 200,
        body: await shapeTeamAdminState(
          deps,
          principal,
          await shapeInviteResult(deps, principal, context, result),
        ),
      };
    }

    if (action === "create-client") {
      if (!deps.identityStore!.createClient) {
        throw new ApiError(500, "internal", "client management is unavailable");
      }
      const name = optionalTrimmedString(raw, "name") ?? optionalTrimmedString(raw, "slug");
      if (!name) {
        throw new ApiError(400, "invalid_request", "client name is required");
      }
      const explicitSlug = optionalTrimmedString(raw, "slug");
      if (!explicitSlug) {
        await createClientWithGeneratedSlug(deps, principal.teamId, name);
        return { status: 200, body: await shapeTeamAdminState(deps, principal) };
      }

      const slug = normalizeClientSlug(explicitSlug);
      const validationError = clientSlugValidationError(slug);
      if (validationError) {
        throw new ApiError(400, "invalid_request", validationError);
      }
      const created = await deps.identityStore!.createClient({
        teamId: principal.teamId,
        slug,
        name,
      });
      if (!created) {
        throw new ApiError(409, "conflict", `client slug already exists: ${slug}`);
      }
      return { status: 200, body: await shapeTeamAdminState(deps, principal) };
    }

    if (action === "grant-client") {
      if (!deps.identityStore!.grantClientAccess) {
        throw new ApiError(500, "internal", "client grants are unavailable");
      }
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      const client = await resolveAdminClient(deps, principal.teamId, requiredString(raw, "client"));
      await deps.identityStore!.grantClientAccess({
        teamId: principal.teamId,
        clientId: client.id,
        userId: user.id,
        access: parseEnumValue(raw, "access", VALID_GRANT_ACCESS, "read"),
        grantedBy: principal.userId,
      });
      return { status: 200, body: await shapeTeamAdminState(deps, principal) };
    }

    if (action === "revoke-client") {
      if (!deps.identityStore!.revokeClientAccess) {
        throw new ApiError(500, "internal", "client grants are unavailable");
      }
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      const client = await resolveAdminClient(deps, principal.teamId, requiredString(raw, "client"));
      await deps.identityStore!.revokeClientAccess({
        teamId: principal.teamId,
        clientId: client.id,
        userId: user.id,
        revokedBy: principal.userId,
      });
      return { status: 200, body: await shapeTeamAdminState(deps, principal) };
    }

    if (action === "grant-skill") {
      if (!deps.identityStore!.grantSkillAccess) {
        throw new ApiError(500, "internal", "skill grants are unavailable");
      }
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      await deps.identityStore!.grantSkillAccess({
        teamId: principal.teamId,
        skillName: requiredString(raw, "skillName").trim(),
        userId: user.id,
        permission: parseEnumValue(raw, "permission", VALID_SKILL_PERMISSIONS, "skill.use"),
        grantedBy: principal.userId,
      });
      return { status: 200, body: await shapeTeamAdminState(deps, principal) };
    }

    if (action === "revoke-skill") {
      if (!deps.identityStore!.revokeSkillAccess) {
        throw new ApiError(500, "internal", "skill grants are unavailable");
      }
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      await deps.identityStore!.revokeSkillAccess({
        teamId: principal.teamId,
        skillName: requiredString(raw, "skillName").trim(),
        userId: user.id,
        permission: parseEnumValue(raw, "permission", VALID_SKILL_PERMISSIONS, "skill.use"),
        revokedBy: principal.userId,
      });
      return { status: 200, body: await shapeTeamAdminState(deps, principal) };
    }

    if (action === "set-member-role") {
      if (!deps.identityStore!.setRole) {
        throw new ApiError(500, "internal", "member role management is unavailable");
      }
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      const membership = await deps.identityStore!.getMembership(principal.teamId, user.id);
      const role = parseEnumValue(raw, "role", VALID_ROLES, "member");
      if (!membership) throw new ApiError(404, "not_found", "member not found");
      if (
        membership.role === "owner" ||
        role === "owner" ||
        await hasProtectedCompanyTeamAccess(deps, principal.teamId, user.id)
      ) {
        throw new ApiError(403, "forbidden", "Team Owner and protected Company access cannot be changed here");
      }
      await deps.identityStore!.setRole(
        principal.teamId,
        user.id,
        role,
      );
      return { status: 200, body: await shapeTeamAdminState(deps, principal) };
    }

    if (action === "set-member-status") {
      if (!deps.identityStore!.setMembershipStatus) {
        throw new ApiError(500, "internal", "member status management is unavailable");
      }
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      const membership = await deps.identityStore!.getMembership(principal.teamId, user.id);
      if (!membership) throw new ApiError(404, "not_found", "member not found");
      if (
        membership.role === "owner" ||
        await hasProtectedCompanyTeamAccess(deps, principal.teamId, user.id)
      ) {
        throw new ApiError(403, "forbidden", "Team Owner and protected Company access cannot be changed here");
      }
      await deps.identityStore!.setMembershipStatus(
        principal.teamId,
        user.id,
        parseEnumValue(raw, "status", VALID_MEMBER_STATUSES, "active"),
      );
      return { status: 200, body: await shapeTeamAdminState(deps, principal) };
    }

    if (action === "create-password-reset-link") {
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      await requireManageableTeamCredential(deps, principal.teamId, user.id);
      const membership = await deps.identityStore!.getMembership(principal.teamId, user.id);
      if (!membership || membership.status !== "active") {
        throw new ApiError(400, "invalid_request", "password reset requires an active member");
      }
      const reset = await createPasswordResetTokenForUser(
        deps.identityStore as never,
        user as never,
        { teamId: principal.teamId },
      );
      return {
        status: 200,
        body: await shapeTeamAdminState(deps, principal, {
          reset: {
            email: user.email,
            expiresAt: reset.expiresAt,
            url: buildHostedUrl(context, "/team/reset-password", {
              email: user.email,
              token: reset.token,
            }),
          },
        }),
      };
    }

    if (action === "remove-member") {
      if (!deps.identityStore!.setMembershipStatus) {
        throw new ApiError(500, "internal", "member status management is unavailable");
      }
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      if (user.id === principal.userId) {
        throw new ApiError(400, "invalid_request", "you cannot remove yourself");
      }
      const membership = await deps.identityStore!.getMembership(principal.teamId, user.id);
      if (!membership || membership.status === "suspended") {
        throw new ApiError(404, "not_found", "member not found");
      }
      if (
        membership.role === "owner" ||
        await hasProtectedCompanyTeamAccess(deps, principal.teamId, user.id)
      ) {
        throw new ApiError(403, "forbidden", "Team Owner and protected Company access cannot be removed here");
      }
      if (membership.status === "active" && membership.role === "owner") {
        const memberships = deps.identityStore!.listMemberships
          ? await deps.identityStore!.listMemberships(principal.teamId)
          : [];
        const activeOwners = memberships.filter(
          (item) =>
            item.status === "active" &&
            item.role === "owner" &&
            item.userId !== user.id,
        );
        if (activeOwners.length === 0) {
          throw new ApiError(400, "invalid_request", "at least one active Team Owner is required");
        }
      }

      if (deps.identityStore!.listGrants && deps.identityStore!.revokeClientAccess) {
        const grants = await deps.identityStore!.listGrants({
          teamId: principal.teamId,
          userId: user.id,
        });
        for (const grant of grants) {
          if (grant.status !== "active") continue;
          await deps.identityStore!.revokeClientAccess({
            teamId: principal.teamId,
            clientId: grant.clientId,
            userId: user.id,
            revokedBy: principal.userId,
          });
        }
      }

      await deps.identityStore!.setMembershipStatus(principal.teamId, user.id, "suspended");
      await deps.identityStore!.recordAuditEvent({
        teamId: principal.teamId,
        actorUserId: principal.userId,
        action: "membership.removed",
        targetType: "membership",
        targetId: membership.id ?? null,
        summary: `removed ${user.email} from the team`,
        metadata: { userId: user.id },
      });
      return { status: 200, body: await shapeTeamAdminState(deps, principal) };
    }

    throw new ApiError(400, "invalid_request", `unknown admin action: ${action}`);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

// ── Team OS secrets ──────────────────────────────────────────────────────────

function requireSecretStore(deps: MemoryApiDeps): Required<Pick<
  MemoryApiIdentityStore,
  | "upsertTeamSecret"
  | "getTeamSecret"
  | "listTeamSecrets"
  | "archiveTeamSecret"
  | "grantSecretAccess"
  | "revokeSecretAccess"
  | "getActiveSecretGrant"
  | "listSecretGrants"
>> {
  const store = deps.identityStore;
  if (
    !store?.upsertTeamSecret ||
    !store.getTeamSecret ||
    !store.listTeamSecrets ||
    !store.archiveTeamSecret ||
    !store.grantSecretAccess ||
    !store.revokeSecretAccess ||
    !store.getActiveSecretGrant ||
    !store.listSecretGrants
  ) {
    throw new ApiError(500, "internal", "TeamOS secret management is unavailable");
  }
  return store as Required<Pick<
    MemoryApiIdentityStore,
    | "upsertTeamSecret"
    | "getTeamSecret"
    | "listTeamSecrets"
    | "archiveTeamSecret"
    | "grantSecretAccess"
    | "revokeSecretAccess"
    | "getActiveSecretGrant"
    | "listSecretGrants"
  >>;
}

function normalizeEnvKey(raw: string): string {
  const envKey = raw.trim().toUpperCase();
  if (!ENV_KEY_RE.test(envKey)) {
    throw new ApiError(400, "invalid_request", "envKey must look like FIRECRAWL_API_KEY");
  }
  return envKey;
}

async function clientForSecret(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  secret: IdentityTeamSecret,
): Promise<IdentityClient | null> {
  if (!secret.clientId) return null;
  const client = await deps.identityStore?.getClientById?.(secret.clientId);
  if (!client) {
    throw new ApiError(404, "not_found", "secret client not found");
  }
  return client;
}

async function canSyncSecret(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  secret: IdentityTeamSecret,
  admin: boolean,
): Promise<boolean> {
  if (secret.status !== "active") return false;
  if (!admin) {
    const grant = await deps.identityStore!.getActiveSecretGrant!(
      principal.teamId,
      secret.id,
      principal.userId,
    );
    if (!grant) return false;
  }
  if (secret.scope === "client") {
    const client = await clientForSecret(deps, principal, secret);
    if (!client) return false;
    if (!admin) {
      const grant = await deps.identityStore!.getActiveGrant(principal.teamId, client.id, principal.userId);
      if (!grant || grant.status !== "active") return false;
    }
  }
  return true;
}

async function shapeSecretMetadata(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  secrets: IdentityTeamSecret[],
  grants: IdentitySecretGrant[],
  admin: boolean,
): Promise<Record<string, unknown>[]> {
  const clients = deps.identityStore?.listClients ? await deps.identityStore.listClients(principal.teamId) : [];
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const userIds = new Set(grants.map((grant) => grant.userId));
  const userById = new Map<string, IdentityUser>();
  if (deps.identityStore?.getUserById) {
    for (const userId of userIds) {
      const user = await deps.identityStore.getUserById(userId);
      if (user) userById.set(userId, user);
    }
  }
  return secrets.map((secret) => {
    const client = secret.clientId ? clientById.get(secret.clientId) : null;
    const activeGrants = grants.filter((grant) => grant.secretId === secret.id && grant.status === "active");
    return {
      id: secret.id,
      name: secret.name,
      envKey: secret.envKey,
      scope: secret.scope,
      clientId: secret.clientId,
      clientSlug: client?.slug ?? null,
      clientName: client?.name ?? null,
      status: secret.status,
      updatedAt: secret.updatedAt ?? null,
      createdAt: secret.createdAt ?? null,
      grantedToCurrentUser: activeGrants.some((grant) => grant.userId === principal.userId) || admin,
      grants: admin
        ? activeGrants.map((grant) => {
            const user = userById.get(grant.userId);
            return {
              id: grant.id,
              userId: grant.userId,
              email: user?.email ?? grant.userId,
              access: grant.access,
              status: grant.status,
              grantedAt: grant.grantedAt ?? null,
            };
          })
        : undefined,
    };
  });
}

async function listVisibleSecretsForPrincipal(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  clientSlug?: string | null,
): Promise<{ admin: boolean; secrets: IdentityTeamSecret[]; grants: IdentitySecretGrant[] }> {
  const secretStore = requireSecretStore(deps);
  const membership = await deps.identityStore!.getMembership(principal.teamId, principal.userId);
  const admin = hasFullTeamAccess(principal, membership);
  let selectedClient: IdentityClient | null = null;
  if (clientSlug?.trim()) {
    selectedClient = await deps.identityStore!.getClientBySlug(principal.teamId, clientSlug.trim());
    if (!selectedClient) throw new ApiError(404, "not_found", "client not found");
    if (!admin) {
      const grant = await deps.identityStore!.getActiveGrant(principal.teamId, selectedClient.id, principal.userId);
      if (!grant || grant.status !== "active") throw new ApiError(403, "forbidden", "client access is required");
    }
  }

  const secrets = await secretStore.listTeamSecrets({ teamId: principal.teamId });
  const grants = admin
    ? await secretStore.listSecretGrants({ teamId: principal.teamId })
    : await secretStore.listSecretGrants({ teamId: principal.teamId, userId: principal.userId });

  const activeGrantSecretIds = new Set(grants.filter((grant) => grant.status === "active").map((grant) => grant.secretId));
  const visible: IdentityTeamSecret[] = [];
  for (const secret of secrets) {
    if (selectedClient) {
      if (secret.scope === "client" && secret.clientId !== selectedClient.id) continue;
    }
    if (!admin && !activeGrantSecretIds.has(secret.id)) continue;
    if (!(await canSyncSecret(deps, principal, secret, admin))) continue;
    visible.push(secret);
  }
  return { admin, secrets: visible, grants };
}

export async function handleTeamSecretsListRequest(
  deps: MemoryApiDeps,
  query: { client?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    requireSecretStore(deps);
    const principal = await requireTeamApiPrincipal(deps, context);
    const { admin, secrets, grants } = await listVisibleSecretsForPrincipal(
      deps,
      principal,
      query.client ?? null,
    );
    return {
      status: 200,
      body: {
        admin,
        secrets: await shapeSecretMetadata(deps, principal, secrets, grants, admin),
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleTeamSecretsActionRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const secretStore = requireSecretStore(deps);
    const principal = await requireAdminPrincipal(deps, context);
    const raw = asRecord(rawBody, "invalid_request", "body");
    const action = requiredString(raw, "action").trim();

    if (action === "create-secret" || action === "update-secret") {
      const scope = parseEnumValue(raw, "scope", VALID_SECRET_SCOPES, "team");
      const name = requiredString(raw, "name").trim();
      const envKey = normalizeEnvKey(requiredString(raw, "envKey"));
      const value = requiredString(raw, "value");
      if (!name) throw new ApiError(400, "invalid_request", "name is required");
      if (value === "") throw new ApiError(400, "invalid_request", "secret value cannot be empty");
      let clientId: string | null = null;
      if (scope === "client") {
        const clientRef = requiredString(raw, "client");
        const client = await resolveAdminClient(deps, principal.teamId, clientRef);
        clientId = client.id;
      }
      const encrypted = encryptSecretValue(value);
      await secretStore.upsertTeamSecret({
        teamId: principal.teamId,
        clientId,
        scope,
        name,
        envKey,
        encryptedValue: encrypted.encryptedValue,
        encryptionKeyId: encrypted.encryptionKeyId,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        valueSha256: encrypted.valueSha256,
        actorUserId: principal.userId,
      });
      return handleTeamSecretsListRequest(deps, {}, context);
    }

    if (action === "grant-secret") {
      const secret = await secretStore.getTeamSecret(principal.teamId, requiredString(raw, "secret"));
      if (!secret || secret.status !== "active") throw new ApiError(404, "not_found", "secret not found");
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      await secretStore.grantSecretAccess({
        teamId: principal.teamId,
        secretId: secret.id,
        userId: user.id,
        grantedBy: principal.userId,
      });
      return handleTeamSecretsListRequest(deps, {}, context);
    }

    if (action === "revoke-secret") {
      const secret = await secretStore.getTeamSecret(principal.teamId, requiredString(raw, "secret"));
      if (!secret) throw new ApiError(404, "not_found", "secret not found");
      const user = await resolveAdminUser(deps, requiredString(raw, "user"));
      await secretStore.revokeSecretAccess({
        teamId: principal.teamId,
        secretId: secret.id,
        userId: user.id,
        revokedBy: principal.userId,
      });
      return handleTeamSecretsListRequest(deps, {}, context);
    }

    if (action === "archive-secret") {
      const archived = await secretStore.archiveTeamSecret({
        teamId: principal.teamId,
        secretId: requiredString(raw, "secret"),
        actorUserId: principal.userId,
      });
      if (!archived) throw new ApiError(404, "not_found", "secret not found");
      return handleTeamSecretsListRequest(deps, {}, context);
    }

    throw new ApiError(400, "invalid_request", `unknown secret action: ${action}`);
  } catch (error) {
    if (error instanceof SecretCryptoError) {
      return errorResponse(new ApiError(500, "secret_crypto_unavailable", error.message));
    }
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleTeamSecretsSyncRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    requireSecretStore(deps);
    const principal = await requireTeamApiPrincipal(deps, context);
    const raw = asRecord(rawBody, "invalid_request", "body");
    const selectedClient = optionalTrimmedString(raw, "client");
    const { admin, secrets } = await listVisibleSecretsForPrincipal(deps, principal, selectedClient);
    const clients = deps.identityStore?.listClients ? await deps.identityStore.listClients(principal.teamId) : [];
    const clientById = new Map(clients.map((client) => [client.id, client]));
    const teamSecrets: Array<Record<string, unknown>> = [];
    const clientSecrets = new Map<string, { client: IdentityClient; secrets: Array<Record<string, unknown>> }>();

    for (const secret of secrets) {
      const value = decryptSecretValue({
        encryptedValue: secret.encryptedValue,
        encryptionKeyId: secret.encryptionKeyId,
        nonce: secret.nonce,
        authTag: secret.authTag,
        valueSha256: secret.valueSha256,
      });
      const item = { id: secret.id, name: secret.name, envKey: secret.envKey, value };
      if (secret.scope === "team") {
        teamSecrets.push(item);
      } else if (secret.clientId) {
        const client = clientById.get(secret.clientId);
        if (!client) continue;
        if (!clientSecrets.has(client.id)) clientSecrets.set(client.id, { client, secrets: [] });
        clientSecrets.get(client.id)!.secrets.push(item);
      }
    }

    await deps.identityStore!.recordAuditEvent({
      teamId: principal.teamId,
      actorUserId: principal.userId,
      action: "secret.synced",
      targetType: "team",
      targetId: principal.teamId,
      summary: "synced TeamOS secrets",
      metadata: {
        teamSecretCount: teamSecrets.length,
        clientSecretCount: Array.from(clientSecrets.values()).reduce((count, group) => count + group.secrets.length, 0),
        client: selectedClient ?? null,
        authSource: principal.authSource ?? null,
      },
    });

    return {
      status: 200,
      body: {
        admin,
        team: { secrets: teamSecrets },
        clients: Array.from(clientSecrets.values()).map(({ client, secrets: groupSecrets }) => ({
          id: client.id,
          slug: client.slug,
          name: client.name ?? client.slug,
          secrets: groupSecrets,
        })),
      },
    };
  } catch (error) {
    if (error instanceof SecretCryptoError) {
      return errorResponse(new ApiError(500, "secret_crypto_unavailable", error.message));
    }
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

// ── Private encrypted user config files ──────────────────────────────────────

const ALLOWED_USER_CONFIG_FILES = new Set([".mcp.json"]);

function normalizeUserConfigFilePath(rawPath: unknown): string {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new ApiError(400, "invalid_request", "path is required");
  }
  const filePath = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    filePath.includes("\0") ||
    filePath.includes("/") ||
    path.posix.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath)
  ) {
    throw new ApiError(400, "invalid_request", "path must be a file name");
  }
  if (!ALLOWED_USER_CONFIG_FILES.has(filePath)) {
    throw new ApiError(400, "invalid_request", "user config file path is not allowed");
  }
  return filePath;
}

function requireUserConfigFileStore(deps: MemoryApiDeps): Required<Pick<
  MemoryApiIdentityStore,
  "upsertUserConfigFile" | "getUserConfigFile" | "recordAuditEvent"
>> {
  const store = deps.identityStore;
  if (!store?.upsertUserConfigFile || !store.getUserConfigFile || !store.recordAuditEvent) {
    throw new ApiError(500, "internal", "TeamOS user config file sync is unavailable");
  }
  return store as Required<Pick<
    MemoryApiIdentityStore,
    "upsertUserConfigFile" | "getUserConfigFile" | "recordAuditEvent"
  >>;
}

function shapeUserConfigFileMetadata(file: IdentityUserConfigFile): Record<string, unknown> {
  return {
    id: file.id,
    path: file.path,
    sha256: file.valueSha256,
    keyId: file.encryptionKeyId,
    algorithm: "AES-256-GCM",
    updatedAt: file.updatedAt ?? null,
    createdAt: file.createdAt ?? null,
  };
}

export async function handleUserConfigFileReadRequest(
  deps: MemoryApiDeps,
  query: { path?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const store = requireUserConfigFileStore(deps);
    const principal = await requireTeamApiPrincipal(deps, context);
    const filePath = normalizeUserConfigFilePath(query.path);
    const file = await store.getUserConfigFile(principal.teamId, principal.userId, filePath);
    if (!file) {
      return { status: 200, body: { file: null } };
    }

    const content = decryptSecretValue({
      encryptedValue: file.encryptedValue,
      encryptionKeyId: file.encryptionKeyId,
      nonce: file.nonce,
      authTag: file.authTag,
      valueSha256: file.valueSha256,
    });
    await store.recordAuditEvent({
      teamId: principal.teamId,
      actorUserId: principal.userId,
      action: "config.synced",
      targetType: "user_config_file",
      targetId: file.id,
      summary: `read user config file ${file.path}`,
      metadata: {
        path: file.path,
        sha256: file.valueSha256,
        authSource: principal.authSource ?? null,
      },
    });

    return {
      status: 200,
      body: {
        file: {
          ...shapeUserConfigFileMetadata(file),
          content,
        },
      },
    };
  } catch (error) {
    if (error instanceof SecretCryptoError) {
      return errorResponse(new ApiError(500, "secret_crypto_unavailable", error.message));
    }
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleUserConfigFileWriteRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const store = requireUserConfigFileStore(deps);
    const principal = await requireTeamApiPrincipal(deps, context);
    const body = asRecord(rawBody, "invalid_request", "request body");
    const filePath = normalizeUserConfigFilePath(body.path);
    const content = requiredString(body, "content");
    if (Buffer.byteLength(content, "utf-8") > MAX_WORKSPACE_FILE_BYTES) {
      throw new ApiError(413, "payload_too_large", `content exceeds ${MAX_WORKSPACE_FILE_BYTES} bytes`);
    }
    try {
      JSON.parse(content);
    } catch {
      throw new ApiError(400, "invalid_request", "content must be valid JSON");
    }

    const current = await store.getUserConfigFile(principal.teamId, principal.userId, filePath);
    const expectedSha256 = optionalString(body, "expectedSha256");
    if (current && !expectedSha256) {
      throw new ApiError(409, "conflict", "expectedSha256 is required when the config file already exists");
    }
    if (current && expectedSha256 !== current.valueSha256) {
      throw new ApiError(409, "conflict", "user config file changed");
    }

    const encrypted = encryptSecretValue(content);
    const file = await store.upsertUserConfigFile({
      teamId: principal.teamId,
      userId: principal.userId,
      path: filePath,
      encryptedValue: encrypted.encryptedValue,
      encryptionKeyId: encrypted.encryptionKeyId,
      nonce: encrypted.nonce,
      authTag: encrypted.authTag,
      valueSha256: encrypted.valueSha256,
      actorUserId: principal.userId,
      metadata: {
        algorithm: "AES-256-GCM",
      },
    });

    return {
      status: 200,
      body: {
        file: shapeUserConfigFileMetadata(file),
      },
    };
  } catch (error) {
    if (error instanceof SecretCryptoError) {
      return errorResponse(new ApiError(500, "secret_crypto_unavailable", error.message));
    }
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

// ── server skill file sync ───────────────────────────────────────────────────

export async function handleSkillsListRequest(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireTeamApiPrincipal(deps, context);
    return {
      status: 200,
      body: { skills: await listServerSkillSummaries(deps, principal) },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleSkillManifestRequest(
  deps: MemoryApiDeps,
  query: { skill?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const principal = await requireTeamApiPrincipal(deps, context);
    const skillName = normalizeSkillName(query.skill);
    await requireSkillServerAccess(deps, principal, skillName, "skill.use");
    if (!(await skillDirectoryExists(root, skillName))) {
      throw new ApiError(404, "not_found", "skill not found");
    }
    const manifest = await collectSkillManifest(root, skillName);
    return {
      status: 200,
      body: {
        skill: skillName,
        files: manifest.files,
        filesCount: manifest.filesCount,
        manifestHash: manifest.manifestHash,
        unsupportedFiles: manifest.unsupportedFiles,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleSkillFileReadRequest(
  deps: MemoryApiDeps,
  query: { path?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const relativePath = normalizeSkillFilePath(query.path);
    const skillName = skillNameFromSkillPath(relativePath);
    const principal = await requireTeamApiPrincipal(deps, context);
    await requireSkillServerAccess(deps, principal, skillName, "skill.use");
    const fullPath = resolveSkillPath(root, relativePath);
    const stat = await statFileOrNull(fullPath);
    if (!stat || !stat.isFile() || stat.size > MAX_WORKSPACE_FILE_BYTES) {
      throw new ApiError(404, "not_found", "file not found");
    }
    const content = await fs.readFile(fullPath);
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.pull",
      "skill",
      skillName,
      "skill file pulled",
      { path: relativePath, skillName, size: stat.size, sha256: sha256(content) },
    );
    return {
      status: 200,
      body: {
        path: relativePath,
        size: stat.size,
        sha256: sha256(content),
        ...(isLikelyTextBuffer(relativePath, content) ? { normalizedSha256: normalizedTextSha256(content) } : {}),
        updatedAt: stat.mtime.toISOString(),
        ...workspaceFilePayload(relativePath, content),
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleSkillFileWriteRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  query: { path?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const relativePath = normalizeSkillFilePath(query.path);
    const skillName = skillNameFromSkillPath(relativePath);
    const principal = await requireTeamApiPrincipal(deps, context);
    const exists = await skillDirectoryExists(root, skillName);
    if (exists) {
      await requireSkillServerAccess(deps, principal, skillName, "skill.admin");
    } else {
      const membership = await deps.identityStore!.getMembership(principal.teamId, principal.userId);
      if (!hasFullTeamAccess(principal, membership)) {
        throw new ApiError(403, "forbidden", "creating server skills requires Owner or Admin");
      }
    }

    const body = asRecord(rawBody, "invalid_request", "request body");
    const content = workspaceBodyToBuffer(body);
    if (content.length > MAX_WORKSPACE_FILE_BYTES) {
      throw new ApiError(
        413,
        "payload_too_large",
        `file content exceeds ${MAX_WORKSPACE_FILE_BYTES} bytes`,
      );
    }
    const fullPath = resolveSkillPath(root, relativePath);
    if (body.expectedSha256 != null) {
      if (typeof body.expectedSha256 !== "string" || body.expectedSha256.trim() === "") {
        throw new ApiError(400, "invalid_request", "expectedSha256 must be a string");
      }
      const current = await statFileOrNull(fullPath);
      if (current && current.isFile()) {
        const currentHash = sha256(await fs.readFile(fullPath));
        if (currentHash !== body.expectedSha256) {
          await recordWorkspaceAudit(
            deps,
            principal,
            "sync.conflict",
            "skill",
            skillName,
            "skill sync conflict",
            { path: relativePath, skillName, expectedSha256: body.expectedSha256, currentSha256: currentHash },
          );
          throw new ApiError(409, "conflict", "remote file changed");
        }
      }
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    const stat = await fs.stat(fullPath);
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.push",
      "skill",
      skillName,
      "skill file pushed",
      { path: relativePath, skillName, size: stat.size, sha256: sha256(content) },
    );
    return {
      status: 200,
      body: {
        path: relativePath,
        size: stat.size,
        sha256: sha256(content),
        ...(isLikelyTextBuffer(relativePath, content) ? { normalizedSha256: normalizedTextSha256(content) } : {}),
        updatedAt: stat.mtime.toISOString(),
      },
    };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleSkillFileDeleteRequest(
  deps: MemoryApiDeps,
  query: { path?: string | null; expectedSha256?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const relativePath = normalizeSkillFilePath(query.path);
    const skillName = skillNameFromSkillPath(relativePath);
    const principal = await requireTeamApiPrincipal(deps, context);
    await requireSkillServerAccess(deps, principal, skillName, "skill.admin");
    const fullPath = resolveSkillPath(root, relativePath);
    const stat = await statFileOrNull(fullPath);
    if (!stat || !stat.isFile()) {
      return { status: 200, body: { deleted: false, path: relativePath } };
    }
    if (query.expectedSha256 != null && query.expectedSha256.trim() !== "") {
      const currentContent = await fs.readFile(fullPath);
      const currentHash = sha256(currentContent);
      if (currentHash !== query.expectedSha256) {
        await recordWorkspaceAudit(
          deps,
          principal,
          "sync.conflict",
          "skill",
          skillName,
          "skill sync conflict",
          { path: relativePath, skillName, expectedSha256: query.expectedSha256, currentSha256: currentHash, operation: "delete" },
        );
        throw new ApiError(409, "conflict", "remote file changed");
      }
    }
    await fs.unlink(fullPath);
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.push",
      "skill",
      skillName,
      "skill file deleted",
      { path: relativePath, skillName },
    );
    return { status: 200, body: { deleted: true, path: relativePath } };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

function scopeWhereForTeam(teamId: string | null): { sql: string; params: unknown[] } {
  return teamId == null
    ? { sql: "team_id IS NULL", params: [] }
    : { sql: "team_id = $1", params: [teamId] };
}

async function queryCount(
  deps: MemoryApiDeps,
  table: "memory_sources" | "memory_chunks" | "index_jobs" | "manual_imports" | "memory_capture_events",
  teamId: string | null,
): Promise<number> {
  const where = scopeWhereForTeam(teamId);
  const result = await deps.store.client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${where.sql}`,
    where.params,
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function queryCaptureEligibility(
  deps: MemoryApiDeps,
  teamId: string | null,
): Promise<{
  pending: number;
  eligiblePending: number;
  waitingPending: number;
  nextEligibleAt: string | null;
  volumeThreshold: number;
}> {
  const where = scopeWhereForTeam(teamId);
  const { rows } = await deps.store.client.query<{
    visibility: string;
    client_id: string | null;
    session_id: string;
    eligible_after: string | null;
  }>(
    `SELECT visibility, client_id, session_id, eligible_after::text AS eligible_after
       FROM memory_capture_events
      WHERE ${where.sql}
        AND status = 'pending'
        AND sync_status = 'synced'`,
    where.params,
  );

  const sessionCounts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.visibility}:${row.client_id ?? ""}:${row.session_id}`;
    sessionCounts.set(key, (sessionCounts.get(key) ?? 0) + 1);
  }

  const now = Date.now();
  let eligiblePending = 0;
  let waitingPending = 0;
  let nextEligibleMs = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const key = `${row.visibility}:${row.client_id ?? ""}:${row.session_id}`;
    const eligibleAt = Date.parse(String(row.eligible_after ?? ""));
    const timeEligible = Number.isFinite(eligibleAt) && eligibleAt <= now;
    const volumeEligible = (sessionCounts.get(key) ?? 0) >= CAPTURE_VOLUME_THRESHOLD;
    if (timeEligible || volumeEligible) {
      eligiblePending += 1;
      continue;
    }
    waitingPending += 1;
    if (Number.isFinite(eligibleAt) && eligibleAt < nextEligibleMs) nextEligibleMs = eligibleAt;
  }

  return {
    pending: rows.length,
    eligiblePending,
    waitingPending,
    nextEligibleAt: Number.isFinite(nextEligibleMs) ? new Date(nextEligibleMs).toISOString() : null,
    volumeThreshold: CAPTURE_VOLUME_THRESHOLD,
  };
}

export async function handleMemoryStatusRequest(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    let principal: MemoryApiPrincipal | null = null;
    if (deps.identityStore) {
      principal = await requireTeamApiPrincipal(deps, context);
    }
    const teamId = principal?.teamId ?? null;
    const where = scopeWhereForTeam(teamId);

    const [sources, chunks, jobs, manualImports, captureEvents, captureEligibility] = await Promise.all([
      queryCount(deps, "memory_sources", teamId),
      queryCount(deps, "memory_chunks", teamId),
      queryCount(deps, "index_jobs", teamId),
      queryCount(deps, "manual_imports", teamId),
      queryCount(deps, "memory_capture_events", teamId),
      queryCaptureEligibility(deps, teamId),
    ]);

    const visibilityRows = await deps.store.client.query<{ visibility: string; n: number }>(
      `SELECT visibility, count(*)::int AS n
         FROM memory_sources
        WHERE ${where.sql}
        GROUP BY visibility`,
      where.params,
    );
    const byVisibility: Record<string, number> = {};
    for (const row of visibilityRows.rows) {
      byVisibility[row.visibility] = Number(row.n);
    }

    const statusRows = await deps.store.client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n
         FROM index_jobs
        WHERE ${where.sql}
        GROUP BY status`,
      where.params,
    );
    const jobsByStatus: Record<string, number> = {};
    for (const row of statusRows.rows) {
      jobsByStatus[row.status] = Number(row.n);
    }

    const sourceStatusRows = await deps.store.client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n
         FROM memory_sources
        WHERE ${where.sql}
        GROUP BY status`,
      where.params,
    );
    const sourcesByStatus: Record<string, number> = {};
    for (const row of sourceStatusRows.rows) {
      sourcesByStatus[row.status] = Number(row.n);
    }

    const failedSources = await deps.store.client.query<{
      id: string;
      source_path: string;
      visibility: string;
      client_id: string | null;
      user_id: string | null;
      error_message: string | null;
      updated_at: string | null;
      indexed_at: string | null;
    }>(
      `SELECT id, source_path, visibility, client_id, user_id, error_message,
              updated_at::text AS updated_at,
              indexed_at::text AS indexed_at
         FROM memory_sources
        WHERE ${where.sql}
          AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 10`,
      where.params,
    );

    const importStatusRows = await deps.store.client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n
         FROM manual_imports
        WHERE ${where.sql}
        GROUP BY status`,
      where.params,
    );
    const manualImportsByStatus: Record<string, number> = {};
    for (const row of importStatusRows.rows) {
      manualImportsByStatus[row.status] = Number(row.n);
    }

    const captureStatusRows = await deps.store.client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n
         FROM memory_capture_events
        WHERE ${where.sql}
        GROUP BY status`,
      where.params,
    );
    const captureEventsByStatus: Record<string, number> = {};
    for (const row of captureStatusRows.rows) {
      captureEventsByStatus[row.status] = Number(row.n);
    }

    const lastJob = await deps.store.client.query<{
      source_path: string;
      reason: string;
      status: string;
      error_message: string | null;
      enqueued_at: string | null;
      started_at: string | null;
      finished_at: string | null;
    }>(
      `SELECT source_path, reason, status, error_message,
              enqueued_at::text AS enqueued_at,
              started_at::text AS started_at,
              finished_at::text AS finished_at
         FROM index_jobs
        WHERE ${where.sql}
        ORDER BY COALESCE(finished_at, started_at, enqueued_at) DESC
        LIMIT 1`,
      where.params,
    );

    const lastIndexed = await deps.store.client.query<{ finished_at: string | null }>(
      `SELECT max(finished_at)::text AS finished_at
         FROM index_jobs
        WHERE ${where.sql}
          AND status IN ('succeeded', 'skipped')`,
      where.params,
    );

    return {
      status: 200,
      body: {
        storeReady: true,
        scope: {
          mode: principal ? "team" : "local",
          teamId,
          userId: principal?.userId ?? null,
        },
        sources,
        chunks,
        jobs,
        manualImports,
        captureEvents,
        byVisibility,
        jobsByStatus,
        sourcesByStatus,
        failedSources: failedSources.rows.map((row) => ({
          id: row.id,
          sourcePath: row.source_path,
          visibility: row.visibility,
          clientId: row.client_id,
          userId: row.user_id,
          errorMessage: row.error_message,
          updatedAt: row.updated_at,
          indexedAt: row.indexed_at,
        })),
        manualImportsByStatus,
        captureEventsByStatus,
        captureEligibility,
        lastIndexedAt: lastIndexed.rows[0]?.finished_at ?? null,
        lastJob: lastJob.rows[0]
          ? {
              sourcePath: lastJob.rows[0].source_path,
              reason: lastJob.rows[0].reason,
              status: lastJob.rows[0].status,
              errorMessage: lastJob.rows[0].error_message,
              enqueuedAt: lastJob.rows[0].enqueued_at,
              startedAt: lastJob.rows[0].started_at,
              finishedAt: lastJob.rows[0].finished_at,
            }
          : null,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

// ── automatic capture staging + consolidation ──────────────────────────────

const CAPTURE_RETENTION_DAYS = 30;
const CAPTURE_ELIGIBILITY_MINUTES = 20;
const CAPTURE_VOLUME_THRESHOLD = 8;

const MEMORY_CAPTURE_COLUMNS = `
  id,
  team_id,
  client_id,
  actor_user_id,
  visibility,
  session_id,
  source_hash,
  source_path,
  source_type,
  title,
  content_date::text AS content_date,
  content,
  content_sha256,
  byte_size,
  status,
  sync_status,
  eligible_after::text AS eligible_after,
  claimed_batch_id,
  processed_at::text AS processed_at,
  redacted_at::text AS redacted_at,
  error_message,
  metadata,
  created_at::text AS created_at,
  updated_at::text AS updated_at`;

const MEMORY_BATCH_COLUMNS = `
  id,
  team_id,
  client_id,
  visibility,
  status,
  claimed_by_user_id,
  claim_token,
  capture_count,
  error_message,
  metadata,
  created_at::text AS created_at,
  updated_at::text AS updated_at,
  expires_at::text AS expires_at,
  completed_at::text AS completed_at`;

function shapeCapture(row: MemoryCaptureRow, includeContent = false): Record<string, unknown> {
  return {
    id: row.id,
    scope: {
      teamId: row.team_id,
      clientId: row.client_id,
      userId: null,
      visibility: row.visibility,
    },
    actorUserId: row.actor_user_id,
    sessionId: row.session_id,
    sourceHash: row.source_hash,
    sourcePath: row.source_path,
    sourceType: row.source_type,
    title: row.title,
    contentDate: row.content_date,
    contentSha256: row.content_sha256,
    byteSize: row.byte_size,
    status: row.status,
    syncStatus: row.sync_status,
    eligibleAfter: row.eligible_after,
    claimedBatchId: row.claimed_batch_id,
    processedAt: row.processed_at,
    redactedAt: row.redacted_at,
    errorMessage: row.error_message,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includeContent ? { content: row.content } : {}),
  };
}

function shapeBatch(row: MemoryConsolidationBatchRow): Record<string, unknown> {
  return {
    id: row.id,
    scope: {
      teamId: row.team_id,
      clientId: row.client_id,
      userId: null,
      visibility: row.visibility,
    },
    status: row.status,
    claimedByUserId: row.claimed_by_user_id,
    claimToken: row.claim_token,
    captureCount: Number(row.capture_count ?? 0),
    errorMessage: row.error_message,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
  };
}

function scopeMatchesBatch(scope: Scope, batch: MemoryConsolidationBatchRow): boolean {
  return (
    scope.visibility === batch.visibility &&
    scope.teamId === batch.team_id &&
    (scope.clientId ?? null) === (batch.client_id ?? null)
  );
}

async function redactProcessedCaptures(deps: MemoryApiDeps, teamId: string | null): Promise<number> {
  const params: unknown[] = [`${CAPTURE_RETENTION_DAYS} days`];
  let where = "processed_at IS NOT NULL AND processed_at < now() - ($1::interval)";
  if (teamId == null) {
    where += " AND team_id IS NULL";
  } else {
    params.push(teamId);
    where += ` AND team_id = $${params.length}`;
  }
  const result = await deps.store.client.query<{ n: number }>(
    `WITH redacted AS (
       UPDATE memory_capture_events
          SET content = '',
              status = 'redacted',
              redacted_at = now(),
              updated_at = now(),
              metadata = metadata || '{"redacted":true}'::jsonb
        WHERE status IN ('processed', 'review', 'failed')
          AND redacted_at IS NULL
          AND ${where}
      RETURNING id
     )
     SELECT count(*)::int AS n FROM redacted`,
    params,
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function recordCaptureAudit(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal | null,
  action: AuditAction,
  targetType: AuditTargetType,
  targetId: string,
  summary: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps.identityStore || !principal) return;
  await deps.identityStore.recordAuditEvent({
    teamId: principal.teamId,
    actorUserId: principal.userId,
    action,
    targetType,
    targetId,
    summary,
    metadata: { ...metadata, authSource: principal.authSource ?? null },
  });
}

async function insertCaptureEvent(
  deps: MemoryApiDeps,
  input: {
    scope: Scope;
    actorUserId: string;
    sessionId: string;
    sourceHash: string;
    sourcePath: string | null;
    sourceType: SourceType;
    title: string | null;
    contentDate: string | null;
    content: string;
    contentSha256: string;
    byteSize: number;
    eligibleAfter: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<MemoryCaptureRow> {
  const { rows } = await deps.store.client.query<MemoryCaptureRow>(
    `INSERT INTO memory_capture_events
       (team_id, client_id, actor_user_id, visibility, session_id, source_hash,
        source_path, source_type, title, content_date, content, content_sha256,
        byte_size, status, sync_status, eligible_after, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12,
             $13, 'pending', 'synced',
             COALESCE($14::timestamptz, now() + interval '${CAPTURE_ELIGIBILITY_MINUTES} minutes'),
             $15::jsonb, now())
     ON CONFLICT (team_id, COALESCE(client_id, ''), actor_user_id, session_id, source_hash)
     DO UPDATE SET
       source_path = EXCLUDED.source_path,
       source_type = EXCLUDED.source_type,
       title = EXCLUDED.title,
       content_date = EXCLUDED.content_date,
       content = EXCLUDED.content,
       content_sha256 = EXCLUDED.content_sha256,
       byte_size = EXCLUDED.byte_size,
       sync_status = 'synced',
       eligible_after = CASE
         WHEN memory_capture_events.status = 'pending' THEN EXCLUDED.eligible_after
         ELSE memory_capture_events.eligible_after
       END,
       metadata = EXCLUDED.metadata,
       updated_at = now()
     RETURNING ${MEMORY_CAPTURE_COLUMNS}`,
    [
      input.scope.teamId,
      input.scope.clientId,
      input.actorUserId,
      input.scope.visibility,
      input.sessionId,
      input.sourceHash,
      input.sourcePath,
      input.sourceType,
      input.title,
      input.contentDate,
      input.content,
      input.contentSha256,
      input.byteSize,
      input.eligibleAfter,
      JSON.stringify(input.metadata),
    ],
  );
  return rows[0];
}

async function deferPendingSessionCaptures(
  deps: MemoryApiDeps,
  capture: MemoryCaptureRow,
): Promise<void> {
  await deps.store.client.query(
    `UPDATE memory_capture_events
        SET eligible_after = $7::timestamptz,
            updated_at = now()
      WHERE team_id = $1
        AND visibility = $2
        AND client_id IS NOT DISTINCT FROM $3
        AND actor_user_id = $4
        AND session_id = $5
        AND status = 'pending'
        AND sync_status = 'synced'
        AND id <> $6`,
    [
      capture.team_id,
      capture.visibility,
      capture.client_id,
      capture.actor_user_id,
      capture.session_id,
      capture.id,
      capture.eligible_after,
    ],
  );
}

export async function handleCaptureCreateRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const requestedScope = parseCaptureScopeFromBody(body.scope);
    const authorized = await authorizeCaptureScope(deps, requestedScope, context);
    const content = requiredString(body, "content");
    const contentSha256 = optionalTrimmedString(body, "contentSha256") ?? sha256Hex(content);
    if (contentSha256 !== sha256Hex(content)) {
      throw new ApiError(400, "invalid_request", "contentSha256 does not match content");
    }
    const sourceHash = requiredString(body, "sourceHash").trim();
    const sessionId = requiredString(body, "sessionId").trim();
    const byteSize = body.byteSize == null ? Buffer.byteLength(content, "utf-8") : Number(body.byteSize);
    if (!Number.isInteger(byteSize) || byteSize < 0) {
      throw new ApiError(400, "invalid_request", "byteSize must be a non-negative integer");
    }
    const actorUserId = authorized.principal?.userId ?? optionalTrimmedString(body, "actorUserId");
    if (!actorUserId) {
      throw new ApiError(400, "invalid_request", "actorUserId is required when no identity store is configured");
    }

    await redactProcessedCaptures(deps, authorized.scope.teamId);

    const capture = await insertCaptureEvent(deps, {
      scope: authorized.scope,
      actorUserId,
      sessionId,
      sourceHash,
      sourcePath: optionalTrimmedString(body, "sourcePath"),
      sourceType: parseSourceType(body.sourceType ?? "session"),
      title: optionalString(body, "title"),
      contentDate: parseContentDate(body.contentDate),
      content,
      contentSha256,
      byteSize,
      eligibleAfter: parseIsoTimestamp(body.eligibleAfter, "eligibleAfter"),
      metadata: optionalMetadata(body),
    });
    await deferPendingSessionCaptures(deps, capture);

    await recordCaptureAudit(
      deps,
      authorized.principal,
      "memory.captured",
      "memory_capture",
      capture.id,
      `captured ${capture.source_path ?? capture.source_hash}`,
      {
        captureId: capture.id,
        sourceHash: capture.source_hash,
        sourcePath: capture.source_path,
        sessionId: capture.session_id,
        scope: auditScope(authorized.scope),
      },
    );

    return {
      status: 200,
      body: { capture: shapeCapture(capture) },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

async function insertConsolidationBatch(
  deps: MemoryApiDeps,
  input: {
    scope: Scope;
    principal: MemoryApiPrincipal | null;
    captureCount: number;
    metadata: Record<string, unknown>;
  },
): Promise<MemoryConsolidationBatchRow> {
  const claimToken = crypto.randomBytes(18).toString("base64url");
  const { rows } = await deps.store.client.query<MemoryConsolidationBatchRow>(
    `INSERT INTO memory_consolidation_batches
       (team_id, client_id, visibility, status, claimed_by_user_id,
        claim_token, capture_count, metadata, expires_at, updated_at)
     VALUES ($1, $2, $3, 'claimed', $4, $5, $6, $7::jsonb,
             now() + interval '30 minutes', now())
     RETURNING ${MEMORY_BATCH_COLUMNS}`,
    [
      input.scope.teamId,
      input.scope.clientId,
      input.scope.visibility,
      input.principal?.userId ?? null,
      claimToken,
      input.captureCount,
      JSON.stringify(input.metadata),
    ],
  );
  return rows[0];
}

async function releaseExpiredConsolidationBatches(
  deps: MemoryApiDeps,
  scope: Scope,
): Promise<number> {
  const expired = await deps.store.client.query<MemoryConsolidationBatchRow>(
    `UPDATE memory_consolidation_batches
        SET status = 'failed',
            error_message = COALESCE(error_message, 'claim expired before completion'),
            updated_at = now(),
            metadata = metadata || '{"expired":true}'::jsonb
      WHERE team_id = $1
        AND visibility = $2
        AND client_id IS NOT DISTINCT FROM $3
        AND status = 'claimed'
        AND expires_at IS NOT NULL
        AND expires_at < now()
      RETURNING ${MEMORY_BATCH_COLUMNS}`,
    [scope.teamId, scope.visibility, scope.clientId],
  );
  if (expired.rows.length === 0) return 0;

  await deps.store.client.query(
    `UPDATE memory_capture_events
        SET status = 'pending',
            claimed_batch_id = NULL,
            updated_at = now(),
            metadata = metadata || $2::jsonb
      WHERE claimed_batch_id = ANY($1::uuid[])
        AND status = 'claimed'`,
    [
      pgArrayLiteral(expired.rows.map((row) => row.id)),
      JSON.stringify({ claimExpiredAt: new Date().toISOString() }),
    ],
  );
  return expired.rows.length;
}

async function findClaimableCaptures(
  deps: MemoryApiDeps,
  input: {
    scope: Scope;
    principal: MemoryApiPrincipal | null;
    membership: IdentityMembership | null;
    limit: number;
  },
): Promise<MemoryCaptureRow[]> {
  const isAdmin = input.membership ? hasSharedIngestAuthority(input.membership) : true;
  const actorUserId = !isAdmin && input.principal ? input.principal.userId : null;
  const params: unknown[] = [
    input.scope.teamId,
    input.scope.visibility,
    input.scope.clientId,
    input.limit,
    CAPTURE_VOLUME_THRESHOLD,
    actorUserId,
  ];

  const { rows } = await deps.store.client.query<MemoryCaptureRow>(
    `SELECT ${MEMORY_CAPTURE_COLUMNS}
       FROM memory_capture_events c
      WHERE c.team_id = $1
        AND c.visibility = $2
        AND c.client_id IS NOT DISTINCT FROM $3
        AND c.status = 'pending'
        AND c.sync_status = 'synced'
        AND ($6::text IS NULL OR c.actor_user_id = $6)
        AND (
          c.eligible_after <= now()
          OR c.session_id IN (
            SELECT session_id
              FROM memory_capture_events
             WHERE team_id = $1
               AND visibility = $2
                AND client_id IS NOT DISTINCT FROM $3
                AND status = 'pending'
                AND sync_status = 'synced'
                AND ($6::text IS NULL OR actor_user_id = $6)
              GROUP BY session_id
             HAVING count(*) >= $5
          )
        )
      ORDER BY c.created_at ASC
      LIMIT $4`,
    params,
  );
  return rows;
}

export async function handleConsolidationClaimRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const requestedScope = parseCaptureScopeFromBody(body.scope);
    const authorized = await authorizeCaptureScope(deps, requestedScope, context);
    const limit = parsePositiveInt(body.limit, "limit", 20, 100);

    await redactProcessedCaptures(deps, authorized.scope.teamId);
    await releaseExpiredConsolidationBatches(deps, authorized.scope);

    const claimable = await findClaimableCaptures(deps, {
      scope: authorized.scope,
      principal: authorized.principal,
      membership: authorized.membership,
      limit,
    });

    if (claimable.length === 0) {
      return { status: 200, body: { batch: null, captures: [] } };
    }

    const batch = await insertConsolidationBatch(deps, {
      scope: authorized.scope,
      principal: authorized.principal,
      captureCount: claimable.length,
      metadata: {
        requestedLimit: limit,
        claimedByRole: authorized.membership?.role ?? null,
      },
    });

    const ids = claimable.map((row) => row.id);
    const updated = await deps.store.client.query<MemoryCaptureRow>(
      `UPDATE memory_capture_events
          SET status = 'claimed',
              claimed_batch_id = $1,
              updated_at = now()
        WHERE id = ANY($2::uuid[])
        RETURNING ${MEMORY_CAPTURE_COLUMNS}`,
      [batch.id, pgArrayLiteral(ids)],
    );

    await recordCaptureAudit(
      deps,
      authorized.principal,
      "memory.consolidation_claimed",
      "memory_consolidation_batch",
      batch.id,
      `claimed ${updated.rows.length} capture(s) for consolidation`,
      {
        batchId: batch.id,
        captureIds: ids,
        scope: auditScope(authorized.scope),
      },
    );

    return {
      status: 200,
      body: {
        batch: shapeBatch(batch),
        captures: updated.rows.map((row) => shapeCapture(row, true)),
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

async function loadConsolidationBatch(
  deps: MemoryApiDeps,
  batchId: string,
): Promise<MemoryConsolidationBatchRow | null> {
  const { rows } = await deps.store.client.query<MemoryConsolidationBatchRow>(
    `SELECT ${MEMORY_BATCH_COLUMNS}
       FROM memory_consolidation_batches
      WHERE id = $1
      LIMIT 1`,
    [batchId],
  );
  return rows[0] ?? null;
}

async function assertBatchCaptures(
  deps: MemoryApiDeps,
  batch: MemoryConsolidationBatchRow,
  captureIds: string[],
): Promise<MemoryCaptureRow[]> {
  const { rows } = await deps.store.client.query<MemoryCaptureRow>(
    `SELECT ${MEMORY_CAPTURE_COLUMNS}
       FROM memory_capture_events
      WHERE id = ANY($1::uuid[])
        AND claimed_batch_id = $2
        AND team_id = $3
        AND status = 'claimed'`,
    [pgArrayLiteral(captureIds), batch.id, batch.team_id],
  );
  if (rows.length !== captureIds.length) {
    throw new ApiError(409, "invalid_batch", "one or more captures are not claimed by this batch");
  }
  return rows;
}

async function insertSourceProvenance(
  deps: MemoryApiDeps,
  input: {
    sourceId: string;
    captures: MemoryCaptureRow[];
    contributionKind?: "capture" | "review" | "manual";
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  for (const capture of input.captures) {
    await deps.store.client.query(
      `INSERT INTO memory_source_provenance
         (source_id, capture_event_id, team_id, client_id, actor_user_id, contribution_kind, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (source_id, capture_event_id) DO NOTHING`,
      [
        input.sourceId,
        capture.id,
        capture.team_id,
        capture.client_id,
        capture.actor_user_id,
        input.contributionKind ?? "capture",
        JSON.stringify(input.metadata),
      ],
    );
  }
}

function parseConsolidationItem(raw: unknown, index: number): Record<string, unknown> {
  return asRecord(raw, "invalid_request", `items[${index}]`);
}

export async function handleConsolidationCompleteRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const batchId = requiredString(body, "batchId").trim();
    const claimToken = requiredString(body, "claimToken").trim();
    const batch = await loadConsolidationBatch(deps, batchId);
    if (!batch || batch.claim_token !== claimToken) {
      throw new ApiError(404, "not_found", "consolidation batch not found");
    }
    if (batch.status !== "claimed") {
      throw new ApiError(409, "invalid_batch", "consolidation batch is not claimable");
    }
    const requestedScope: Scope = {
      teamId: batch.team_id,
      clientId: batch.client_id,
      userId: null,
      visibility: batch.visibility,
    };
    const authorized = await authorizeConsolidatedMemoryScope(deps, requestedScope, context);
    if (!scopeMatchesBatch(authorized.scope, batch)) {
      throw new ApiError(403, "forbidden", "batch scope does not match authorized scope");
    }
    if (
      deps.identityStore &&
      batch.claimed_by_user_id &&
      authorized.principal?.userId !== batch.claimed_by_user_id
    ) {
      throw new ApiError(403, "forbidden", "only the claimant can complete this batch");
    }

    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new ApiError(400, "invalid_request", "items must be a non-empty array");
    }

    const published: Array<Record<string, unknown>> = [];
    const review: Array<Record<string, unknown>> = [];
    const discarded: Array<Record<string, unknown>> = [];

    for (const [index, rawItem] of rawItems.entries()) {
      const item = parseConsolidationItem(rawItem, index);
      const disposition = optionalTrimmedString(item, "disposition") ?? "publish";
      const captureIds = parseCaptureIds(item.captureIds);
      const captures = await assertBatchCaptures(deps, batch, captureIds);

      if (disposition === "review") {
        const reason = optionalTrimmedString(item, "reviewReason") ?? "needs_review";
        await deps.store.client.query(
          `UPDATE memory_capture_events
              SET status = 'review',
                  processed_at = now(),
                  updated_at = now(),
                  metadata = metadata || $1::jsonb
            WHERE id = ANY($2::uuid[])`,
          [
            JSON.stringify({
              review: {
                reason,
                batchId: batch.id,
                confidence: item.confidence ?? null,
              },
            }),
            pgArrayLiteral(captureIds),
          ],
        );
        review.push({ captureIds, reason });
        await recordCaptureAudit(
          deps,
          authorized.principal,
          "memory.review_requested",
          "memory_consolidation_batch",
          batch.id,
          `queued ${captureIds.length} capture(s) for memory review`,
          { batchId: batch.id, captureIds, reason },
        );
        continue;
      }

      if (disposition === "discard") {
        const reason = optionalTrimmedString(item, "discardReason") ?? "no_durable_memory";
        await deps.store.client.query(
          `UPDATE memory_capture_events
              SET status = 'processed',
                  processed_at = now(),
                  updated_at = now(),
                  metadata = metadata || $1::jsonb
            WHERE id = ANY($2::uuid[])`,
          [
            JSON.stringify({
              discard: {
                reason,
                batchId: batch.id,
                confidence: item.confidence ?? null,
              },
            }),
            pgArrayLiteral(captureIds),
          ],
        );
        discarded.push({ captureIds, reason });
        await recordCaptureAudit(
          deps,
          authorized.principal,
          "memory.discarded",
          "memory_consolidation_batch",
          batch.id,
          `discarded ${captureIds.length} capture(s) during memory consolidation`,
          { batchId: batch.id, captureIds, reason, confidence: item.confidence ?? null },
        );
        continue;
      }

      if (disposition !== "publish") {
        throw new ApiError(400, "invalid_request", `items[${index}].disposition must be publish, review, or discard`);
      }

      const itemScope = parseCaptureScopeFromBody(item.scope ?? requestedScope);
      const itemAuthorized = await authorizeConsolidatedMemoryScope(deps, itemScope, context);
      if (!scopeMatchesBatch(itemAuthorized.scope, batch)) {
        throw new ApiError(400, "invalid_scope", "published memory scope must match the batch scope");
      }
      const { spec, chunks } = parseClientProvidedChunks(deps, item);
      const { contentSha256, byteSize } = parseContentSha256AndByteSize(item);
      const sourcePath = requiredString(item, "sourcePath").trim();
      const sourceType = parseSourceType(item.sourceType ?? "memory");
      const metadata = {
        ...optionalMetadata(item),
        consolidation: {
          batchId: batch.id,
          captureIds,
          confidence: item.confidence ?? null,
          reviewPolicy: "auto_with_review",
        },
      };
      const result = await ingestPreparedContent({
        store: deps.store,
        scope: itemAuthorized.scope,
        sourcePath,
        sourceType,
        title: optionalString(item, "title"),
        contentDate: parseContentDate(item.contentDate),
        authorityWeight: parseAuthorityWeight(item.authorityWeight),
        contentSha256,
        byteSize,
        embeddingModel: spec.model,
        embeddingDim: spec.dim,
        chunks,
        force: item.force === true,
        reason: "session_capture",
        createdByUserId: authorized.principal?.userId ?? null,
        metadata,
      });

      await insertSourceProvenance(deps, {
        sourceId: result.sourceId,
        captures,
        metadata: { batchId: batch.id },
      });
      await deps.store.client.query(
        `UPDATE memory_capture_events
            SET status = 'processed',
                processed_at = now(),
                updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [pgArrayLiteral(captureIds)],
      );
      await recordCaptureAudit(
        deps,
        authorized.principal,
        "memory.published",
        "memory_source",
        result.sourceId,
        `published consolidated memory ${sourcePath}`,
        {
          batchId: batch.id,
          sourceId: result.sourceId,
          sourcePath,
          captureIds,
          scope: auditScope(itemAuthorized.scope),
          skipped: result.skipped,
        },
      );
      published.push({
        sourceId: result.sourceId,
        sourcePath,
        captureIds,
        skipped: result.skipped,
        chunksInserted: result.chunksInserted,
        chunksPruned: result.chunksPruned,
      });
    }

    const nextStatus = review.length > 0 && published.length === 0 && discarded.length === 0 ? "review" : "completed";
    const { rows } = await deps.store.client.query<MemoryConsolidationBatchRow>(
      `UPDATE memory_consolidation_batches
          SET status = $2,
              completed_at = now(),
              updated_at = now(),
              metadata = metadata || $3::jsonb
        WHERE id = $1
      RETURNING ${MEMORY_BATCH_COLUMNS}`,
      [
        batch.id,
        nextStatus,
        JSON.stringify({
          result: {
            published: published.length,
            review: review.length,
            discarded: discarded.length,
          },
        }),
      ],
    );
    await redactProcessedCaptures(deps, authorized.scope.teamId);

    return {
      status: 200,
      body: {
        batch: shapeBatch(rows[0]),
        published,
        review,
        discarded,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

// ── admin memory review + library ───────────────────────────────────────────

interface PublishedMemorySourceRow {
  id: string;
  team_id: string | null;
  client_id: string | null;
  user_id: string | null;
  visibility: "team" | "client" | "private" | "system";
  source_path: string;
  source_type: SourceType;
  title: string | null;
  created_by_user_id: string | null;
  content_date: string | null;
  authority_weight: number;
  content_sha256: string;
  byte_size: number | null;
  status: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
  archived_at: string | null;
}

interface MemoryChunkContentRow {
  source_id: string;
  chunk_index: number;
  content: string;
}

function looseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function memoryReviewReason(metadata: Record<string, unknown>): string | null {
  const review = looseRecord(metadata.review);
  const reason = review.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

function cleanReviewCaptureContent(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inHtmlComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inHtmlComment) {
      if (trimmed.includes("-->")) inHtmlComment = false;
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) inHtmlComment = true;
      continue;
    }
    if (/^#{1,6}\s+\d{4}-\d{2}-\d{2}\s+-\s+session auto-capture\b/i.test(trimmed)) continue;
    if (/^#{1,6}\s+Auto-capture\s*\(/i.test(trimmed)) continue;
    if (/^#{1,6}\s+Session\s+[A-Za-z0-9._-]+(?:\s+-\s+.+)?$/i.test(trimmed)) continue;
    if (/^Raw transcript:\s*`?[^`]+`?\s*$/i.test(trimmed)) continue;
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function titleFromMemoryContent(content: string): string | null {
  const heading = content.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (heading?.[1]?.trim()) return heading[1].trim().slice(0, 120);
  const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  return firstLine ? firstLine.replace(/^[-*+]\s+/, "").slice(0, 120) : null;
}

function slugForMemoryPath(value: string | null | undefined, fallback = "memory"): string {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function normalizeMemorySourcePath(raw: string): string {
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new ApiError(400, "invalid_request", "sourcePath is invalid");
  }
  return parts.join("/");
}

function defaultReviewedMemorySourcePath(capture: MemoryCaptureRow, title: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const scope = capture.visibility === "client"
    ? `client-${slugForMemoryPath(capture.client_id, "client")}`
    : "team";
  return `reviewed/${scope}/${date}-${capture.id.slice(0, 8)}-${slugForMemoryPath(title)}.md`;
}

async function loadMemoryClientLabels(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal | null,
): Promise<Map<string, { id: string; slug: string; name?: string | null }>> {
  const out = new Map<string, { id: string; slug: string; name?: string | null }>();
  if (!deps.identityStore?.listClients || !principal) return out;
  const clients = await deps.identityStore.listClients(principal.teamId);
  for (const client of clients) {
    out.set(client.slug, { id: client.id, slug: client.slug, name: client.name ?? null });
    out.set(client.id, { id: client.id, slug: client.slug, name: client.name ?? null });
  }
  return out;
}

async function loadMemoryUserLabels(
  deps: MemoryApiDeps,
  userIds: string[],
): Promise<Map<string, { id: string; email?: string | null; displayName?: string | null }>> {
  const out = new Map<string, { id: string; email?: string | null; displayName?: string | null }>();
  if (!deps.identityStore?.getUserById) return out;
  for (const id of [...new Set(userIds.filter(Boolean))]) {
    const user = await deps.identityStore.getUserById(id);
    if (user) out.set(id, { id: user.id, email: user.email, displayName: user.displayName ?? null });
  }
  return out;
}

function shapeMemoryScope(
  row: { team_id: string | null; client_id: string | null; user_id?: string | null; visibility: string },
  clientLabels: Map<string, { id: string; slug: string; name?: string | null }>,
): Record<string, unknown> {
  const client = row.client_id ? clientLabels.get(row.client_id) : null;
  return {
    teamId: row.team_id,
    clientId: row.client_id,
    clientSlug: client?.slug ?? row.client_id,
    clientName: client?.name ?? null,
    userId: row.user_id ?? null,
    visibility: row.visibility,
  };
}

function shapeReviewMemory(
  row: MemoryCaptureRow,
  clientLabels: Map<string, { id: string; slug: string; name?: string | null }>,
  userLabels: Map<string, { id: string; email?: string | null; displayName?: string | null }>,
): Record<string, unknown> {
  const actor = userLabels.get(row.actor_user_id);
  const metadata = row.metadata ?? {};
  const reason = memoryReviewReason(metadata) ?? row.error_message ?? "needs_review";
  const content = row.status === "redacted" ? "" : cleanReviewCaptureContent(row.content);
  return {
    id: row.id,
    kind: "review",
    scope: shapeMemoryScope(row, clientLabels),
    actorUserId: row.actor_user_id,
    actorEmail: actor?.email ?? null,
    actorDisplayName: actor?.displayName ?? null,
    sessionId: row.session_id,
    sourcePath: row.source_path,
    sourceType: row.source_type,
    title: titleFromMemoryContent(content) || row.title || "Memory review item",
    contentDate: row.content_date,
    content,
    contentAvailable: row.status !== "redacted" && content.trim().length > 0,
    status: row.status,
    reason,
    confidence: looseRecord(metadata.review).confidence ?? null,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    processedAt: row.processed_at,
    redactedAt: row.redacted_at,
  };
}

function shapePublishedMemory(
  row: PublishedMemorySourceRow,
  chunksBySource: Map<string, string[]>,
  clientLabels: Map<string, { id: string; slug: string; name?: string | null }>,
  userLabels: Map<string, { id: string; email?: string | null; displayName?: string | null }>,
): Record<string, unknown> {
  const creator = row.created_by_user_id ? userLabels.get(row.created_by_user_id) : null;
  const chunks = chunksBySource.get(row.id) ?? [];
  const content = chunks.join("\n\n").trim();
  return {
    id: row.id,
    kind: "published",
    scope: shapeMemoryScope(row, clientLabels),
    sourcePath: row.source_path,
    sourceType: row.source_type,
    title: row.title || titleFromMemoryContent(content) || row.source_path,
    contentDate: row.content_date,
    content,
    chunkCount: chunks.length,
    status: row.status ?? "indexed",
    errorMessage: row.error_message,
    createdByUserId: row.created_by_user_id,
    createdByEmail: creator?.email ?? null,
    createdByDisplayName: creator?.displayName ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at,
    archivedAt: row.archived_at,
  };
}

async function loadPublishedMemoryContent(
  deps: MemoryApiDeps,
  sourceIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (sourceIds.length === 0) return out;
  const { rows } = await deps.store.client.query<MemoryChunkContentRow>(
    `SELECT source_id, chunk_index, content
       FROM memory_chunks
      WHERE source_id = ANY($1::uuid[])
      ORDER BY source_id ASC, chunk_index ASC`,
    [pgArrayLiteral(sourceIds)],
  );
  for (const row of rows) {
    const chunks = out.get(row.source_id) ?? [];
    chunks.push(row.content);
    out.set(row.source_id, chunks);
  }
  return out;
}

export async function handleMemoriesListRequest(
  deps: MemoryApiDeps,
  query: { limit?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const requestedScope: Scope = {
      teamId: context.principal?.teamId ?? null,
      clientId: null,
      userId: null,
      visibility: "team",
    };
    const principal = await requireMemoryManagementAdmin(deps, context, requestedScope);
    const teamId = principal?.teamId ?? null;
    const where = scopeWhereForTeam(teamId);
    const limit = parsePositiveInt(query.limit, "limit", 100, 500);
    const clientLabels = await loadMemoryClientLabels(deps, principal);

    await redactProcessedCaptures(deps, teamId);

    const reviewParams = [...where.params, limit];
    const reviewRows = await deps.store.client.query<MemoryCaptureRow>(
      `SELECT ${MEMORY_CAPTURE_COLUMNS}
         FROM memory_capture_events
        WHERE ${where.sql}
          AND visibility IN ('team', 'client')
          AND status IN ('review', 'redacted')
        ORDER BY updated_at DESC
        LIMIT $${reviewParams.length}`,
      reviewParams,
    );
    const reviewCandidates = reviewRows.rows.filter((row) => {
      if (row.status === "review") return true;
      return looseRecord(row.metadata).review != null;
    });

    const sourceParams = [...where.params, limit];
    const sourceRows = await deps.store.client.query<PublishedMemorySourceRow>(
      `SELECT id, team_id, client_id, user_id, visibility, source_path, source_type,
              title, created_by_user_id, content_date::text AS content_date,
              authority_weight, content_sha256, byte_size, status, error_message,
              metadata, created_at::text AS created_at, updated_at::text AS updated_at,
              indexed_at::text AS indexed_at, archived_at::text AS archived_at
         FROM memory_sources
        WHERE ${where.sql}
          AND visibility IN ('team', 'client')
          AND COALESCE(status, 'indexed') <> 'archived'
        ORDER BY COALESCE(indexed_at, updated_at, created_at) DESC
        LIMIT $${sourceParams.length}`,
      sourceParams,
    );
    const chunksBySource = await loadPublishedMemoryContent(
      deps,
      sourceRows.rows.map((row) => row.id),
    );
    const userLabels = await loadMemoryUserLabels(deps, [
      ...reviewCandidates.map((row) => row.actor_user_id),
      ...sourceRows.rows.flatMap((row) => row.created_by_user_id ? [row.created_by_user_id] : []),
    ]);

    const review = reviewCandidates.map((row) => shapeReviewMemory(row, clientLabels, userLabels));
    const published = sourceRows.rows.map((row) => shapePublishedMemory(row, chunksBySource, clientLabels, userLabels));

    return {
      status: 200,
      body: {
        admin: true,
        review,
        published,
        counts: {
          review: review.filter((item) => item.status === "review").length,
          redactedReview: review.filter((item) => item.status === "redacted").length,
          published: published.length,
          team: published.filter((item) => looseRecord(item.scope).visibility === "team").length,
          client: published.filter((item) => looseRecord(item.scope).visibility === "client").length,
        },
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

async function loadReviewCaptureForDecision(
  deps: MemoryApiDeps,
  captureId: string,
  teamId: string | null,
): Promise<MemoryCaptureRow> {
  const { rows } = await deps.store.client.query<MemoryCaptureRow>(
    `SELECT ${MEMORY_CAPTURE_COLUMNS}
       FROM memory_capture_events
      WHERE id = $1
        AND team_id IS NOT DISTINCT FROM $2
        AND visibility IN ('team', 'client')
      LIMIT 1`,
    [captureId, teamId],
  );
  const capture = rows[0];
  if (!capture) throw new ApiError(404, "not_found", "memory review item not found");
  if (capture.status !== "review") {
    throw new ApiError(409, "invalid_state", "memory review item is no longer reviewable");
  }
  return capture;
}

async function loadPublishedMemoryForDecision(
  deps: MemoryApiDeps,
  sourceId: string,
  teamId: string | null,
): Promise<PublishedMemorySourceRow> {
  const { rows } = await deps.store.client.query<PublishedMemorySourceRow>(
    `SELECT id, team_id, client_id, user_id, visibility, source_path, source_type,
            title, created_by_user_id, content_date::text AS content_date,
            authority_weight, content_sha256, byte_size, status, error_message,
            metadata, created_at::text AS created_at, updated_at::text AS updated_at,
            indexed_at::text AS indexed_at, archived_at::text AS archived_at
       FROM memory_sources
      WHERE id = $1
        AND team_id IS NOT DISTINCT FROM $2
        AND visibility IN ('team', 'client')
      LIMIT 1`,
    [sourceId, teamId],
  );
  const source = rows[0];
  if (!source) throw new ApiError(404, "not_found", "published memory not found");
  if (source.status === "archived") {
    throw new ApiError(409, "invalid_state", "published memory is already deleted");
  }
  return source;
}

function keyedPreparedChunks(
  chunks: PreparedIngestChunk[],
  sourcePath: string,
  embeddingModel: string,
): PreparedIngestChunk[] {
  return chunks.map((chunk) => {
    const contentHash = chunk.contentHash ?? sha256Hex(chunk.content);
    return {
      ...chunk,
      contentHash,
      chunkKey: buildChunkKey({
        sourcePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        contentHash,
        embeddingModel,
      }),
    };
  });
}

async function updatePublishedMemory(
  deps: MemoryApiDeps,
  body: Record<string, unknown>,
  principal: MemoryApiPrincipal | null,
  teamId: string | null,
): Promise<ApiResponse> {
  const sourceId = requiredString(body, "sourceId").trim();
  const source = await loadPublishedMemoryForDecision(deps, sourceId, teamId);
  const { content, contentSha256, byteSize } = parseContentSha256AndByteSize(body);
  const memoryContent = content ?? "";
  if (memoryContent.trim().length === 0) {
    throw new ApiError(400, "invalid_request", "content is required to update a memory");
  }
  const { spec, chunks } = parseClientProvidedChunks(deps, body);
  const title = optionalTrimmedString(body, "title")
    ?? titleFromMemoryContent(memoryContent)
    ?? source.title
    ?? "Published memory";
  const scopeForSource: Scope = {
    teamId: source.team_id,
    clientId: source.client_id,
    userId: null,
    visibility: source.visibility as Scope["visibility"],
  };
  const updatedAt = new Date().toISOString();
  const result = await ingestPreparedContent({
    store: deps.store,
    scope: scopeForSource,
    sourcePath: source.source_path,
    sourceType: source.source_type,
    title,
    createdByUserId: source.created_by_user_id,
    contentDate: source.content_date,
    authorityWeight: source.authority_weight,
    contentSha256,
    byteSize,
    embeddingModel: spec.model,
    embeddingDim: spec.dim,
    chunks: keyedPreparedChunks(chunks, source.source_path, spec.model),
    force: true,
    reason: "manual",
    metadata: {
      ...(source.metadata ?? {}),
      lastEdit: {
        action: "updated",
        previousContentSha256: source.content_sha256,
        updatedByUserId: principal?.userId ?? null,
        updatedAt,
      },
    },
  });

  await recordCaptureAudit(
    deps,
    principal,
    "memory.updated",
    "memory_source",
    source.id,
    `updated published memory ${source.source_path}`,
    {
      sourceId: source.id,
      sourcePath: source.source_path,
      scope: auditScope(scopeForSource),
      previousContentSha256: source.content_sha256,
      contentSha256,
      chunksInserted: result.chunksInserted,
      chunksPruned: result.chunksPruned,
    },
  );

  return {
    status: 200,
    body: {
      updated: {
        sourceId: source.id,
        sourcePath: source.source_path,
        skipped: result.skipped,
        chunksInserted: result.chunksInserted,
        chunksPruned: result.chunksPruned,
      },
    },
  };
}

async function deletePublishedMemory(
  deps: MemoryApiDeps,
  body: Record<string, unknown>,
  principal: MemoryApiPrincipal | null,
  teamId: string | null,
): Promise<ApiResponse> {
  const sourceId = requiredString(body, "sourceId").trim();
  const source = await loadPublishedMemoryForDecision(deps, sourceId, teamId);
  const deletedAt = new Date().toISOString();

  await deps.store.client.query(
    `UPDATE memory_sources
        SET status = 'archived',
            archived_at = now(),
            updated_at = now(),
            metadata = metadata || $1::jsonb
      WHERE id = $2`,
    [
      JSON.stringify({
        deleted: {
          deletedByUserId: principal?.userId ?? null,
          deletedAt,
        },
      }),
      source.id,
    ],
  );
  const deletedChunks = await deps.store.client.query<{ id: string }>(
    `DELETE FROM memory_chunks
      WHERE source_id = $1
      RETURNING id`,
    [source.id],
  );

  await recordCaptureAudit(
    deps,
    principal,
    "memory.deleted",
    "memory_source",
    source.id,
    `deleted published memory ${source.source_path}`,
    {
      sourceId: source.id,
      sourcePath: source.source_path,
      scope: auditScope({
        teamId: source.team_id,
        clientId: source.client_id,
        userId: null,
        visibility: source.visibility as Scope["visibility"],
      }),
      chunksDeleted: deletedChunks.rows.length,
    },
  );

  return {
    status: 200,
    body: {
      deleted: {
        sourceId: source.id,
        sourcePath: source.source_path,
        chunksDeleted: deletedChunks.rows.length,
      },
    },
  };
}

export async function handleMemoryReviewActionRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const action = requiredString(body, "action").trim();
    const requestedScope: Scope = {
      teamId: context.principal?.teamId ?? null,
      clientId: null,
      userId: null,
      visibility: "team",
    };
    const principal = await requireMemoryManagementAdmin(deps, context, requestedScope);
    const teamId = principal?.teamId ?? null;

    if (action === "update") {
      return await updatePublishedMemory(deps, body, principal, teamId);
    }

    if (action === "delete") {
      return await deletePublishedMemory(deps, body, principal, teamId);
    }

    const captureId = requiredString(body, "captureId").trim();
    const capture = await loadReviewCaptureForDecision(deps, captureId, teamId);

    if (action === "discard") {
      const reason = optionalTrimmedString(body, "discardReason") ?? "admin_discarded";
      await deps.store.client.query(
        `UPDATE memory_capture_events
            SET status = 'processed',
                processed_at = now(),
                updated_at = now(),
                metadata = metadata || $1::jsonb
          WHERE id = $2`,
        [
          JSON.stringify({
            discard: {
              reason,
              reviewedByUserId: principal?.userId ?? null,
              reviewedAt: new Date().toISOString(),
              fromReview: true,
            },
          }),
          capture.id,
        ],
      );
      await recordCaptureAudit(
        deps,
        principal,
        "memory.discarded",
        "memory_capture",
        capture.id,
        "discarded memory review item",
        { captureIds: [capture.id], reason, reviewedByUserId: principal?.userId ?? null },
      );
      return {
        status: 200,
        body: {
          discarded: {
            captureId: capture.id,
            reason,
          },
        },
      };
    }

    if (action !== "accept") {
      throw new ApiError(400, "invalid_request", "action must be accept, discard, update, or delete");
    }

    const { content, contentSha256, byteSize } = parseContentSha256AndByteSize(body);
    const memoryContent = content ?? "";
    if (memoryContent.trim().length === 0) {
      throw new ApiError(400, "invalid_request", "content is required to accept a memory");
    }
    const title = optionalTrimmedString(body, "title")
      ?? capture.title
      ?? titleFromMemoryContent(memoryContent)
      ?? "Reviewed memory";
    const sourcePath = optionalTrimmedString(body, "sourcePath")
      ? normalizeMemorySourcePath(optionalTrimmedString(body, "sourcePath")!)
      : defaultReviewedMemorySourcePath(capture, title);
    const { spec, chunks } = parseClientProvidedChunks(deps, body);
    const scopeForSource: Scope = {
      teamId: capture.team_id,
      clientId: capture.client_id,
      userId: null,
      visibility: capture.visibility,
    };
    const result = await ingestPreparedContent({
      store: deps.store,
      scope: scopeForSource,
      sourcePath,
      sourceType: "memory",
      title,
      contentDate: parseContentDate(body.contentDate ?? capture.content_date),
      authorityWeight: parseAuthorityWeight(body.authorityWeight),
      contentSha256,
      byteSize,
      embeddingModel: spec.model,
      embeddingDim: spec.dim,
      chunks: keyedPreparedChunks(chunks, sourcePath, spec.model),
      force: body.force === true,
      reason: "session_capture",
      createdByUserId: principal?.userId ?? null,
      metadata: {
        ...optionalMetadata(body),
        reviewDecision: {
          action: "accepted",
          captureId: capture.id,
          reviewedByUserId: principal?.userId ?? null,
          reviewedAt: new Date().toISOString(),
        },
      },
    });

    await insertSourceProvenance(deps, {
      sourceId: result.sourceId,
      captures: [capture],
      contributionKind: "review",
      metadata: {
        reviewedByUserId: principal?.userId ?? null,
      },
    });
    await deps.store.client.query(
      `UPDATE memory_capture_events
          SET status = 'processed',
              processed_at = now(),
              updated_at = now(),
              metadata = metadata || $1::jsonb
        WHERE id = $2`,
      [
        JSON.stringify({
          reviewDecision: {
            action: "accepted",
            sourceId: result.sourceId,
            sourcePath,
            reviewedByUserId: principal?.userId ?? null,
            reviewedAt: new Date().toISOString(),
          },
        }),
        capture.id,
      ],
    );
    await recordCaptureAudit(
      deps,
      principal,
      "memory.published",
      "memory_source",
      result.sourceId,
      `accepted reviewed memory ${sourcePath}`,
      {
        captureId: capture.id,
        sourceId: result.sourceId,
        sourcePath,
        scope: auditScope(scopeForSource),
        skipped: result.skipped,
      },
    );

    return {
      status: 200,
      body: {
        accepted: {
          captureId: capture.id,
          sourceId: result.sourceId,
          sourcePath,
          skipped: result.skipped,
          chunksInserted: result.chunksInserted,
          chunksPruned: result.chunksPruned,
        },
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

// ── manual shared content imports ───────────────────────────────────────────

const MANUAL_IMPORT_COLUMNS = `
  id,
  team_id,
  client_id,
  user_id,
  visibility,
  actor_user_id,
  source_path,
  source_type,
  title,
  content_date::text AS content_date,
  authority_weight,
  content,
  content_sha256,
  status,
  attempts,
  source_id,
  error_message,
  metadata,
  created_at::text AS created_at,
  updated_at::text AS updated_at,
  indexed_at::text AS indexed_at`;

function parseManualImportInput(
  deps: MemoryApiDeps,
  body: Record<string, unknown>,
): ManualImportInput {
  const scope = buildIngestScopeFromBody(body.scope);
  const sourcePath = optionalString(body, "sourcePath")?.trim() ?? null;
  if (!sourcePath && body.connector == null) {
    throw new ApiError(400, "invalid_request", "sourcePath is required");
  }
  const { spec, chunks } = parseClientProvidedChunks(deps, body);

  const connector = (body.connector ?? {
    id: "manual",
    itemId: sourcePath ?? undefined,
  }) as ConnectorDescriptor | string;

  let prepared: PreparedConnectorImport;
  try {
    prepared = prepareConnectorImport({
      connector,
      scope,
      sourcePath,
      sourceType: parseSourceType(body.sourceType),
      title: optionalString(body, "title"),
      contentDate: parseContentDate(body.contentDate),
      authorityWeight: parseAuthorityWeight(body.authorityWeight),
      content: requiredString(body, "content"),
      metadata: optionalMetadata(body),
    });
  } catch (error) {
    if (error instanceof ConnectorImportError) {
      throw new ApiError(400, "invalid_request", error.message);
    }
    throw error;
  }

  return {
    scope: prepared.scope,
    sourcePath: prepared.sourcePath,
    sourceType: prepared.sourceType,
    title: prepared.title,
    contentDate: prepared.contentDate,
    authorityWeight: prepared.authorityWeight,
    content: prepared.content,
    contentSha256: sha256Hex(prepared.content),
    byteSize: Buffer.byteLength(prepared.content, "utf-8"),
    embeddingModel: spec.model,
    embeddingDim: spec.dim,
    chunks,
    metadata: {
      ...prepared.metadata,
      clientProvidedEmbeddings: {
        embeddingModel: spec.model,
        embeddingDim: spec.dim,
        chunks,
      },
    },
    force: body.force === true,
  };
}

function normalizeImportMetadata(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseStoredManualImportEmbeddings(
  deps: MemoryApiDeps,
  metadata: Record<string, unknown>,
): { spec: ExpectedEmbeddingSpec; chunks: ParsedPreparedChunk[] } {
  const stored = metadata.clientProvidedEmbeddings;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new ApiError(
      409,
      "missing_client_embeddings",
      "this manual import does not contain client-provided embeddings; re-import it with a current client",
    );
  }
  return parseClientProvidedChunks(deps, stored as Record<string, unknown>);
}

function shapeManualImport(row: ManualImportRow): Record<string, unknown> {
  const content = String(row.content ?? "");
  const metadata = normalizeImportMetadata(row.metadata);
  const { clientProvidedEmbeddings: _clientProvidedEmbeddings, ...publicMetadata } = metadata;
  return {
    id: row.id,
    scope: {
      teamId: row.team_id,
      clientId: row.client_id,
      userId: row.user_id,
      visibility: row.visibility,
    },
    actorUserId: row.actor_user_id,
    sourcePath: row.source_path,
    sourceType: row.source_type,
    title: row.title,
    contentDate: row.content_date,
    authorityWeight: row.authority_weight,
    contentSha256: row.content_sha256,
    contentBytes: Buffer.byteLength(content, "utf-8"),
    contentPreview: content.length > 240 ? `${content.slice(0, 240)}...` : content,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    sourceId: row.source_id,
    errorMessage: row.error_message,
    metadata: publicMetadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at,
  };
}

function auditScope(scope: Scope): Record<string, unknown> {
  return {
    teamId: scope.teamId,
    clientId: scope.clientId,
    userId: scope.userId,
    visibility: scope.visibility,
  };
}

async function recordIngestionAudit(
  deps: MemoryApiDeps,
  input: {
    principal: MemoryApiPrincipal | null;
    action:
      | "memory.imported"
      | "memory.published"
      | "memory.retry"
      | "memory.failed"
      | "memory.reindexed";
    targetType: "memory_source" | "manual_import";
    targetId: string;
    sourcePath: string;
    scope: Scope;
    summary: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!deps.identityStore || !input.principal) return;
  await deps.identityStore.recordAuditEvent({
    teamId: input.principal.teamId,
    actorUserId: input.principal.userId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    metadata: {
      sourcePath: input.sourcePath,
      scope: auditScope(input.scope),
      authSource: input.principal.authSource ?? null,
      ...(input.metadata ?? {}),
    },
  });
}

async function insertManualImport(
  deps: MemoryApiDeps,
  input: ManualImportInput,
  scope: Scope,
  principal: MemoryApiPrincipal | null,
): Promise<ManualImportRow> {
  const { rows } = await deps.store.client.query<ManualImportRow>(
    `INSERT INTO manual_imports
       (team_id, client_id, user_id, visibility, actor_user_id, source_path,
        source_type, title, content_date, authority_weight, content,
        content_sha256, status, attempts, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12,
             'indexing', 1, $13::jsonb, now())
     RETURNING ${MANUAL_IMPORT_COLUMNS}`,
    [
      scope.teamId,
      scope.clientId,
      scope.userId,
      scope.visibility,
      principal?.userId ?? null,
      input.sourcePath,
      input.sourceType,
      input.title,
      input.contentDate,
      input.authorityWeight ?? null,
      input.content,
      input.contentSha256,
      JSON.stringify(input.metadata),
    ],
  );
  return rows[0];
}

async function markManualImportFinished(
  deps: MemoryApiDeps,
  importId: string,
  status: "indexed" | "skipped",
  sourceId: string,
): Promise<ManualImportRow> {
  const { rows } = await deps.store.client.query<ManualImportRow>(
    `UPDATE manual_imports
        SET status = $2,
            source_id = $3,
            error_message = NULL,
            indexed_at = now(),
            updated_at = now()
      WHERE id = $1
      RETURNING ${MANUAL_IMPORT_COLUMNS}`,
    [importId, status, sourceId],
  );
  return rows[0];
}

async function markManualImportFailed(
  deps: MemoryApiDeps,
  importId: string,
  errorMessage: string,
): Promise<ManualImportRow> {
  const { rows } = await deps.store.client.query<ManualImportRow>(
    `UPDATE manual_imports
        SET status = 'failed',
            error_message = $2,
            updated_at = now()
      WHERE id = $1
      RETURNING ${MANUAL_IMPORT_COLUMNS}`,
    [importId, errorMessage],
  );
  return rows[0];
}

async function fetchManualImportById(
  deps: MemoryApiDeps,
  importId: string,
  teamId: string | null,
): Promise<ManualImportRow | null> {
  const where = teamId == null
    ? "id = $1 AND team_id IS NULL"
    : "id = $1 AND team_id = $2";
  const params = teamId == null ? [importId] : [importId, teamId];
  const { rows } = await deps.store.client.query<ManualImportRow>(
    `SELECT ${MANUAL_IMPORT_COLUMNS}
       FROM manual_imports
      WHERE ${where}
      LIMIT 1`,
    params,
  );
  return rows[0] ?? null;
}

async function runManualImportIngest(
  deps: MemoryApiDeps,
  importId: string,
  input: ManualImportInput,
  scope: Scope,
  force: boolean,
  audit: {
    principal: MemoryApiPrincipal | null;
    successAction: "memory.published" | "memory.reindexed";
  },
): Promise<ApiResponse> {
  try {
    const result = await ingestPreparedContent({
      store: deps.store,
      scope,
      sourcePath: input.sourcePath,
      sourceType: input.sourceType,
      title: input.title,
      createdByUserId: audit.principal?.userId ?? null,
      contentDate: input.contentDate,
      authorityWeight: input.authorityWeight,
      contentSha256: input.contentSha256,
      byteSize: input.byteSize,
      embeddingModel: input.embeddingModel,
      embeddingDim: input.embeddingDim,
      chunks: input.chunks,
      force,
      reason: "manual",
    });
    const importRow = await markManualImportFinished(
      deps,
      importId,
      result.skipped ? "skipped" : "indexed",
      result.sourceId,
    );
    await recordIngestionAudit(deps, {
      principal: audit.principal,
      action: audit.successAction,
      targetType: "memory_source",
      targetId: result.sourceId,
      sourcePath: input.sourcePath,
      scope,
      summary:
        audit.successAction === "memory.reindexed"
          ? `reindexed ${input.sourcePath}`
          : `published ${input.sourcePath}`,
      metadata: {
        importId,
        sourceId: result.sourceId,
        skipped: result.skipped,
        chunksInserted: result.chunksInserted,
        chunksPruned: result.chunksPruned,
        force,
      },
    });
    return {
      status: 200,
      body: {
        import: shapeManualImport(importRow),
        sourceId: result.sourceId,
        skipped: result.skipped,
        chunksInserted: result.chunksInserted,
        chunksPruned: result.chunksPruned,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const importRow = await markManualImportFailed(deps, importId, message);
    await recordIngestionAudit(deps, {
      principal: audit.principal,
      action: "memory.failed",
      targetType: "manual_import",
      targetId: importId,
      sourcePath: input.sourcePath,
      scope,
      summary: `failed to index ${input.sourcePath}`,
      metadata: {
        importId,
        sourceId: importRow.source_id,
        errorMessage: message,
        force,
      },
    });
    return {
      status: 500,
      body: {
        error: { code: "import_failed", message },
        import: shapeManualImport(importRow),
      },
    };
  }
}

export async function handleManualImportRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const input = parseManualImportInput(deps, body);
    const authorized = await authorizeManualImportScope(deps, input.scope, context);
    const importRow = await insertManualImport(
      deps,
      input,
      authorized.scope,
      authorized.principal,
    );
    await recordIngestionAudit(deps, {
      principal: authorized.principal,
      action: "memory.imported",
      targetType: "manual_import",
      targetId: importRow.id,
      sourcePath: input.sourcePath,
      scope: authorized.scope,
      summary: `imported ${input.sourcePath}`,
      metadata: {
        importId: importRow.id,
        sourceType: input.sourceType,
        title: input.title,
        contentSha256: importRow.content_sha256,
      },
    });
    return await runManualImportIngest(
      deps,
      importRow.id,
      input,
      authorized.scope,
      input.force,
      { principal: authorized.principal, successAction: "memory.published" },
    );
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleManualImportsListRequest(
  deps: MemoryApiDeps,
  rawFilters: unknown = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const filters = asRecord(rawFilters ?? {}, "invalid_request", "query");
    const principal = await requireManualImportAdmin(deps, context, {
      teamId: context.principal?.teamId ?? null,
      clientId: null,
      userId: context.principal?.userId ?? null,
      include: ["team"],
    });
    const teamId = principal?.teamId ?? null;

    let status: ManualImportStatus | null = null;
    if (filters.status != null) {
      if (!VALID_IMPORT_STATUSES.includes(filters.status as ManualImportStatus)) {
        throw new ApiError(
          400,
          "invalid_request",
          `status must be one of ${VALID_IMPORT_STATUSES.join(", ")}`,
        );
      }
      status = filters.status as ManualImportStatus;
    }

    let limit = 20;
    if (filters.limit != null) {
      const n = Number(filters.limit);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        throw new ApiError(400, "invalid_request", "limit must be an integer in [1, 100]");
      }
      limit = n;
    }

    const params: unknown[] = [];
    const where = [
      teamId == null ? "team_id IS NULL" : `team_id = $${params.push(teamId)}`,
    ];
    if (status) {
      where.push(`status = $${params.push(status)}`);
    }
    const limitParam = params.push(limit);
    const { rows } = await deps.store.client.query<ManualImportRow>(
      `SELECT ${MANUAL_IMPORT_COLUMNS}
         FROM manual_imports
        WHERE ${where.join(" AND ")}
        ORDER BY updated_at DESC
        LIMIT $${limitParam}`,
      params,
    );

    return {
      status: 200,
      body: { imports: rows.map(shapeManualImport) },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleManualImportRetryRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const importId = requiredString(body, "importId").trim();
    const principal = await requireManualImportAdmin(deps, context, {
      teamId: context.principal?.teamId ?? null,
      clientId: null,
      userId: context.principal?.userId ?? null,
      include: ["team"],
    });
    const importRow = await fetchManualImportById(deps, importId, principal?.teamId ?? null);
    if (!importRow) {
      throw new ApiError(404, "not_found", "manual import not found");
    }

    const storedScope: Scope = {
      teamId: importRow.team_id,
      clientId: importRow.client_id,
      userId: importRow.user_id,
      visibility: importRow.visibility,
    };
    const authorized = await authorizeManualImportScope(deps, storedScope, context);
    await recordIngestionAudit(deps, {
      principal,
      action: "memory.retry",
      targetType: "manual_import",
      targetId: importRow.id,
      sourcePath: importRow.source_path,
      scope: authorized.scope,
      summary: `retrying ${importRow.source_path}`,
      metadata: {
        importId: importRow.id,
        sourceId: importRow.source_id,
        previousStatus: importRow.status,
        previousAttempts: Number(importRow.attempts ?? 0),
        force: body.force !== false,
      },
    });
    const metadata = normalizeImportMetadata(importRow.metadata);
    const prepared = parseStoredManualImportEmbeddings(deps, metadata);
    const input: ManualImportInput = {
      scope: authorized.scope,
      sourcePath: importRow.source_path,
      sourceType: importRow.source_type,
      title: importRow.title,
      contentDate: importRow.content_date,
      authorityWeight: importRow.authority_weight ?? undefined,
      content: importRow.content,
      contentSha256: importRow.content_sha256,
      byteSize: Buffer.byteLength(importRow.content ?? "", "utf-8"),
      embeddingModel: prepared.spec.model,
      embeddingDim: prepared.spec.dim,
      chunks: prepared.chunks,
      metadata,
      force: body.force !== false,
    };

    await deps.store.client.query(
      `UPDATE manual_imports
          SET status = 'indexing',
              attempts = attempts + 1,
              error_message = NULL,
              updated_at = now()
        WHERE id = $1`,
      [importRow.id],
    );

    return await runManualImportIngest(
      deps,
      importRow.id,
      input,
      authorized.scope,
      input.force,
      { principal, successAction: "memory.reindexed" },
    );
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

// ── workspace file sync ──────────────────────────────────────────────────────

function requireWorkspaceRoot(deps: MemoryApiDeps): string {
  if (!deps.workspaceRoot) {
    throw new ApiError(500, "internal", "workspace root is required for workspace sync");
  }
  return path.resolve(deps.workspaceRoot);
}

function normalizeWorkspacePath(rawPath: unknown): string {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new ApiError(400, "invalid_request", "path is required");
  }
  const input = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    input.includes("\0") ||
    path.posix.isAbsolute(input) ||
    path.win32.isAbsolute(input)
  ) {
    throw new ApiError(400, "invalid_request", "path must be relative");
  }
  const parts = input.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new ApiError(400, "invalid_request", "path cannot contain traversal segments");
  }
  if (parts[0] !== "clients" || !parts[1] || parts.length < 3) {
    throw new ApiError(400, "invalid_request", "path must be under clients/{client}/...");
  }
  if (!CLIENT_SLUG_RE.test(parts[1])) {
    throw new ApiError(400, "invalid_request", "client slug in path is invalid");
  }
  return parts.join("/");
}

function workspaceClientFromPath(relativePath: string): string {
  return relativePath.split("/")[1]!;
}

function resolveWorkspaceFile(root: string, relativePath: string): string {
  const fullPath = path.resolve(root, ...relativePath.split("/"));
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (fullPath !== root && !fullPath.startsWith(rootWithSep)) {
    throw new ApiError(400, "invalid_request", "path escapes workspace root");
  }
  return fullPath;
}

function sha256(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeTextForSync(content: Buffer | string): string {
  const text = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const withLf = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return withLf.endsWith("\n") ? withLf.slice(0, -1) : withLf;
}

function normalizedTextSha256(content: Buffer | string): string {
  return sha256(normalizeTextForSync(content));
}

function isSecretWorkspacePath(relativePath: string): boolean {
  const name = path.posix.basename(relativePath);
  return (
    name === ".env" ||
    name === ".env.local" ||
    name.startsWith(".env.") ||
    name === ".mcp.json"
  );
}

function textFileNameMatches(name: string): boolean {
  if (TEXT_FILE_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  for (const ext of TEXT_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function isLikelyTextBuffer(relativePath: string, content: Buffer): boolean {
  const name = path.posix.basename(relativePath);
  if (textFileNameMatches(name)) return true;
  if (content.includes(0)) return false;
  const sample = content.subarray(0, Math.min(content.length, 4096));
  let control = 0;
  for (const byte of sample) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) control += 1;
  }
  return sample.length === 0 || control / sample.length < 0.02;
}

function workspaceFilePayload(relativePath: string, content: Buffer): Record<string, unknown> {
  if (isLikelyTextBuffer(relativePath, content)) {
    return { encoding: "utf-8", content: content.toString("utf-8") };
  }
  return { encoding: "base64", contentBase64: content.toString("base64") };
}

function workspaceBodyToBuffer(rawBody: Record<string, unknown>): Buffer {
  if (typeof rawBody.content === "string") {
    return Buffer.from(rawBody.content, "utf-8");
  }
  if (typeof rawBody.contentBase64 === "string") {
    return Buffer.from(rawBody.contentBase64, "base64");
  }
  throw new ApiError(400, "invalid_request", "content or contentBase64 is required");
}

function isExcludedRelativePath(relativePath: string): boolean {
  const parts = relativePath.split("/");
  return parts.some((part) => EXCLUDED_DIR_NAMES.has(part));
}

function isSyncableTextFile(relativePath: string): boolean {
  if (isExcludedRelativePath(relativePath)) return false;
  const name = path.posix.basename(relativePath);
  if (EXCLUDED_FILE_NAMES.has(name) || name.startsWith(".env.")) return false;
  if (TEXT_FILE_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  for (const ext of TEXT_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

async function statFileOrNull(fullPath: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.stat(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// ── Team OS context resolver ────────────────────────────────────────────────

export interface ResolveContextSnapshotInput {
  principal: MemoryApiPrincipal;
  selectedClient?: string | null;
  cwd?: string | null;
  taskType?: string | null;
}

interface ContextSnapshotLayer {
  label: string;
  visibility: Visibility;
  kind: ContextKind;
  path: string;
  sha256: string;
  source: "database" | "workspace";
  content: string;
  updatedAt?: string | null;
}

interface ContextSnapshotAvailableFile {
  visibility: Visibility;
  kind: ContextKind;
  path: string;
  title: string | null;
  size: number;
  source: "database" | "workspace";
  updatedAt?: string | null;
}

export interface ResolvedContextSnapshot {
  generatedAt: string;
  team: { id: string; slug?: string | null; name?: string | null };
  user: { id: string; email?: string | null; displayName?: string | null };
  client: { id: string; slug: string; name?: string | null; access: GrantAccess } | null;
  taskType: string | null;
  layers: ContextSnapshotLayer[];
  availableContext: ContextSnapshotAvailableFile[];
  markdown: string;
}

const TEAM_CONTEXT_DEFAULT_PATHS = new Set([
  "team_context/AGENTS.md",
  "team_context/team-profile.md",
  "team_context/operating-rules.md",
  "team_context/shared-preferences.md",
  "brand_context/brand-snapshot.md",
]);

function normalizeContextPath(rawPath: unknown): string {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new ApiError(400, "invalid_request", "path is required");
  }
  const input = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    input.includes("\0") ||
    path.posix.isAbsolute(input) ||
    path.win32.isAbsolute(input)
  ) {
    throw new ApiError(400, "invalid_request", "path must be relative");
  }
  const parts = input.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new ApiError(400, "invalid_request", "path cannot contain traversal segments");
  }
  if (parts.length === 0 || isExcludedRelativePath(parts.join("/"))) {
    throw new ApiError(400, "invalid_request", "path is not allowed");
  }
  const normalized = parts.join("/");
  if (!isSyncableTextFile(normalized)) {
    throw new ApiError(400, "invalid_request", "path must be a syncable text file");
  }
  return normalized;
}

function inferContextKind(documentPath: string): ContextKind {
  const name = path.posix.basename(documentPath);
  if (name === "AGENTS.md" || name === "CLAUDE.md" || name === "SOUL.md") return "agents";
  if (name === "USER.md") return "user";
  if (name === "MEMORY.md" || documentPath.includes("/memory/")) return "memory";
  if (name === "learnings.md" || documentPath.includes("/learnings")) return "learnings";
  if (documentPath.includes("brand_context/")) return "brand";
  if (
    name === "preferences.md" ||
    name === "prompt-tags.md" ||
    name.endsWith(".local.md")
  ) return "preferences";
  return "other";
}

function contextKindFromBody(raw: unknown, documentPath: string): ContextKind {
  if (raw == null) return inferContextKind(documentPath);
  if (!VALID_CONTEXT_KINDS.includes(raw as ContextKind)) {
    throw new ApiError(400, "invalid_request", "kind is invalid");
  }
  return raw as ContextKind;
}

function contextScopeForDocument(
  principal: MemoryApiPrincipal,
  visibility: Visibility,
  client: IdentityClient | null,
): Scope {
  if (visibility === "private") {
    return {
      teamId: principal.teamId,
      clientId: null,
      userId: principal.userId,
      visibility,
    };
  }
  if (visibility === "client") {
    if (!client) {
      throw new ApiError(400, "invalid_request", "client context requires client");
    }
    return {
      teamId: principal.teamId,
      clientId: client.id,
      userId: null,
      visibility,
    };
  }
  if (visibility === "team") {
    return {
      teamId: principal.teamId,
      clientId: null,
      userId: null,
      visibility,
    };
  }
  return {
    teamId: null,
    clientId: null,
    userId: null,
    visibility,
  };
}

function assertContextPathAllowed(
  visibility: Visibility,
  documentPath: string,
  client: IdentityClient | null,
): void {
  if (visibility === "system") {
    if (
      documentPath !== "AGENTS.md" &&
      documentPath !== "CLAUDE.md" &&
      documentPath !== "context/SOUL.md"
    ) {
      throw new ApiError(400, "invalid_request", "system context path is not allowed");
    }
    return;
  }
  if (visibility === "team") {
    if (documentPath.startsWith("team_context/") || documentPath.startsWith("brand_context/")) {
      return;
    }
    throw new ApiError(400, "invalid_request", "team context must live under team_context/ or brand_context/");
  }
  if (visibility === "client") {
    const slug = client?.slug;
    if (!slug) {
      throw new ApiError(400, "invalid_request", "client context requires client");
    }
    const prefix = `clients/${slug}/`;
    if (
      documentPath === `${prefix}AGENTS.md` ||
      documentPath.startsWith(`${prefix}brand_context/`) ||
      documentPath === `${prefix}context/MEMORY.md` ||
      documentPath === `${prefix}context/learnings.md`
    ) {
      return;
    }
    throw new ApiError(400, "invalid_request", "client context path is not allowed for this client");
  }
  if (
    documentPath === "context/USER.md" ||
    documentPath === "context/MEMORY.md" ||
    documentPath === "context/learnings.md" ||
    documentPath === "context/prompt-tags.md" ||
    documentPath === "AGENTS.local.md" ||
    documentPath === "CLAUDE.local.md" ||
    /^\.claude\/skills\/[^/]+\/SKILL\.local\.md$/.test(documentPath)
  ) {
    return;
  }
  throw new ApiError(400, "invalid_request", "private context path is not allowed");
}

function clientSlugFromCwd(root: string | null, cwd: string | null | undefined): string | null {
  if (!root || !cwd) return null;
  const rel = path.relative(root, cwd).replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  if (parts[0] === "clients" && parts[1] && CLIENT_SLUG_RE.test(parts[1])) return parts[1];
  return null;
}

function selectedClientSlug(
  deps: MemoryApiDeps,
  selectedClient: string | null | undefined,
  cwd: string | null | undefined,
): string | null {
  const raw = selectedClient?.trim() || clientSlugFromCwd(deps.workspaceRoot ?? null, cwd);
  if (!raw || raw === "root") return null;
  if (!CLIENT_SLUG_RE.test(raw)) {
    throw new ApiError(400, "invalid_request", "client slug is invalid");
  }
  return raw;
}

async function resolveOptionalContextClient(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  selectedClient: string | null | undefined,
  cwd: string | null | undefined,
  required: GrantAccess,
): Promise<WorkspaceClientGrant | null> {
  const slug = selectedClientSlug(deps, selectedClient, cwd);
  if (!slug) return null;
  return requireClientGrantForWorkspace(deps, principal, slug, required, {
    route: "context",
  });
}

async function recordContextAudit(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  action: AuditAction,
  targetId: string | null,
  summary: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps.identityStore) return;
  await deps.identityStore.recordAuditEvent({
    teamId: principal.teamId,
    actorUserId: principal.userId,
    action,
    targetType: targetId ? "context_document" : "team",
    targetId,
    summary,
    metadata: { ...metadata, authSource: principal.authSource ?? null },
  });
}

function appendContextLayer(
  layers: ContextSnapshotLayer[],
  seen: Set<string>,
  input: Omit<ContextSnapshotLayer, "sha256">,
): void {
  const key = `${input.visibility}:${input.path}`;
  if (seen.has(key)) return;
  seen.add(key);
  layers.push({
    ...input,
    sha256: sha256(input.content),
  });
}

async function appendWorkspaceContextFile(
  root: string,
  layers: ContextSnapshotLayer[],
  seen: Set<string>,
  input: {
    label: string;
    visibility: Visibility;
    kind?: ContextKind;
    path: string;
  },
): Promise<void> {
  if (!isSyncableTextFile(input.path)) return;
  const fullPath = resolveWorkspaceFile(root, input.path);
  const stat = await statFileOrNull(fullPath);
  if (!stat || !stat.isFile() || stat.size > MAX_WORKSPACE_FILE_BYTES) return;
  const content = await fs.readFile(fullPath, "utf-8");
  appendContextLayer(layers, seen, {
    label: input.label,
    visibility: input.visibility,
    kind: input.kind ?? inferContextKind(input.path),
    path: input.path,
    source: "workspace",
    content,
    updatedAt: stat.mtime.toISOString(),
  });
}

function contextSnapshotWorkspaceFallbackEnabled(): boolean {
  return (process.env.TEAM_OS_ENABLE_WORKSPACE_CONTEXT_FALLBACK ?? "").trim() === "1";
}

function contextSnapshotLoadedKey(visibility: Visibility, documentPath: string): string {
  return `${visibility}:${documentPath}`;
}

function titleFromContent(content: string): string | null {
  try {
    const parsed = matter(content);
    const frontmatterTitle = parsed.data?.title;
    if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) {
      return frontmatterTitle.replace(/\s+/g, " ").trim().slice(0, 120);
    }
    content = parsed.content;
  } catch {
    // Fall through to heading extraction.
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (!heading) continue;
    const value = heading[1]
      .replace(/[`*_#[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (value) return value.slice(0, 120);
  }
  return null;
}

function fallbackTitleFromPath(documentPath: string): string {
  return path.posix.basename(documentPath).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function contextDocumentLabel(doc: ContextDocumentRow): string {
  if (doc.visibility === "system") return "System base";
  if (doc.visibility === "private") return "Private user";
  if (doc.visibility === "client") {
    return doc.path.includes("/brand_context/") ? "Client brand" : "Client";
  }
  if (doc.path.startsWith("brand_context/")) return "Brand/team";
  return "Team";
}

function shouldLoadTeamContextDocument(doc: ContextDocumentRow): boolean {
  if (doc.visibility === "system") return true;
  if (doc.visibility === "private") {
    return doc.path === "context/USER.md" || doc.path === "context/MEMORY.md";
  }
  if (doc.visibility === "team") return TEAM_CONTEXT_DEFAULT_PATHS.has(doc.path);
  if (doc.visibility === "client") {
    const clientPrefix = doc.path.match(/^clients\/[^/]+\//)?.[0];
    if (!clientPrefix) return false;
    return (
      doc.path === `${clientPrefix}AGENTS.md` ||
      doc.path === `${clientPrefix}context/MEMORY.md` ||
      doc.path === `${clientPrefix}brand_context/brand-snapshot.md`
    );
  }
  return false;
}

function appendDatabaseDocument(
  layers: ContextSnapshotLayer[],
  seen: Set<string>,
  doc: ContextDocumentRow,
  label = contextDocumentLabel(doc),
): void {
  appendContextLayer(layers, seen, {
    label,
    visibility: doc.visibility,
    kind: doc.kind,
    path: doc.path,
    source: "database",
    content: doc.content,
    updatedAt: doc.updatedAt,
  });
}

function shouldIncludeStartupAvailableContext(documentPath: string): boolean {
  return !(
    /^brand_context\/archive(?:\/|$)/.test(documentPath) ||
    /^clients\/[^/]+\/brand_context\/archive(?:\/|$)/.test(documentPath)
  );
}

function appendAvailableDatabaseDocuments(
  availableContext: ContextSnapshotAvailableFile[],
  seenAvailable: Set<string>,
  loaded: Set<string>,
  docs: ContextDocumentRow[],
): void {
  for (const doc of docs) {
    if (!shouldIncludeStartupAvailableContext(doc.path)) continue;
    const key = contextSnapshotLoadedKey(doc.visibility, doc.path);
    if (loaded.has(key) || seenAvailable.has(key)) continue;
    seenAvailable.add(key);
    availableContext.push({
      visibility: doc.visibility,
      kind: doc.kind,
      path: doc.path,
      title: titleFromContent(doc.content) ?? fallbackTitleFromPath(doc.path),
      size: Buffer.byteLength(doc.content, "utf-8"),
      source: "database",
      updatedAt: doc.updatedAt,
    });
  }
}

async function appendAvailableWorkspaceFile(
  root: string,
  availableContext: ContextSnapshotAvailableFile[],
  seenAvailable: Set<string>,
  loaded: Set<string>,
  input: {
    visibility: Visibility;
    path: string;
    kind?: ContextKind;
  },
): Promise<void> {
  const key = contextSnapshotLoadedKey(input.visibility, input.path);
  if (
    loaded.has(key) ||
    seenAvailable.has(key) ||
    !shouldIncludeStartupAvailableContext(input.path) ||
    !isSyncableTextFile(input.path)
  ) return;
  const fullPath = resolveWorkspaceFile(root, input.path);
  const stat = await statFileOrNull(fullPath);
  if (!stat || !stat.isFile() || stat.size > MAX_WORKSPACE_FILE_BYTES) return;
  let title: string | null = null;
  try {
    title = titleFromContent(await fs.readFile(fullPath, "utf-8"));
  } catch {
    title = null;
  }
  seenAvailable.add(key);
  availableContext.push({
    visibility: input.visibility,
    kind: input.kind ?? inferContextKind(input.path),
    path: input.path,
    title: title ?? fallbackTitleFromPath(input.path),
    size: stat.size,
    source: "workspace",
    updatedAt: stat.mtime.toISOString(),
  });
}

async function appendAvailableWorkspaceTree(
  root: string,
  availableContext: ContextSnapshotAvailableFile[],
  seenAvailable: Set<string>,
  loaded: Set<string>,
  input: {
    visibility: Visibility;
    basePath: string;
  },
): Promise<void> {
  const fullBase = resolveWorkspaceFile(root, input.basePath);
  const stat = await statFileOrNull(fullBase);
  if (!stat || !stat.isDirectory()) return;
  const paths: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (
          !EXCLUDED_DIR_NAMES.has(entry.name) &&
          !isExcludedRelativePath(rel) &&
          shouldIncludeStartupAvailableContext(rel)
        ) {
          await walk(fullPath);
        }
        continue;
      }
      if (entry.isFile() && isSyncableTextFile(rel)) paths.push(rel);
    }
  }
  await walk(fullBase);
  paths.sort((a, b) => a.localeCompare(b));
  for (const rel of paths) {
    await appendAvailableWorkspaceFile(root, availableContext, seenAvailable, loaded, {
      visibility: input.visibility,
      path: rel,
    });
  }
}

function buildContextSnapshotMarkdown(snapshot: Omit<ResolvedContextSnapshot, "markdown">): string {
  const lines: string[] = [
    "# Team OS Context Snapshot",
    "",
    "This snapshot was resolved by the Team OS server for the authenticated user. Do not inspect other users' or teams' files manually.",
    "",
    "## Metadata",
    `- Generated: ${snapshot.generatedAt}`,
    `- Team: ${snapshot.team.name ?? snapshot.team.slug ?? snapshot.team.id}`,
    `- User: ${snapshot.user.email ?? snapshot.user.displayName ?? snapshot.user.id}`,
    `- Client: ${snapshot.client ? snapshot.client.slug : "none"}`,
  ];
  if (snapshot.taskType) lines.push(`- Task type: ${snapshot.taskType}`);
  lines.push("");
  for (const layer of snapshot.layers) {
    lines.push(`## ${layer.label}: ${layer.path}`);
    lines.push(`- Visibility: ${layer.visibility}`);
    lines.push(`- Kind: ${layer.kind}`);
    lines.push(`- Source: ${layer.source}`);
    lines.push(`- SHA-256: ${layer.sha256}`);
    if (layer.updatedAt) lines.push(`- Updated: ${layer.updatedAt}`);
    lines.push("");
    lines.push(layer.content.trimEnd());
    lines.push("");
  }
  if (snapshot.availableContext.length > 0) {
    lines.push("## Context Available");
    lines.push(
      "These files are available to load when the task needs them. They were not included in full in this snapshot.",
    );
    lines.push("");
    for (const file of snapshot.availableContext) {
      const title = file.title ? ` — ${file.title}` : "";
      const updated = file.updatedAt ? `; updated ${file.updatedAt}` : "";
      lines.push(
        `- ${file.path}${title} (${file.visibility}, ${file.kind}, ${file.size} bytes, ${file.source}${updated})`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function resolveContextSnapshot(
  deps: MemoryApiDeps,
  input: ResolveContextSnapshotInput,
): Promise<ResolvedContextSnapshot> {
  const root = deps.workspaceRoot ? requireWorkspaceRoot(deps) : null;
  const principal = input.principal;
  await requireTeamApiPrincipal(deps, { principal });
  const grantedClient = await resolveOptionalContextClient(
    deps,
    principal,
    input.selectedClient ?? null,
    input.cwd ?? null,
    "read",
  );
  const team = deps.identityStore!.getTeam
    ? await deps.identityStore!.getTeam(principal.teamId)
    : null;
  const user = deps.identityStore!.getUserById
    ? await deps.identityStore!.getUserById(principal.userId)
    : null;

  const layers: ContextSnapshotLayer[] = [];
  const seen = new Set<string>();
  const availableContext: ContextSnapshotAvailableFile[] = [];
  const seenAvailable = new Set<string>();
  const workspaceFallbackEnabled = contextSnapshotWorkspaceFallbackEnabled();

  const systemDocs = await deps.store.listContextDocuments({ visibility: "system", status: "active" });
  for (const doc of systemDocs.filter(shouldLoadTeamContextDocument)) {
    appendDatabaseDocument(layers, seen, doc);
  }

  if (root) {
    await appendWorkspaceContextFile(root, layers, seen, {
      label: "System base",
      visibility: "system",
      kind: "agents",
      path: "AGENTS.md",
    });
    await appendWorkspaceContextFile(root, layers, seen, {
      label: "System base",
      visibility: "system",
      kind: "agents",
      path: "CLAUDE.md",
    });
    await appendWorkspaceContextFile(root, layers, seen, {
      label: "System base",
      visibility: "system",
      kind: "agents",
      path: "context/SOUL.md",
    });
  }

  const teamDocs = await deps.store.listContextDocuments({
    visibility: "team",
    teamId: principal.teamId,
    status: "active",
  });
  for (const doc of teamDocs.filter(shouldLoadTeamContextDocument)) {
    appendDatabaseDocument(layers, seen, doc);
  }

  if (root && workspaceFallbackEnabled) {
    for (const relPath of TEAM_CONTEXT_DEFAULT_PATHS) {
      await appendWorkspaceContextFile(root, layers, seen, {
        label: relPath.startsWith("brand_context/") ? "Brand/team" : "Team",
        visibility: "team",
        path: relPath,
      });
    }
  }

  let clientDocs: ContextDocumentRow[] = [];
  if (grantedClient) {
    clientDocs = await deps.store.listContextDocuments({
      visibility: "client",
      teamId: principal.teamId,
      clientId: grantedClient.client.id,
      status: "active",
    });
    for (const doc of clientDocs.filter(shouldLoadTeamContextDocument)) {
      appendDatabaseDocument(layers, seen, doc);
    }
    if (root && workspaceFallbackEnabled) {
      await appendWorkspaceContextFile(root, layers, seen, {
        label: "Client",
        visibility: "client",
        kind: "agents",
        path: `clients/${grantedClient.client.slug}/AGENTS.md`,
      });
      await appendWorkspaceContextFile(root, layers, seen, {
        label: "Client",
        visibility: "client",
        kind: "memory",
        path: `clients/${grantedClient.client.slug}/context/MEMORY.md`,
      });
      await appendWorkspaceContextFile(root, layers, seen, {
        label: "Client brand",
        visibility: "client",
        kind: "brand",
        path: `clients/${grantedClient.client.slug}/brand_context/brand-snapshot.md`,
      });
    }
  }

  const privateDocs = await deps.store.listContextDocuments({
    visibility: "private",
    teamId: principal.teamId,
    userId: principal.userId,
    status: "active",
  });
  for (const doc of privateDocs.filter(shouldLoadTeamContextDocument)) {
    appendDatabaseDocument(layers, seen, doc);
  }

  const loadedKeys = new Set(layers.map((layer) => contextSnapshotLoadedKey(layer.visibility, layer.path)));
  appendAvailableDatabaseDocuments(availableContext, seenAvailable, loadedKeys, systemDocs);
  appendAvailableDatabaseDocuments(availableContext, seenAvailable, loadedKeys, teamDocs);
  appendAvailableDatabaseDocuments(availableContext, seenAvailable, loadedKeys, privateDocs);
  if (grantedClient) {
    appendAvailableDatabaseDocuments(availableContext, seenAvailable, loadedKeys, clientDocs);
  }

  if (root && workspaceFallbackEnabled) {
    await appendAvailableWorkspaceTree(root, availableContext, seenAvailable, loadedKeys, {
      visibility: "team",
      basePath: "team_context",
    });
    await appendAvailableWorkspaceTree(root, availableContext, seenAvailable, loadedKeys, {
      visibility: "team",
      basePath: "brand_context",
    });
    if (grantedClient) {
      await appendAvailableWorkspaceTree(root, availableContext, seenAvailable, loadedKeys, {
        visibility: "client",
        basePath: `clients/${grantedClient.client.slug}/brand_context`,
      });
      await appendAvailableWorkspaceFile(root, availableContext, seenAvailable, loadedKeys, {
        visibility: "client",
        kind: "agents",
        path: `clients/${grantedClient.client.slug}/AGENTS.md`,
      });
      await appendAvailableWorkspaceFile(root, availableContext, seenAvailable, loadedKeys, {
        visibility: "client",
        kind: "memory",
        path: `clients/${grantedClient.client.slug}/context/MEMORY.md`,
      });
    }
  }

  const baseSnapshot = {
    generatedAt: new Date().toISOString(),
    team: {
      id: principal.teamId,
      slug: team?.slug ?? null,
      name: team?.name ?? null,
    },
    user: {
      id: principal.userId,
      email: user?.email ?? null,
      displayName: user?.displayName ?? null,
    },
    client: grantedClient
      ? {
          id: grantedClient.client.id,
          slug: grantedClient.client.slug,
          name: grantedClient.client.name ?? null,
          access: grantedClient.grant.access,
        }
      : null,
    taskType: input.taskType ?? null,
    layers,
    availableContext: availableContext.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const markdown = buildContextSnapshotMarkdown(baseSnapshot);
  await recordContextAudit(
    deps,
    principal,
    "context.read",
    null,
    "context snapshot resolved",
    {
      clientSlug: grantedClient?.client.slug ?? null,
      taskType: input.taskType ?? null,
      layers: layers.map((layer) => ({
        visibility: layer.visibility,
        kind: layer.kind,
        path: layer.path,
        sha256: layer.sha256,
        source: layer.source,
      })),
      availableContext: availableContext.map((file) => ({
        visibility: file.visibility,
        kind: file.kind,
        path: file.path,
        source: file.source,
        size: file.size,
      })),
    },
  );
  return { ...baseSnapshot, markdown };
}

function shapeContextDocument(doc: ContextDocumentRow, includeContent = true): Record<string, unknown> {
  return {
    id: doc.id,
    visibility: doc.visibility,
    teamId: doc.teamId,
    clientId: doc.clientId,
    userId: doc.userId,
    path: doc.path,
    kind: doc.kind,
    sha256: doc.contentSha256,
    status: doc.status,
    updatedBy: doc.updatedBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(includeContent ? { content: doc.content } : {}),
  };
}

export async function handleContextSnapshotRequest(
  deps: MemoryApiDeps,
  query: { client?: string | null; cwd?: string | null; taskType?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireTeamApiPrincipal(deps, context);
    const snapshot = await resolveContextSnapshot(deps, {
      principal,
      selectedClient: query.client ?? null,
      cwd: query.cwd ?? null,
      taskType: query.taskType ?? null,
    });
    return {
      status: 200,
      body: {
        snapshot: {
          generatedAt: snapshot.generatedAt,
          team: snapshot.team,
          user: snapshot.user,
          client: snapshot.client,
          taskType: snapshot.taskType,
          layers: snapshot.layers.map((layer) => ({
            label: layer.label,
            visibility: layer.visibility,
            kind: layer.kind,
            path: layer.path,
            sha256: layer.sha256,
            source: layer.source,
            updatedAt: layer.updatedAt ?? null,
          })),
          availableContext: snapshot.availableContext.map((file) => ({
            visibility: file.visibility,
            kind: file.kind,
            path: file.path,
            title: file.title,
            size: file.size,
            source: file.source,
            updatedAt: file.updatedAt ?? null,
          })),
          markdown: snapshot.markdown,
        },
      },
    };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleContextDocumentsListRequest(
  deps: MemoryApiDeps,
  query: { visibility?: string | null; client?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireTeamApiPrincipal(deps, context);
    const visibility = query.visibility as Visibility | undefined;
    if (!visibility || !VALID_VISIBILITIES.includes(visibility)) {
      throw new ApiError(400, "invalid_request", "visibility must be team, client, private, or system");
    }

    let docs: ContextDocumentRow[] = [];
    if (visibility === "system") {
      docs = await deps.store.listContextDocuments({ visibility, status: "active" });
    } else if (visibility === "team") {
      docs = await deps.store.listContextDocuments({
        visibility,
        teamId: principal.teamId,
        status: "active",
      });
    } else if (visibility === "private") {
      docs = await deps.store.listContextDocuments({
        visibility,
        teamId: principal.teamId,
        userId: principal.userId,
        status: "active",
      });
    } else {
      const granted = await resolveOptionalContextClient(
        deps,
        principal,
        query.client ?? null,
        null,
        "read",
      );
      if (!granted) {
        throw new ApiError(400, "invalid_request", "client visibility requires client");
      }
      docs = await deps.store.listContextDocuments({
        visibility,
        teamId: principal.teamId,
        clientId: granted.client.id,
        status: "active",
      });
    }

    await recordContextAudit(
      deps,
      principal,
      "context.read",
      null,
      "context documents listed",
      { visibility, count: docs.length, client: query.client ?? null },
    );
    return {
      status: 200,
      body: { documents: docs.map((doc) => shapeContextDocument(doc)) },
    };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

async function mirrorContextDocumentToWorkspace(
  deps: MemoryApiDeps,
  doc: ContextDocumentRow,
): Promise<void> {
  if (!deps.workspaceRoot || doc.kind !== "brand") return;
  if (
    !doc.path.startsWith("brand_context/") &&
    !/^clients\/[^/]+\/brand_context\//.test(doc.path)
  ) {
    return;
  }
  const root = requireWorkspaceRoot(deps);
  const fullPath = resolveWorkspaceFile(root, doc.path);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, doc.content, "utf-8");
}

const CLIENT_BRAND_CONTEXT_PATH_RE = /^clients\/[^/]+\/brand_context\//;

/**
 * The reverse of {@link mirrorContextDocumentToWorkspace}: a client brand_context
 * write through the plain workspace file API (used by client file sync) also
 * upserts the context_documents row, so /v1/context/snapshot and the context
 * doc list don't silently drift from what workspace sync shows.
 */
async function mirrorClientBrandFileToContextDocument(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  client: IdentityClient,
  relativePath: string,
  content: string,
): Promise<void> {
  if (!CLIENT_BRAND_CONTEXT_PATH_RE.test(relativePath)) return;
  await deps.store.upsertContextDocument({
    scope: { teamId: principal.teamId, clientId: client.id, userId: null, visibility: "client" },
    path: relativePath,
    kind: "brand",
    content,
    contentSha256: sha256(content),
    updatedBy: principal.userId,
  });
}

async function archiveClientBrandFileContextDocument(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  client: IdentityClient,
  relativePath: string,
): Promise<void> {
  if (!CLIENT_BRAND_CONTEXT_PATH_RE.test(relativePath)) return;
  await deps.store.archiveContextDocument({
    scope: { teamId: principal.teamId, clientId: client.id, userId: null, visibility: "client" },
    path: relativePath,
    updatedBy: principal.userId,
  });
}

export async function handleContextDocumentWriteRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireTeamApiPrincipal(deps, context);
    const body = asRecord(rawBody, "invalid_request", "request body");
    const visibility = body.visibility as Visibility | undefined;
    if (!visibility || !VALID_VISIBILITIES.includes(visibility)) {
      throw new ApiError(400, "invalid_request", "visibility must be team, client, private, or system");
    }
    if (visibility === "system") {
      await recordContextAudit(
        deps,
        principal,
        "context.denied",
        null,
        "system context write denied",
        { reason: "system_context_read_only" },
      );
      throw new ApiError(403, "forbidden", "system context cannot be edited through this API");
    }

    const requiredPrincipal =
      visibility === "team" ? await requireAdminPrincipal(deps, context) : principal;
    const content = requiredString(body, "content");
    if (Buffer.byteLength(content, "utf-8") > MAX_WORKSPACE_FILE_BYTES) {
      throw new ApiError(413, "payload_too_large", `content exceeds ${MAX_WORKSPACE_FILE_BYTES} bytes`);
    }
    const granted = visibility === "client"
      ? await resolveOptionalContextClient(
          deps,
          requiredPrincipal,
          optionalString(body, "client"),
          null,
          "write",
        )
      : null;
    const client = granted?.client ?? null;
    const documentPath = normalizeContextPath(body.path);
    assertContextPathAllowed(visibility, documentPath, client);
    const kind = contextKindFromBody(body.kind, documentPath);
    const scope = contextScopeForDocument(requiredPrincipal, visibility, client);
    const existing = await deps.store.listContextDocuments({
      visibility,
      teamId: scope.teamId,
      clientId: scope.clientId,
      userId: scope.userId,
      path: documentPath,
      status: "active",
    });
    const current = existing[0] ?? null;
    const expectedSha256 = optionalString(body, "expectedSha256");
    if (current && !expectedSha256) {
      await recordContextAudit(
        deps,
        requiredPrincipal,
        "context.conflict",
        current.id,
        "context write missing expected hash",
        { path: documentPath, visibility },
      );
      throw new ApiError(409, "conflict", "expectedSha256 is required when the document already exists");
    }
    if (current && expectedSha256 !== current.contentSha256) {
      await recordContextAudit(
        deps,
        requiredPrincipal,
        "context.conflict",
        current.id,
        "context write conflict",
        {
          path: documentPath,
          visibility,
          expectedSha256,
          currentSha256: current.contentSha256,
        },
      );
      throw new ApiError(409, "conflict", "context document changed");
    }

    const doc = await deps.store.upsertContextDocument({
      scope,
      path: documentPath,
      kind,
      content,
      contentSha256: sha256(content),
      updatedBy: requiredPrincipal.userId,
    });
    await mirrorContextDocumentToWorkspace(deps, doc);
    await recordContextAudit(
      deps,
      requiredPrincipal,
      "context.write",
      doc.id,
      "context document written",
      {
        path: doc.path,
        visibility: doc.visibility,
        kind: doc.kind,
        sha256: doc.contentSha256,
        clientSlug: client?.slug ?? null,
      },
    );
    return { status: 200, body: { document: shapeContextDocument(doc) } };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleContextDocumentDeleteRequest(
  deps: MemoryApiDeps,
  query: {
    visibility?: string | null;
    path?: string | null;
    client?: string | null;
    expectedSha256?: string | null;
  } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const principal = await requireTeamApiPrincipal(deps, context);
    const visibility = query.visibility as Visibility | undefined;
    if (!visibility || !VALID_VISIBILITIES.includes(visibility)) {
      throw new ApiError(400, "invalid_request", "visibility must be team, client, private, or system");
    }
    if (visibility === "system") {
      await recordContextAudit(
        deps,
        principal,
        "context.denied",
        null,
        "system context archive denied",
        { reason: "system_context_read_only" },
      );
      throw new ApiError(403, "forbidden", "system context cannot be archived through this API");
    }
    const requiredPrincipal =
      visibility === "team" ? await requireAdminPrincipal(deps, context) : principal;
    const granted = visibility === "client"
      ? await resolveOptionalContextClient(deps, requiredPrincipal, query.client ?? null, null, "write")
      : null;
    const client = granted?.client ?? null;
    const documentPath = normalizeContextPath(query.path);
    assertContextPathAllowed(visibility, documentPath, client);
    const scope = contextScopeForDocument(requiredPrincipal, visibility, client);
    const existing = await deps.store.listContextDocuments({
      visibility,
      teamId: scope.teamId,
      clientId: scope.clientId,
      userId: scope.userId,
      path: documentPath,
      status: "active",
    });
    const current = existing[0] ?? null;
    if (!current) {
      return { status: 200, body: { archived: false, path: documentPath } };
    }
    if (query.expectedSha256 && query.expectedSha256 !== current.contentSha256) {
      await recordContextAudit(
        deps,
        requiredPrincipal,
        "context.conflict",
        current.id,
        "context archive conflict",
        {
          path: documentPath,
          visibility,
          expectedSha256: query.expectedSha256,
          currentSha256: current.contentSha256,
        },
      );
      throw new ApiError(409, "conflict", "context document changed");
    }
    const archived = await deps.store.archiveContextDocument({
      scope,
      path: documentPath,
      updatedBy: requiredPrincipal.userId,
    });
    await recordContextAudit(
      deps,
      requiredPrincipal,
      "context.archived",
      archived?.id ?? current.id,
      "context document archived",
      { path: documentPath, visibility, clientSlug: client?.slug ?? null },
    );
    return {
      status: 200,
      body: {
        archived: true,
        document: archived ? shapeContextDocument(archived, false) : null,
      },
    };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

async function requireClientGrantForWorkspace(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  clientSlug: string,
  required: GrantAccess,
  metadata: Record<string, unknown> = {},
): Promise<WorkspaceClientGrant> {
  if (!deps.identityStore) {
    throw new ApiError(500, "internal", "identity store is required for workspace sync");
  }
  if (!CLIENT_SLUG_RE.test(clientSlug)) {
    throw new ApiError(400, "invalid_request", "client slug is invalid");
  }

  const client = await deps.identityStore.getClientBySlug(principal.teamId, clientSlug);
  if (!client || (client.status && client.status !== "active")) {
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.denied",
      "team",
      principal.teamId,
      "workspace sync denied: unknown client",
      { ...metadata, clientSlug, required, reason: "unknown_client" },
    );
    throw new ApiError(404, "not_found", "client not found");
  }

  const membership = await deps.identityStore.getMembership(principal.teamId, principal.userId);
  if (hasFullTeamAccess(principal, membership)) {
    return { client, grant: { access: "write", status: "active" } };
  }

  const denialSummaries: Record<string, string> = {
    revoked_client_grant: "workspace sync denied: revoked client grant",
    missing_client_grant: "workspace sync denied: missing client grant",
  };
  const grant = await resolveClientGrantOrThrow(deps, principal, client, required, async (reason) => {
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.denied",
      "client",
      client.id,
      denialSummaries[reason] ?? "workspace sync denied",
      { ...metadata, clientSlug, required, reason },
    );
  });

  return { client, grant };
}

async function recordWorkspaceAudit(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  action: AuditAction,
  targetType: AuditTargetType,
  targetId: string | null,
  summary: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps.identityStore) return;
  const safeTargetId = targetType === "skill" ? null : targetId;
  await deps.identityStore.recordAuditEvent({
    teamId: principal.teamId,
    actorUserId: principal.userId,
    action,
    targetType,
    targetId: safeTargetId,
    summary,
    metadata: { ...metadata, authSource: principal.authSource ?? null },
  });
}

async function listGrantedWorkspaceClients(
  deps: MemoryApiDeps,
  principal: MemoryApiPrincipal,
  clientSlug?: string | null,
): Promise<WorkspaceClientGrant[]> {
  if (clientSlug) {
    return [await requireClientGrantForWorkspace(deps, principal, clientSlug, "read")];
  }
  const clients = deps.identityStore!.listClients
    ? await deps.identityStore!.listClients(principal.teamId)
    : [];
  const out: WorkspaceClientGrant[] = [];
  for (const client of clients) {
    if (client.status && client.status !== "active") continue;
    const membership = await deps.identityStore!.getMembership(principal.teamId, principal.userId);
    if (hasFullTeamAccess(principal, membership)) {
      out.push({ client, grant: { access: "write", status: "active" } });
      continue;
    }
    const grant = await deps.identityStore!.getActiveGrant(
      principal.teamId,
      client.id,
      principal.userId,
    );
    if (grant && grant.status === "active") out.push({ client, grant });
  }
  return out;
}

async function collectClientManifest(
  root: string,
  client: IdentityClient,
  grant: IdentityGrant,
): Promise<WorkspaceManifestResult> {
  const clientRoot = path.join(root, "clients", client.slug);
  const files: Array<Record<string, unknown>> = [];
  let unsupportedFiles = 0;
  let secretFilesHidden = 0;
  const start = await statFileOrNull(clientRoot);
  if (!start || !start.isDirectory()) return { files, unsupportedFiles, secretFilesHidden };

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        unsupportedFiles += 1;
        continue;
      }
      const stat = await fs.stat(fullPath);
      if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
        unsupportedFiles += 1;
        continue;
      }
      const secret = isSecretWorkspacePath(rel);
      if (secret && grant.access !== "write") {
        secretFilesHidden += 1;
        continue;
      }
      const content = await fs.readFile(fullPath);
      files.push({
        path: rel,
        client: client.slug,
        size: stat.size,
        sha256: sha256(content),
        updatedAt: stat.mtime.toISOString(),
        writable: grant.access === "write",
        secret,
        encoding: isLikelyTextBuffer(rel, content) ? "utf-8" : "base64",
      });
    }
  }

  await walk(clientRoot);
  files.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return { files, unsupportedFiles, secretFilesHidden };
}

export async function handleWorkspaceManifestRequest(
  deps: MemoryApiDeps,
  query: { client?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const principal = await requireTeamApiPrincipal(deps, context);
    const granted = await listGrantedWorkspaceClients(deps, principal, query.client ?? null);
    const files: Array<Record<string, unknown>> = [];
    let unsupportedFiles = 0;
    let secretFilesHidden = 0;
    for (const { client, grant } of granted) {
      const manifest = await collectClientManifest(root, client, grant);
      files.push(...manifest.files);
      unsupportedFiles += manifest.unsupportedFiles;
      secretFilesHidden += manifest.secretFilesHidden;
    }
    return {
      status: 200,
      body: {
        clients: granted.map(({ client, grant }) => ({
          id: client.id,
          slug: client.slug,
          name: client.name ?? client.slug,
          access: grant.access,
        })),
        files,
        unsupportedFiles,
        secretFilesHidden,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleWorkspaceFileReadRequest(
  deps: MemoryApiDeps,
  query: { path?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const relativePath = normalizeWorkspacePath(query.path);
    const principal = await requireTeamApiPrincipal(deps, context);
    const isSecret = isSecretWorkspacePath(relativePath);
    const { client } = await requireClientGrantForWorkspace(
      deps,
      principal,
      workspaceClientFromPath(relativePath),
      isSecret ? "write" : "read",
      { path: relativePath, secret: isSecret },
    );
    const fullPath = resolveWorkspaceFile(root, relativePath);
    const stat = await statFileOrNull(fullPath);
    if (!stat || !stat.isFile() || stat.size > MAX_WORKSPACE_FILE_BYTES) {
      throw new ApiError(404, "not_found", "file not found");
    }
    const content = await fs.readFile(fullPath);
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.pull",
      "client",
      client.id,
      "workspace file pulled",
      {
        path: relativePath,
        clientSlug: client.slug,
        size: stat.size,
        sha256: sha256(content),
        secret: isSecret,
      },
    );
    return {
      status: 200,
      body: {
        path: relativePath,
        size: stat.size,
        sha256: sha256(content),
        updatedAt: stat.mtime.toISOString(),
        secret: isSecret,
        ...workspaceFilePayload(relativePath, content),
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleWorkspaceFileWriteRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  query: { path?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const relativePath = normalizeWorkspacePath(query.path);
    const principal = await requireTeamApiPrincipal(deps, context);
    const isSecret = isSecretWorkspacePath(relativePath);
    const { client } = await requireClientGrantForWorkspace(
      deps,
      principal,
      workspaceClientFromPath(relativePath),
      "write",
      { path: relativePath, secret: isSecret },
    );

    const body = asRecord(rawBody, "invalid_request", "request body");
    const content = workspaceBodyToBuffer(body);
    if (content.length > MAX_WORKSPACE_FILE_BYTES) {
      throw new ApiError(
        413,
        "payload_too_large",
        `file content exceeds ${MAX_WORKSPACE_FILE_BYTES} bytes`,
      );
    }
    if (body.expectedSha256 != null) {
      if (typeof body.expectedSha256 !== "string" || body.expectedSha256.trim() === "") {
        throw new ApiError(400, "invalid_request", "expectedSha256 must be a string");
      }
      const current = await statFileOrNull(resolveWorkspaceFile(root, relativePath));
      if (current && current.isFile()) {
        const currentHash = sha256(await fs.readFile(resolveWorkspaceFile(root, relativePath)));
        if (currentHash !== body.expectedSha256) {
          await recordWorkspaceAudit(
            deps,
            principal,
            "sync.conflict",
            "client",
            client.id,
            "workspace sync conflict",
            {
              path: relativePath,
              clientSlug: client.slug,
              expectedSha256: body.expectedSha256,
              currentSha256: currentHash,
            },
          );
          throw new ApiError(409, "conflict", "remote file changed");
        }
      }
    }

    const fullPath = resolveWorkspaceFile(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    const stat = await fs.stat(fullPath);
    if (typeof body.content === "string") {
      await mirrorClientBrandFileToContextDocument(deps, principal, client, relativePath, body.content);
    }
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.push",
      "client",
      client.id,
      "workspace file pushed",
      {
        path: relativePath,
        clientSlug: client.slug,
        size: stat.size,
        sha256: sha256(content),
        secret: isSecret,
      },
    );
    return {
      status: 200,
      body: {
        path: relativePath,
        size: stat.size,
        sha256: sha256(content),
        updatedAt: stat.mtime.toISOString(),
        secret: isSecret,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleWorkspaceFileDeleteRequest(
  deps: MemoryApiDeps,
  query: { path?: string | null; expectedSha256?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const relativePath = normalizeWorkspacePath(query.path);
    const principal = await requireTeamApiPrincipal(deps, context);
    const isSecret = isSecretWorkspacePath(relativePath);
    const { client } = await requireClientGrantForWorkspace(
      deps,
      principal,
      workspaceClientFromPath(relativePath),
      "write",
      { path: relativePath, secret: isSecret },
    );

    const fullPath = resolveWorkspaceFile(root, relativePath);
    const stat = await statFileOrNull(fullPath);
    if (!stat || !stat.isFile()) {
      return {
        status: 200,
        body: { deleted: false, path: relativePath },
      };
    }

    if (query.expectedSha256 != null && query.expectedSha256.trim() !== "") {
      const currentContent = await fs.readFile(fullPath);
      const currentHash = sha256(currentContent);
      if (currentHash !== query.expectedSha256) {
        await recordWorkspaceAudit(
          deps,
          principal,
          "sync.conflict",
          "client",
          client.id,
          "workspace sync conflict",
          {
            path: relativePath,
            clientSlug: client.slug,
            expectedSha256: query.expectedSha256,
            currentSha256: currentHash,
            operation: "delete",
            secret: isSecret,
          },
        );
        throw new ApiError(409, "conflict", "remote file changed");
      }
    }

    await fs.unlink(fullPath);
    await archiveClientBrandFileContextDocument(deps, principal, client, relativePath);
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.push",
      "client",
      client.id,
      "workspace file deleted",
      {
        path: relativePath,
        clientSlug: client.slug,
        secret: isSecret,
      },
    );
    return {
      status: 200,
      body: { deleted: true, path: relativePath },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

// ── brand context file sync ──────────────────────────────────────────────────

function normalizeBrandContextPath(rawPath: unknown): string {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new ApiError(400, "invalid_request", "path is required");
  }
  const input = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    input.includes("\0") ||
    path.posix.isAbsolute(input) ||
    path.win32.isAbsolute(input)
  ) {
    throw new ApiError(400, "invalid_request", "path must be relative");
  }
  const parts = input.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new ApiError(400, "invalid_request", "path cannot contain traversal segments");
  }
  if (parts[0] !== "brand_context" || parts.length < 2) {
    throw new ApiError(400, "invalid_request", "path must be under brand_context/...");
  }
  return parts.join("/");
}

async function collectBrandContextManifest(root: string): Promise<Array<Record<string, unknown>>> {
  const brandRoot = path.join(root, "brand_context");
  const files: Array<Record<string, unknown>> = [];
  const start = await statFileOrNull(brandRoot);
  if (!start || !start.isDirectory()) return files;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(entry.name) && !isExcludedRelativePath(rel)) {
          await walk(fullPath);
        }
        continue;
      }
      if (!entry.isFile() || !isSyncableTextFile(rel)) continue;
      const stat = await fs.stat(fullPath);
      if (stat.size > MAX_WORKSPACE_FILE_BYTES) continue;
      const content = await fs.readFile(fullPath);
      files.push({
        path: rel,
        size: stat.size,
        sha256: sha256(content),
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }

  await walk(brandRoot);
  files.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return files;
}

export async function handleBrandContextManifestRequest(
  deps: MemoryApiDeps,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const principal = await requireTeamApiPrincipal(deps, context);
    const membership = await deps.identityStore!.getMembership(principal.teamId, principal.userId);
    const writable = hasFullTeamAccess(principal, membership);
    return {
      status: 200,
      body: {
        files: await collectBrandContextManifest(root),
        writable,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleBrandContextFileReadRequest(
  deps: MemoryApiDeps,
  query: { path?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const relativePath = normalizeBrandContextPath(query.path);
    if (!isSyncableTextFile(relativePath)) {
      throw new ApiError(404, "not_found", "file not found");
    }
    const principal = await requireTeamApiPrincipal(deps, context);
    const fullPath = resolveWorkspaceFile(root, relativePath);
    const stat = await statFileOrNull(fullPath);
    if (!stat || !stat.isFile() || stat.size > MAX_WORKSPACE_FILE_BYTES) {
      throw new ApiError(404, "not_found", "file not found");
    }
    const content = await fs.readFile(fullPath, "utf-8");
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.pull",
      "team",
      principal.teamId,
      "brand context file pulled",
      { path: relativePath, size: stat.size, sha256: sha256(content) },
    );
    return {
      status: 200,
      body: {
        path: relativePath,
        content,
        size: stat.size,
        sha256: sha256(content),
        updatedAt: stat.mtime.toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export async function handleBrandContextFileWriteRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  query: { path?: string | null } = {},
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const root = requireWorkspaceRoot(deps);
    const relativePath = normalizeBrandContextPath(query.path);
    if (!isSyncableTextFile(relativePath)) {
      throw new ApiError(404, "not_found", "file not found");
    }
    const principal = await requireAdminPrincipal(deps, context);
    const body = asRecord(rawBody, "invalid_request", "request body");
    const content = requiredString(body, "content");
    if (Buffer.byteLength(content, "utf-8") > MAX_WORKSPACE_FILE_BYTES) {
      throw new ApiError(
        413,
        "payload_too_large",
        `file content exceeds ${MAX_WORKSPACE_FILE_BYTES} bytes`,
      );
    }
    if (body.expectedSha256 != null) {
      if (typeof body.expectedSha256 !== "string" || body.expectedSha256.trim() === "") {
        throw new ApiError(400, "invalid_request", "expectedSha256 must be a string");
      }
      const fullPath = resolveWorkspaceFile(root, relativePath);
      const current = await statFileOrNull(fullPath);
      if (current && current.isFile()) {
        const currentHash = sha256(await fs.readFile(fullPath));
        if (currentHash !== body.expectedSha256) {
          await recordWorkspaceAudit(
            deps,
            principal,
            "sync.conflict",
            "team",
            principal.teamId,
            "brand context sync conflict",
            { path: relativePath, expectedSha256: body.expectedSha256, currentSha256: currentHash },
          );
          throw new ApiError(409, "conflict", "remote file changed");
        }
      }
    }

    const fullPath = resolveWorkspaceFile(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    const stat = await fs.stat(fullPath);
    const mirroredDoc = await deps.store.upsertContextDocument({
      scope: {
        teamId: principal.teamId,
        clientId: null,
        userId: null,
        visibility: "team",
      },
      path: relativePath,
      kind: "brand",
      content,
      contentSha256: sha256(content),
      updatedBy: principal.userId,
    });
    await recordWorkspaceAudit(
      deps,
      principal,
      "sync.push",
      "team",
      principal.teamId,
      "brand context file pushed",
      {
        path: relativePath,
        size: stat.size,
        sha256: sha256(content),
        contextDocumentId: mirroredDoc.id,
      },
    );
    return {
      status: 200,
      body: {
        path: relativePath,
        size: stat.size,
        sha256: sha256(content),
        updatedAt: stat.mtime.toISOString(),
      },
    };
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

// ── search ───────────────────────────────────────────────────────────────────

/**
 * Build the SearchScope from a request body's `scope` object. Mirrors the CLI's
 * buildSearchScope: an explicit scope object is REQUIRED; `include` (when
 * given) pins the visibility layers, else they derive from the identity fields
 * with `system` as the always-present baseline.
 */
export function buildSearchScopeFromBody(rawScope: unknown): SearchScope {
  if (rawScope == null) {
    throw new ApiError(
      400,
      "invalid_scope",
      "scope is required: pass a scope object with teamId/clientId/userId " +
        'and/or an explicit include list (e.g. {"include":["system"]})',
    );
  }
  const raw = asRecord(rawScope, "invalid_scope", "scope");

  const searchScope: SearchScope = {
    teamId: optionalId(raw, "teamId"),
    clientId: optionalId(raw, "clientId"),
    userId: optionalId(raw, "userId"),
  };

  if (raw.include != null) {
    if (!Array.isArray(raw.include) || raw.include.length === 0) {
      throw new ApiError(400, "invalid_scope", "scope.include must be a non-empty array");
    }
    for (const layer of raw.include) {
      if (!VALID_VISIBILITIES.includes(layer as Visibility)) {
        throw new ApiError(
          400,
          "invalid_scope",
          `scope.include has invalid visibility "${String(layer)}" ` +
            `(allowed: ${VALID_VISIBILITIES.join(", ")})`,
        );
      }
    }
    searchScope.include = raw.include as Visibility[];
  } else {
    // Derive layers from the identity fields; system is the baseline everyone sees.
    const include: Visibility[] = ["system"];
    if (searchScope.teamId != null) include.push("team");
    if (searchScope.clientId != null) include.push("client");
    if (searchScope.userId != null) include.push("private");
    searchScope.include = include;
  }

  return searchScope;
}

function optionalBoundedInteger(
  raw: Record<string, unknown>,
  key: string,
  { min, max }: { min: number; max: number },
): number | undefined {
  if (raw[key] == null) return undefined;
  const value = Number(raw[key]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(
      400,
      "invalid_request",
      `${key} must be an integer in [${min}, ${max}]`,
    );
  }
  return value;
}

/**
 * POST /v1/memory/expand — accept a chunk id from a prior scoped search and
 * return surrounding source context. Out-of-scope chunks return null, matching
 * local expand's deny-as-not-found behavior.
 */
export async function handleExpandRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const chunkId = requiredString(body, "chunkId").trim();
    const searchScope = buildSearchScopeFromBody(body.scope);
    const authorizedScope = await authorizeSearchScope(deps, searchScope, context);
    const radius = optionalBoundedInteger(body, "radius", { min: 0, max: 20 });
    const limit = optionalBoundedInteger(body, "limit", { min: 1, max: 100 });
    const maxChars = optionalBoundedInteger(body, "maxChars", { min: 1, max: 100_000 });

    const expansion = await expandMemoryChunk({
      client: deps.store.client,
      chunkId,
      searchScope: authorizedScope,
      radius,
      limit,
      maxChars,
    });

    return {
      status: 200,
      body: { expansion },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

/**
 * POST /v1/memory/search — run scoped + reranked search and return
 * citation-ready hits plus the audit event id. By default callers provide the
 * query embedding; hosted deployments may enable embeddingMode="server".
 */
export async function handleSearchRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const query = requiredString(body, "query");
    const serverMode = body.embeddingMode === "server";
    if (body.embeddingMode != null && body.embeddingMode !== "server" && body.embeddingMode !== "client") {
      throw new ApiError(400, "invalid_request", "embeddingMode must be \"client\" or \"server\"");
    }
    const spec = serverMode ? expectedEmbeddingSpec(deps) : parseEmbeddingSpec(deps, body);
    const serverEmbedder = serverMode ? await resolveServerSearchEmbedder(deps) : undefined;
    const queryEmbedding = serverMode
      ? undefined
      : parseEmbeddingVector(body.queryEmbedding, spec.dim, "queryEmbedding");
    const searchScope = buildSearchScopeFromBody(body.scope);
    const authorizedScope = await authorizeSearchScope(deps, searchScope, context);

    let topK = 10;
    if (body.topK != null) {
      const n = Number(body.topK);
      if (!Number.isInteger(n) || n < 1 || n > MAX_TOP_K) {
        throw new ApiError(
          400,
          "invalid_request",
          `topK must be an integer in [1, ${MAX_TOP_K}]`,
        );
      }
      topK = n;
    }

    const res = await searchMemory({
      store: deps.store,
      query,
      queryEmbedding,
      embedder: serverEmbedder,
      embeddingModel: spec.model,
      embeddingDim: spec.dim,
      searchScope: authorizedScope,
      topK,
      rerankConfig: deps.rerankConfig,
      recordEvent: true, // audit is mandatory on the hosted API
      storeQueryText: body.storeQueryText === true,
    });

    return {
      status: 200,
      body: {
        results: res.results.map((r) => ({
          chunkId: r.id,
          sourceId: r.sourceId,
          sourcePath: r.sourcePath,
          sourceType: r.sourceType,
          contentDate: r.contentDate,
          heading: r.heading,
          headingLevel: r.headingLevel,
          startLine: r.startLine,
          endLine: r.endLine,
          contentHash: r.contentHash,
          chunkKey: r.chunkKey,
          content: r.content,
          score: Number((1 - r.distance).toFixed(6)), // cosine similarity
          distance: r.distance,
          finalScore: r.finalScore,
          reranked: r.reranked,
        })),
        visibilitySet: res.visibilitySet,
        latencyMs: res.latencyMs,
        eventId: res.event ? res.event.id : null,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error; // transport maps unexpected failures to 500
  }
}

// ── ingest ───────────────────────────────────────────────────────────────────

/** Build and validate the ingest Scope from a request body's `scope` object. */
function buildIngestScopeFromBody(rawScope: unknown): Scope {
  if (rawScope == null) {
    throw new ApiError(
      400,
      "invalid_scope",
      "scope is required: pass {teamId, clientId, userId, visibility}",
    );
  }
  const raw = asRecord(rawScope, "invalid_scope", "scope");

  if (!VALID_VISIBILITIES.includes(raw.visibility as Visibility)) {
    throw new ApiError(
      400,
      "invalid_scope",
      `scope.visibility must be one of ${VALID_VISIBILITIES.join(", ")}`,
    );
  }

  const scope: Scope = {
    teamId: optionalId(raw, "teamId"),
    clientId: optionalId(raw, "clientId"),
    userId: optionalId(raw, "userId"),
    visibility: raw.visibility as Visibility,
  };

  try {
    assertValidScope(scope); // the same invariants the store + DB enforce
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(400, "invalid_scope", message);
  }
  return scope;
}

/**
 * POST /v1/memory/ingest — upsert one source from client-chunked,
 * client-embedded rows. The hosted API validates and stores vectors only.
 * Idempotent: re-sending identical content is a no-op (`skipped: true`).
 */
export async function handleIngestRequest(
  deps: MemoryApiDeps,
  rawBody: unknown,
  context: MemoryApiRequestContext = {},
): Promise<ApiResponse> {
  try {
    const body = asRecord(rawBody, "invalid_request", "request body");
    const scope = buildIngestScopeFromBody(body.scope);
    const authorizedScope = await authorizeIngestScope(deps, scope, context);
    const sourcePath = requiredString(body, "sourcePath").trim();
    const { spec, chunks } = parseClientProvidedChunks(deps, body);
    const { contentSha256, byteSize } = parseContentSha256AndByteSize(body);

    let sourceType: SourceType = "other";
    if (body.sourceType != null) {
      if (!VALID_SOURCE_TYPES.includes(body.sourceType as SourceType)) {
        throw new ApiError(
          400,
          "invalid_request",
          `sourceType must be one of ${VALID_SOURCE_TYPES.join(", ")}`,
        );
      }
      sourceType = body.sourceType as SourceType;
    }

    let contentDate: string | null = null;
    if (body.contentDate != null) {
      if (typeof body.contentDate !== "string" || !DATE_RE.test(body.contentDate)) {
        throw new ApiError(400, "invalid_request", "contentDate must be YYYY-MM-DD");
      }
      contentDate = body.contentDate;
    }

    let authorityWeight: number | undefined;
    if (body.authorityWeight != null) {
      const w = Number(body.authorityWeight);
      if (!Number.isFinite(w) || w <= 0) {
        throw new ApiError(400, "invalid_request", "authorityWeight must be a positive number");
      }
      authorityWeight = w;
    }

    let reason: IndexJobReason = "manual";
    if (body.reason != null) {
      if (!VALID_REASONS.includes(body.reason as IndexJobReason)) {
        throw new ApiError(
          400,
          "invalid_request",
          `reason must be one of ${VALID_REASONS.join(", ")}`,
        );
      }
      reason = body.reason as IndexJobReason;
    }

    let title: string | null = null;
    if (body.title != null) {
      if (typeof body.title !== "string") {
        throw new ApiError(400, "invalid_request", "title must be a string or null");
      }
      title = body.title;
    }

    const result = await ingestPreparedContent({
      store: deps.store,
      scope: authorizedScope,
      sourcePath,
      sourceType,
      title,
      createdByUserId: context.principal?.userId ?? null,
      contentDate,
      authorityWeight,
      contentSha256,
      byteSize,
      embeddingModel: spec.model,
      embeddingDim: spec.dim,
      chunks,
      force: body.force === true,
      reason,
    });

    return {
      status: 200,
      body: {
        sourceId: result.sourceId,
        skipped: result.skipped,
        chunksInserted: result.chunksInserted,
        chunksPruned: result.chunksPruned,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error; // transport maps unexpected failures to 500
  }
}
