import { normalizeClientId } from "@/lib/clients";
import { getActiveLocalProfileDescriptor } from "@/lib/db";
import type { LocalProfileDescriptorV1 } from "@/lib/local-profile";
import { readTeamContext } from "@/lib/team-api-context";
import {
  SESSION_SCOPE_VERSION,
  createSessionScopeV1,
  interpretStoredWorkScope,
  sameProfileIdentity,
  type StoredWorkScopeV1,
} from "./session-scope";

export type WorkScopeErrorCode =
  | "invalid_scope_input"
  | "invalid_work_scope"
  | "team_context_unavailable";

export class WorkScopeError extends Error {
  constructor(
    readonly code: WorkScopeErrorCode,
    readonly status: 400 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = "WorkScopeError";
  }
}

export interface WorkScopedDatabaseRow {
  clientId?: string | null;
  workScope?: string | StoredWorkScopeV1 | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeScopeClientId(value: string | null | undefined): string | null {
  return normalizeClientId(value);
}

function parseStoredValue(
  value: string | StoredWorkScopeV1 | null | undefined,
): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new WorkScopeError(
      "invalid_work_scope",
      409,
      "The saved work scope is corrupted and cannot be used safely.",
    );
  }
}

export function serializeStoredWorkScope(scope: StoredWorkScopeV1): string {
  return JSON.stringify(scope);
}

export function getStoredWorkScopeClientId(scope: StoredWorkScopeV1): string | null {
  return scope.mode === "team" ? scope.scope.clientId : scope.clientId;
}

export function sameStoredWorkScope(
  left: StoredWorkScopeV1,
  right: StoredWorkScopeV1,
): boolean {
  return serializeStoredWorkScope(left) === serializeStoredWorkScope(right);
}

export function createSoloStoredWorkScope(
  clientId: string | null | undefined,
): StoredWorkScopeV1 {
  return Object.freeze({
    mode: "solo" as const,
    version: SESSION_SCOPE_VERSION,
    clientId: normalizeScopeClientId(clientId),
  });
}

export function parseStoredWorkScope(
  value: string | StoredWorkScopeV1 | null | undefined,
  legacyClientId?: string | null,
): StoredWorkScopeV1 {
  try {
    return interpretStoredWorkScope(parseStoredValue(value), { legacyClientId });
  } catch (error) {
    if (error instanceof WorkScopeError) throw error;
    throw new WorkScopeError(
      "invalid_work_scope",
      409,
      error instanceof Error
        ? `The saved work scope is invalid: ${error.message}`
        : "The saved work scope is invalid.",
    );
  }
}

export function assertWorkScopeMatchesProfile(
  scope: StoredWorkScopeV1,
  descriptor: LocalProfileDescriptorV1 = getActiveLocalProfileDescriptor(),
): void {
  if (scope.mode === "solo") return;
  if (
    descriptor.mode !== "team"
    || !sameProfileIdentity(scope.scope, descriptor.identity)
  ) {
    throw new WorkScopeError(
      "invalid_work_scope",
      409,
      "This work belongs to a different local Team OS profile.",
    );
  }
}

export function readWorkScopeFromRow(
  row: WorkScopedDatabaseRow,
  descriptor: LocalProfileDescriptorV1 = getActiveLocalProfileDescriptor(),
): StoredWorkScopeV1 {
  const scope = parseStoredWorkScope(row.workScope, row.clientId ?? null);
  assertWorkScopeMatchesProfile(scope, descriptor);
  if (
    normalizeScopeClientId(row.clientId)
    !== normalizeScopeClientId(getStoredWorkScopeClientId(scope))
  ) {
    throw new WorkScopeError(
      "invalid_work_scope",
      409,
      "The saved client does not match the immutable work scope.",
    );
  }
  return scope;
}

export function normalizeWorkScopedRow<T extends WorkScopedDatabaseRow>(
  row: T,
  descriptor: LocalProfileDescriptorV1 = getActiveLocalProfileDescriptor(),
): Omit<T, "workScope"> & { workScope: StoredWorkScopeV1 } {
  return {
    ...row,
    workScope: readWorkScopeFromRow(row, descriptor),
  };
}

export function inheritWorkScope(
  row: WorkScopedDatabaseRow,
  descriptor: LocalProfileDescriptorV1 = getActiveLocalProfileDescriptor(),
): { scope: StoredWorkScopeV1; serialized: string; clientId: string | null } {
  const scope = readWorkScopeFromRow(row, descriptor);
  return {
    scope,
    serialized: serializeStoredWorkScope(scope),
    clientId: getStoredWorkScopeClientId(scope),
  };
}

