import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import {
  readSelectedTeamId,
  rebuildTeamSkillPlugin,
  resolveTeamSkillCachePaths,
} from "@/lib/team-skill-cache";
import { isExcludedSkillSyncPath, isSyncableSharedSkillPath } from "../../../../lib/skill-sync-rules";
import {
  deleteTeamSkillFile,
  fetchTeamSkillFile,
  fetchTeamSkillManifest,
  fetchTeamSkills,
  TeamApiError,
  writeTeamSkillFile,
  type TeamSkillManifest,
  type TeamWorkspaceFile,
  type TeamWorkspaceFileContent,
} from "@/lib/team-api-context";
import {
  classifySyncHashes,
  summarizeSyncFiles,
  type SyncItemStatus,
  type SyncStateFile,
  type SyncStateSummary,
} from "@/lib/sync-state";

export const dynamic = "force-dynamic";

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;
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

type SyncDirection = "pull" | "push" | "adopt";
type SkillLocalStatus = "ready" | "not_synced" | "orphaned";
type SkillMetadataFiles = SkillSyncMetadata["skills"][string]["files"];

interface SkillSyncMetadata {
  version: 1;
  skills: Record<string, {
    managed: true;
    files: Record<string, {
      sha256: string;
      normalizedSha256?: string;
      size?: number;
      updatedAt?: string;
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
  normalizedSha256?: string;
  size: number;
  encoding: "utf-8" | "base64";
}

interface SkillSyncInfo {
  slug: string;
  localStatus: SkillLocalStatus;
  managed: boolean;
  hasAccess: boolean;
  hasLocal: boolean;
  adoptable: boolean;
  syncState?: SyncStateSummary;
}

interface SyncConflict {
  path: string;
  operation: "write-local" | "write-remote" | "delete-local" | "delete-remote";
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

function normalizeTextForSync(content: Buffer | string): string {
  const text = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const withLf = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return withLf.endsWith("\n") ? withLf.slice(0, -1) : withLf;
}

function normalizedTextSha256(content: Buffer | string): string {
  return sha256(normalizeTextForSync(content));
}

function assertSkillName(value: unknown): string {
  if (typeof value !== "string" || !SKILL_NAME_RE.test(value.trim())) {
    throw new Error("skill name is invalid");
  }
  return value.trim();
}

function workspaceRoot(): string {
  return resolveTeamSkillCachePaths(readSelectedTeamId()).sourceRoot;
}

function metadataPath(): string {
  return resolveTeamSkillCachePaths(readSelectedTeamId()).metadataPath;
}

function skillRoot(skill: string): string {
  return path.join(workspaceRoot(), ".claude", "skills", skill);
}

function safeSkillFilePath(root: string, remotePath: string, skill: string): string {
  const normalized = remotePath.replace(/\\/g, "/");
  const expectedPrefix = `.claude/skills/${skill}/`;
  if (!normalized.startsWith(expectedPrefix)) {
    throw new Error(`server returned a file outside .claude/skills/${skill}`);
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("server returned an unsafe skill path");
  }
  const fullPath = path.resolve(root, ...parts);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!fullPath.startsWith(rootWithSep)) {
    throw new Error("server skill path escapes workspace root");
  }
  return fullPath;
}

function localSkillStatus(skill: string, metadata = readMetadata()): SkillLocalStatus {
  const exists = fs.existsSync(skillRoot(skill)) && fs.statSync(skillRoot(skill)).isDirectory();
  if (!exists) return "not_synced";
  return metadata.skills[skill]?.managed ? "ready" : "orphaned";
}

function readMetadata(): SkillSyncMetadata {
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath(), "utf-8"));
    if (parsed?.version === 1 && parsed.skills && typeof parsed.skills === "object") {
      return parsed as SkillSyncMetadata;
    }
  } catch {
    // First sync or unreadable metadata.
  }
  return { version: 1, skills: {} };
}

