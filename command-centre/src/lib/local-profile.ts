import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getConfig } from "./config";
import {
  createProfileIdentityV1,
  type ProfileIdentityV1,
} from "./identity/session-scope";
import { getLocalProfileRuntimeSession } from "./local-profile-lifecycle";

export const LOCAL_PROFILE_VERSION = 1 as const;
export const LOCAL_PROFILE_SCHEMA_VERSION = 1 as const;
export const SOLO_PROFILE_KEY = "solo" as const;

export type LocalProfileStatus =
  | "creating"
  | "ready"
  | "migration_failed"
  | "missing";

export interface SoloLocalProfileDescriptorV1 {
  readonly version: typeof LOCAL_PROFILE_VERSION;
  readonly mode: "solo";
  readonly profileKey: typeof SOLO_PROFILE_KEY;
  readonly dataDir: string;
  readonly stateDir: string;
  readonly tempDir: string;
  readonly dbPath: string;
}

export interface TeamLocalProfileDescriptorV1 {
  readonly version: typeof LOCAL_PROFILE_VERSION;
  readonly mode: "team";
  readonly profileKey: string;
  readonly identity: ProfileIdentityV1;
  readonly dataDir: string;
  readonly stateDir: string;
  readonly tempDir: string;
  readonly dbPath: string;
}

export type LocalProfileDescriptorV1 =
  | SoloLocalProfileDescriptorV1
  | TeamLocalProfileDescriptorV1;

export interface BrowserLocalProfileV1 {
  readonly version: typeof LOCAL_PROFILE_VERSION;
  readonly mode: "solo" | "team";
  readonly profileKey: string;
  readonly sessionId: string;
}

export interface LocalTeamProfileMetadataV1 {
  version: typeof LOCAL_PROFILE_VERSION;
  profileKey: string;
  identity: ProfileIdentityV1;
  status: LocalProfileStatus;
  relativeDirectory: string;
  localSchemaVersion: number;
  createdAt: string;
  updatedAt: string;
  lastAuthenticatedAt: string;
  lastServerUrl: string;
  lastKnownEmail: string | null;
  recoveryMessage: string | null;
}

interface LocalProfileRegistryV1 {
  version: typeof LOCAL_PROFILE_VERSION;
  profiles: LocalTeamProfileMetadataV1[];
}

export type LocalProfileLockedCode =
  | "corrupt_context"
  | "identity_incomplete"
  | "reauthentication_required"
  | "profile_metadata_invalid"
  | "profile_missing"
  | "profile_migration_failed";

export class LocalProfileLockedError extends Error {
  readonly status = 423;
  readonly code = "profile_locked";

  constructor(
    readonly reason: LocalProfileLockedCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalProfileLockedError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function getTeamContextFilePath(): string {
  const dir = process.env.AI_OS_TEAM_CONFIG_DIR
    ? path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR)
    : path.join(os.homedir(), ".AI-OS");
  return path.join(dir, "team-context.json");
}

export function createLocalProfileKey(identity: ProfileIdentityV1): string {
  return crypto
    .createHash("sha256")
    .update(`team-os-profile:v1\n${identity.serverId}\n${identity.userId}`, "utf8")
    .digest("hex");
}

export function createTeamLocalProfileDescriptor(
  identity: ProfileIdentityV1,
): TeamLocalProfileDescriptorV1 {
  const config = getConfig();
  const profileKey = createLocalProfileKey(identity);
  assertProfileKey(profileKey);
  const dataDir = resolveContained(config.dataDir, "profiles", profileKey);
  return Object.freeze({
    version: LOCAL_PROFILE_VERSION,
    mode: "team" as const,
    profileKey,
    identity,
    dataDir,
    stateDir: resolveContained(dataDir, "state"),
    tempDir: resolveContained(dataDir, "tmp"),
    dbPath: resolveContained(dataDir, "data.db"),
  });
}

function assertProfileKey(profileKey: string): void {
  if (!/^[a-f0-9]{64}$/.test(profileKey)) {
    throw new LocalProfileLockedError(
      "profile_metadata_invalid",
      "The saved Team OS local profile key is invalid. Reconnect this profile before continuing.",
    );
  }
}

function resolveContained(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, ...segments);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new LocalProfileLockedError(
      "profile_metadata_invalid",
      "The saved Team OS local profile path is invalid. Reconnect this profile before continuing.",
    );
  }
  return resolvedTarget;
}

