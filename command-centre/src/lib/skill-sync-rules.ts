import path from "node:path";

export const SKILL_SYNC_EXCLUDED_DIR_NAMES = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "env",
  "node_modules",
  "venv",
]);

export const SKILL_SYNC_EXCLUDED_FILE_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

export const SKILL_SYNC_EXCLUDED_FILE_EXTENSIONS = new Set([
  ".log",
  ".pyc",
  ".pyo",
  ".tmp",
]);

export function isExcludedSkillSyncPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => SKILL_SYNC_EXCLUDED_DIR_NAMES.has(part))) return true;

  const name = path.posix.basename(normalized);
  if (name === "SKILL.local.md" || name.endsWith(".local.md")) return true;
  if (SKILL_SYNC_EXCLUDED_FILE_NAMES.has(name)) return true;

  const lower = name.toLowerCase();
  for (const ext of SKILL_SYNC_EXCLUDED_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export function isSyncableSharedSkillPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.startsWith(".claude/skills/") && !isExcludedSkillSyncPath(normalized);
}
