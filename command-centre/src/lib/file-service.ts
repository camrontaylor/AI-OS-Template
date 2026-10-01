import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import { getConfig } from "./config";
import type { FileNode, FileContent, SkillDependency, InstalledSkill } from "@/types/file";
import {
  assertMaterializedPathAccessible,
  assertMaterializedPathWritable,
  isMaterializedPathAccessible,
  registerMaterializedFiles,
  removeMaterializedOwnership,
} from "./materialized-file-ownership";

export function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Validate that a resolved path is within the given root directory.
 * Prevents directory traversal attacks.
 */
function validatePath(resolved: string, rootDir: string): void {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedTarget = path.resolve(resolved);
  if (!normalizedTarget.startsWith(normalizedRoot + path.sep) && normalizedTarget !== normalizedRoot) {
    throw new Error("Path traversal detected: access denied");
  }
}

/**
 * Resolve a relative path to an absolute path within a base directory.
 * Defaults to the AI-OS root if no baseDir is provided.
 */
function resolvePath(relativePath: string, baseDir?: string): string {
  const root = baseDir || getConfig().aiOsDir;
  const normalizedPath = normalizeRelativePath(relativePath);
  const resolved = path.join(root, normalizedPath);
  validatePath(resolved, root);
  return resolved;
}

/**
 * List immediate children of a directory.
 * For context/memory/ specifically: sort by filename descending, limit entries.
 */
export function listDirectory(relativePath: string, options?: { limit?: number; baseDir?: string; includeHidden?: boolean; skipOwnershipCheck?: boolean }): FileNode[] {
  const normalizedPath = normalizeRelativePath(relativePath);
  const resolved = resolvePath(normalizedPath, options?.baseDir);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Directory not found: ${normalizedPath}`);
  }

  const entries = fs.readdirSync(resolved, { withFileTypes: true });

  let nodes: FileNode[] = entries
    .filter((entry) => options?.includeHidden === true || !entry.name.startsWith("."))
    .filter((entry) => options?.skipOwnershipCheck === true || isMaterializedPathAccessible(path.join(resolved, entry.name)))
    .map((entry) => {
      const fullPath = path.join(resolved, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: normalizeRelativePath(path.posix.join(normalizedPath, entry.name)),
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        lastModified: stat.mtime.toISOString(),
        size: stat.size,
      };
    });

  // For context/memory/ specifically: sort newest first and limit
  if (normalizedPath === "context/memory") {
    nodes.sort((a, b) => b.name.localeCompare(a.name));
    const limit = options?.limit || 30;
    nodes = nodes.slice(0, limit);
  }

  return nodes;
}

/**
 * Read a file's content and metadata.
 */
export function readFile(relativePath: string, baseDir?: string, options?: { skipOwnershipCheck?: boolean }): FileContent {
  const normalizedPath = normalizeRelativePath(relativePath);
  const resolved = resolvePath(normalizedPath, baseDir);
  if (options?.skipOwnershipCheck !== true) assertMaterializedPathAccessible(resolved);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${normalizedPath}`);
  }

  const content = fs.readFileSync(resolved, "utf-8");
  const stat = fs.statSync(resolved);

  return {
    path: normalizedPath,
    content,
    lastModified: stat.mtime.toISOString(),
  };
}

/**
 * Write a file with atomic write and optimistic concurrency check.
 */
export function writeFile(
  relativePath: string,
  content: string,
  expectedLastModified?: string,
  baseDir?: string,
  options?: { skipOwnershipCheck?: boolean; skipOwnershipRegistration?: boolean },
): FileContent {
  const normalizedPath = normalizeRelativePath(relativePath);
  const resolved = resolvePath(normalizedPath, baseDir);
  if (options?.skipOwnershipCheck !== true) assertMaterializedPathWritable(resolved);

  // Optimistic concurrency check
  if (expectedLastModified && fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    const currentModified = stat.mtime.toISOString();
    if (currentModified !== expectedLastModified) {
      throw new Error("File was modified since you loaded it. Reload and try again.");
    }
  }

  // Atomic write: create an unpredictable temp file exclusively in the same
  // directory, then rename it into place. A predictable `${resolved}.tmp`
  // could already be a symlink and redirect the write outside the workspace.
  const tmpPath = `${resolved}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let tempFd: number | null = null;
  try {
    tempFd = fs.openSync(tmpPath, "wx", 0o600);
    fs.writeFileSync(tempFd, content, "utf-8");
    fs.fsyncSync(tempFd);
    fs.closeSync(tempFd);
    tempFd = null;
    fs.renameSync(tmpPath, resolved);
  } catch (error) {
    if (tempFd !== null) {
      try {
        fs.closeSync(tempFd);
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // The temp file may not have been created or may already be renamed.
    }
    throw error;
  }

  // Ownership is recorded only after the atomic rename has completed.
  if (options?.skipOwnershipRegistration !== true) {
    registerMaterializedFiles([resolved], {
      scope: normalizedPath.startsWith("clients/") ? "client" : "team",
      kind: "local-file",
    });
  }

  const stat = fs.statSync(resolved);
  return {
    path: normalizedPath,
    content,
    lastModified: stat.mtime.toISOString(),
  };
}

/**
 * Delete a file within the AI-OS directory.
 */
export function deleteFile(relativePath: string, baseDir?: string, options?: { skipOwnershipCheck?: boolean }): void {
  const normalizedPath = normalizeRelativePath(relativePath);
  const resolved = resolvePath(normalizedPath, baseDir);
  if (options?.skipOwnershipCheck !== true) assertMaterializedPathAccessible(resolved);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${normalizedPath}`);
  }

  if (fs.statSync(resolved).isDirectory()) {
    throw new Error(`Cannot delete directories: ${normalizedPath}`);
  }

  removeMaterializedOwnership([resolved]);
  fs.unlinkSync(resolved);
}

