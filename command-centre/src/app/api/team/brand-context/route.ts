import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { getLocalProfileStatePath } from "@/lib/local-profile";
import { assertMaterializedPathWritable, registerMaterializedFiles } from "@/lib/materialized-file-ownership";
import {
  fetchTeamContextDocuments,
  fetchTeamStatus,
  readTeamContext,
  writeTeamContextDocument,
  type TeamContextDocument,
} from "@/lib/team-api-context";
import {
  classifySyncHashes,
  summarizeSyncFiles,
  syncStatusToLocalStatus,
  type SyncStateFile,
  type SyncStateSummary,
} from "@/lib/sync-state";

export const dynamic = "force-dynamic";

const SHARED_CONTEXT_DIRS = ["brand_context", "team_context"] as const;
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
const TEXT_FILE_NAMES = new Set(["AGENTS.md", "CLAUDE.md", "README.md", "SKILL.md", "SKILL.local.md"]);
const EXCLUDED_DIR_NAMES = new Set([
  ".command-centre",
  ".git",
  ".memsearch",
  ".next",
  "backups",
  "coverage",
  "dist",
  "node_modules",
]);
const EXCLUDED_FILE_NAMES = new Set([".env", ".env.local", ".mcp.json"]);
const MAX_FILE_BYTES = 1024 * 1024;

interface SharedLocalFile {
  path: string;
  fullPath: string;
  content: string;
  sha256: string;
  size: number;
}

interface SharedSyncReview {
  path: string;
  operation: "write-local" | "write-remote";
  secret: boolean;
  encoding: "utf-8";
  localSha256?: string;
  remoteSha256?: string;
  localSize?: number;
  remoteSize?: number;
  localContent?: string;
  remoteContent?: string;
}

interface SharedSyncMetadata {
  version: 1;
  files: Record<string, {
    sha256: string;
    size?: number;
    updatedAt?: string;
  }>;
  syncedAt?: string;
}

function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function workspaceRoot(): string {
  return getConfig().aiOsDir;
}

function metadataPath(): string {
  return getLocalProfileStatePath("team-shared-context-sync.json");
}

function readMetadata(): SharedSyncMetadata {
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath(), "utf-8"));
    if (parsed?.version === 1 && parsed.files && typeof parsed.files === "object") {
      return parsed as SharedSyncMetadata;
    }
  } catch {
    // First sync or unreadable metadata: start fresh.
  }
  return { version: 1, files: {} };
}

