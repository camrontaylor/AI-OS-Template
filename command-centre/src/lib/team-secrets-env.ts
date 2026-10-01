import fs from "node:fs/promises";
import path from "node:path";

import type { TeamSecretValue, TeamSecretsSyncPayload } from "./team-api-context";
import { getLocalProfileStatePath, resolveLocalProfileDescriptor, type LocalProfileDescriptorV1 } from "./local-profile";

export const TEAMOS_SECRETS_BEGIN = "# BEGIN TEAMOS MANAGED SECRETS";
export const TEAMOS_SECRETS_END = "# END TEAMOS MANAGED SECRETS";

interface ManagedEnvTarget {
  filePath: string;
  label: string;
  secrets: TeamSecretValue[];
}

interface SecretSyncMetadata {
  version: 1;
  files: Record<string, { label: string; keys: string[]; syncedAt: string }>;
}

export interface ManagedEnvConflict {
  filePath: string;
  label: string;
  keys: string[];
}

export interface ManagedEnvSyncResult {
  filesChanged: number;
  files: Array<{ filePath: string; label: string; keys: string[]; changed: boolean }>;
  conflicts: ManagedEnvConflict[];
}

function metadataPath(root: string): string {
  const profile = resolveLocalProfileDescriptor();
  return profile.mode === "solo"
    ? path.join(/*turbopackIgnore: true*/ root, ".command-centre", "team-secrets-sync.json")
    : getLocalProfileStatePath("team-secrets-sync.json");
}

async function readMetadata(root: string): Promise<SecretSyncMetadata> {
  try {
    const parsed = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ metadataPath(root), "utf-8"));
    if (parsed?.version === 1 && parsed.files && typeof parsed.files === "object") {
      return parsed as SecretSyncMetadata;
    }
  } catch {
    // First sync or unreadable metadata: start clean.
  }
  return { version: 1, files: {} };
}

async function writeMetadata(root: string, metadata: SecretSyncMetadata): Promise<void> {
  const filePath = metadataPath(root);
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(filePath), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ filePath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(/*turbopackIgnore: true*/ filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function normalizeNewline(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function withoutManagedBlock(content: string): string {
  const normalized = normalizeNewline(content);
  const begin = normalized.indexOf(TEAMOS_SECRETS_BEGIN);
  if (begin === -1) return normalized;
  const end = normalized.indexOf(TEAMOS_SECRETS_END, begin);
  if (end === -1) return normalized.slice(0, begin).trimEnd() + "\n";
  const after = end + TEAMOS_SECRETS_END.length;
  return `${normalized.slice(0, begin).trimEnd()}\n${normalized.slice(after).replace(/^\n+/, "")}`.trimEnd() + "\n";
}

function envKeysOutsideManagedBlock(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of withoutManagedBlock(content).split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1].toUpperCase());
  }
  return keys;
}

function removeUserOwnedKeys(content: string, keys: Set<string>): string {
  return withoutManagedBlock(content)
    .split("\n")
    .filter((line) => {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return !match || !keys.has(match[1].toUpperCase());
    })
    .join("\n")
    .trimEnd() + "\n";
}

