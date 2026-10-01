export const TASK_FILE_ROOTS = ["context", "team_context", "brand_context", "docs", "projects", ".planning", ".claude/skills"] as const;
export const TASK_ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "README.md"] as const;

export function normalizeTaskRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

export function isAllowedTaskFilePath(value: string, allowRoot = false): boolean {
  const relativePath = normalizeTaskRelativePath(value);
  if (!relativePath) return allowRoot;
  if (relativePath.split("/").includes("..") || /^[a-zA-Z]:/.test(relativePath)) return false;
  return TASK_ROOT_FILES.includes(relativePath as typeof TASK_ROOT_FILES[number])
    || TASK_FILE_ROOTS.some((root) => relativePath === root || relativePath.startsWith(`${root}/`));
}

function stripQueryAndFragment(value: string): string {
  const queryIndex = value.indexOf("?");
  const fragmentIndex = value.indexOf("#");
  const cutAt = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);
  return value.slice(0, cutAt);
}

export function hasWorkspaceDirectoryHint(value: string | null | undefined): boolean {
  if (!value) return false;
  let reference = stripQueryAndFragment(value.trim()).trim();
  if (reference.startsWith("<") && reference.endsWith(">")) {
    reference = reference.slice(1, -1).trim();
  }
  return reference.replace(/\\/g, "/").endsWith("/");
}

function decodeReference(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Resolve a user-visible local file reference to a safe Task workspace path.
 * External URLs and traversal attempts intentionally return null.
 */
export function resolveWorkspaceFileReference(
  value: string | null | undefined,
  sourcePath?: string | null,
): string | null {
  if (!value) return null;
  let reference = value.trim();
  if (!reference) return null;
  if (reference.startsWith("<") && reference.endsWith(">")) {
    reference = reference.slice(1, -1).trim();
  }
  if (!reference || reference.startsWith("#") || reference.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) return null;

  const decoded = decodeReference(stripQueryAndFragment(reference));
  if (!decoded) return null;
  const slashPath = decoded.replace(/\\/g, "/");
  if (slashPath.split("/").includes("..") || /^[a-zA-Z]:/.test(slashPath)) return null;

  const workspaceRooted = slashPath.startsWith("/");
  const cleanReference = normalizeTaskRelativePath(slashPath.replace(/^\.\//, ""));
  if (!cleanReference) return null;

  let candidate = cleanReference;
  const alreadyWorkspaceRelative = isAllowedTaskFilePath(cleanReference);
  if (!workspaceRooted && !alreadyWorkspaceRelative && sourcePath) {
    const normalizedSource = normalizeTaskRelativePath(sourcePath);
    const lastSlash = normalizedSource.lastIndexOf("/");
    const sourceDirectory = lastSlash >= 0 ? normalizedSource.slice(0, lastSlash) : "";
    candidate = normalizeTaskRelativePath(sourceDirectory ? `${sourceDirectory}/${cleanReference}` : cleanReference);
  }

  return isAllowedTaskFilePath(candidate) ? candidate : null;
}

/**
 * Convert an output path reported by a tool into a safe workspace-relative
 * reference. Tool output may contain an absolute path from Windows, macOS,
 * Linux, or a Git worktree whose folder name is not `AI-OS`.
 */
export function resolveWorkspaceFileOutputPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized) return null;

  const direct = resolveWorkspaceFileReference(normalized);
  if (direct) return direct;

  const parts = normalized.split("/").filter(Boolean);
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = resolveWorkspaceFileReference(parts.slice(index).join("/"));
    if (candidate) return candidate;
  }
  return null;
}