function writeMetadata(metadata: SharedSyncMetadata): void {
  fs.mkdirSync(path.dirname(metadataPath()), { recursive: true });
  fs.writeFileSync(metadataPath(), `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}

function isSharedContextPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return SHARED_CONTEXT_DIRS.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
}

function isSyncableTextFile(relativePath: string): boolean {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => EXCLUDED_DIR_NAMES.has(part))) return false;
  const name = parts[parts.length - 1] ?? "";
  if (EXCLUDED_FILE_NAMES.has(name) || name.startsWith(".env.")) return false;
  if (TEXT_FILE_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  return Array.from(TEXT_FILE_EXTENSIONS).some((ext) => lower.endsWith(ext));
}

function normalizeSharedPathInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    throw new Error("file path is invalid");
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  const rel = parts.join("/");
  if (parts.some((part) => part === "." || part === "..") || !isSharedContextPath(rel)) {
    throw new Error("file path is outside shared context");
  }
  return rel;
}

function safeSharedPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!isSharedContextPath(normalized)) {
    throw new Error("server returned a file outside shared context");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("server returned an unsafe shared context path");
  }
  const fullPath = path.resolve(workspaceRoot(), ...parts);
  const root = workspaceRoot();
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!fullPath.startsWith(rootWithSep)) {
    throw new Error("shared context path escapes workspace root");
  }
  return fullPath;
}

function listLocalSharedFiles(onlyPath?: string | null): SharedLocalFile[] {
  const root = workspaceRoot();
  const files: SharedLocalFile[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !isSyncableTextFile(rel)) continue;
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_BYTES) continue;
      if (onlyPath && rel !== onlyPath) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      files.push({ path: rel, fullPath, content, sha256: sha256(content), size: stat.size });
    }
  }

  for (const dir of SHARED_CONTEXT_DIRS) {
    const fullDir = path.join(root, dir);
    if (fs.existsSync(fullDir)) walk(fullDir);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function sharedWritable(status: Awaited<ReturnType<typeof fetchTeamStatus>>): boolean {
  if (status.status !== "connected") return false;
  const membership = status.membership && typeof status.membership === "object"
    ? status.membership as Record<string, unknown>
    : {};
  return membership.role === "owner" || membership.role === "admin";
}

function inferContextKind(relativePath: string): string {
  const name = path.posix.basename(relativePath);
  if (name === "AGENTS.md" || name === "CLAUDE.md") return "agents";
  if (relativePath.startsWith("brand_context/")) return "brand";
  if (name === "prompt-tags.md" || name.endsWith(".local.md") || name === "preferences.md") {
    return "preferences";
  }
  return "other";
}

async function fetchRemoteSharedDocs(): Promise<TeamContextDocument[]> {
  return (await fetchTeamContextDocuments("team")).filter((doc) => isSharedContextPath(doc.path));
}

function metadataFromRemoteDocs(docs: TeamContextDocument[]): SharedSyncMetadata["files"] {
  return Object.fromEntries(docs.map((doc) => {
    const content = doc.content ?? "";
    return [doc.path, {
      sha256: doc.sha256 ?? sha256(content),
      size: Buffer.byteLength(content),
      updatedAt: doc.updatedAt,
    }];
  }));
}

function saveSharedMetadata(files: SharedSyncMetadata["files"]): void {
  writeMetadata({
    version: 1,
    files,
    syncedAt: new Date().toISOString(),
  });
}

function mergeSharedMetadata(files: SharedSyncMetadata["files"]): void {
  const metadata = readMetadata();
  writeMetadata({
    version: 1,
    files: { ...metadata.files, ...files },
    syncedAt: new Date().toISOString(),
  });
}

function pushReviewFor(input: {
  local: SharedLocalFile;
  remote?: TeamContextDocument | null;
}): SharedSyncReview {
  const remoteContent = input.remote?.content;
  return {
    path: input.local.path,
    operation: "write-remote",
    secret: false,
    encoding: "utf-8",
    localSha256: input.local.sha256,
    remoteSha256: input.remote?.sha256,
    localSize: input.local.size,
    remoteSize: remoteContent === undefined ? undefined : Buffer.byteLength(remoteContent),
    localContent: input.local.content,
    remoteContent,
  };
}

function pullReviewFor(input: {
  local?: SharedLocalFile | null;
  remote: TeamContextDocument;
}): SharedSyncReview {
  const remoteContent = input.remote.content ?? "";
  return {
    path: input.remote.path,
    operation: "write-local",
    secret: false,
    encoding: "utf-8",
    localSha256: input.local?.sha256,
    remoteSha256: input.remote.sha256 ?? sha256(remoteContent),
    localSize: input.local?.size,
    remoteSize: Buffer.byteLength(remoteContent),
    localContent: input.local?.content,
    remoteContent,
  };
}

function buildSharedSyncState(remoteDocs: TeamContextDocument[], localFiles: SharedLocalFile[]): SyncStateSummary {
  const metadata = readMetadata().files;
  const localMap = new Map(localFiles.map((file) => [file.path, file]));
  const remoteMap = new Map(remoteDocs.map((doc) => [doc.path, doc]));
  const paths = new Set([
    ...Object.keys(metadata),
    ...localFiles.map((file) => file.path),
    ...remoteDocs.map((doc) => doc.path),
  ]);
  const files: SyncStateFile[] = [];

  for (const filePath of Array.from(paths).sort((a, b) => a.localeCompare(b))) {
    const local = localMap.get(filePath);
    const remote = remoteMap.get(filePath);
    const remoteContent = remote?.content ?? "";
    const remoteSha256 = remote ? remote.sha256 ?? sha256(remoteContent) : undefined;
    const status = classifySyncHashes({
      localSha256: local?.sha256,
      remoteSha256,
      lastSyncedSha256: metadata[filePath]?.sha256,
    });
    files.push({
      path: filePath,
      status,
      localSha256: local?.sha256,
      remoteSha256,
      localSize: local?.size,
      remoteSize: remote ? Buffer.byteLength(remoteContent) : undefined,
      remoteUpdatedAt: remote?.updatedAt,
    });
  }

  return summarizeSyncFiles(files);
}

async function pullSharedContext(overwrite: boolean) {
  const [remoteDocs, status] = await Promise.all([
    fetchRemoteSharedDocs(),
    fetchTeamStatus(),
  ]);
  const remoteFiles = [];
  const conflicts: SharedSyncReview[] = [];
  const localFiles = listLocalSharedFiles();
  const localMap = new Map(localFiles.map((file) => [file.path, file]));

  for (const doc of remoteDocs) {
    const content = doc.content ?? "";
    const fullPath = safeSharedPath(doc.path);
    remoteFiles.push({ path: doc.path, fullPath, content });
    if (fs.existsSync(fullPath)) {
      const local = localMap.get(doc.path);
      const localHash = local?.sha256 ?? sha256(fs.readFileSync(fullPath));
      const remoteHash = doc.sha256 ?? sha256(content);
      if (localHash !== remoteHash) conflicts.push(pullReviewFor({ local, remote: doc }));
    } else {
      const lastHash = readMetadata().files[doc.path]?.sha256;
      const remoteHash = doc.sha256 ?? sha256(content);
      if (lastHash && lastHash !== remoteHash) conflicts.push(pullReviewFor({ remote: doc }));
    }
  }

  if (conflicts.length > 0 && !overwrite) {
    return { ok: false as const, status: 409, conflicts };
  }

  for (const file of remoteFiles) {
    assertMaterializedPathWritable(file.fullPath);
    fs.mkdirSync(path.dirname(file.fullPath), { recursive: true });
    fs.writeFileSync(file.fullPath, file.content, "utf-8");
  }
  registerMaterializedFiles(remoteFiles.map((file) => file.fullPath), {
    scope: "team",
    kind: "shared-context",
  });
  saveSharedMetadata(metadataFromRemoteDocs(remoteDocs));

  return {
    ok: true as const,
    filesPulled: remoteFiles.length,
    writable: sharedWritable(status),
    syncState: buildSharedSyncState(remoteDocs, listLocalSharedFiles()),
  };
}

async function pushSharedContext(overwrite: boolean, onlyPath?: string | null) {
  const [remoteDocs, status] = await Promise.all([
    fetchRemoteSharedDocs(),
    fetchTeamStatus(),
  ]);
  if (!sharedWritable(status)) {
    return { ok: false as const, status: 403, error: "Owner or Admin access is required to push shared context." };
  }

  const targetPath = onlyPath ? normalizeSharedPathInput(onlyPath) : null;
  const localFiles = listLocalSharedFiles(targetPath);
  if (targetPath && localFiles.length === 0) {
    const fullPath = safeSharedPath(targetPath);
    return {
      ok: false as const,
      status: fs.existsSync(fullPath) ? 400 : 404,
      error: fs.existsSync(fullPath)
        ? "Selected file is not syncable."
        : "Selected file does not exist locally.",
    };
  }

  const remoteMap = new Map(remoteDocs.map((doc) => [doc.path, doc]));
  const review: SharedSyncReview[] = [];

  for (const file of localFiles) {
    const remote = remoteMap.get(file.path);
    if (remote?.sha256 === file.sha256) continue;
    review.push(pushReviewFor({ local: file, remote }));
  }

  if (review.length > 0 && !overwrite) {
    return { ok: false as const, status: 409, conflicts: review, direction: "push" as const, preview: true };
  }

  let filesPushed = 0;
  const pushedMetadata: SharedSyncMetadata["files"] = {};
  for (const file of localFiles) {
    const remote = remoteMap.get(file.path);
    if (remote?.sha256 === file.sha256) continue;
    await writeTeamContextDocument({
      visibility: "team",
      path: file.path,
      kind: inferContextKind(file.path),
      content: file.content,
      expectedSha256: remote?.sha256,
    });
    pushedMetadata[file.path] = {
      sha256: file.sha256,
      size: file.size,
    };
    filesPushed += 1;
  }

  if (targetPath) {
    mergeSharedMetadata(pushedMetadata);
  } else {
    saveSharedMetadata({
      ...metadataFromRemoteDocs(remoteDocs),
      ...Object.fromEntries(localFiles.map((file) => [file.path, {
        sha256: file.sha256,
        size: file.size,
      }])),
    });
  }

  const syncState = buildSharedSyncState(await fetchRemoteSharedDocs(), listLocalSharedFiles());
  return { ok: true as const, path: targetPath ?? undefined, filesPushed, upToDate: filesPushed === 0, syncState };
}

function isConfigExpired(config: { expiresAt?: string | null } | null): boolean {
  return Boolean(config && typeof config.expiresAt === "string" && Date.parse(config.expiresAt) <= Date.now());
}

export async function GET() {
  const config = await readTeamContext();
  if (!config || isConfigExpired(config)) {
    return NextResponse.json({
      signedIn: false,
      writable: false,
      serverFiles: 0,
      localFiles: listLocalSharedFiles().length,
    });
  }

  try {
    const [remoteDocs, localFiles, status] = await Promise.all([
      fetchRemoteSharedDocs(),
      Promise.resolve(listLocalSharedFiles()),
      fetchTeamStatus(),
    ]);
    return NextResponse.json({
      signedIn: true,
      writable: sharedWritable(status),
      serverFiles: remoteDocs.length,
      localFiles: localFiles.length,
      localStatus: syncStatusToLocalStatus(buildSharedSyncState(remoteDocs, localFiles).status),
      syncState: buildSharedSyncState(remoteDocs, localFiles),
    });
  } catch (error) {
    // A signed-in-but-unreachable/blocked server is a different situation than
    // never signing in — the UI should say "unavailable", not "sign in".
    return NextResponse.json({
      signedIn: true,
      writable: false,
      serverFiles: 0,
      localFiles: listLocalSharedFiles().length,
      unavailable: true,
      error: error instanceof Error ? error.message : "Shared context sync unavailable",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "pull") {
      const result = await pullSharedContext(body.overwrite === true);
      if (!result.ok) {
        return NextResponse.json(
          { error: "Local shared context differs from the server version.", conflicts: result.conflicts },
          { status: result.status },
        );
      }
      return NextResponse.json(result);
    }
    if (action === "push") {
      const result = await pushSharedContext(
        body.overwrite === true,
        typeof body.path === "string" ? body.path : null,
      );
      if (!result.ok) {
        const message = "error" in result ? result.error : "Review shared context changes before pushing.";
        const conflicts = "conflicts" in result ? result.conflicts : undefined;
        const direction = "direction" in result ? result.direction : undefined;
        return NextResponse.json({ error: message, conflicts, direction }, { status: result.status });
      }
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Unknown shared context sync action" }, { status: 400 });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && error.status === 404 ? 404 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Shared context sync failed" },
      { status },
    );
  }
}
