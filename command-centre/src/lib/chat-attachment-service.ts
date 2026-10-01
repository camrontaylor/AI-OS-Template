import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { getClientAiOsDir, getConfig } from "@/lib/config";
import { getChatAttachmentExtension, getChatAttachmentValidationError } from "@/lib/chat-attachment-policy";
import type { ChatAttachment, ChatComposerSurface } from "@/types/chat-composer";
import { getActiveLocalProfileDescriptor } from "@/lib/db";
import { readWorkScopeFromRow } from "@/lib/identity/work-scope";

const CHAT_DRAFT_ROOT = path.join(".tmp", "chat-drafts");
const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "item";
}

function assertSafePathSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveWithinDirectory(baseDir: string, relativePath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, relativePath);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
    throw new Error("Path traversal not allowed");
  }
  return resolvedTarget;
}

function getChatRoot(baseDir: string): string {
  const profile = typeof getActiveLocalProfileDescriptor === "function"
    ? getActiveLocalProfileDescriptor()
    : null;
  return profile?.mode === "team"
    ? path.join(baseDir, "tmp", "chat-drafts")
    : path.join(baseDir, CHAT_DRAFT_ROOT);
}

function assertPathInsideDirectory(dirPath: string, targetPath: string, label: string): string {
  const resolvedDir = path.resolve(dirPath);
  const resolvedTarget = path.resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedDir + path.sep) && resolvedTarget !== resolvedDir) {
    throw new Error(`Attachment path is outside ${label}`);
  }
  return resolvedTarget;
}

function buildDraftDirectory(baseDir: string, surface: ChatComposerSurface, scopeId: string, draftKey: string): string {
  assertSafePathSegment(scopeId, "scopeId");
  assertSafePathSegment(draftKey, "draftKey");
  return path.join(
    getChatRoot(baseDir),
    "drafts",
    surface,
    scopeId,
    draftKey,
  );
}

function buildSentDirectory(baseDir: string, surface: ChatComposerSurface, scopeId: string, referenceId: string): string {
  assertSafePathSegment(scopeId, "scopeId");
  assertSafePathSegment(referenceId, "referenceId");
  return path.join(
    getChatRoot(baseDir),
    "sent",
    surface,
    scopeId,
    referenceId,
  );
}

function ensureUniqueFilePath(dirPath: string, fileName: string): string {
  const parsed = path.parse(fileName);
  let candidate = path.join(dirPath, fileName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    const nextName = `${parsed.name}-${counter}${parsed.ext}`;
    candidate = path.join(dirPath, nextName);
    counter += 1;
  }
  return candidate;
}

function cleanupEmptyParents(startDir: string, stopDir: string): void {
  let current = startDir;
  const resolvedStop = path.resolve(stopDir);
  while (path.resolve(current).startsWith(resolvedStop) && path.resolve(current) !== resolvedStop) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }
    if (fs.readdirSync(current).length > 0) {
      break;
    }
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function readClientIdForSurface(surface: ChatComposerSurface, scopeId: string): string | null {
  const db = getDb();
  if (surface === "conversation") {
    const row = db.prepare("SELECT clientId, workScope FROM conversations WHERE id = ?").get(scopeId) as { clientId: string | null; workScope: string | null } | undefined;
    if (!row) throw new Error("Conversation not found");
    readWorkScopeFromRow(row);
    return row.clientId ?? null;
  }
  if (surface === "task") {
    const row = db.prepare("SELECT clientId, workScope FROM tasks WHERE id = ?").get(scopeId) as { clientId: string | null; workScope: string | null } | undefined;
    if (!row) throw new Error("Task not found");
    readWorkScopeFromRow(row);
    return row.clientId ?? null;
  }
  const row = db.prepare(
    `SELECT c.clientId, c.workScope
     FROM messages m
     LEFT JOIN conversations c ON c.id = m.conversationId
     WHERE m.id = ?`
  ).get(scopeId) as { clientId: string | null; workScope: string | null } | undefined;
  if (!row) throw new Error("Message scope not found");
  readWorkScopeFromRow(row);
  return row.clientId ?? null;
}

function getBaseDirForSurface(surface: ChatComposerSurface, scopeId: string): string {
  const clientId = readClientIdForSurface(surface, scopeId);
  const profile = typeof getActiveLocalProfileDescriptor === "function"
    ? getActiveLocalProfileDescriptor()
    : null;
  if (profile?.mode === "team") return profile.dataDir;
  return clientId ? getClientAiOsDir(clientId) : getConfig().aiOsDir;
}

