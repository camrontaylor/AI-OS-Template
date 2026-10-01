import fs from "fs";
import path from "path";
import { getClientAiOsDir, getConfig } from "./config";
import { getDb } from "./db";
import {
  TASK_FILE_ROOTS,
  TASK_ROOT_FILES,
  isAllowedTaskFilePath,
  normalizeTaskRelativePath,
} from "./workspace-file-reference";

export { TASK_FILE_ROOTS, TASK_ROOT_FILES, isAllowedTaskFilePath, normalizeTaskRelativePath };

export function resolveTaskWorkspace(taskId: string) {
  const db = getDb();
  let task = db.prepare("SELECT id, parentId, clientId, projectSlug FROM tasks WHERE id = ?").get(taskId) as
    | { id: string; parentId: string | null; clientId: string | null; projectSlug: string | null }
    | undefined;
  if (!task) return null;
  const seen = new Set<string>();
  let root = task;
  while (root.parentId) {
    if (seen.has(root.id)) return null;
    seen.add(root.id);
    const parent = db.prepare("SELECT id, parentId, clientId, projectSlug FROM tasks WHERE id = ?").get(root.parentId) as typeof task;
    if (!parent) return null;
    root = parent;
  }
  // The root Goal owns the workspace boundary. Child metadata may be stale or
  // corrupt, so it must never widen or replace the root client/project scope.
  const clientId = root.clientId ?? null;
  return {
    task,
    root,
    clientId,
    baseDir: clientId ? getClientAiOsDir(clientId) : getConfig().aiOsDir,
    projectSlug: root.projectSlug ?? null,
  };
}

export function resolveTaskFile(taskId: string, value: string) {
  const context = resolveTaskWorkspace(taskId);
  if (!context) return null;
  const relativePath = normalizeTaskRelativePath(value);
  if (!isAllowedTaskFilePath(relativePath)) return null;
  const baseDir = path.resolve(context.baseDir);
  if (!fs.existsSync(baseDir)) return null;
  const absolutePath = path.resolve(baseDir, relativePath);
  const relative = path.relative(baseDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  // The lexical check above is not enough when an allowed folder contains a
  // symlink or junction. Resolve the existing target (or its parent for a new
  // file) and make sure it still belongs to the Task workspace.
  const boundary = fs.realpathSync.native(baseDir);
  const existingBoundaryTarget = fs.existsSync(absolutePath)
    ? absolutePath
    : path.dirname(absolutePath);
  if (!fs.existsSync(existingBoundaryTarget)) return null;
  const realTarget = fs.realpathSync.native(existingBoundaryTarget);
  const realRelative = path.relative(boundary, realTarget);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) return null;
  return { ...context, relativePath, absolutePath };
}

export function listTaskWorkspaceRoot(taskId: string) {
  const context = resolveTaskWorkspace(taskId);
  if (!context) return null;
  if (!fs.existsSync(context.baseDir)) return [];
  const boundary = fs.realpathSync.native(context.baseDir);
  return [...TASK_ROOT_FILES, ...TASK_FILE_ROOTS]
    .map((name) => {
      const absolutePath = path.join(context.baseDir, name);
      if (!fs.existsSync(absolutePath)) return null;
      const target = fs.realpathSync.native(absolutePath);
      const relative = path.relative(boundary, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
      const stat = fs.statSync(absolutePath);
      return { name, path: name, type: stat.isDirectory() ? "directory" as const : "file" as const, lastModified: stat.mtime.toISOString(), size: stat.size };
    })
    .filter(Boolean);
}
