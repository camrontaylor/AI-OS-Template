import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getConfig } from "./config";
import {
  getTeamContextFilePath,
  resolveLocalProfileDescriptor,
  type LocalProfileDescriptorV1,
} from "./local-profile";
import {
  fetchTeamSkillFile,
  fetchTeamSkillManifest,
  fetchTeamSkills,
} from "./team-api-context";

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export interface TeamSkillCachePaths {
  teamKey: string;
  root: string;
  sourceRoot: string;
  pluginRoot: string;
  metadataPath: string;
}

export interface TeamSkillRuntime {
  pluginDir: string | null;
  promptFile: string | null;
  fingerprint: string;
  teamSkills: string[];
  localSkills: string[];
  clientSkills: string[];
  incompatibleTeamSkills: string[];
}

interface CacheMetadata {
  version: 1;
  skills: Record<string, {
    managed: true;
    files: Record<string, { sha256: string; normalizedSha256?: string; size?: number; updatedAt?: string; encoding?: "utf-8" | "base64" }>;
    syncedAt?: string;
    conflict?: boolean;
  }>;
}

function contained(base: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(base);
  const target = path.resolve(base, ...segments);
  if (target !== resolvedBase && !target.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error("Team skill cache path escaped its profile directory");
  }
  return target;
}

export function teamCacheKey(teamId: string): string {
  const value = teamId.trim();
  if (!value) throw new Error("A Team OS team is required for the skill cache");
  return crypto.createHash("sha256").update(`team-skill-cache:v1\n${value}`, "utf8").digest("hex");
}

export function resolveTeamSkillCachePaths(
  teamId: string,
  profile: LocalProfileDescriptorV1 = resolveLocalProfileDescriptor(),
): TeamSkillCachePaths {
  if (profile.mode !== "team") throw new Error("Team skill caches require a Team OS profile");
  const teamKey = teamCacheKey(teamId);
  const root = contained(profile.dataDir, "team-skills", teamKey);
  return {
    teamKey,
    root,
    sourceRoot: contained(root, "source"),
    pluginRoot: contained(root, "plugin"),
    metadataPath: contained(root, "sync-v1.json"),
  };
}

export function readSelectedTeamId(): string {
  const parsed = JSON.parse(fs.readFileSync(getTeamContextFilePath(), "utf8")) as Record<string, unknown>;
  const savedTeam = parsed.team && typeof parsed.team === "object"
    ? parsed.team as Record<string, unknown>
    : null;
  const teamId = typeof parsed.selectedTeamId === "string"
    ? parsed.selectedTeamId.trim()
    : typeof savedTeam?.id === "string"
      ? savedTeam.id.trim()
      : "";
  if (!teamId) throw new Error("Select a Team OS team before syncing skills");
  return teamId;
}

function listSkillDirectories(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SKILL_NAME_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function readCacheMetadata(filePath: string): CacheMetadata {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as CacheMetadata;
    if (parsed.version === 1 && parsed.skills && typeof parsed.skills === "object") return parsed;
  } catch {
    // A missing cache is the normal first-run state.
  }
  return { version: 1, skills: {} };
}

function writeCacheMetadata(filePath: string, metadata: CacheMetadata): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function safeSourcePath(sourceRoot: string, skill: string, remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, "/");
  const prefix = `.claude/skills/${skill}/`;
  if (!normalized.startsWith(prefix) || normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`Team OS returned an unsafe path for ${skill}`);
  }
  const target = path.resolve(sourceRoot, ...normalized.split("/"));
  const base = path.resolve(sourceRoot);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error(`Team OS path escaped the cache for ${skill}`);
  return target;
}

function remoteContentBuffer(file: { content?: string; contentBase64?: string; encoding?: "utf-8" | "base64" }): Buffer {
  return file.encoding === "base64" || file.contentBase64 !== undefined
    ? Buffer.from(file.contentBase64 ?? "", "base64")
    : Buffer.from(file.content ?? "", "utf8");
}

/**
 * Refresh only server-owned changes. Local cache edits are kept when they
 * conflict, and revoked Team copies are removed only after a successful
 * authorization response for the chat's immutable team.
 */
