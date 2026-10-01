import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getConfig } from "./config";
import { getActiveLocalProfileDescriptor } from "./db";
import type { TeamLocalProfileDescriptorV1 } from "./local-profile";

interface MaterializedOwnerV1 {
  version: 1;
  relativePath: string;
  profileKey: string;
  identityDigest: string;
  scope: "team" | "client" | "private" | "skill" | "config";
  kind: string;
  contentSha256: string;
  updatedAt: string;
}

interface MaterializedOwnershipRegistryV1 {
  version: 1;
  files: Record<string, MaterializedOwnerV1>;
}

export class MaterializedFileAccessError extends Error {
  readonly status = 404;
  readonly code = "file_not_found";

  constructor() {
    super("File not found");
    this.name = "MaterializedFileAccessError";
  }
}

function registryPath(): string {
  return path.join(getConfig().dataDir, "materialized-ownership-v1.json");
}

function normalizeOwnedPath(absolutePath: string): string {
  const root = path.resolve(getConfig().aiOsDir);
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Materialized path is outside the workspace");
  }
  return relative.replace(/\\/g, "/");
}

function readRegistry(): MaterializedOwnershipRegistryV1 {
  try {
    const value = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    if (value?.version === 1 && value.files && typeof value.files === "object") {
      return value as MaterializedOwnershipRegistryV1;
    }
  } catch {
    // Legacy workspaces start with no assigned ownership.
  }
  return { version: 1, files: {} };
}

function writeRegistry(registry: MaterializedOwnershipRegistryV1): void {
  const target = registryPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function currentTeamProfile(): TeamLocalProfileDescriptorV1 | null {
  const profile = getActiveLocalProfileDescriptor();
  if (profile.mode !== "team") return null;
  return profile;
}

export function registerMaterializedFiles(
  absolutePaths: string[],
  options: { scope: MaterializedOwnerV1["scope"]; kind: string },
): void {
  if (absolutePaths.length === 0) return;
  const profile = currentTeamProfile();
  if (!profile) return;
  const registry = readRegistry();
  const now = new Date().toISOString();
  for (const absolutePath of absolutePaths) {
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
    const relativePath = normalizeOwnedPath(absolutePath);
    registry.files[relativePath] = {
      version: 1,
      relativePath,
      profileKey: profile.profileKey,
      identityDigest: crypto.createHash("sha256")
        .update(`materialized-owner:v1\n${profile.identity.serverId}\n${profile.identity.userId}`)
        .digest("hex"),
      scope: options.scope,
      kind: options.kind,
      contentSha256: crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex"),
      updatedAt: now,
    };
  }
  writeRegistry(registry);
}

export function removeMaterializedOwnership(absolutePaths: string[]): void {
  if (absolutePaths.length === 0) return;
  const profile = getActiveLocalProfileDescriptor();
  const registry = readRegistry();
  let changed = false;
  for (const absolutePath of absolutePaths) {
    const relativePath = normalizeOwnedPath(absolutePath);
    if (registry.files[relativePath]?.profileKey !== profile.profileKey) continue;
    delete registry.files[relativePath];
    changed = true;
  }
  if (changed) writeRegistry(registry);
}

export function isMaterializedPathAccessible(absolutePath: string): boolean {
  let relativePath: string;
  try { relativePath = normalizeOwnedPath(absolutePath); } catch { return false; }
  const registry = readRegistry();
  const owner = registry.files[relativePath];
  const activeProfile = getActiveLocalProfileDescriptor();
  if (!owner && fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
    const prefix = `${relativePath}/`;
    const ownedDescendants = Object.values(registry.files)
      .filter((entry) => entry.relativePath.startsWith(prefix));
    if (activeProfile.mode === "team") {
      return ownedDescendants.some((entry) => entry.profileKey === activeProfile.profileKey);
    }
    if (ownedDescendants.length === 0) return true;
    const stack = [absolutePath];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(child);
          continue;
        }
        if (!entry.isFile()) continue;
        const childRelative = normalizeOwnedPath(child);
        if (!registry.files[childRelative]) return true;
      }
    }
    return false;
  }
  if (!owner) return activeProfile.mode === "solo";
  return owner.profileKey === activeProfile.profileKey;
}

export function assertMaterializedPathAccessible(absolutePath: string): void {
  if (!isMaterializedPathAccessible(absolutePath)) throw new MaterializedFileAccessError();
}

export function assertMaterializedPathWritable(absolutePath: string): void {
  let relativePath: string;
  try { relativePath = normalizeOwnedPath(absolutePath); } catch { throw new MaterializedFileAccessError(); }
  const activeProfile = getActiveLocalProfileDescriptor();
  const owner = readRegistry().files[relativePath];
  if (owner && owner.profileKey !== activeProfile.profileKey) throw new MaterializedFileAccessError();
  if (!owner && fs.existsSync(absolutePath) && activeProfile.mode !== "solo") {
    throw new MaterializedFileAccessError();
  }
}

export function cleanupManagedMaterializedCredentials(
  profile: TeamLocalProfileDescriptorV1,
): void {
  const registry = readRegistry();
  let changed = false;
  for (const [relativePath, owner] of Object.entries(registry.files)) {
    if (owner.profileKey !== profile.profileKey || owner.scope !== "config") continue;
    const absolutePath = path.join(getConfig().aiOsDir, relativePath);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      const current = fs.readFileSync(absolutePath);
      const currentHash = crypto.createHash("sha256").update(current).digest("hex");
      if (currentHash !== owner.contentSha256) {
        const recoveryDir = path.join(profile.dataDir, "recovery", "managed-config");
        fs.mkdirSync(recoveryDir, { recursive: true });
        const recoveryName = `${path.basename(relativePath)}.${new Date().toISOString().replace(/[:.]/g, "-")}`;
        fs.writeFileSync(path.join(recoveryDir, recoveryName), current, { mode: 0o600 });
      }
      fs.rmSync(absolutePath, { force: true });
    }
    delete registry.files[relativePath];
    changed = true;
  }
  if (changed) writeRegistry(registry);
}