function serializeEnvValue(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function managedBlock(secrets: TeamSecretValue[]): string {
  if (secrets.length === 0) return "";
  const sorted = [...secrets].sort((a, b) => a.envKey.localeCompare(b.envKey));
  return [
    TEAMOS_SECRETS_BEGIN,
    "# Synced from TeamOS. Edit these in Team Settings, not here.",
    ...sorted.map((secret) => `${secret.envKey}=${serializeEnvValue(secret.value)}`),
    TEAMOS_SECRETS_END,
  ].join("\n");
}

function withManagedBlock(content: string, secrets: TeamSecretValue[], overwriteKeys: Set<string>): string {
  const base = overwriteKeys.size > 0 ? removeUserOwnedKeys(content, overwriteKeys) : withoutManagedBlock(content);
  const block = managedBlock(secrets);
  if (!block) return base.trimEnd() ? `${base.trimEnd()}\n` : "";
  return base.trimEnd() ? `${base.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

function payloadTargets(root: string, payload: TeamSecretsSyncPayload): ManagedEnvTarget[] {
  const targets: ManagedEnvTarget[] = [{
    filePath: path.join(/*turbopackIgnore: true*/ root, ".env"),
    label: "Team",
    secrets: payload.team.secrets,
  }];
  for (const client of payload.clients) {
    targets.push({
      filePath: path.join(/*turbopackIgnore: true*/ root, "clients", client.slug, ".env"),
      label: client.name || client.slug,
      secrets: client.secrets,
    });
  }
  return targets;
}

export async function syncTeamSecretsToManagedEnv(
  root: string,
  payload: TeamSecretsSyncPayload,
  options: { overwriteConflicts?: boolean } = {},
): Promise<ManagedEnvSyncResult> {
  const resolvedRoot = path.resolve(/*turbopackIgnore: true*/ root);
  const metadata = await readMetadata(resolvedRoot);
  const targetsByPath = new Map<string, ManagedEnvTarget>();
  for (const target of payloadTargets(resolvedRoot, payload)) {
    targetsByPath.set(path.resolve(target.filePath), target);
  }
  for (const [filePath, previous] of Object.entries(metadata.files)) {
    const resolved = path.resolve(filePath);
    if (!targetsByPath.has(resolved)) {
      targetsByPath.set(resolved, { filePath: resolved, label: previous.label, secrets: [] });
    }
  }

  const targetList = Array.from(targetsByPath.values());
  const conflicts: ManagedEnvConflict[] = [];
  const snapshots = new Map<string, string>();
  for (const target of targetList) {
    const content = await readTextFile(target.filePath);
    snapshots.set(target.filePath, content);
    const userKeys = envKeysOutsideManagedBlock(content);
    const targetKeys = target.secrets.map((secret) => secret.envKey.toUpperCase());
    const conflictKeys = targetKeys.filter((key) => userKeys.has(key));
    if (conflictKeys.length > 0) {
      conflicts.push({ filePath: target.filePath, label: target.label, keys: conflictKeys });
    }
  }

  if (conflicts.length > 0 && !options.overwriteConflicts) {
    return { filesChanged: 0, files: [], conflicts };
  }

  const files: ManagedEnvSyncResult["files"] = [];
  let filesChanged = 0;
  const nextMetadata: SecretSyncMetadata = { version: 1, files: {} };
  for (const target of targetList) {
    const content = snapshots.get(target.filePath) ?? "";
    const overwriteKeys = new Set(
      options.overwriteConflicts
        ? target.secrets.map((secret) => secret.envKey.toUpperCase())
        : [],
    );
    const nextContent = withManagedBlock(content, target.secrets, overwriteKeys);
    const changed = normalizeNewline(content) !== nextContent;
    if (changed) {
      await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(target.filePath), { recursive: true });
      await fs.writeFile(/*turbopackIgnore: true*/ target.filePath, nextContent, { mode: 0o600 });
      filesChanged += 1;
    }
    const keys = target.secrets.map((secret) => secret.envKey);
    if (keys.length > 0) {
      nextMetadata.files[target.filePath] = {
        label: target.label,
        keys,
        syncedAt: new Date().toISOString(),
      };
    }
    files.push({ filePath: target.filePath, label: target.label, keys, changed });
  }
  await writeMetadata(resolvedRoot, nextMetadata);
  return { filesChanged, files, conflicts: [] };
}

export async function cleanupManagedTeamSecrets(
  root: string,
  profile: LocalProfileDescriptorV1,
): Promise<{ filesChanged: number }> {
  if (profile.mode !== "team") return { filesChanged: 0 };
  const metadataFile = path.join(profile.stateDir, "team-secrets-sync.json");
  let metadata: SecretSyncMetadata;
  try {
    const parsed = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ metadataFile, "utf-8"));
    metadata = parsed?.version === 1 && parsed.files && typeof parsed.files === "object"
      ? parsed as SecretSyncMetadata
      : { version: 1, files: {} };
  } catch {
    return { filesChanged: 0 };
  }

  const resolvedRoot = path.resolve(/*turbopackIgnore: true*/ root);
  let filesChanged = 0;
  for (const [filePath, record] of Object.entries(metadata.files)) {
    const resolvedPath = path.resolve(/*turbopackIgnore: true*/ filePath);
    const relative = path.relative(resolvedRoot, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const current = await readTextFile(resolvedPath);
    const next = withoutManagedBlock(current);
    if (normalizeNewline(current) !== next) {
      await fs.writeFile(/*turbopackIgnore: true*/ resolvedPath, next, { mode: 0o600 });
      filesChanged += 1;
    }
    for (const key of record.keys) {
      if (typeof key === "string" && key in process.env) delete process.env[key];
    }
  }
  await fs.rm(/*turbopackIgnore: true*/ metadataFile, { force: true });
  return { filesChanged };
}