function registryPath(): string {
  return path.join(getConfig().dataDir, "profiles", "registry-v1.json");
}

function profileMetadataPath(profileKey: string): string {
  assertProfileKey(profileKey);
  return resolveContained(getConfig().dataDir, "profiles", profileKey, "profile-v1.json");
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = fs.openSync(tempPath, "wx", 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tempPath, filePath);
}

function parseMetadata(value: unknown): LocalTeamProfileMetadataV1 | null {
  const record = asRecord(value);
  const identityRecord = asRecord(record?.identity);
  if (
    record?.version !== LOCAL_PROFILE_VERSION ||
    typeof record.profileKey !== "string" ||
    typeof record.relativeDirectory !== "string" ||
    typeof record.status !== "string" ||
    !["creating", "ready", "migration_failed", "missing"].includes(record.status) ||
    !identityRecord ||
    identityRecord.version !== 1 ||
    typeof identityRecord.serverId !== "string" ||
    typeof identityRecord.userId !== "string"
  ) {
    return null;
  }
  try {
    const identity = createProfileIdentityV1({
      serverId: identityRecord.serverId,
      userId: identityRecord.userId,
    });
    const profileKey = createLocalProfileKey(identity);
    if (profileKey !== record.profileKey) return null;
    assertProfileKey(profileKey);
    return {
      version: LOCAL_PROFILE_VERSION,
      profileKey,
      identity,
      status: record.status as LocalProfileStatus,
      relativeDirectory: record.relativeDirectory,
      localSchemaVersion: typeof record.localSchemaVersion === "number" ? record.localSchemaVersion : 0,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
      lastAuthenticatedAt: typeof record.lastAuthenticatedAt === "string" ? record.lastAuthenticatedAt : new Date(0).toISOString(),
      lastServerUrl: typeof record.lastServerUrl === "string" ? record.lastServerUrl : "",
      lastKnownEmail: typeof record.lastKnownEmail === "string" ? record.lastKnownEmail : null,
      recoveryMessage: typeof record.recoveryMessage === "string" ? record.recoveryMessage : null,
    };
  } catch {
    return null;
  }
}

function rebuildRegistry(): LocalProfileRegistryV1 {
  const profilesRoot = path.join(getConfig().dataDir, "profiles");
  const profiles: LocalTeamProfileMetadataV1[] = [];
  if (fs.existsSync(profilesRoot)) {
    for (const entry of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      try {
        const parsed = parseMetadata(JSON.parse(fs.readFileSync(profileMetadataPath(entry.name), "utf8")));
        if (parsed && parsed.relativeDirectory === entry.name) profiles.push(parsed);
      } catch {
        // Invalid profile folders are never adopted automatically.
      }
    }
  }
  const registry: LocalProfileRegistryV1 = { version: LOCAL_PROFILE_VERSION, profiles };
  atomicWriteJson(registryPath(), registry);
  return registry;
}

function readRegistry(): LocalProfileRegistryV1 {
  const filePath = registryPath();
  if (!fs.existsSync(filePath)) return rebuildRegistry();
  try {
    const record = asRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (record?.version !== LOCAL_PROFILE_VERSION || !Array.isArray(record.profiles)) {
      throw new Error("Unsupported profile registry");
    }
    const profiles = record.profiles.map(parseMetadata);
    if (profiles.some((profile) => profile === null)) throw new Error("Invalid profile registry");
    return { version: LOCAL_PROFILE_VERSION, profiles: profiles as LocalTeamProfileMetadataV1[] };
  } catch {
    const backupPath = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try { fs.renameSync(filePath, backupPath); } catch { /* recovery still attempts a rebuild */ }
    return rebuildRegistry();
  }
}

