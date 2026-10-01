import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { getLocalProfileStatePath } from "@/lib/local-profile";
import { assertMaterializedPathAccessible, assertMaterializedPathWritable, registerMaterializedFiles, removeMaterializedOwnership } from "@/lib/materialized-file-ownership";
import {
  deleteTeamWorkspaceFile,
  fetchTeamStatus,
  fetchTeamWorkspaceFile,
  fetchTeamWorkspaceManifest,
  TeamApiError,
  writeTeamWorkspaceFile,
  type TeamWorkspaceFile,
  type TeamWorkspaceFileContent,
  type TeamWorkspaceManifest,
} from "@/lib/team-api-context";
import {
  classifySyncHashes,
  summarizeSyncFiles,
  syncStatusToLocalStatus,
  type SyncItemStatus,
  type SyncStateFile,
  type SyncStateSummary,
} from "@/lib/sync-state";

export const dynamic = "force-dynamic";

const CLIENT_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const MAX_SYNC_FILE_BYTES = 25 * 1024 * 1024;
const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".conf",
  ".csv",
  ".env",
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
const TEXT_FILE_NAMES = new Set(["AGENTS.md", "CLAUDE.md", "README.md", "SKILL.md", "SKILL.local.md", ".mcp.json"]);

type ClientLocalStatus = "ready" | "not_synced";
type SyncDirection = "pull" | "push";

interface SyncMetadata {
  version: 1;
  clients: Record<string, {
    files: Record<string, {
      sha256: string;
      size?: number;
      updatedAt?: string;
      secret?: boolean;
      encoding?: "utf-8" | "base64";
    }>;
    syncedAt?: string;
  }>;
}

interface LocalFile {
  path: string;
  fullPath: string;
  content: Buffer;
  sha256: string;
  size: number;
  secret: boolean;
  encoding: "utf-8" | "base64";
}

interface SyncConflict {
  path: string;
  operation: "write-local" | "write-remote" | "delete-local" | "delete-remote";
  secret: boolean;
  encoding: "utf-8" | "base64";
  localSha256?: string;
  remoteSha256?: string;
  localSize?: number;
  remoteSize?: number;
  localContent?: string;
  remoteContent?: string;
}

function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function assertClientSlug(value: unknown): string {
  if (typeof value !== "string" || !CLIENT_SLUG_RE.test(value.trim())) {
    throw new Error("client slug is invalid");
  }
  return value.trim();
}

function workspaceRoot(): string {
  return getConfig().aiOsDir;
}

function metadataPath(): string {
  return getLocalProfileStatePath("team-sync.json");
}

function clientRoot(slug: string): string {
  return path.join(workspaceRoot(), "clients", slug);
}

function localClientStatus(slug: string): ClientLocalStatus {
  try {
    return fs.statSync(clientRoot(slug)).isDirectory() ? "ready" : "not_synced";
  } catch {
    return "not_synced";
  }
}

function clientRootExists(slug: string): boolean {
  try {
    return fs.statSync(clientRoot(slug)).isDirectory();
  } catch {
    return false;
  }
}

function isSecretWorkspacePath(relativePath: string): boolean {
  const name = path.posix.basename(relativePath);
  return name === ".env" || name === ".env.local" || name.startsWith(".env.") || name === ".mcp.json";
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

function encodingFor(relativePath: string, content: Buffer): "utf-8" | "base64" {
  return isLikelyTextBuffer(relativePath, content) ? "utf-8" : "base64";
}

function safeWorkspaceFilePath(root: string, remotePath: string, slug: string): string {
  const normalized = remotePath.replace(/\\/g, "/");
  const expectedPrefix = `clients/${slug}/`;
  if (!normalized.startsWith(expectedPrefix)) {
    throw new Error(`server returned a file outside clients/${slug}`);
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("server returned an unsafe file path");
  }
  const fullPath = path.resolve(root, ...parts);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!fullPath.startsWith(rootWithSep)) {
    throw new Error("server file path escapes workspace root");
  }
  return fullPath;
}

function ensureClientScaffold(slug: string): void {
  const root = clientRoot(slug);
  fs.mkdirSync(path.join(root, "brand_context"), { recursive: true });
  fs.mkdirSync(path.join(root, "context", "memory"), { recursive: true });
  fs.mkdirSync(path.join(root, "projects", "briefs"), { recursive: true });
}

function readMetadata(): SyncMetadata {
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath(), "utf-8"));
    if (parsed?.version === 1 && parsed.clients && typeof parsed.clients === "object") {
      return parsed as SyncMetadata;
    }
  } catch {
    // First sync or unreadable metadata: start fresh.
  }
  return { version: 1, clients: {} };
}