function resolveDraftAttachmentPath(baseDir: string, attachment: Pick<ChatAttachment, "surface" | "scopeId" | "draftKey" | "relativePath">): string {
  if (!attachment.draftKey) {
    throw new Error("Draft attachment is missing draftKey");
  }
  const draftDir = buildDraftDirectory(baseDir, attachment.surface, attachment.scopeId, attachment.draftKey);
  const absolutePath = resolveWithinDirectory(baseDir, attachment.relativePath);
  return assertPathInsideDirectory(draftDir, absolutePath, "the expected draft scope");
}

function resolveSentAttachmentPath(baseDir: string, attachment: Pick<ChatAttachment, "surface" | "scopeId" | "relativePath">): string {
  const sentScopeDir = path.join(getChatRoot(baseDir), "sent", attachment.surface, attachment.scopeId);
  const absolutePath = resolveWithinDirectory(baseDir, attachment.relativePath);
  return assertPathInsideDirectory(sentScopeDir, absolutePath, "the expected sent scope");
}

function resolveAttachmentSourcePath(attachment: Pick<ChatAttachment, "state" | "surface" | "scopeId" | "draftKey" | "relativePath">): { absolutePath: string; baseDir: string } {
  const baseDir = getBaseDirForSurface(attachment.surface, attachment.scopeId);
  if (attachment.state === "draft") {
    return {
      baseDir,
      absolutePath: resolveDraftAttachmentPath(baseDir, attachment),
    };
  }

  return {
    baseDir,
    absolutePath: resolveSentAttachmentPath(baseDir, attachment),
  };
}

function isDraftAttachment(attachment: ChatAttachment): boolean {
  return attachment.state === "draft" && !!attachment.draftKey;
}

function isScopeArchivedOrInactive(surface: ChatComposerSurface, scopeId: string): boolean {
  const db = getDb();
  if (surface === "conversation") {
    const row = db.prepare("SELECT status FROM conversations WHERE id = ?").get(scopeId) as { status: string } | undefined;
    return row?.status === "archived";
  }
  if (surface === "task") {
    const row = db.prepare("SELECT status, needsInput FROM tasks WHERE id = ?").get(scopeId) as { status: string; needsInput: number } | undefined;
    if (!row) return true;
    return row.status === "done" || (row.status === "review" && !row.needsInput);
  }
  const row = db.prepare(
    `SELECT c.status
     FROM messages m
     LEFT JOIN conversations c ON c.id = m.conversationId
     WHERE m.id = ?`
  ).get(scopeId) as { status: string | null } | undefined;
  return row?.status === "archived";
}

function listDirectoryEntries(dirPath: string): fs.Dirent[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true });
}