function writeRegistry(registry: LocalProfileRegistryV1): void {
  atomicWriteJson(registryPath(), registry);
}

function ensureTeamMetadata(
  profileKey: string,
  identity: ProfileIdentityV1,
  context: Record<string, unknown>,
): LocalTeamProfileMetadataV1 {
  const registry = readRegistry();
  const expectedRelativeDirectory = profileKey;
  const existing = registry.profiles.find((profile) => profile.profileKey === profileKey);
  const now = new Date().toISOString();
  const user = asRecord(context.user);
  const authenticatedAt = typeof context.savedAt === "string" ? context.savedAt : now;
  const serverUrl = typeof context.apiUrl === "string" ? context.apiUrl : "";
  const email = typeof user?.email === "string" ? user.email : null;
  let metadata = existing;

  if (metadata) {
    if (
      metadata.identity.serverId !== identity.serverId ||
      metadata.identity.userId !== identity.userId ||
      metadata.relativeDirectory !== expectedRelativeDirectory
    ) {
      throw new LocalProfileLockedError(
        "profile_metadata_invalid",
        "The saved Team OS local profile owner does not match the current login.",
      );
    }
  } else {
    metadata = {
      version: LOCAL_PROFILE_VERSION,
      profileKey,
      identity,
      status: "creating",
      relativeDirectory: expectedRelativeDirectory,
      localSchemaVersion: 0,
      createdAt: now,
      updatedAt: now,
      lastAuthenticatedAt: authenticatedAt,
      lastServerUrl: serverUrl,
      lastKnownEmail: email,
      recoveryMessage: null,
    };
    registry.profiles.push(metadata);
  }

  const changed = !existing ||
    metadata.lastAuthenticatedAt !== authenticatedAt ||
    metadata.lastServerUrl !== serverUrl ||
    metadata.lastKnownEmail !== email;
  if (!changed) return metadata;

  metadata = {
    ...metadata,
    identity,
    updatedAt: now,
    lastAuthenticatedAt: authenticatedAt,
    lastServerUrl: serverUrl || metadata.lastServerUrl,
    lastKnownEmail: email,
  };
  const index = registry.profiles.findIndex((profile) => profile.profileKey === profileKey);
  registry.profiles[index] = metadata;
  writeRegistry(registry);
  atomicWriteJson(profileMetadataPath(profileKey), metadata);
  return metadata;
}

export function updateLocalProfileStatus(
  descriptor: TeamLocalProfileDescriptorV1,
  status: LocalProfileStatus,
  recoveryMessage: string | null = null,
): void {
  const registry = readRegistry();
  const index = registry.profiles.findIndex((profile) => profile.profileKey === descriptor.profileKey);
  if (index < 0) {
    throw new LocalProfileLockedError("profile_metadata_invalid", "The Team OS local profile registry entry is missing.");
  }
  const current = registry.profiles[index];
  const nextSchemaVersion = status === "ready" ? LOCAL_PROFILE_SCHEMA_VERSION : current.localSchemaVersion;
  if (
    current.status === status &&
    current.localSchemaVersion === nextSchemaVersion &&
    current.recoveryMessage === recoveryMessage
  ) {
    return;
  }
  const metadata: LocalTeamProfileMetadataV1 = {
    ...current,
    status,
    localSchemaVersion: nextSchemaVersion,
    updatedAt: new Date().toISOString(),
    recoveryMessage,
  };
  registry.profiles[index] = metadata;
  writeRegistry(registry);
  atomicWriteJson(profileMetadataPath(descriptor.profileKey), metadata);
}