export function assertNoWorkScopeInput(body: unknown): void {
  const record = asRecord(body);
  if (!record) return;
  if (
    Object.hasOwn(record, "workScope")
    || Object.hasOwn(record, "serverId")
    || Object.hasOwn(record, "userId")
    || Object.hasOwn(record, "teamId")
  ) {
    throw new WorkScopeError(
      "invalid_scope_input",
      400,
      "Work identity and team scope are assigned by the server and cannot be supplied by the client.",
    );
  }
}

function requireTeamContextIdentity(
  descriptor: Extract<LocalProfileDescriptorV1, { mode: "team" }>,
  config: Awaited<ReturnType<typeof readTeamContext>>,
): { teamId: string } {
  if (!config) {
    throw new WorkScopeError(
      "team_context_unavailable",
      503,
      "Team OS context is unavailable. Reconnect before creating Team work.",
    );
  }
  if (config.expiresAt && Date.parse(config.expiresAt) <= Date.now()) {
    throw new WorkScopeError(
      "team_context_unavailable",
      503,
      "The Team OS login expired. Sign in again before creating Team work.",
    );
  }

  const user = asRecord(config.user);
  const userId = typeof user?.id === "string" ? user.id : "";
  const serverId = typeof config.serverId === "string" ? config.serverId : "";
  const teamId = typeof config.selectedTeamId === "string"
    ? config.selectedTeamId.trim()
    : "";
  const confirmedTeam = config.teams?.some((team) => team.id === teamId) === true;

  if (
    serverId !== descriptor.identity.serverId
    || userId !== descriptor.identity.userId
    || !teamId
    || !confirmedTeam
  ) {
    throw new WorkScopeError(
      "team_context_unavailable",
      503,
      "The saved Team OS identity or selected team is not confirmed for this local profile.",
    );
  }
  return { teamId };
}

export async function captureNewWorkScope(
  clientId: string | null | undefined,
): Promise<{ scope: StoredWorkScopeV1; serialized: string; clientId: string | null }> {
  const descriptor = getActiveLocalProfileDescriptor();
  const normalizedClientId = normalizeScopeClientId(clientId);

  if (descriptor.mode === "solo") {
    const scope = createSoloStoredWorkScope(normalizedClientId);
    return { scope, serialized: serializeStoredWorkScope(scope), clientId: normalizedClientId };
  }

  const config = await readTeamContext();
  const { teamId } = requireTeamContextIdentity(descriptor, config);
  const scope: StoredWorkScopeV1 = Object.freeze({
    mode: "team" as const,
    scope: createSessionScopeV1({
      serverId: descriptor.identity.serverId,
      userId: descriptor.identity.userId,
      teamId,
      clientId: normalizedClientId,
    }),
  });
  return { scope, serialized: serializeStoredWorkScope(scope), clientId: normalizedClientId };
}

export function getTeamIdForWorkScope(scope: StoredWorkScopeV1): string | null {
  return scope.mode === "team" ? scope.scope.teamId : null;
}

export function requestWithWorkScope(
  request: NextRequest,
  scope: StoredWorkScopeV1,
): NextRequest {
  if (scope.mode !== "team") return request;
  const headers = new Headers(request.headers);
  headers.set("x-ai-team-id", scope.scope.teamId);
  return new NextRequest(request.url, {
    method: request.method,
    headers,
  });
}

export function buildWorkScopeEnvironment(
  scope: StoredWorkScopeV1,
  profileKey: string,
): Record<string, string> {
  const env: Record<string, string> = {
    AI_OS_WORK_SCOPE_VERSION: String(SESSION_SCOPE_VERSION),
    AI_OS_WORK_MODE: scope.mode,
    AI_OS_PROFILE_KEY: profileKey,
    AI_OS_CLIENT_ID: getStoredWorkScopeClientId(scope) ?? "",
    AI_OS_SERVER_ID: "",
    AI_OS_USER_ID: "",
    AI_OS_TEAM_ID: "",
  };
  if (scope.mode === "team") {
    env.AI_OS_SERVER_ID = scope.scope.serverId;
    env.AI_OS_USER_ID = scope.scope.userId;
    env.AI_OS_TEAM_ID = scope.scope.teamId;
  }
  return env;
}

export function workScopeErrorBody(error: WorkScopeError): {
  code: WorkScopeErrorCode;
  error: string;
} {
  return { code: error.code, error: error.message };
}

export function isWorkScopeError(error: unknown): error is WorkScopeError {
  return error instanceof WorkScopeError;
}
import { NextRequest } from "next/server";