export async function refreshAuthorizedTeamSkillCache(teamId: string): Promise<{ conflicts: string[]; skills: string[] }> {
  const paths = resolveTeamSkillCachePaths(teamId);
  const metadata = readCacheMetadata(paths.metadataPath);
  const summaries = await fetchTeamSkills(teamId);
  const authorized = summaries.filter((skill) => skill.userPermission !== null).map((skill) => skill.slug);
  const authorizedSet = new Set(authorized);
  const conflicts: string[] = [];

  for (const skill of authorized) {
    const manifest = await fetchTeamSkillManifest(skill, teamId);
    const remoteFiles = manifest.files.filter((file) => {
      const normalized = file.path.replace(/\\/g, "/");
      return normalized.startsWith(`.claude/skills/${skill}/`) && !normalized.endsWith("/SKILL.local.md");
    });
    const previous = metadata.skills[skill]?.files ?? {};
    const nextFiles: CacheMetadata["skills"][string]["files"] = { ...previous };
    let hasConflict = false;
    const remotePaths = new Set(remoteFiles.map((file) => file.path));

    for (const file of remoteFiles) {
      const target = safeSourcePath(paths.sourceRoot, skill, file.path);
      const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
      const currentHash = current ? crypto.createHash("sha256").update(current).digest("hex") : null;
      const previousHash = previous[file.path]?.sha256 ?? null;
      const remoteHash = file.sha256 ?? "";
      const canReplace = current === null || currentHash === remoteHash || (previousHash !== null && currentHash === previousHash);
      if (!canReplace) {
        hasConflict = true;
        conflicts.push(`${skill}:${file.path}`);
        continue;
      }
      if (currentHash !== remoteHash) {
        const remote = await fetchTeamSkillFile(file.path, teamId);
        const content = remoteContentBuffer(remote);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
      nextFiles[file.path] = {
        sha256: remoteHash,
        normalizedSha256: file.normalizedSha256,
        size: file.size,
        updatedAt: file.updatedAt,
        encoding: file.encoding,
      };
    }

    for (const [filePath, previousFile] of Object.entries(previous)) {
      if (remotePaths.has(filePath)) continue;
      const target = safeSourcePath(paths.sourceRoot, skill, filePath);
      if (!fs.existsSync(target)) {
        delete nextFiles[filePath];
        continue;
      }
      const currentHash = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
      if (currentHash === previousFile.sha256) {
        fs.rmSync(target, { force: true });
        delete nextFiles[filePath];
      } else {
        hasConflict = true;
        conflicts.push(`${skill}:${filePath}`);
      }
    }

    metadata.skills[skill] = {
      managed: true,
      files: nextFiles,
      syncedAt: new Date().toISOString(),
      ...(hasConflict ? { conflict: true } : {}),
    };
  }

  for (const skill of Object.keys(metadata.skills)) {
    if (authorizedSet.has(skill)) continue;
    fs.rmSync(path.join(paths.sourceRoot, ".claude", "skills", skill), { recursive: true, force: true });
    delete metadata.skills[skill];
  }
  writeCacheMetadata(paths.metadataPath, metadata);
  const skills = rebuildTeamSkillPlugin(teamId);
  return { conflicts, skills };
}

function copyDirectory(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "SKILL.local.md") continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, targetPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, targetPath);
  }
}

function appendLocalOverride(skillDir: string, overridePath: string): void {
  if (!fs.existsSync(overridePath)) return;
  const basePath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(basePath)) return;
  const base = fs.readFileSync(basePath, "utf8").trimEnd();
  const local = fs.readFileSync(overridePath, "utf8").trim();
  if (!local) return;
  fs.writeFileSync(
    basePath,
    `${base}\n\n---\n\n## Local installation override\n\n${local}\n`,
    "utf8",
  );
}