function writeMetadata(metadata: SkillSyncMetadata): void {
  fs.mkdirSync(path.dirname(metadataPath()), { recursive: true });
  fs.writeFileSync(metadataPath(), `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
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

function listLocalSkillFiles(skill: string): { files: LocalFile[]; unsupportedFiles: number } {
  const root = workspaceRoot();
  const start = skillRoot(skill);
  const files: LocalFile[] = [];
  let unsupportedFiles = 0;
  if (!fs.existsSync(start)) return { files, unsupportedFiles };

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, "/");
      if (isExcludedSkillSyncPath(rel)) {
        continue;
      }
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
      const encoding = encodingFor(rel, content);
      files.push({
        path: rel,
        fullPath,
        content,
        sha256: sha256(content),
        ...(encoding === "utf-8" ? { normalizedSha256: normalizedTextSha256(content) } : {}),
        size: stat.size,
        encoding,
      });
    }
  }

  walk(start);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, unsupportedFiles };
}

function syncableManifestFiles(files: TeamWorkspaceFile[]): TeamWorkspaceFile[] {
  return files.filter((file) => isSyncableSharedSkillPath(file.path));
}

function metadataFiles(files: SkillMetadataFiles): SkillMetadataFiles {
  return Object.fromEntries(
    Object.entries(files).filter(([filePath]) => isSyncableSharedSkillPath(filePath)),
  );
}

function localFileMap(files: LocalFile[]): Map<string, LocalFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function manifestFileMap(files: TeamWorkspaceFile[]): Map<string, TeamWorkspaceFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function hashForManifestFile(file: TeamWorkspaceFile): string | null {
  return typeof file.sha256 === "string" && file.sha256.trim() !== "" ? file.sha256 : null;
}

function normalizedHashForManifestFile(file: TeamWorkspaceFile): string | null {
  return typeof file.normalizedSha256 === "string" && file.normalizedSha256.trim() !== "" ? file.normalizedSha256 : null;
}

function comparableManifestHash(file: TeamWorkspaceFile): string | null {
  return normalizedHashForManifestFile(file) ?? hashForManifestFile(file);
}

function comparableLocalHash(local: LocalFile, remote: TeamWorkspaceFile): string {
  return normalizedHashForManifestFile(remote) && local.normalizedSha256 ? local.normalizedSha256 : local.sha256;
}

type SkillMetadataInput = {
  path: string;
  sha256: string;
  normalizedSha256?: string;
  size?: number;
  updatedAt?: string;
  encoding?: "utf-8" | "base64";
};

function metadataFromManifestFile(file: TeamWorkspaceFile, content?: Buffer): SkillMetadataInput {
  const contentEncoding = content ? encodingFor(file.path, content) : undefined;
  return {
    path: file.path,
    sha256: file.sha256 ?? (content ? sha256(content) : ""),
    normalizedSha256: file.normalizedSha256 ?? (content && contentEncoding === "utf-8" ? normalizedTextSha256(content) : undefined),
    size: file.size ?? content?.length,
    updatedAt: file.updatedAt,
    encoding: file.encoding ?? contentEncoding,
  };
}

function metadataFromManifestFiles(files: TeamWorkspaceFile[]): SkillMetadataInput[] {
  return files.map((file) => metadataFromManifestFile(file)).filter((file) => file.sha256);
}

function localMatchesManifest(localFiles: LocalFile[], manifestFiles: TeamWorkspaceFile[]): boolean {
  if (localFiles.length !== manifestFiles.length) return false;
  const localMap = localFileMap(localFiles);
  for (const file of manifestFiles) {
    const remoteHash = comparableManifestHash(file);
    const local = localMap.get(file.path);
    if (!remoteHash || !local || comparableLocalHash(local, file) !== remoteHash) return false;
  }
  return true;
}

async function localMatchesManifestForAdoption(
  localFiles: LocalFile[],
  manifestFiles: TeamWorkspaceFile[],
): Promise<{ matches: boolean; files: SkillMetadataInput[] }> {
  const manifestMetadata = metadataFromManifestFiles(manifestFiles);
  if (localFiles.length !== manifestFiles.length) return { matches: false, files: manifestMetadata };

  const localMap = localFileMap(localFiles);
  const metadataFiles: SkillMetadataInput[] = [];
  for (const file of manifestFiles) {
    const local = localMap.get(file.path);
    if (!local) return { matches: false, files: manifestMetadata };

    const remoteHash = comparableManifestHash(file);
    if (remoteHash && comparableLocalHash(local, file) === remoteHash) {
      metadataFiles.push(metadataFromManifestFile(file));
      continue;
    }

    const remote = await remoteFileWithBuffer(file);
    if (!buffersEquivalentForSync(file.path, local.content, remote.content)) {
      return { matches: false, files: manifestMetadata };
    }
    metadataFiles.push(metadataFromManifestFile(file, remote.content));
  }

  return { matches: true, files: metadataFiles.filter((file) => file.sha256) };
}

function buffersEquivalentForSync(relativePath: string, local: Buffer, remote: Buffer): boolean {
  const localText = isLikelyTextBuffer(relativePath, local);
  const remoteText = isLikelyTextBuffer(relativePath, remote);
  if (localText && remoteText) {
    return normalizeTextForSync(local) === normalizeTextForSync(remote);
  }
  return sha256(local) === sha256(remote);
}

function localMatchesMetadata(local: Buffer, localPath: string, last?: { sha256?: string; normalizedSha256?: string }): boolean {
  if (!last) return false;
  const rawHash = sha256(local);
  if (last.sha256 && rawHash === last.sha256) return true;
  if (last.normalizedSha256 && isLikelyTextBuffer(localPath, local)) {
    return normalizedTextSha256(local) === last.normalizedSha256;
  }
  return false;
}

function comparableLastHash(last?: { sha256?: string; normalizedSha256?: string }): string | null {
  return last?.normalizedSha256 || last?.sha256 || null;
}

function comparableLocalHashForStatus(local: LocalFile, remote?: TeamWorkspaceFile, last?: { sha256?: string; normalizedSha256?: string }): string {
  if ((remote?.normalizedSha256 || last?.normalizedSha256) && local.normalizedSha256) {
    return local.normalizedSha256;
  }
  return local.sha256;
}

function buildSkillSyncState(
  skill: string,
  manifestFiles: TeamWorkspaceFile[],
  local: { files: LocalFile[] },
  metadata = readMetadata(),
): SyncStateSummary {
  const lastFiles = metadataFiles(metadata.skills[skill]?.files ?? {});
  const localMap = localFileMap(local.files);
  const remoteMap = manifestFileMap(manifestFiles);
  const hasLocalRoot = fs.existsSync(skillRoot(skill)) && fs.statSync(skillRoot(skill)).isDirectory();
  const paths = new Set([
    ...Object.keys(lastFiles),
    ...local.files.map((file) => file.path),
    ...manifestFiles.map((file) => file.path),
  ]);
  const files: SyncStateFile[] = [];

  for (const filePath of Array.from(paths).sort((a, b) => a.localeCompare(b))) {
    const localFile = localMap.get(filePath);
    const remoteFile = remoteMap.get(filePath);
    const last = lastFiles[filePath];
    const localHash = localFile ? comparableLocalHashForStatus(localFile, remoteFile, last) : undefined;
    const remoteHash = remoteFile ? comparableManifestHash(remoteFile) : undefined;
    const status: SyncItemStatus = !hasLocalRoot && remoteFile
      ? "not_synced"
      : classifySyncHashes({
        localSha256: localHash,
        remoteSha256: remoteHash,
        lastSyncedSha256: comparableLastHash(last),
      });

    files.push({
      path: filePath,
      status,
      localSha256: localFile?.sha256,
      remoteSha256: remoteFile?.sha256,
      localSize: localFile?.size,
      remoteSize: remoteFile?.size,
      remoteUpdatedAt: remoteFile?.updatedAt,
    });
  }

  return summarizeSyncFiles(files);
}

function localStatusFromSkillSyncState(syncState: SyncStateSummary, fallback: SkillLocalStatus): SkillLocalStatus {
  if (syncState.status === "synced") return "ready";
  if (syncState.status === "local_changes" || syncState.status === "diverged") return "orphaned";
  if (fallback === "orphaned") return "orphaned";
  return "not_synced";
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
}): SyncConflict {
  const source = input.local ?? input.remote ?? Buffer.alloc(0);
  const encoding = encodingFor(input.path, source);
  const conflict: SyncConflict = {
    path: input.path,
    operation: input.operation,
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
  const remote = await fetchTeamSkillFile(file.path);
  return { file, content: remoteToBuffer(remote) };
}

function saveSkillMetadata(skill: string, files: SkillMetadataInput[]): void {
  const metadata = readMetadata();
  const syncableFiles = files.filter((file) => isSyncableSharedSkillPath(file.path));
  metadata.skills[skill] = {
    managed: true,
    files: Object.fromEntries(syncableFiles.map((file) => [file.path, {
      sha256: file.sha256,
      normalizedSha256: file.normalizedSha256,
      size: file.size,
      updatedAt: file.updatedAt,
      encoding: file.encoding,
    }])),
    syncedAt: new Date().toISOString(),
  };
  writeMetadata(metadata);
  rebuildTeamSkillPlugin(readSelectedTeamId());
}

async function collectPullConflicts(input: {
  localFiles: LocalFile[];
  remoteFiles: Array<{ file: TeamWorkspaceFile; content: Buffer }>;
  includeLocalExtras: boolean;
}): Promise<SyncConflict[]> {
  const conflicts: SyncConflict[] = [];
  const localMap = localFileMap(input.localFiles);
  const remoteMap = manifestFileMap(input.remoteFiles.map((remote) => remote.file));

  for (const remote of input.remoteFiles) {
    const local = localMap.get(remote.file.path);
    const remoteHash = remote.file.sha256 ?? sha256(remote.content);
    if (!local || !buffersEquivalentForSync(remote.file.path, local.content, remote.content)) {
      conflicts.push(conflictFor({
        path: remote.file.path,
        operation: "write-local",
        local: local?.content ?? null,
        remote: remote.content,
        localSha256: local?.sha256,
        remoteSha256: remoteHash,
        localSize: local?.size,
        remoteSize: remote.file.size,
      }));
    }
  }

  if (input.includeLocalExtras) {
    for (const local of input.localFiles) {
      if (remoteMap.has(local.path)) continue;
      conflicts.push(conflictFor({
        path: local.path,
        operation: "delete-local",
        local: local.content,
        localSha256: local.sha256,
        localSize: local.size,
      }));
    }
  }

  return conflicts;
}

async function adoptSkill(skill: string) {
  const manifest = await fetchTeamSkillManifest(skill);
  const manifestFiles = syncableManifestFiles(manifest.files);
  const local = listLocalSkillFiles(skill);
  if (local.files.length === 0) {
    return { ok: false as const, status: 404, error: "Local skill folder is missing or has no syncable files." };
  }

  const adoptionMatch = await localMatchesManifestForAdoption(local.files, manifestFiles);
  if (adoptionMatch.matches) {
    saveSkillMetadata(skill, adoptionMatch.files);

    return {
      ok: true as const,
      skill,
      action: "adopt",
      adopted: true,
      filesChanged: 0,
      filesDeleted: 0,
      unsupportedFiles: local.unsupportedFiles + manifest.unsupportedFiles,
      localStatus: localSkillStatus(skill),
      syncState: buildSkillSyncState(skill, manifestFiles, local),
      upToDate: true,
    };
  }

  const remoteFiles = await Promise.all(manifestFiles.map(remoteFileWithBuffer));
  const conflicts = await collectPullConflicts({
    localFiles: local.files,
    remoteFiles,
    includeLocalExtras: true,
  });
  if (conflicts.length === 0) {
    saveSkillMetadata(skill, remoteFiles.map((remote) => ({
      path: remote.file.path,
      sha256: remote.file.sha256 ?? sha256(remote.content),
      normalizedSha256: remote.file.normalizedSha256 ?? (encodingFor(remote.file.path, remote.content) === "utf-8" ? normalizedTextSha256(remote.content) : undefined),
      size: remote.file.size,
      updatedAt: remote.file.updatedAt,
      encoding: remote.file.encoding,
    })));

    return {
      ok: true as const,
      skill,
      action: "adopt",
      adopted: true,
      filesChanged: 0,
      filesDeleted: 0,
      unsupportedFiles: local.unsupportedFiles + manifest.unsupportedFiles,
      localStatus: localSkillStatus(skill),
      syncState: buildSkillSyncState(skill, manifestFiles, local),
      upToDate: true,
    };
  }

  return {
    ok: false as const,
    status: 409,
    error: "Skill sync conflict",
    conflicts,
    direction: "pull" as const,
  };
}

function manifestOrEmpty(skill: string): Promise<TeamSkillManifest> {
  return fetchTeamSkillManifest(skill).catch((error) => {
    if (error instanceof TeamApiError && error.status === 404) {
      return { skill, files: [], unsupportedFiles: 0 };
    }
    throw error;
  });
}

async function pullSkill(skill: string, overwrite: boolean) {
  const metadata = readMetadata();
  const existingLocal = fs.existsSync(skillRoot(skill));
  const manifest = await fetchTeamSkillManifest(skill);
  const manifestFiles = syncableManifestFiles(manifest.files);
  const remoteMap = manifestFileMap(manifestFiles);
  const lastFiles = metadataFiles(metadata.skills[skill]?.files ?? {});
  const remoteFiles = [];
  const conflicts: SyncConflict[] = [];
  const deletes: string[] = [];
  const unmanagedExistingLocal = existingLocal && !metadata.skills[skill]?.managed;
  const local = unmanagedExistingLocal ? listLocalSkillFiles(skill) : null;

  for (const file of manifestFiles) {
    const fullPath = safeSkillFilePath(workspaceRoot(), file.path, skill);
    const remote = await remoteFileWithBuffer(file);
    remoteFiles.push({ ...remote, fullPath });
    if (fs.existsSync(fullPath)) {
      const local = fs.readFileSync(fullPath);
      const localHash = sha256(local);
      const remoteHash = file.sha256 ?? sha256(remote.content);
      const matchesRemote = buffersEquivalentForSync(file.path, local, remote.content);
      const matchesLast = localMatchesMetadata(local, file.path, lastFiles[file.path]);
      if (!matchesRemote && !matchesLast && !overwrite) {
        conflicts.push(conflictFor({
          path: file.path,
          operation: "write-local",
          local,
          remote: remote.content,
          localSha256: localHash,
          remoteSha256: remoteHash,
          localSize: local.length,
          remoteSize: file.size,
        }));
      }
    }
  }

  if (unmanagedExistingLocal && local) {
    const unmanagedConflicts = await collectPullConflicts({
      localFiles: local.files,
      remoteFiles,
      includeLocalExtras: true,
    });
    if (unmanagedConflicts.length === 0) {
      saveSkillMetadata(skill, metadataFromManifestFiles(manifestFiles));

      return {
        ok: true as const,
        skill,
        action: "adopt",
        adopted: true,
        filesPulled: remoteFiles.length,
        filesChanged: 0,
        filesDeleted: 0,
        unsupportedFiles: local.unsupportedFiles + manifest.unsupportedFiles,
        localStatus: localSkillStatus(skill),
        upToDate: true,
      };
    }
    if (!overwrite) {
      return { ok: false as const, status: 409, error: "Skill sync conflict", conflicts: unmanagedConflicts, direction: "pull" as const };
    }
    for (const localFile of local.files) {
      if (!remoteMap.has(localFile.path)) deletes.push(localFile.fullPath);
    }
  }

  for (const [filePath, last] of Object.entries(lastFiles)) {
    if (!filePath.startsWith(`.claude/skills/${skill}/`) || remoteMap.has(filePath)) continue;
    const fullPath = safeSkillFilePath(workspaceRoot(), filePath, skill);
    if (!fs.existsSync(fullPath)) continue;
    const local = fs.readFileSync(fullPath);
    const localHash = sha256(local);
    if (!localMatchesMetadata(local, filePath, last) && !overwrite) {
      conflicts.push(conflictFor({
        path: filePath,
        operation: "delete-local",
        local,
        localSha256: localHash,
        localSize: local.length,
      }));
      continue;
    }
    deletes.push(fullPath);
  }

  if (conflicts.length > 0) {
    return { ok: false as const, status: 409, error: "Skill sync conflict", conflicts, direction: "pull" as const };
  }

  let filesChanged = 0;
  for (const remote of remoteFiles) {
    const current = fs.existsSync(remote.fullPath) ? fs.readFileSync(remote.fullPath) : null;
    const currentMatchesRemote = current ? buffersEquivalentForSync(remote.file.path, current, remote.content) : false;
    if (currentMatchesRemote) continue;
    filesChanged += 1;
    fs.mkdirSync(path.dirname(remote.fullPath), { recursive: true });
    fs.writeFileSync(remote.fullPath, remote.content);
  }
  let filesDeleted = 0;
  for (const fullPath of deletes) {
    fs.rmSync(fullPath, { force: true });
    filesDeleted += 1;
  }

  saveSkillMetadata(skill, manifest.files.map((file) => ({
    path: file.path,
    sha256: file.sha256 ?? "",
    normalizedSha256: file.normalizedSha256,
    size: file.size,
    updatedAt: file.updatedAt,
    encoding: file.encoding,
  })).filter((file) => file.sha256));
  const syncState = buildSkillSyncState(skill, manifestFiles, listLocalSkillFiles(skill));

  return {
    ok: true as const,
    skill,
    action: "pull",
    filesPulled: remoteFiles.length,
    filesChanged,
    filesDeleted,
    unsupportedFiles: manifest.unsupportedFiles,
    localStatus: localStatusFromSkillSyncState(syncState, localSkillStatus(skill)),
    syncState,
    upToDate: filesChanged === 0 && filesDeleted === 0,
  };
}

async function pushSkill(skill: string, overwrite: boolean) {
  const manifest = await manifestOrEmpty(skill);
  const manifestFiles = syncableManifestFiles(manifest.files);
  const local = listLocalSkillFiles(skill);
  if (local.files.length === 0) {
    return { ok: false as const, status: 404, error: "Local skill folder is missing or has no syncable files." };
  }

  const remoteMap = manifestFileMap(manifestFiles);
  const localMap = new Map(local.files.map((file) => [file.path, file]));
  const metadata = metadataFiles(readMetadata().skills[skill]?.files ?? {});
  const review: SyncConflict[] = [];

  for (const localFile of local.files) {
    const remote = remoteMap.get(localFile.path);
    const remoteContent = remote ? await remoteFileWithBuffer(remote) : null;
    if (remote && (localMatchesManifest([localFile], [remote]) || (remoteContent && buffersEquivalentForSync(localFile.path, localFile.content, remoteContent.content)))) {
      continue;
    }
    review.push(conflictFor({
      path: localFile.path,
      operation: "write-remote",
      local: localFile.content,
      remote: remoteContent?.content ?? null,
      localSha256: localFile.sha256,
      remoteSha256: remote?.sha256,
      localSize: localFile.size,
      remoteSize: remote?.size,
    }));
  }

  for (const remote of manifestFiles) {
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
    }));
  }

  if (review.length > 0 && !overwrite) {
    return { ok: false as const, status: 409, error: "Review skill push changes before upload.", conflicts: review, direction: "push" as const, preview: true };
  }

  let filesPushed = 0;
  for (const localFile of local.files) {
    const remote = remoteMap.get(localFile.path);
    if (remote && localMatchesManifest([localFile], [remote])) continue;
    if (remote) {
      const remoteContent = await remoteFileWithBuffer(remote).catch(() => null);
      if (remoteContent && buffersEquivalentForSync(localFile.path, localFile.content, remoteContent.content)) continue;
    }
    await writeTeamSkillFile(localFile.path, {
      ...(localFile.encoding === "utf-8"
        ? { content: localFile.content.toString("utf-8") }
        : { contentBase64: localFile.content.toString("base64") }),
      ...(remote?.sha256 ? { expectedSha256: remote.sha256 } : {}),
    });
    filesPushed += 1;
  }

  let filesDeleted = 0;
  for (const remote of manifestFiles) {
    if (localMap.has(remote.path)) continue;
    const lastHash = metadata[remote.path]?.sha256;
    if (!lastHash) continue;
    await deleteTeamSkillFile(remote.path, remote.sha256);
    filesDeleted += 1;
  }

  saveSkillMetadata(skill, local.files.map((file) => ({
    path: file.path,
    sha256: file.sha256,
    normalizedSha256: file.normalizedSha256,
    size: file.size,
    encoding: file.encoding,
  })));

  const nextManifest = await manifestOrEmpty(skill).catch(() => manifest);
  const syncState = buildSkillSyncState(skill, syncableManifestFiles(nextManifest.files), listLocalSkillFiles(skill));
  return {
    ok: true as const,
    skill,
    action: "push",
    filesPushed,
    filesDeleted,
    unsupportedFiles: local.unsupportedFiles,
    localStatus: localStatusFromSkillSyncState(syncState, localSkillStatus(skill)),
    syncState,
    upToDate: filesPushed === 0 && filesDeleted === 0,
  };
}

function pruneSkill(skill: string) {
  const metadata = readMetadata();
  if (!metadata.skills[skill]?.managed) {
    return { ok: true, skill, pruned: false };
  }
  fs.rmSync(skillRoot(skill), { recursive: true, force: true });
  delete metadata.skills[skill];
  writeMetadata(metadata);
  rebuildTeamSkillPlugin(readSelectedTeamId());
  return { ok: true, skill, pruned: true };
}

async function skillSyncInfoForServerSkill(skill: string, metadata: SkillSyncMetadata): Promise<SkillSyncInfo> {
  const hasLocal = fs.existsSync(skillRoot(skill)) && fs.statSync(skillRoot(skill)).isDirectory();
  const managed = metadata.skills[skill]?.managed === true;
  if (!hasLocal) {
    const manifest = await manifestOrEmpty(skill);
    const syncState = buildSkillSyncState(skill, syncableManifestFiles(manifest.files), { files: [] }, metadata);
    return { slug: skill, localStatus: "not_synced", managed, hasAccess: true, hasLocal: false, adoptable: false, syncState };
  }

  try {
    const [manifest, local] = await Promise.all([
      fetchTeamSkillManifest(skill),
      Promise.resolve(listLocalSkillFiles(skill)),
    ]);
    const manifestFiles = syncableManifestFiles(manifest.files);
    const adoptionMatch = await localMatchesManifestForAdoption(local.files, manifestFiles);
    if (adoptionMatch.matches) {
      if (!managed) {
        saveSkillMetadata(skill, adoptionMatch.files);
      }
      return {
        slug: skill,
        localStatus: "ready",
        managed: true,
        hasAccess: true,
        hasLocal: true,
        adoptable: !managed,
        syncState: buildSkillSyncState(skill, manifestFiles, local),
      };
    }
    const syncState = buildSkillSyncState(skill, manifestFiles, local, metadata);
    return {
      slug: skill,
      localStatus: localStatusFromSkillSyncState(syncState, "orphaned"),
      managed,
      hasAccess: true,
      hasLocal: true,
      adoptable: false,
      syncState,
    };
  } catch {
    return { slug: skill, localStatus: managed ? "ready" : "orphaned", managed, hasAccess: true, hasLocal: true, adoptable: false };
  }
}

export async function GET() {
  try {
    const [serverSkills, metadata] = await Promise.all([
      fetchTeamSkills(),
      Promise.resolve(readMetadata()),
    ]);
    const serverSlugs = new Set(serverSkills.map((skill) => skill.slug));
    const skills = await Promise.all(serverSkills.map((skill) => skillSyncInfoForServerSkill(skill.slug, metadata)));
    for (const [slug, value] of Object.entries(metadata.skills)) {
      if (serverSlugs.has(slug) || value.managed !== true) continue;
      const hasLocal = fs.existsSync(skillRoot(slug)) && fs.statSync(skillRoot(slug)).isDirectory();
      skills.push({
        slug,
        localStatus: hasLocal ? "ready" : "not_synced",
        managed: true,
        hasAccess: false,
        hasLocal,
        adoptable: false,
      });
    }
    return NextResponse.json({ signedIn: true, skills });
  } catch (error) {
    return NextResponse.json(
      {
        signedIn: false,
        skills: [],
        error: error instanceof Error ? error.message : "Could not read skill sync status",
      },
      { status: error instanceof TeamApiError ? error.status : error && typeof error === "object" && "status" in error && error.status === 404 ? 404 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const skill = assertSkillName(body.skill);
    if (body.action === "prune") {
      return NextResponse.json(pruneSkill(skill));
    }
    const action: SyncDirection = body.action === "push" ? "push" : body.action === "adopt" ? "adopt" : "pull";
    const overwrite = body.overwrite === true;
    const result = action === "push"
      ? await pushSkill(skill, overwrite)
      : action === "adopt"
        ? await adoptSkill(skill)
        : await pullSkill(skill, overwrite);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          conflicts: "conflicts" in result ? result.conflicts : undefined,
          direction: "direction" in result ? result.direction : undefined,
        },
        { status: result.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sync skill" },
      { status: error instanceof TeamApiError ? error.status : error && typeof error === "object" && "status" in error && error.status === 404 ? 404 : 500 },
    );
  }
}