/**
 * Move a file from one path to another within the AI-OS directory.
 */
export function moveFile(
  fromPath: string,
  toPath: string,
  baseDir?: string,
  options?: { skipOwnershipCheck?: boolean; skipOwnershipRegistration?: boolean },
): void {
  const root = baseDir || getConfig().aiOsDir;
  const normalizedFromPath = normalizeRelativePath(fromPath);
  const normalizedToPath = normalizeRelativePath(toPath);
  const resolvedFrom = resolvePath(normalizedFromPath, root);
  const resolvedTo = resolvePath(normalizedToPath, root);
  if (options?.skipOwnershipCheck !== true) {
    assertMaterializedPathAccessible(resolvedFrom);
    assertMaterializedPathWritable(resolvedTo);
  }

  if (!fs.existsSync(resolvedFrom)) {
    throw new Error(`File not found: ${normalizedFromPath}`);
  }

  if (fs.existsSync(resolvedTo)) {
    throw new Error(`Target already exists: ${normalizedToPath}`);
  }

  // Ensure target directory exists
  const targetDir = path.dirname(resolvedTo);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.renameSync(resolvedFrom, resolvedTo);
  if (options?.skipOwnershipRegistration !== true) {
    removeMaterializedOwnership([resolvedFrom]);
    registerMaterializedFiles([resolvedTo], {
      scope: normalizedToPath.startsWith("clients/") ? "client" : "team",
      kind: "local-file",
    });
  }
}

/**
 * Parse ## Dependencies markdown table from SKILL.md body.
 */
export function parseDependencies(markdownBody: string): SkillDependency[] {
  const depsMatch = markdownBody.match(
    /## Dependencies\s*\n[\s\S]*?\|[\s\S]*?\n\|[-\s|]+\n([\s\S]*?)(?=\n##|\n*$)/
  );
  if (!depsMatch) return [];

  const rows = depsMatch[1]
    .trim()
    .split("\n")
    .filter((r) => r.includes("|"));

  return rows
    .map((row) => {
      const cells = row
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      return {
        skill: cells[0]?.replace(/`/g, "") || "",
        required: (cells[1] || "").toLowerCase().includes("required"),
        description: cells[2] || "",
        fallback: cells[3] || "",
      };
    })
    .filter((d) => d.skill);
}

/**
 * List all installed skills by reading .claude/skills/ SKILL.md files.
 */
export function listSkills(): InstalledSkill[] {
  const { aiOsDir } = getConfig();
  const skillsDir = path.join(aiOsDir, ".claude", "skills");

  if (!fs.existsSync(skillsDir)) return [];

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: InstalledSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "_catalog") continue;

    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;
    if (!isMaterializedPathAccessible(skillMdPath)) continue;

    try {
      const raw = fs.readFileSync(skillMdPath, "utf-8");
      const { data, content } = matter(raw);

      skills.push({
        name: (data.name as string) || entry.name,
        category: entry.name.split("-")[0],
        description: (data.description as string) || "",
        triggers: (data.triggers as string[]) || [],
        folderName: entry.name,
        dependencies: parseDependencies(content),
      });
    } catch {
      skills.push({
        name: entry.name,
        category: entry.name.split("-")[0],
        description: "Unable to read skill details",
        triggers: [],
        folderName: entry.name,
        dependencies: [],
      });
    }
  }

  return skills;
}