function writeMetadata(metadata: SyncMetadata): void {
  fs.mkdirSync(path.dirname(metadataPath()), { recursive: true });
  fs.writeFileSync(metadataPath(), `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}

function listLocalClientFiles(slug: string): { files: LocalFile[]; unsupportedFiles: number; secretFiles: number } {
  const root = workspaceRoot();
  const start = clientRoot(slug);
  const files: LocalFile[] = [];
  let unsupportedFiles = 0;
  let secretFiles = 0;
  if (!fs.existsSync(start)) return { files, unsupportedFiles, secretFiles };

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        unsupportedFiles += 1;
        continue;
      }
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_SYNC_FILE_BYTES) {
        unsupportedFiles += 1;
        continue;
      }
      const content = fs.readFileSync(fullPath);
      const secret = isSecretWorkspacePath(rel);
      if (secret) secretFiles += 1;
      files.push({
        path: rel,
        fullPath,
        content,
        sha256: sha256(content),
        size: stat.size,
        secret,
        encoding: encodingFor(rel, content),
      });
    }
  }

  walk(start);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, unsupportedFiles, secretFiles };
}

function remoteToBuffer(remote: TeamWorkspaceFileContent): Buffer {
  if (remote.encoding === "base64" || remote.contentBase64) {
    return Buffer.from(remote.contentBase64 ?? "", "base64");
  }
  return Buffer.from(remote.content ?? "", "utf-8");
}

function conflictFor(input: {
  path: string;
  operation: SyncConflict["operation"];
  local?: Buffer | null;
  remote?: Buffer | null;
  localSha256?: string;
  remoteSha256?: string;
  localSize?: number;
  remoteSize?: number;
  secret?: boolean;
}): SyncConflict {
  const source = input.local ?? input.remote ?? Buffer.alloc(0);
  const encoding = encodingFor(input.path, source);
  const conflict: SyncConflict = {
    path: input.path,
    operation: input.operation,
    secret: input.secret ?? isSecretWorkspacePath(input.path),
    encoding,
    localSha256: input.localSha256,
    remoteSha256: input.remoteSha256,
    localSize: input.localSize,
    remoteSize: input.remoteSize,
  };
  if (encoding === "utf-8") {
    if (input.local) conflict.localContent = input.local.toString("utf-8");
    if (input.remote) conflict.remoteContent = input.remote.toString("utf-8");
  }
  return conflict;
}

async function remoteFileWithBuffer(file: TeamWorkspaceFile): Promise<{ file: TeamWorkspaceFile; content: Buffer }> {
  const remote = await fetchTeamWorkspaceFile(file.path);
  return { file, content: remoteToBuffer(remote) };
}

function clientAccessFromManifest(manifest: TeamWorkspaceManifest): "read" | "write" {
  return manifest.clients[0]?.access === "write" ? "write" : "read";
}

function saveClientMetadata(slug: string, files: Array<{ path: string; sha256: string; size?: number; updatedAt?: string; secret?: boolean; encoding?: "utf-8" | "base64" }>): void {
  const metadata = readMetadata();
  metadata.clients[slug] = {
    files: Object.fromEntries(files.map((file) => [file.path, {
      sha256: file.sha256,
      size: file.size,
      updatedAt: file.updatedAt,
      secret: file.secret,
      encoding: file.encoding,
    }])),
    syncedAt: new Date().toISOString(),
  };
  writeMetadata(metadata);
}

function buildClientSyncState(
  slug: string,
  manifest: TeamWorkspaceManifest,
  local: { files: LocalFile[] },
  metadata = readMetadata(),
): SyncStateSummary {
  const lastFiles = metadata.clients[slug]?.files ?? {};
  const localMap = new Map(local.files.map((file) => [file.path, file]));
  const remoteMap = new Map(manifest.files.map((file) => [file.path, file]));
  const hasLocalRoot = clientRootExists(slug);
  const canSeeSecrets = clientAccessFromManifest(manifest) === "write";
  const paths = new Set([
    ...Object.keys(lastFiles),
    ...local.files.map((file) => file.path),
    ...manifest.files.map((file) => file.path),
  ]);
  const files: SyncStateFile[] = [];

  for (const filePath of Array.from(paths).sort((a, b) => a.localeCompare(b))) {
    const localFile = localMap.get(filePath);
    const remoteFile = remoteMap.get(filePath);
    const last = lastFiles[filePath];
    if (!canSeeSecrets && !remoteFile && (last?.secret || localFile?.secret)) continue;

    const status: SyncItemStatus = !hasLocalRoot && remoteFile
      ? "not_synced"
      : classifySyncHashes({
        localSha256: localFile?.sha256,
        remoteSha256: remoteFile?.sha256,
        lastSyncedSha256: last?.sha256,
      });
    files.push({
      path: filePath,
      status,
      localSha256: localFile?.sha256,
      remoteSha256: remoteFile?.sha256,
      localSize: localFile?.size,
      remoteSize: remoteFile?.size,
      remoteUpdatedAt: remoteFile?.updatedAt,
      secret: localFile?.secret || remoteFile?.secret || last?.secret,
    });
  }

  return summarizeSyncFiles(files);
}

function mergeClientMetadata(slug: string, files: Array<{ path: string; sha256: string; size?: number; updatedAt?: string; secret?: boolean; encoding?: "utf-8" | "base64" }>): void {
  const metadata = readMetadata();
  const existing = metadata.clients[slug]?.files ?? {};
  for (const file of files) {
    existing[file.path] = {
      sha256: file.sha256,
      size: file.size,
      updatedAt: file.updatedAt,
      secret: file.secret,
      encoding: file.encoding,
    };
  }
  metadata.clients[slug] = {
    files: existing,
    syncedAt: new Date().toISOString(),
  };
  writeMetadata(metadata);
}

function normalizeWorkspacePathInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    throw new Error("file path is invalid");
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("file path is invalid");
  }
  return parts.join("/");
}

function canonicalClientFilePath(slug: string, inputPath: string): string {
  const normalized = normalizeWorkspacePathInput(inputPath);
  const expectedPrefix = `clients/${slug}/`;
  if (normalized.startsWith("clients/")) {
    if (!normalized.startsWith(expectedPrefix) || normalized === expectedPrefix.slice(0, -1)) {
      throw new Error("file path is outside this client");
    }
    return normalized;
  }
  return `${expectedPrefix}${normalized}`;
}

async function pullClient(slug: string, overwrite: boolean) {
  const manifest = await fetchTeamWorkspaceManifest(slug);
  const remoteMap = new Map(manifest.files.map((file) => [file.path, file]));
  const metadata = readMetadata().clients[slug]?.files ?? {};
  const remoteFiles = [];
  const conflicts: SyncConflict[] = [];
  const deletes: string[] = [];
  const canSeeSecrets = clientAccessFromManifest(manifest) === "write";

  for (const file of manifest.files) {
    const fullPath = safeWorkspaceFilePath(workspaceRoot(), file.path, slug);
    const remote = await remoteFileWithBuffer(file);
    remoteFiles.push({ ...remote, fullPath });
    if (fs.existsSync(fullPath)) {
      const local = fs.readFileSync(fullPath);
      const localHash = sha256(local);
      const remoteHash = file.sha256 ?? sha256(remote.content);
      const lastHash = metadata[file.path]?.sha256;
      if (localHash !== remoteHash && localHash !== lastHash && !overwrite) {
        conflicts.push(conflictFor({
          path: file.path,
          operation: "write-local",
          local,
          remote: remote.content,
          localSha256: localHash,
          remoteSha256: remoteHash,
          localSize: local.length,
          remoteSize: file.size,
          secret: file.secret,
        }));
      }
    }
  }

  for (const [filePath, last] of Object.entries(metadata)) {
    if (!filePath.startsWith(`clients/${slug}/`) || remoteMap.has(filePath)) continue;
    if (last.secret && !canSeeSecrets) continue;
    const fullPath = safeWorkspaceFilePath(workspaceRoot(), filePath, slug);
    if (!fs.existsSync(fullPath)) continue;
    const local = fs.readFileSync(fullPath);
    const localHash = sha256(local);
    if (localHash !== last.sha256 && !overwrite) {
      conflicts.push(conflictFor({
        path: filePath,
        operation: "delete-local",
        local,
        localSha256: localHash,
        localSize: local.length,
        secret: last.secret,
      }));
      continue;
    }
    deletes.push(fullPath);
  }

  if (conflicts.length > 0) {
    return { ok: false as const, status: 409, conflicts, direction: "pull" as const };
  }

  ensureClientScaffold(slug);
  let filesChanged = 0;
  for (const remote of remoteFiles) {
    assertMaterializedPathWritable(remote.fullPath);
    const currentHash = fs.existsSync(remote.fullPath) ? sha256(fs.readFileSync(remote.fullPath)) : null;
    const remoteHash = remote.file.sha256 ?? sha256(remote.content);
    if (currentHash !== remoteHash) filesChanged += 1;
    fs.mkdirSync(path.dirname(remote.fullPath), { recursive: true });
    fs.writeFileSync(remote.fullPath, remote.content);
  }
  registerMaterializedFiles(remoteFiles.map((remote) => remote.fullPath), {
    scope: "client",
    kind: "client-workspace",
  });
  let filesDeleted = 0;
  for (const fullPath of deletes) {
    assertMaterializedPathAccessible(fullPath);
    removeMaterializedOwnership([fullPath]);
    fs.rmSync(fullPath, { force: true });
    filesDeleted += 1;
  }

  const preservedSecretMeta = Object.entries(metadata)
    .filter(([, value]) => value.secret && !canSeeSecrets)
    .map(([filePath, value]) => ({
      path: filePath,
      sha256: value.sha256,
      size: value.size,
      updatedAt: value.updatedAt,
      secret: value.secret,
      encoding: value.encoding,
    }));
  saveClientMetadata(slug, [
    ...manifest.files.map((file) => ({
      path: file.path,
      sha256: file.sha256 ?? "",
      size: file.size,
      updatedAt: file.updatedAt,
      secret: file.secret,
      encoding: file.encoding,
    })).filter((file) => file.sha256),
    ...preservedSecretMeta,
  ]);

  return {
    ok: true as const,
    client: slug,
    action: "pull",
    filesPulled: remoteFiles.length,
    filesChanged,
    filesDeleted,
    unsupportedFiles: manifest.unsupportedFiles,
    secretFilesHidden: manifest.secretFilesHidden,
    localStatus: syncStatusToLocalStatus(buildClientSyncState(slug, manifest, listLocalClientFiles(slug)).status),
    syncState: buildClientSyncState(slug, manifest, listLocalClientFiles(slug)),
    upToDate: filesChanged === 0 && filesDeleted === 0,
  };
}

async function pushClient(slug: string, overwrite: boolean, onlyPath?: string | null) {
  const manifest = await fetchTeamWorkspaceManifest(slug);
  if (clientAccessFromManifest(manifest) !== "write") {
    return { ok: false as const, status: 403, error: "Client Editor access is required to push this client." };
  }

  const remoteMap = new Map(manifest.files.map((file) => [file.path, file]));
  const local = listLocalClientFiles(slug);
  const localMap = new Map(local.files.map((file) => [file.path, file]));
  const metadata = readMetadata().clients[slug]?.files ?? {};
  const review: SyncConflict[] = [];
  let targetPath: string | null = null;

  if (onlyPath) {
    targetPath = canonicalClientFilePath(slug, onlyPath);
    if (!localMap.has(targetPath)) {
      const fullPath = safeWorkspaceFilePath(workspaceRoot(), targetPath, slug);
      return {
        ok: false as const,
        status: fs.existsSync(fullPath) ? 400 : 404,
        error: fs.existsSync(fullPath)
          ? "Selected file is not syncable."
          : "Selected file does not exist locally.",
      };
    }
  }

  const pushFiles = targetPath
    ? local.files.filter((file) => file.path === targetPath)
    : local.files;

  for (const localFile of pushFiles) {
    const remote = remoteMap.get(localFile.path);
    if (remote?.sha256 === localFile.sha256) continue;
    const remoteContent = remote ? await remoteFileWithBuffer(remote) : null;
    review.push(conflictFor({
      path: localFile.path,
      operation: "write-remote",
      local: localFile.content,
      remote: remoteContent?.content ?? null,
      localSha256: localFile.sha256,
      remoteSha256: remote?.sha256,
      localSize: localFile.size,
      remoteSize: remote?.size,
      secret: localFile.secret || remote?.secret,
    }));
  }

  if (!targetPath) {
    for (const remote of manifest.files) {
      if (localMap.has(remote.path)) continue;
      const lastHash = metadata[remote.path]?.sha256;
      if (!lastHash) continue;
      const remoteContent = await remoteFileWithBuffer(remote);
      review.push(conflictFor({
        path: remote.path,
        operation: "delete-remote",
        remote: remoteContent.content,
        remoteSha256: remote.sha256,
        remoteSize: remote.size,
        secret: remote.secret,
      }));
    }
  }

  if (review.length > 0 && !overwrite) {
    return { ok: false as const, status: 409, conflicts: review, direction: "push" as const, preview: true };
  }

  let filesPushed = 0;
  for (const localFile of pushFiles) {
    const remote = remoteMap.get(localFile.path);
    if (remote?.sha256 === localFile.sha256) continue;
    await writeTeamWorkspaceFile(localFile.path, {
      ...(localFile.encoding === "utf-8"
        ? { content: localFile.content.toString("utf-8") }
        : { contentBase64: localFile.content.toString("base64") }),
      ...(remote?.sha256 ? { expectedSha256: remote.sha256 } : {}),
    });
    filesPushed += 1;
  }

  let filesDeleted = 0;
  if (!targetPath) {
    for (const remote of manifest.files) {
      if (localMap.has(remote.path)) continue;
      const lastHash = metadata[remote.path]?.sha256;
      if (!lastHash) continue;
      await deleteTeamWorkspaceFile(remote.path, remote.sha256);
      filesDeleted += 1;
    }
  }

  const metadataFiles = (targetPath ? pushFiles : local.files).map((file) => ({
    path: file.path,
    sha256: file.sha256,
    size: file.size,
    secret: file.secret,
    encoding: file.encoding,
  }));

  if (targetPath) {
    mergeClientMetadata(slug, metadataFiles);
  } else {
    saveClientMetadata(slug, metadataFiles);
  }

  const nextManifest = await fetchTeamWorkspaceManifest(slug).catch(() => manifest);
  const syncState = buildClientSyncState(slug, nextManifest, listLocalClientFiles(slug));
  return {
    ok: true as const,
    client: slug,
    action: "push",
    path: targetPath ?? undefined,
    filesPushed,
    filesDeleted,
    unsupportedFiles: local.unsupportedFiles,
    localSecretFiles: local.secretFiles,
    localStatus: syncStatusToLocalStatus(syncState.status),
    syncState,
    upToDate: filesPushed === 0 && filesDeleted === 0,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const selectedClient = searchParams.get("client");
    const status = await fetchTeamStatus();
    if (status.status !== "connected") {
      return NextResponse.json({ clients: [], signedIn: false });
    }

    if (selectedClient) {
      const slug = assertClientSlug(selectedClient);
      const grantedClient = status.clients.find((client) => client.slug === slug);
      if (!grantedClient) {
        return NextResponse.json({ error: "Client access not found" }, { status: 404 });
      }
      const [manifest, local] = await Promise.all([
        fetchTeamWorkspaceManifest(slug),
        Promise.resolve(listLocalClientFiles(slug)),
      ]);
      const access = clientAccessFromManifest(manifest);
      const syncState = buildClientSyncState(slug, manifest, local);
      return NextResponse.json({
        signedIn: true,
        client: {
          slug,
          name: grantedClient.name ?? slug,
          access,
          writable: access === "write",
          localStatus: syncStatusToLocalStatus(syncState.status),
        },
        serverFiles: manifest.files.length,
        localFiles: local.files.length,
        localSecretFiles: local.secretFiles,
        unsupportedFiles: local.unsupportedFiles + manifest.unsupportedFiles,
        secretFilesHidden: manifest.secretFilesHidden,
        syncState,
      });
    }

    const metadata = readMetadata();
    const clients = await Promise.all(status.clients.map(async (client) => {
      const [manifest, local] = await Promise.all([
        fetchTeamWorkspaceManifest(client.slug),
        Promise.resolve(listLocalClientFiles(client.slug)),
      ]);
      const syncState = buildClientSyncState(client.slug, manifest, local, metadata);
      return {
        slug: client.slug,
        name: client.name ?? client.slug,
        access: client.access,
        localStatus: syncStatusToLocalStatus(syncState.status),
        syncState,
      };
    }));

    return NextResponse.json({
      signedIn: true,
      clients,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read client sync status" },
      { status: error instanceof TeamApiError ? error.status : error && typeof error === "object" && "status" in error && error.status === 404 ? 404 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const slug = assertClientSlug(body.client);
    const action: SyncDirection = body.action === "push" ? "push" : "pull";
    const overwrite = body.overwrite === true;
    const filePath = typeof body.path === "string" && body.path.trim() !== "" ? body.path : null;
    const result = action === "push"
      ? await pushClient(slug, overwrite, filePath)
      : await pullClient(slug, overwrite);

    if (!result.ok) {
      const message = "error" in result ? result.error : "Client sync conflict";
      const conflicts = "conflicts" in result ? result.conflicts : undefined;
      const direction = "direction" in result ? result.direction : undefined;
      return NextResponse.json(
        { error: message, conflicts, direction },
        { status: result.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sync client" },
      { status: error instanceof TeamApiError ? error.status : error && typeof error === "object" && "status" in error && error.status === 404 ? 404 : 500 },
    );
  }
}
