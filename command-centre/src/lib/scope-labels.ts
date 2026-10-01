import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getLocalProfileStatePath } from "./local-profile";

export const SCOPE_LABELS_VERSION = 1 as const;

export interface KnownTeamLabel {
  id: string;
  name: string | null;
  slug: string | null;
  lastSeenAt: string;
}

export interface KnownClientLabel {
  teamId: string;
  clientId: string;
  name: string | null;
  lastSeenAt: string;
}

export interface ScopeLabelsV1 {
  version: typeof SCOPE_LABELS_VERSION;
  teams: KnownTeamLabel[];
  clients: KnownClientLabel[];
}

interface TeamLabelInput {
  id: string;
  name?: string | null;
  slug?: string | null;
}

interface ClientLabelInput {
  id?: string;
  slug: string;
  name?: string | null;
}

const EMPTY_SCOPE_LABELS: ScopeLabelsV1 = Object.freeze({
  version: SCOPE_LABELS_VERSION,
  teams: [],
  clients: [],
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseLabels(value: unknown): ScopeLabelsV1 | null {
  const record = asRecord(value);
  if (record?.version !== SCOPE_LABELS_VERSION) return null;

  const teams = Array.isArray(record.teams)
    ? record.teams.flatMap((item): KnownTeamLabel[] => {
        const team = asRecord(item);
        const id = nullableString(team?.id);
        const lastSeenAt = nullableString(team?.lastSeenAt);
        if (!id || !lastSeenAt) return [];
        return [{
          id,
          name: nullableString(team?.name),
          slug: nullableString(team?.slug),
          lastSeenAt,
        }];
      })
    : [];

  const clients = Array.isArray(record.clients)
    ? record.clients.flatMap((item): KnownClientLabel[] => {
        const client = asRecord(item);
        const teamId = nullableString(client?.teamId);
        const clientId = nullableString(client?.clientId);
        const lastSeenAt = nullableString(client?.lastSeenAt);
        if (!teamId || !clientId || !lastSeenAt) return [];
        return [{
          teamId,
          clientId,
          name: nullableString(client?.name),
          lastSeenAt,
        }];
      })
    : [];

  return { version: SCOPE_LABELS_VERSION, teams, clients };
}

function labelsPath(): string {
  return getLocalProfileStatePath("scope-labels-v1.json");
}

function atomicWrite(filePath: string, value: ScopeLabelsV1): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = fs.openSync(tempPath, "wx", 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tempPath, filePath);
}

export function readScopeLabels(): ScopeLabelsV1 {
  try {
    const parsed = parseLabels(JSON.parse(fs.readFileSync(labelsPath(), "utf8")));
    return parsed ?? { ...EMPTY_SCOPE_LABELS, teams: [], clients: [] };
  } catch {
    return { ...EMPTY_SCOPE_LABELS, teams: [], clients: [] };
  }
}

export function mergeScopeLabels(input: {
  teams: TeamLabelInput[];
  selectedTeamId: string | null;
  clients: ClientLabelInput[];
  now?: string;
}): ScopeLabelsV1 {
  const current = readScopeLabels();
  const now = input.now ?? new Date().toISOString();
  const teams = new Map(current.teams.map((team) => [team.id, team]));
  const clients = new Map(
    current.clients.map((client) => [`${client.teamId}\n${client.clientId}`, client]),
  );

  for (const rawTeam of input.teams) {
    const id = rawTeam.id.trim();
    if (!id) continue;
    const existing = teams.get(id);
    teams.set(id, {
      id,
      name: nullableString(rawTeam.name) ?? existing?.name ?? null,
      slug: nullableString(rawTeam.slug) ?? existing?.slug ?? null,
      lastSeenAt: now,
    });
  }

  const selectedTeamId = input.selectedTeamId?.trim() || null;
  if (selectedTeamId) {
    for (const rawClient of input.clients) {
      const clientId = rawClient.slug.trim();
      if (!clientId) continue;
      const key = `${selectedTeamId}\n${clientId}`;
      const existing = clients.get(key);
      clients.set(key, {
        teamId: selectedTeamId,
        clientId,
        name: nullableString(rawClient.name) ?? existing?.name ?? null,
        lastSeenAt: now,
      });
    }
  }

  const result: ScopeLabelsV1 = {
    version: SCOPE_LABELS_VERSION,
    teams: [...teams.values()].sort((a, b) => a.id.localeCompare(b.id)),
    clients: [...clients.values()].sort((a, b) =>
      a.teamId.localeCompare(b.teamId) || a.clientId.localeCompare(b.clientId),
    ),
  };
  atomicWrite(labelsPath(), result);
  return result;
}