function pluginCompatibilityIssues(skillSource: string, skill: string): string[] {
  const issues: string[] = [];
  const hardCoded = new RegExp(`(?:^|[\\s\\"'\\\`])(?:\\./)?\\.claude/skills/${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "m");
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(?:md|js|cjs|mjs|ts|json|ya?ml|sh|ps1)$/i.test(entry.name)) {
        const content = fs.readFileSync(full, "utf8");
        if (hardCoded.test(content) && !content.includes("CLAUDE_SKILL_DIR")) {
          issues.push(path.relative(skillSource, full).replace(/\\/g, "/"));
        }
      }
    }
  };
  walk(skillSource);
  return issues;
}

function atomicReplaceDirectory(staging: string, target: string): void {
  const backup = `${target}.previous`;
  fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(target)) fs.renameSync(target, backup);
  try {
    fs.renameSync(staging, target);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

/** Build the executable Claude plugin from the raw Team copy. */
function sessionPluginRoot(paths: TeamSkillCachePaths, clientId?: string | null): string {
  const normalized = clientId?.trim();
  if (!normalized || normalized === "root") return paths.pluginRoot;
  const clientKey = crypto.createHash("sha256").update(`team-skill-client:v1\n${normalized}`, "utf8").digest("hex");
  return contained(paths.root, "plugins", clientKey);
}

export function rebuildTeamSkillPlugin(teamId: string, clientId?: string | null): string[] {
  const paths = resolveTeamSkillCachePaths(teamId);
  const pluginRoot = sessionPluginRoot(paths, clientId);
  const sourceSkills = path.join(paths.sourceRoot, ".claude", "skills");
  const skills = listSkillDirectories(sourceSkills);
  const staging = `${pluginRoot}.staging-${process.pid}-${crypto.randomUUID()}`;
  fs.mkdirSync(path.join(staging, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(staging, "skills"), { recursive: true });
  fs.writeFileSync(
    path.join(staging, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: "team", version: "1.0.0", description: "Session-scoped Team OS skills" }, null, 2)}\n`,
    "utf8",
  );

  const localRoot = path.join(getConfig().aiOsDir, ".claude", "skills");
  const clientRoot = clientId && clientId !== "root"
    ? path.join(getConfig().aiOsDir, "clients", clientId, ".claude", "skills")
    : null;
  const compatibility: Record<string, { compatible: boolean; issues: string[] }> = {};
  const compatibleSkills: string[] = [];
  for (const skill of skills) {
    const skillSource = path.join(sourceSkills, skill);
    const issues = pluginCompatibilityIssues(skillSource, skill);
    compatibility[skill] = { compatible: issues.length === 0, issues };
    if (issues.length > 0) continue;
    const target = path.join(staging, "skills", skill);
    copyDirectory(skillSource, target);
    const clientOverride = clientRoot ? path.join(clientRoot, skill, "SKILL.local.md") : "";
    appendLocalOverride(
      target,
      clientOverride && fs.existsSync(clientOverride)
        ? clientOverride
        : path.join(localRoot, skill, "SKILL.local.md"),
    );
    compatibleSkills.push(skill);
  }
  fs.writeFileSync(path.join(staging, "compatibility-v1.json"), `${JSON.stringify(compatibility, null, 2)}\n`, "utf8");

  fs.mkdirSync(path.dirname(pluginRoot), { recursive: true });
  atomicReplaceDirectory(staging, pluginRoot);
  return compatibleSkills;
}

