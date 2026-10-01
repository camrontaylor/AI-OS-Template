import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";
import type { NextRequest } from "next/server";

import { getClientAiOsDir, getConfig } from "./config";
import { parseDependencies } from "./file-service";
import {
  RequestPrincipalError,
  resolveRequestPrincipalContext,
  type RequestPrincipalContext,
} from "./identity/request-principal";
import { PermissionError, requireClientAccess } from "./identity/permissions";
import { isTeamScopedRequest } from "./team-mode";
import { fetchTeamSkills } from "./team-api-context";
import { resolveTeamSkillRuntime } from "./team-skill-cache";
import type { SkillCatalogEntry, SkillCatalogOrigin, SkillOrigin } from "@/types/file";

export interface ResolvedSkillCatalog {
  skills: SkillCatalogEntry[];
  clientId: string | null;
  teamId: string | null;
  principalContext: RequestPrincipalContext | null;
}

export interface ResolvedSkillFileTarget {
  baseDir: string;
  storagePath: string;
  canonicalPath: string;
  origin: SkillOrigin;
  writable: boolean;
  close: () => Promise<void>;
}

const SKILL_PATH_RE = /^\.claude\/skills\/([a-z0-9][a-z0-9._-]*)(?:\/(.*))?$/i;

/**
 * Folder names of the skills materialized under `skillsDir`, applying the shared
 * traversal rules: directories only, `_catalog` excluded, a readable `SKILL.md`
 * required. `isAccessible` layers an extra guard (e.g. materialized file
 * ownership) on top of that existence check.
 */
export function listSkillFolderNames(
  skillsDir: string,
  isAccessible: (skillMdPath: string) => boolean = () => true,
): string[] {
  if (!fs.existsSync(skillsDir)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "_catalog") continue;
    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath) || !isAccessible(skillMdPath)) continue;
    names.push(entry.name);
  }
  return names;
}

function readSkills(skillsDir: string, origin: "local" | "client"): Map<string, SkillCatalogEntry> {
  const skills = new Map<string, SkillCatalogEntry>();
  for (const name of listSkillFolderNames(skillsDir)) {
    const skillMdPath = path.join(skillsDir, name, "SKILL.md");
    const catalogOrigin: SkillCatalogOrigin = {
      origin,
      command: `/local:${name}`,
      permission: "not_required",
      syncState: origin === "client" ? "client" : "installation",
    };
    try {
      const raw = fs.readFileSync(skillMdPath, "utf8");
      const { data, content } = matter(raw);
      skills.set(name, {
        name: (data.name as string) || name,
        category: name.split("-")[0],
        description: (data.description as string) || "",
        triggers: Array.isArray(data.triggers) ? data.triggers as string[] : [],
        folderName: name,
        dependencies: parseDependencies(content),
        availableOrigins: [catalogOrigin],
        effectiveOrigin: origin,
        commands: { default: `/${name}`, local: `/local:${name}` },
      });
    } catch {
      skills.set(name, {
        name: name,
        category: name.split("-")[0],
        description: "",
        triggers: [],
        folderName: name,
        dependencies: [],
        availableOrigins: [catalogOrigin],
        effectiveOrigin: origin,
        commands: { default: `/${name}`, local: `/local:${name}` },
      });
    }
  }
  return skills;
}

async function requireClientScope(
  context: RequestPrincipalContext,
  clientId: string,
): Promise<void> {
  const client = await context.store.getClientBySlug(context.principal.teamId, clientId);
  if (!client) throw new RequestPrincipalError(404, "not_found", "client not found");
  try {
    await requireClientAccess(context.store, context.principal, client.id, "read");
  } catch (error) {
    if (error instanceof PermissionError) {
      throw new RequestPrincipalError(403, "forbidden", "client access is required");
    }
    throw error;
  }
}

function mergeClientSkills(
  catalog: Map<string, SkillCatalogEntry>,
  clientSkills: Map<string, SkillCatalogEntry>,
): void {
  for (const [slug, clientSkill] of clientSkills) {
    const existing = catalog.get(slug);
    if (existing) clientSkill.availableOrigins = [...existing.availableOrigins, ...clientSkill.availableOrigins];
    catalog.set(slug, clientSkill);
  }
}

