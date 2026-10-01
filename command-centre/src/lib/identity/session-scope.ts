/**
 * Canonical Team OS identity and immutable work-scope contract.
 *
 * AIOS-378 defines the contract only. Runtime persistence, request routing,
 * profile databases, and process ownership are implemented by follow-up issues.
 */

export const PROFILE_IDENTITY_VERSION = 1 as const;
export const SESSION_SCOPE_VERSION = 1 as const;

export interface ProfileIdentityV1 {
  readonly version: typeof PROFILE_IDENTITY_VERSION;
  readonly serverId: string;
  readonly userId: string;
}

export interface SessionScopeV1 extends ProfileIdentityV1 {
  readonly teamId: string;
  readonly clientId: string | null;
}

export interface SoloWorkScopeV1 {
  readonly mode: "solo";
  readonly version: typeof SESSION_SCOPE_VERSION;
  readonly clientId: string | null;
}

export interface TeamWorkScopeV1 {
  readonly mode: "team";
  readonly scope: SessionScopeV1;
}

export type StoredWorkScopeV1 = SoloWorkScopeV1 | TeamWorkScopeV1;

export type SessionScopeContractErrorCode =
  | "invalid_scope"
  | "unsupported_scope_version";

export class SessionScopeContractError extends Error {
  constructor(
    readonly code: SessionScopeContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionScopeContractError";
  }
}

export type SessionScopeInput = {
  serverId: string;
  userId: string;
  teamId: string;
  clientId?: string | null;
};

export type InterpretStoredWorkScopeOptions = {
  /** The client recorded on an old unscoped row. `root` means no client. */
  legacyClientId?: string | null;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionScopeContractError("invalid_scope", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readVersion(value: unknown, label: string): 1 {
  if (value !== SESSION_SCOPE_VERSION) {
    throw new SessionScopeContractError(
      "unsupported_scope_version",
      `${label} must use scope version ${SESSION_SCOPE_VERSION}`,
    );
  }
  return SESSION_SCOPE_VERSION;
}

function readIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new SessionScopeContractError(
      "invalid_scope",
      `${label} must be a non-empty canonical identifier`,
    );
  }
  return value;
}

function readClientId(value: unknown, label: string): string | null {
  if (value === null) return null;
  return readIdentifier(value, label);
}

function legacyClientId(value: string | null | undefined): string | null {
  if (value == null || value === "" || value === "root") return null;
  return readIdentifier(value, "legacyClientId");
}

function freezeProfileIdentity(input: ProfileIdentityV1): ProfileIdentityV1 {
  return Object.freeze(input);
}

function freezeSessionScope(input: SessionScopeV1): SessionScopeV1 {
  return Object.freeze(input);
}

export function createProfileIdentityV1(
  input: Omit<ProfileIdentityV1, "version">,
): ProfileIdentityV1 {
  return freezeProfileIdentity({
    version: PROFILE_IDENTITY_VERSION,
    serverId: readIdentifier(input.serverId, "serverId"),
    userId: readIdentifier(input.userId, "userId"),
  });
}

export function createSessionScopeV1(input: SessionScopeInput): SessionScopeV1 {
  return freezeSessionScope({
    version: SESSION_SCOPE_VERSION,
    serverId: readIdentifier(input.serverId, "serverId"),
    userId: readIdentifier(input.userId, "userId"),
    teamId: readIdentifier(input.teamId, "teamId"),
    clientId: readClientId(input.clientId ?? null, "clientId"),
  });
}

export function parseSessionScopeV1(value: unknown): SessionScopeV1 {
  const scope = asRecord(value, "session scope");
  readVersion(scope.version, "session scope");
  return createSessionScopeV1({
    serverId: readIdentifier(scope.serverId, "serverId"),
    userId: readIdentifier(scope.userId, "userId"),
    teamId: readIdentifier(scope.teamId, "teamId"),
    clientId: readClientId(scope.clientId, "clientId"),
  });
}

export function isSessionScopeV1(value: unknown): value is SessionScopeV1 {
  try {
    parseSessionScopeV1(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Interpret a persisted work-scope value.
 *
 * Only a genuinely absent legacy value (`null` or `undefined`) becomes Solo.
 * A present but malformed value throws so corrupted Team OS ownership can never
 * be exposed by silently downgrading it to Solo.
 */
export function interpretStoredWorkScope(
  value: unknown,
  options: InterpretStoredWorkScopeOptions = {},
): StoredWorkScopeV1 {
  if (value == null) {
    return Object.freeze({
      mode: "solo" as const,
      version: SESSION_SCOPE_VERSION,
      clientId: legacyClientId(options.legacyClientId),
    });
  }

  const record = asRecord(value, "stored work scope");
  if (record.mode === "solo") {
    readVersion(record.version, "Solo work scope");
    return Object.freeze({
      mode: "solo" as const,
      version: SESSION_SCOPE_VERSION,
      clientId: readClientId(record.clientId, "clientId"),
    });
  }

  if (record.mode === "team") {
    return Object.freeze({
      mode: "team" as const,
      scope: parseSessionScopeV1(record.scope),
    });
  }

  throw new SessionScopeContractError(
    "invalid_scope",
    "stored work scope mode must be solo or team",
  );
}

export function sameProfileIdentity(
  left: Pick<ProfileIdentityV1, "serverId" | "userId">,
  right: Pick<ProfileIdentityV1, "serverId" | "userId">,
): boolean {
  return left.serverId === right.serverId && left.userId === right.userId;
}
