import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RUNTIME_CONTEXT_OVERLAY_VERSION = 1 as const;

export type RuntimeContextOverlayOwnerType = "task" | "claude_session";

export interface RuntimeContextOverlayV1 {
  readonly version: typeof RUNTIME_CONTEXT_OVERLAY_VERSION;
  readonly ownerType: RuntimeContextOverlayOwnerType;
  readonly ownerId: string;
  readonly profileKey: string;
  readonly mode: "team";
  readonly serverId: string;
  readonly userId: string;
  readonly teamId: string;
  readonly clientId: string | null;
  readonly taskType: string;
  readonly snapshotSha256: string;
  readonly createdAt: string;
}

export interface RuntimeContextOverlayExpectation {
  readonly profileTempDir: string;
  readonly ownerType: RuntimeContextOverlayOwnerType;
  readonly ownerId: string;
  readonly profileKey: string;
  readonly serverId: string;
  readonly userId: string;
  readonly teamId: string;
  readonly clientId: string | null;
}

export type RuntimeContextOverlayOwnerExpectation = Pick<
  RuntimeContextOverlayExpectation,
  "profileTempDir" | "ownerType" | "ownerId" | "profileKey" | "serverId" | "userId"
>;

export interface LoadedRuntimeContextOverlay {
  readonly metadata: RuntimeContextOverlayV1;
  readonly overlayDir: string;
  readonly snapshotPath: string;
  readonly snapshotMarkdown: string;
}

export class RuntimeContextOverlayError extends Error {
  readonly code = "invalid_context_overlay" as const;

  constructor(message: string) {
    super(message);
    this.name = "RuntimeContextOverlayError";
  }
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new RuntimeContextOverlayError(`The runtime context overlay ${label} is missing.`);
  }
  return normalized;
}

function normalizeClientId(value: string | null): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function resolveContained(baseDir: string, ...segments: string[]): string {
  const base = path.resolve(baseDir);
  const target = path.resolve(baseDir, ...segments);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new RuntimeContextOverlayError("The runtime context overlay path is outside the active profile.");
  }
  return target;
}

function overlayDirectoryName(ownerType: RuntimeContextOverlayOwnerType, ownerId: string): string {
  const ownerHash = sha256(`runtime-context-overlay:v1\n${ownerType}\n${ownerId}`);
  return `${ownerType === "task" ? "task" : "claude-session"}-${ownerHash}`;
}

export function resolveRuntimeContextOverlayPaths(
  expectation: Pick<RuntimeContextOverlayExpectation, "profileTempDir" | "ownerType" | "ownerId">,
): { rootDir: string; overlayDir: string; metadataPath: string; snapshotPath: string } {
  const ownerId = requiredString(expectation.ownerId, "owner ID");
  const rootDir = resolveContained(expectation.profileTempDir, "runtime", "context-overlays");
  const overlayDir = resolveContained(
    rootDir,
    overlayDirectoryName(expectation.ownerType, ownerId),
  );
  return {
    rootDir,
    overlayDir,
    metadataPath: resolveContained(overlayDir, "metadata-v1.json"),
    snapshotPath: resolveContained(overlayDir, "snapshot.md"),
  };
}

function parseMetadata(value: unknown): RuntimeContextOverlayV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeContextOverlayError("The runtime context overlay metadata is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== RUNTIME_CONTEXT_OVERLAY_VERSION ||
    (record.ownerType !== "task" && record.ownerType !== "claude_session") ||
    typeof record.ownerId !== "string" ||
    typeof record.profileKey !== "string" ||
    record.mode !== "team" ||
    typeof record.serverId !== "string" ||
    typeof record.userId !== "string" ||
    typeof record.teamId !== "string" ||
    (record.clientId !== null && typeof record.clientId !== "string") ||
    typeof record.taskType !== "string" ||
    typeof record.snapshotSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.snapshotSha256) ||
    typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt))
  ) {
    throw new RuntimeContextOverlayError("The runtime context overlay metadata is invalid.");
  }
  return Object.freeze({
    version: RUNTIME_CONTEXT_OVERLAY_VERSION,
    ownerType: record.ownerType,
    ownerId: requiredString(record.ownerId, "owner ID"),
    profileKey: requiredString(record.profileKey, "profile key"),
    mode: "team" as const,
    serverId: requiredString(record.serverId, "server ID"),
    userId: requiredString(record.userId, "user ID"),
    teamId: requiredString(record.teamId, "Team ID"),
    clientId: normalizeClientId(record.clientId),
    taskType: requiredString(record.taskType, "task type"),
    snapshotSha256: record.snapshotSha256,
    createdAt: record.createdAt,
  });
}

function assertOrdinaryPath(filePath: string, expectedType: "file" | "directory"): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new RuntimeContextOverlayError("The runtime context overlay is incomplete.");
  }
  if (stat.isSymbolicLink()) {
    throw new RuntimeContextOverlayError("The runtime context overlay cannot use symbolic links.");
  }
  if (expectedType === "file" ? !stat.isFile() : !stat.isDirectory()) {
    throw new RuntimeContextOverlayError("The runtime context overlay has an invalid filesystem type.");
  }
}