function removeDirIfOld(dirPath: string, maxAgeMs: number): void {
  if (!fs.existsSync(dirPath)) return;
  const stat = fs.statSync(dirPath);
  if (Date.now() - stat.mtimeMs > maxAgeMs) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export async function storeChatDraftFiles(params: {
  surface: ChatComposerSurface;
  scopeId: string;
  draftKey: string;
  files: File[];
}): Promise<ChatAttachment[]> {
  const { surface, scopeId, draftKey, files } = params;
  const baseDir = getBaseDirForSurface(surface, scopeId);
  const draftDir = buildDraftDirectory(baseDir, surface, scopeId, draftKey);
  ensureDirectory(draftDir);

  const attachments: ChatAttachment[] = [];
  for (const file of files) {
    const validationError = getChatAttachmentValidationError(file);
    if (validationError) {
      throw new Error(validationError);
    }

    const safeName = sanitizeFileName(file.name);
    const targetPath = ensureUniqueFilePath(draftDir, safeName);
    const extension = getChatAttachmentExtension(safeName);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(targetPath, buffer);

    attachments.push({
      id: crypto.randomUUID(),
      fileName: path.basename(targetPath),
      relativePath: path.relative(baseDir, targetPath).replace(/\\/g, "/"),
      extension,
      sizeBytes: file.size,
      contentType: file.type || null,
      surface,
      scopeId,
      draftKey,
      state: "draft",
      uploadedAt: new Date().toISOString(),
    });
  }

  return attachments;
}

export function deleteChatDraftAttachment(params: {
  surface: ChatComposerSurface;
  scopeId: string;
  draftKey: string;
  relativePath: string;
}): void {
  const { surface, scopeId, draftKey, relativePath } = params;
  const baseDir = getBaseDirForSurface(surface, scopeId);
  const absolutePath = resolveDraftAttachmentPath(baseDir, { surface, scopeId, draftKey, relativePath });
  if (fs.existsSync(absolutePath)) {
    fs.rmSync(absolutePath, { force: true });
  }
  cleanupEmptyParents(path.dirname(absolutePath), getChatRoot(baseDir));
}

export function clearChatDraftScope(params: {
  surface: ChatComposerSurface;
  scopeId: string;
  draftKey: string;
}): void {
  const { surface, scopeId, draftKey } = params;
  const baseDir = getBaseDirForSurface(surface, scopeId);
  const draftDir = buildDraftDirectory(baseDir, surface, scopeId, draftKey);
  if (fs.existsSync(draftDir)) {
    fs.rmSync(draftDir, { recursive: true, force: true });
  }
}

export function copyChatAttachmentsToSent(params: {
  surface: ChatComposerSurface;
  scopeId: string;
  referenceId: string;
  attachments: ChatAttachment[];
}): ChatAttachment[] {
  const { surface, scopeId, referenceId, attachments } = params;
  if (attachments.length === 0) return [];

  const baseDir = getBaseDirForSurface(surface, scopeId);
  const sentDir = buildSentDirectory(baseDir, surface, scopeId, referenceId);
  ensureDirectory(sentDir);

  return attachments.map((attachment) => {
    if (attachment.state === "sent" && attachment.surface === surface && attachment.scopeId === scopeId) {
      resolveSentAttachmentPath(getBaseDirForSurface(attachment.surface, attachment.scopeId), attachment);
      return attachment;
    }

    const { absolutePath: sourcePath } = resolveAttachmentSourcePath(attachment);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Attachment file not found: ${attachment.fileName}`);
    }

    const safeName = sanitizeFileName(attachment.fileName);
    const targetPath = ensureUniqueFilePath(sentDir, safeName);
    fs.copyFileSync(sourcePath, targetPath);

    return {
      ...attachment,
      fileName: path.basename(targetPath),
      relativePath: path.relative(baseDir, targetPath).replace(/\\/g, "/"),
      surface,
      scopeId,
      draftKey: null,
      state: "sent",
    };
  });
}

export function deleteSourceDraftAttachments(attachments: ChatAttachment[]): void {
  if (attachments.length === 0) return;

  for (const attachment of attachments) {
    if (!isDraftAttachment(attachment)) continue;
    const { absolutePath, baseDir } = resolveAttachmentSourcePath(attachment);
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { force: true });
      cleanupEmptyParents(path.dirname(absolutePath), getChatRoot(baseDir));
    }
  }
}

export function cleanupChatAttachmentStorage(params: {
  surface: ChatComposerSurface;
  scopeId: string;
}): void {
  const { surface, scopeId } = params;
  const baseDir = getBaseDirForSurface(surface, scopeId);
  const rootDir = getChatRoot(baseDir);
  if (!fs.existsSync(rootDir)) return;

  const draftsDir = path.join(rootDir, "drafts");
  for (const surfaceEntry of listDirectoryEntries(draftsDir)) {
    if (!surfaceEntry.isDirectory()) continue;
    const surfaceDir = path.join(draftsDir, surfaceEntry.name);
    for (const scopeEntry of listDirectoryEntries(surfaceDir)) {
      if (!scopeEntry.isDirectory()) continue;
      const scopeDir = path.join(surfaceDir, scopeEntry.name);
      for (const draftEntry of listDirectoryEntries(scopeDir)) {
        if (!draftEntry.isDirectory()) continue;
        removeDirIfOld(path.join(scopeDir, draftEntry.name), DRAFT_RETENTION_MS);
      }
      cleanupEmptyParents(scopeDir, surfaceDir);
    }
    cleanupEmptyParents(surfaceDir, draftsDir);
  }

  const sentDir = path.join(rootDir, "sent");
  for (const surfaceEntry of listDirectoryEntries(sentDir)) {
    if (!surfaceEntry.isDirectory()) continue;
    const sentSurface = surfaceEntry.name as ChatComposerSurface;
    const surfaceDir = path.join(sentDir, surfaceEntry.name);
    for (const scopeEntry of listDirectoryEntries(surfaceDir)) {
      if (!scopeEntry.isDirectory()) continue;
      const scopeDir = path.join(surfaceDir, scopeEntry.name);
      if (!isScopeArchivedOrInactive(sentSurface, scopeEntry.name)) {
        continue;
      }
      for (const referenceEntry of listDirectoryEntries(scopeDir)) {
        if (!referenceEntry.isDirectory()) continue;
        removeDirIfOld(path.join(scopeDir, referenceEntry.name), SENT_RETENTION_MS);
      }
      cleanupEmptyParents(scopeDir, surfaceDir);
    }
    cleanupEmptyParents(surfaceDir, sentDir);
  }
}
