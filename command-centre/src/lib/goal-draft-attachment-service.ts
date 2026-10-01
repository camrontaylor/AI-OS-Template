import fs from "fs";
import path from "path";
import { getClientAiOsDir } from "@/lib/config";
import { getChatAttachmentExtension, getChatAttachmentValidationError } from "@/lib/chat-attachment-policy";
import type { GoalDraftAttachment } from "@/types/goal-draft";
import { getActiveLocalProfileDescriptor } from "@/lib/db";

const GOAL_DRAFT_ROOT = path.join(".tmp", "goal-drafts");

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

function getBaseDir(clientId: string | null): string {
  const profile = typeof getActiveLocalProfileDescriptor === "function"
    ? getActiveLocalProfileDescriptor()
    : null;
  if (profile?.mode === "team") return profile.dataDir;
  return getClientAiOsDir(clientId);
}

function getGoalDraftRoot(baseDir: string): string {
  const profile = typeof getActiveLocalProfileDescriptor === "function"
    ? getActiveLocalProfileDescriptor()
    : null;
  return profile?.mode === "team"
    ? path.join(baseDir, "tmp", "goal-drafts")
    : path.join(baseDir, GOAL_DRAFT_ROOT);
}

function buildDraftDirectory(baseDir: string, draftId: string): string {
  assertSafePathSegment(draftId, "draftId");
  return path.join(getGoalDraftRoot(baseDir), draftId);
}

function resolveDraftAttachmentPath(baseDir: string, draftId: string, relativePath: string): string {
  const draftDir = buildDraftDirectory(baseDir, draftId);
  const absolutePath = resolveWithinDirectory(baseDir, relativePath);
  const resolvedDraftDir = path.resolve(draftDir);
  const resolvedPath = path.resolve(absolutePath);
  if (!resolvedPath.startsWith(resolvedDraftDir + path.sep) && resolvedPath !== resolvedDraftDir) {
    throw new Error("Attachment path is outside the expected draft scope");
  }
  return absolutePath;
}

export async function storeGoalDraftFiles(params: {
  draftId: string;
  clientId: string | null;
  files: File[];
}): Promise<GoalDraftAttachment[]> {
  const { draftId, clientId, files } = params;
  const baseDir = getBaseDir(clientId);
  const draftDir = buildDraftDirectory(baseDir, draftId);
  ensureDirectory(draftDir);

  const attachments: GoalDraftAttachment[] = [];
  for (const file of files) {
    const validationError = getChatAttachmentValidationError(file);
    if (validationError) {
      throw new Error(validationError);
    }

    const safeName = sanitizeFileName(file.name);
    const targetPath = ensureUniqueFilePath(draftDir, safeName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(targetPath, buffer);

    attachments.push({
      fileName: path.basename(targetPath),
      relativePath: path.relative(baseDir, targetPath).replace(/\\/g, "/"),
      extension: getChatAttachmentExtension(safeName),
      sizeBytes: file.size,
    });
  }

  return attachments;
}

export function deleteGoalDraftAttachment(params: {
  draftId: string;
  clientId: string | null;
  relativePath: string;
}): void {
  const { draftId, clientId, relativePath } = params;
  const baseDir = getBaseDir(clientId);
  const absolutePath = resolveDraftAttachmentPath(baseDir, draftId, relativePath);
  if (fs.existsSync(absolutePath)) {
    fs.rmSync(absolutePath, { force: true });
  }
  cleanupEmptyParents(path.dirname(absolutePath), getGoalDraftRoot(baseDir));
}

export function clearGoalDraftScope(params: {
  draftId: string;
  clientId: string | null;
}): void {
  const { draftId, clientId } = params;
  const baseDir = getBaseDir(clientId);
  const draftDir = buildDraftDirectory(baseDir, draftId);
  if (fs.existsSync(draftDir)) {
    fs.rmSync(draftDir, { recursive: true, force: true });
  }
  cleanupEmptyParents(path.dirname(draftDir), getGoalDraftRoot(baseDir));
}