export function resolveLocalProfileDescriptor(): LocalProfileDescriptorV1 {
  const config = getConfig();
  const contextPath = getTeamContextFilePath();
  if (!fs.existsSync(contextPath)) {
    return Object.freeze({
      version: LOCAL_PROFILE_VERSION,
      mode: "solo" as const,
      profileKey: SOLO_PROFILE_KEY,
      dataDir: config.dataDir,
      stateDir: config.dataDir,
      tempDir: path.join(config.aiOsDir, ".tmp"),
      dbPath: config.dbPath,
    });
  }

  let context: Record<string, unknown>;
  try {
    const parsed = asRecord(JSON.parse(fs.readFileSync(contextPath, "utf8")));
    if (!parsed) throw new Error("Team context is not an object");
    context = parsed;
  } catch {
    throw new LocalProfileLockedError(
      "corrupt_context",
      "The saved Team OS login is damaged. Reconnect Team OS before continuing.",
    );
  }

  const user = asRecord(context.user);
  const serverId = typeof context.serverId === "string" ? context.serverId : "";
  const userId = typeof user?.id === "string" ? user.id : "";
  const token = typeof context.token === "string" ? context.token.trim() : "";
  if (!serverId || !userId || !token) {
    throw new LocalProfileLockedError(
      "identity_incomplete",
      "The saved Team OS login has no stable server or user identity. Reconnect after upgrading the server.",
    );
  }
  if (typeof context.expiresAt === "string" && Date.parse(context.expiresAt) <= Date.now()) {
    throw new LocalProfileLockedError(
      "reauthentication_required",
      "The Team OS login expired. Sign in again before opening local Team history.",
    );
  }

  let identity: ProfileIdentityV1;
  try {
    identity = createProfileIdentityV1({ serverId, userId });
  } catch {
    throw new LocalProfileLockedError(
      "identity_incomplete",
      "The saved Team OS identity is invalid. Reconnect Team OS before continuing.",
    );
  }
  const profileKey = createLocalProfileKey(identity);
  assertProfileKey(profileKey);
  const metadata = ensureTeamMetadata(profileKey, identity, context);
  if (metadata.status === "migration_failed") {
    throw new LocalProfileLockedError(
      "profile_migration_failed",
      metadata.recoveryMessage ?? "This local Team profile needs repair before it can be opened.",
    );
  }
  const candidateDescriptor = createTeamLocalProfileDescriptor(identity);
  const { dataDir, dbPath } = candidateDescriptor;
  if (metadata.status === "ready" && !fs.existsSync(dbPath)) {
    const descriptor = candidateDescriptor;
    updateLocalProfileStatus(descriptor, "missing", "The local profile database is missing. Restore it before continuing.");
    throw new LocalProfileLockedError("profile_missing", "The local Team profile database is missing. Restore it before continuing.");
  }
  if (metadata.status === "missing") {
    throw new LocalProfileLockedError("profile_missing", metadata.recoveryMessage ?? "The local Team profile database is missing.");
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(resolveContained(dataDir, "state"), { recursive: true });
  fs.mkdirSync(resolveContained(dataDir, "tmp"), { recursive: true });
  return candidateDescriptor;
}

export function toBrowserLocalProfile(
  descriptor: LocalProfileDescriptorV1 = resolveLocalProfileDescriptor(),
): BrowserLocalProfileV1 {
  const runtime = getLocalProfileRuntimeSession(descriptor);
  return Object.freeze({
    version: LOCAL_PROFILE_VERSION,
    mode: descriptor.mode,
    profileKey: descriptor.profileKey,
    sessionId: runtime.sessionId,
  });
}

export function getLocalProfileStatePath(fileName: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) throw new Error("Invalid profile state file name");
  const profile = resolveLocalProfileDescriptor();
  return resolveContained(profile.stateDir, fileName);
}

export function getLocalProfileTempPath(...segments: string[]): string {
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Invalid profile temporary path");
  }
  return resolveContained(resolveLocalProfileDescriptor().tempDir, ...segments);
}

export function localProfileErrorBody(error: LocalProfileLockedError): {
  error: { code: "profile_locked"; reason: LocalProfileLockedCode; message: string };
} {
  return { error: { code: error.code, reason: error.reason, message: error.message } };
}