function assertMetadataMatches(
  metadata: RuntimeContextOverlayV1,
  expectation: RuntimeContextOverlayExpectation,
): void {
  const expectedClientId = normalizeClientId(expectation.clientId);
  if (
    metadata.ownerType !== expectation.ownerType ||
    metadata.ownerId !== requiredString(expectation.ownerId, "owner ID") ||
    metadata.profileKey !== requiredString(expectation.profileKey, "profile key") ||
    metadata.serverId !== requiredString(expectation.serverId, "server ID") ||
    metadata.userId !== requiredString(expectation.userId, "user ID") ||
    metadata.teamId !== requiredString(expectation.teamId, "Team ID") ||
    metadata.clientId !== expectedClientId
  ) {
    throw new RuntimeContextOverlayError("The runtime context overlay does not match the immutable session scope.");
  }
}

function assertOwnerMetadataMatches(
  metadata: RuntimeContextOverlayV1,
  expectation: RuntimeContextOverlayOwnerExpectation,
): void {
  if (
    metadata.ownerType !== expectation.ownerType ||
    metadata.ownerId !== requiredString(expectation.ownerId, "owner ID") ||
    metadata.profileKey !== requiredString(expectation.profileKey, "profile key") ||
    metadata.serverId !== requiredString(expectation.serverId, "server ID") ||
    metadata.userId !== requiredString(expectation.userId, "user ID")
  ) {
    throw new RuntimeContextOverlayError("The runtime context overlay does not match the active profile and owner.");
  }
}

export function loadRuntimeContextOverlayForOwner(
  expectation: RuntimeContextOverlayOwnerExpectation,
): LoadedRuntimeContextOverlay | null {
  const paths = resolveRuntimeContextOverlayPaths(expectation);
  if (!fs.existsSync(paths.overlayDir)) return null;

  assertOrdinaryPath(paths.overlayDir, "directory");
  assertOrdinaryPath(paths.metadataPath, "file");
  assertOrdinaryPath(paths.snapshotPath, "file");

  let metadata: RuntimeContextOverlayV1;
  let snapshotMarkdown: string;
  try {
    metadata = parseMetadata(JSON.parse(fs.readFileSync(paths.metadataPath, "utf8")));
    snapshotMarkdown = fs.readFileSync(paths.snapshotPath, "utf8");
  } catch (error) {
    if (error instanceof RuntimeContextOverlayError) throw error;
    throw new RuntimeContextOverlayError("The runtime context overlay could not be read.");
  }
  assertOwnerMetadataMatches(metadata, expectation);
  if (!snapshotMarkdown.trim() || sha256(snapshotMarkdown) !== metadata.snapshotSha256) {
    throw new RuntimeContextOverlayError("The runtime context overlay snapshot checksum is invalid.");
  }
  return Object.freeze({
    metadata,
    overlayDir: paths.overlayDir,
    snapshotPath: paths.snapshotPath,
    snapshotMarkdown,
  });
}

export function loadRuntimeContextOverlay(
  expectation: RuntimeContextOverlayExpectation,
): LoadedRuntimeContextOverlay | null {
  const loaded = loadRuntimeContextOverlayForOwner(expectation);
  if (!loaded) return null;
  assertMetadataMatches(loaded.metadata, expectation);
  return loaded;
}

function writeSyncedFile(filePath: string, content: string): void {
  const handle = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

export function createOrLoadRuntimeContextOverlay(
  expectation: RuntimeContextOverlayExpectation,
  snapshotMarkdown: string,
  taskType: string,
  now: Date = new Date(),
): LoadedRuntimeContextOverlay {
  const existing = loadRuntimeContextOverlay(expectation);
  if (existing) return existing;

  const snapshot = snapshotMarkdown.trim() ? snapshotMarkdown : "";
  if (!snapshot) {
    throw new RuntimeContextOverlayError("The runtime context overlay snapshot is empty.");
  }
  const paths = resolveRuntimeContextOverlayPaths(expectation);
  fs.mkdirSync(paths.rootDir, { recursive: true, mode: 0o700 });

  const tempDir = resolveContained(
    paths.rootDir,
    `.${path.basename(paths.overlayDir)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const metadata: RuntimeContextOverlayV1 = Object.freeze({
    version: RUNTIME_CONTEXT_OVERLAY_VERSION,
    ownerType: expectation.ownerType,
    ownerId: requiredString(expectation.ownerId, "owner ID"),
    profileKey: requiredString(expectation.profileKey, "profile key"),
    mode: "team" as const,
    serverId: requiredString(expectation.serverId, "server ID"),
    userId: requiredString(expectation.userId, "user ID"),
    teamId: requiredString(expectation.teamId, "Team ID"),
    clientId: normalizeClientId(expectation.clientId),
    taskType: requiredString(taskType, "task type"),
    snapshotSha256: sha256(snapshot),
    createdAt: now.toISOString(),
  });

  try {
    fs.mkdirSync(tempDir, { mode: 0o700 });
    writeSyncedFile(path.join(tempDir, "snapshot.md"), snapshot);
    writeSyncedFile(path.join(tempDir, "metadata-v1.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    try {
      fs.renameSync(tempDir, paths.overlayDir);
    } catch (error) {
      if (!fs.existsSync(paths.overlayDir)) throw error;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (error instanceof RuntimeContextOverlayError) throw error;
    throw new RuntimeContextOverlayError("The runtime context overlay could not be created.");
  }

  const created = loadRuntimeContextOverlay(expectation);
  if (!created) {
    throw new RuntimeContextOverlayError("The runtime context overlay was not created.");
  }
  return created;
}

export function deleteRuntimeContextOverlay(
  expectation: Pick<RuntimeContextOverlayExpectation, "profileTempDir" | "ownerType" | "ownerId">,
): void {
  const paths = resolveRuntimeContextOverlayPaths(expectation);
  fs.rmSync(paths.overlayDir, { recursive: true, force: true });
}