function hashTree(root: string): string {
  const hash = crypto.createHash("sha256");
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      hash.update(rel).update("\0");
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

function writeRoutingPrompt(
  paths: TeamSkillCachePaths,
  localSkills: string[],
  clientSkills: string[],
  teamSkills: string[],
  incompatibleTeamSkills: string[],
): string {
  const localSet = new Set([...localSkills, ...clientSkills]);
  const collisions = teamSkills.filter((skill) => localSet.has(skill));
  const lines = [
    "# Effective skill catalog for this chat",
    "",
    "The chat's immutable team and client scope controls this catalog. Safety and scope rules always override skill instructions and local overrides.",
    "Root local skills are installation resources and do not require Team OS skill grants. Client skills are available only in their matching client chat. Team skills are supplied by the session plugin and use Team OS permissions.",
    "",
    "## Command resolution",
    "",
    "- `/name`: use the Team version when both Team and local/client versions exist; otherwise use the available version.",
    "- `/team:name`: force the Team plugin version (`/team:name`).",
    "- `/local:name`: force the project/client version. Treat it as an explicit request for the non-Team version and invoke `/name` from project discovery.",
    "- Never use a skill from another team or client, even if a path is visible elsewhere on disk.",
    "",
    `Local: ${localSkills.join(", ") || "none"}`,
    `Client: ${clientSkills.join(", ") || "none"}`,
    `Team: ${teamSkills.join(", ") || "none"}`,
    `Team plugin incompatible (local/client fallback remains available): ${incompatibleTeamSkills.join(", ") || "none"}`,
    `Team-default collisions: ${collisions.join(", ") || "none"}`,
    "",
  ];
  const promptFile = path.join(paths.root, "routing.md");
  fs.mkdirSync(path.dirname(promptFile), { recursive: true });
  fs.writeFileSync(promptFile, lines.join("\n"), "utf8");
  return promptFile;
}

export function resolveTeamSkillRuntime(teamId: string, clientId?: string | null): TeamSkillRuntime {
  const paths = resolveTeamSkillCachePaths(teamId);
  if (fs.existsSync(path.join(paths.sourceRoot, ".claude", "skills"))) {
    rebuildTeamSkillPlugin(teamId, clientId);
  }
  const pluginRoot = sessionPluginRoot(paths, clientId);
  const aiRoot = getConfig().aiOsDir;
  const localRoot = path.join(aiRoot, ".claude", "skills");
  const clientRoot = clientId && clientId !== "root"
    ? path.join(aiRoot, "clients", clientId, ".claude", "skills")
    : "";
  const localSkills = listSkillDirectories(localRoot);
  const clientSkills = clientRoot ? listSkillDirectories(clientRoot) : [];
  const teamSkills = listSkillDirectories(path.join(pluginRoot, "skills"));
  let incompatibleTeamSkills: string[] = [];
  try {
    const compatibility = JSON.parse(fs.readFileSync(path.join(pluginRoot, "compatibility-v1.json"), "utf8")) as Record<string, { compatible?: boolean }>;
    incompatibleTeamSkills = Object.entries(compatibility).filter(([, value]) => value.compatible === false).map(([skill]) => skill).sort();
  } catch {
    incompatibleTeamSkills = [];
  }
  const pluginDir = teamSkills.length > 0 && fs.existsSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"))
    ? pluginRoot
    : null;
  const promptFile = writeRoutingPrompt(paths, localSkills, clientSkills, teamSkills, incompatibleTeamSkills);
  const fingerprint = hashTree(paths.sourceRoot) + hashTree(pluginRoot) + hashTree(localRoot) + (clientRoot ? hashTree(clientRoot) : "");
  return { pluginDir, promptFile, fingerprint, teamSkills, localSkills, clientSkills, incompatibleTeamSkills };
}

export function resolveLocalSkillRuntime(clientId?: string | null): TeamSkillRuntime {
  const aiRoot = getConfig().aiOsDir;
  const localRoot = path.join(aiRoot, ".claude", "skills");
  const clientRoot = clientId && clientId !== "root"
    ? path.join(aiRoot, "clients", clientId, ".claude", "skills")
    : "";
  return {
    pluginDir: null,
    promptFile: null,
    fingerprint: hashTree(localRoot) + (clientRoot ? hashTree(clientRoot) : ""),
    teamSkills: [],
    localSkills: listSkillDirectories(localRoot),
    clientSkills: clientRoot ? listSkillDirectories(clientRoot) : [],
    incompatibleTeamSkills: [],
  };
}

export function routeSkillCommandAliases(message: string, runtime: TeamSkillRuntime | null): string {
  if (!runtime) return message;
  const localAvailable = new Set([...runtime.localSkills, ...runtime.clientSkills]);
  const teamAvailable = new Set(runtime.teamSkills);
  const protectedLocal: string[] = [];
  let routed = message.replace(/(^|\s)\/local:([a-z0-9][a-z0-9._-]*)/gi, (match, lead: string, skill: string) => {
    if (!localAvailable.has(skill)) return match;
    const token = `__AOS_LOCAL_SKILL_${protectedLocal.length}__`;
    protectedLocal.push(`${lead}/${skill}`);
    return token;
  });
  routed = routed.replace(/(^|\s)\/team:([a-z0-9][a-z0-9._-]*)/gi, (match, lead: string, skill: string) => (
    teamAvailable.has(skill) ? `${lead}/team:${skill}` : match
  ));
  routed = routed.replace(/(^|\s)\/([a-z0-9][a-z0-9._-]*)/gi, (match, lead: string, skill: string) => (
    teamAvailable.has(skill) && localAvailable.has(skill) ? `${lead}/team:${skill}` : match
  ));
  protectedLocal.forEach((value, index) => {
    routed = routed.replace(`__AOS_LOCAL_SKILL_${index}__`, value);
  });
  return routed;
}