/**
 * Skills this client turned off via skillOverrides in settings.local.json.
 * The file belongs to the user and may be absent or hand-edited; any read or
 * parse problem simply means "no overrides".
 */
export function readClientHiddenSkills(clientDir: string): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(clientDir, ".claude", "settings.local.json"), "utf8");
    // Windows editors may save the file with a BOM, which JSON.parse rejects.
    const overrides = (JSON.parse(raw.replace(/^\uFEFF/, "")) as { skillOverrides?: Record<string, unknown> }).skillOverrides;
    if (!overrides || typeof overrides !== "object") return new Set();
    return new Set(Object.keys(overrides).filter((name) => overrides[name] === "off"));
  } catch {
    return new Set();
  }
}

// A client folder carries two per-client skill facts the folder scan cannot
// see: SKILL.local.md overrides on inherited skills, and skills turned off via
// skillOverrides. Surface both on the merged catalog, and give customised
// skills a client origin so their override file is reachable through the
// files route.
function annotateClientSkillState(catalog: Map<string, SkillCatalogEntry>, clientDir: string): void {
  const hidden = readClientHiddenSkills(clientDir);
  for (const [slug, entry] of catalog) {
    if (hidden.has(slug)) entry.hiddenByClient = true;
    if (entry.effectiveOrigin === "client") continue;
    if (!fs.existsSync(path.join(clientDir, ".claude", "skills", slug, "SKILL.local.md"))) continue;
    entry.clientOverride = true;
    if (!entry.availableOrigins.some((candidate) => candidate.origin === "client")) {
      entry.availableOrigins.push({
        origin: "client",
        command: `/local:${slug}`,
        permission: "not_required",
        syncState: "client",
      });
    }
  }
}

function addCachedTeamSkills(
  catalog: Map<string, SkillCatalogEntry>,
  teamId: string,
  clientId: string | null,
): void {
  const runtime = resolveTeamSkillRuntime(teamId, clientId);
  for (const slug of runtime.teamSkills) {
    const existing = catalog.get(slug);
    catalog.set(slug, {
      name: existing?.name || slug,
      category: slug.split("-")[0],
      description: existing?.description || "",
      triggers: existing?.triggers || [],
      folderName: slug,
      dependencies: existing?.dependencies || [],
      availableOrigins: [
        ...(existing?.availableOrigins || []),
        { origin: "team", command: `/team:${slug}`, permission: "skill.use", syncState: "offline_authorized", executable: true },
      ],
      effectiveOrigin: "team",
      commands: { default: `/${slug}`, ...(existing ? { local: `/local:${slug}` } : {}), team: `/team:${slug}` },
    });
  }
}

