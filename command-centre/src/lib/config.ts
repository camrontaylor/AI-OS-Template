import path from "path";
import fs from "fs";

interface Config {
  agenticOsDir: string;
  dbPath: string;
}

let cachedConfig: Config | null = null;
const workspaceMarkers = ["AGENTS.md", "CLAUDE.md"];

function isAiOsRoot(targetDir: string): boolean {
  return workspaceMarkers.some((marker) => fs.existsSync(path.join(targetDir, marker)));
}

function findAiOsRoot(startDir: string): string | null {
  let currentDir = startDir;

  for (let depth = 0; depth < 10; depth += 1) {
    if (isAiOsRoot(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return null;
}

function resolveAiOsRoot(): string {
  const configuredRoot = process.env.AI_OS_DIR;
  if (configuredRoot) {
    const resolvedRoot = path.resolve(configuredRoot);
    if (!isAiOsRoot(resolvedRoot)) {
      throw new Error(
        `AI_OS_DIR must point to an AI-OS workspace containing ${workspaceMarkers.join(" or ")}: ${resolvedRoot}`
      );
    }
    return resolvedRoot;
  }

  const detectedRoot = findAiOsRoot(__dirname);
  if (!detectedRoot) {
    throw new Error("Unable to locate the AI-OS workspace root from command-centre.");
  }

  return detectedRoot;
}

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const agenticOsDir = resolveAiOsRoot();
  const dataDir = path.join(agenticOsDir, ".command-centre");
  const dbPath = path.join(dataDir, "data.db");

  // Ensure .command-centre directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  cachedConfig = { agenticOsDir, dbPath };
  return cachedConfig;
}

/**
 * Resolve the AI-OS directory for a specific client,
 * or the root AI-OS directory if no clientId is provided.
 */
export function getClientAiOsDir(clientId: string | null): string {
  const config = getConfig();
  if (!clientId) return config.agenticOsDir;
  return path.join(config.agenticOsDir, "clients", clientId);
}

// ─── Planning directory resolution ──────────────────────────────────────
// Each Level 3 GSD project owns its own .planning/ at
// projects/briefs/{slug}/.planning/. Multiple briefs can be active in parallel.
//
// Resolution order (first hit wins):
//   1. Explicit override (caller passes a slug, e.g. from ?project=)
//   2. AI_OS_ACTIVE_PROJECT env var (AI_OS_ACTIVE_PROJECT accepted as fallback)
//   3. cwd walk — if cwd is inside projects/briefs/{slug}/..., use {slug}
//   4. .planning-active pointer file at the base dir (single line = slug)
//   5. Auto-detect — if exactly one projects/briefs/*/.planning/ exists
//   6. null — no active project

export interface PlanningResolution {
  planningDir: string;
  projectSlug: string;
  briefDir: string;
}

export interface ResolvePlanningOptions {
  baseDir?: string;
  cwd?: string;
  overrideSlug?: string | null;
}

function briefsDirFor(baseDir: string): string {
  return path.join(baseDir, "projects", "briefs");
}

function slugHasPlanning(baseDir: string, slug: string): boolean {
  const planning = path.join(briefsDirFor(baseDir), slug, ".planning");
  return fs.existsSync(planning);
}

function buildResolution(baseDir: string, slug: string): PlanningResolution {
  const briefDir = path.join(briefsDirFor(baseDir), slug);
  return {
    planningDir: path.join(briefDir, ".planning"),
    projectSlug: slug,
    briefDir,
  };
}

function cwdSlugFromWalk(baseDir: string, startCwd: string): string | null {
  const briefsDir = briefsDirFor(baseDir);
  let current = path.resolve(startCwd);
  for (let depth = 0; depth < 20; depth += 1) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (path.resolve(parent) === path.resolve(briefsDir)) {
      return path.basename(current);
    }
    current = parent;
  }
  return null;
}

function listBriefsWithPlanning(baseDir: string): string[] {
  const briefsDir = briefsDirFor(baseDir);
  if (!fs.existsSync(briefsDir)) return [];
  const slugs: string[] = [];
  for (const entry of fs.readdirSync(briefsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (slugHasPlanning(baseDir, entry.name)) slugs.push(entry.name);
  }
  return slugs;
}

export function resolvePlanningDir(
  options: ResolvePlanningOptions = {}
): PlanningResolution | null {
  const baseDir = options.baseDir ?? getConfig().agenticOsDir;

  // 1. Explicit override (highest priority)
  if (options.overrideSlug) {
    if (slugHasPlanning(baseDir, options.overrideSlug)) {
      return buildResolution(baseDir, options.overrideSlug);
    }
    return null;
  }

  // 2. Env var
  const envSlug = process.env.AI_OS_ACTIVE_PROJECT;
  if (envSlug) {
    if (slugHasPlanning(baseDir, envSlug)) {
      return buildResolution(baseDir, envSlug);
    }
    // env var pointed at a non-existent project — fall through
  }

  // 3. cwd walk
  const cwd = options.cwd ?? process.cwd();
  const fromCwd = cwdSlugFromWalk(baseDir, cwd);
  if (fromCwd && slugHasPlanning(baseDir, fromCwd)) {
    return buildResolution(baseDir, fromCwd);
  }

  // 4. .planning-active pointer file at base
  const pointerPath = path.join(baseDir, ".planning-active");
  if (fs.existsSync(pointerPath)) {
    try {
      const slug = fs.readFileSync(pointerPath, "utf-8").trim().split("\n")[0].trim();
      if (slug && slugHasPlanning(baseDir, slug)) {
        return buildResolution(baseDir, slug);
      }
    } catch {
      /* ignore */
    }
  }

  // 5. Auto-detect — exactly one project with .planning/
  const available = listBriefsWithPlanning(baseDir);
  if (available.length === 1) {
    return buildResolution(baseDir, available[0]);
  }

  // 6. None
  return null;
}

export function listPlanningProjects(baseDir?: string): string[] {
  return listBriefsWithPlanning(baseDir ?? getConfig().agenticOsDir);
}