export async function resolveSkillCatalogForRequest(
  request: NextRequest,
  options: { includeTeam?: boolean; requireTeamIdentity?: boolean } = {},
): Promise<ResolvedSkillCatalog> {
  const clientId = request.nextUrl.searchParams.get("clientId");
  const rootSkills = readSkills(path.join(getConfig().aiOsDir, ".claude", "skills"), "local");
  const catalog = new Map(rootSkills);
  const teamScoped = isTeamScopedRequest(request);
  let principalContext: RequestPrincipalContext | null = null;

  try {
    if (teamScoped && (options.includeTeam !== false || Boolean(clientId))) {
      principalContext = await resolveRequestPrincipalContext(request);
      if (clientId && clientId !== "root") await requireClientScope(principalContext, clientId);
    }

    if (clientId && clientId !== "root") {
      if (!teamScoped || principalContext) {
        mergeClientSkills(catalog, readSkills(path.join(getClientAiOsDir(clientId), ".claude", "skills"), "client"));
      }
    }

    if (teamScoped && options.includeTeam !== false) {
      if (!principalContext) principalContext = await resolveRequestPrincipalContext(request);
      const teamId = principalContext.principal.teamId;
      try {
        const teamSkills = await fetchTeamSkills(teamId);
        const runtime = resolveTeamSkillRuntime(teamId, clientId);
        const incompatible = new Set(runtime.incompatibleTeamSkills);
        const executable = new Set(runtime.teamSkills);
        for (const teamSkill of teamSkills) {
          if (!teamSkill.userPermission) continue;
          const existing = catalog.get(teamSkill.slug);
          const teamOrigin: SkillCatalogOrigin = {
            origin: "team",
            command: `/team:${teamSkill.slug}`,
            permission: teamSkill.userPermission,
            syncState: incompatible.has(teamSkill.slug)
              ? "plugin_incompatible"
              : executable.has(teamSkill.slug) ? "synced" : "not_synced",
            executable: executable.has(teamSkill.slug),
          };
          catalog.set(teamSkill.slug, {
            name: teamSkill.name || existing?.name || teamSkill.slug,
            category: teamSkill.slug.split("-")[0],
            description: teamSkill.description || existing?.description || "",
            triggers: existing?.triggers || [],
            folderName: teamSkill.slug,
            dependencies: existing?.dependencies || [],
            availableOrigins: [...(existing?.availableOrigins || []), teamOrigin],
            effectiveOrigin: incompatible.has(teamSkill.slug) && existing ? existing.effectiveOrigin : "team",
            commands: {
              default: `/${teamSkill.slug}`,
              ...(existing ? { local: `/local:${teamSkill.slug}` } : {}),
              team: `/team:${teamSkill.slug}`,
            },
          });
        }
      } catch (error) {
        if (options.requireTeamIdentity && !principalContext) throw error;
        addCachedTeamSkills(catalog, teamId, clientId);
      }
    }

    if (clientId && clientId !== "root" && (!teamScoped || principalContext)) {
      annotateClientSkillState(catalog, getClientAiOsDir(clientId));
    }

    return {
      skills: [...catalog.values()].sort((a, b) => a.folderName.localeCompare(b.folderName)),
      clientId,
      teamId: principalContext?.principal.teamId ?? null,
      principalContext,
    };
  } catch (error) {
    await principalContext?.close();
    throw error;
  }
}

export async function resolveSkillFileTarget(
  request: NextRequest,
  canonicalPath: string,
  origin: SkillOrigin,
): Promise<ResolvedSkillFileTarget> {
  const normalized = canonicalPath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  const match = normalized.match(SKILL_PATH_RE);
  if (!match) throw new RequestPrincipalError(404, "not_found", "skill file not found");
  const [, slug, childPath = ""] = match;
  const catalog = await resolveSkillCatalogForRequest(request, {
    includeTeam: origin === "team",
    requireTeamIdentity: origin === "team",
  });
  const entry = catalog.skills.find((skill) => skill.folderName === slug);
  const available = entry?.availableOrigins.some((candidate) => candidate.origin === origin);
  if (!entry || !available) {
    await catalog.principalContext?.close();
    throw new RequestPrincipalError(404, "not_found", "skill file not found");
  }

  if (origin === "team") {
    if (!catalog.teamId) {
      await catalog.principalContext?.close();
      throw new RequestPrincipalError(404, "not_found", "skill file not found");
    }
    const runtime = resolveTeamSkillRuntime(catalog.teamId, catalog.clientId);
    if (!runtime.pluginDir || !runtime.teamSkills.includes(slug)) {
      await catalog.principalContext?.close();
      throw new RequestPrincipalError(404, "not_found", "skill file not found");
    }
    return {
      baseDir: runtime.pluginDir,
      storagePath: path.posix.join("skills", slug, childPath),
      canonicalPath: normalized,
      origin,
      writable: false,
      close: () => catalog.principalContext?.close() ?? Promise.resolve(),
    };
  }

  const baseDir = origin === "client"
    ? getClientAiOsDir(catalog.clientId)
    : getConfig().aiOsDir;
  return {
    baseDir,
    storagePath: normalized,
    canonicalPath: normalized,
    origin,
    writable: origin === "client" || childPath === "SKILL.local.md",
    close: () => catalog.principalContext?.close() ?? Promise.resolve(),
  };
}

export function parseSkillOrigin(value: string | null): SkillOrigin | null {
  return value === "local" || value === "client" || value === "team" ? value : null;
}
