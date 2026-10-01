import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { LocalProfileDescriptorV1 } from "./local-profile";

export const LOCAL_PROFILE_KEY_HEADER = "x-AI-OS-profile-key";
export const LOCAL_PROFILE_SESSION_HEADER = "x-AI-OS-profile-session";
export const LOCAL_PROFILE_SOURCE_HEADER = "x-AI-OS-profile-source";
export const LOCAL_PROFILE_CLEANUP_MARKER = "cleanup-pending-v1.json";

export type LocalProfileLifecycleState = "active" | "closing" | "closed";

export interface LocalProfileRuntimeSessionV1 {
  readonly version: 1;
  readonly profileKey: string;
  readonly sessionId: string;
  readonly state: LocalProfileLifecycleState;
  readonly activatedAt: string;
}

interface MutableRuntimeSession {
  version: 1;
  profileKey: string;
  sessionId: string;
  state: LocalProfileLifecycleState;
  activatedAt: string;
}

export interface LocalProfileCleanupMarkerV1 {
  version: 1;
  profileKey: string;
  state: "closing";
  startedAt: string;
  pending: string[];
}

type LifecycleGlobal = typeof globalThis & {
  __commandCentreProfileLifecycle?: Map<string, MutableRuntimeSession>;
};

const lifecycleGlobal = globalThis as LifecycleGlobal;
const sessions = lifecycleGlobal.__commandCentreProfileLifecycle
  ?? new Map<string, MutableRuntimeSession>();
lifecycleGlobal.__commandCentreProfileLifecycle = sessions;

export class LocalProfileRequestError extends Error {
  constructor(
    readonly status: 409 | 423,
    readonly code: "stale_profile_session" | "profile_closing",
    message: string,
  ) {
    super(message);
    this.name = "LocalProfileRequestError";
  }
}

function cleanupMarkerPath(descriptor: LocalProfileDescriptorV1): string {
  return path.join(descriptor.stateDir, LOCAL_PROFILE_CLEANUP_MARKER);
}

function hasCleanupMarker(descriptor: LocalProfileDescriptorV1): boolean {
  return descriptor.mode === "team" && fs.existsSync(cleanupMarkerPath(descriptor));
}

function snapshot(session: MutableRuntimeSession): LocalProfileRuntimeSessionV1 {
  return Object.freeze({ ...session });
}

export function getLocalProfileRuntimeSession(
  descriptor: LocalProfileDescriptorV1,
): LocalProfileRuntimeSessionV1 {
  const existing = sessions.get(descriptor.profileKey);
  if (existing) {
    if (hasCleanupMarker(descriptor) && existing.state === "active") {
      existing.state = "closing";
    }
    return snapshot(existing);
  }

  const created: MutableRuntimeSession = {
    version: 1,
    profileKey: descriptor.profileKey,
    sessionId: crypto.randomUUID(),
    state: hasCleanupMarker(descriptor) ? "closing" : "active",
    activatedAt: new Date().toISOString(),
  };
  sessions.set(descriptor.profileKey, created);
  return snapshot(created);
}

export function activateLocalProfile(
  descriptor: LocalProfileDescriptorV1,
  options: { rotate?: boolean } = {},
): LocalProfileRuntimeSessionV1 {
  if (hasCleanupMarker(descriptor)) {
    throw new LocalProfileRequestError(
      423,
      "profile_closing",
      "This local profile is still completing secure cleanup.",
    );
  }
  const current = sessions.get(descriptor.profileKey);
  if (current && current.state === "active" && !options.rotate) return snapshot(current);
  const next: MutableRuntimeSession = {
    version: 1,
    profileKey: descriptor.profileKey,
    sessionId: crypto.randomUUID(),
    state: "active",
    activatedAt: new Date().toISOString(),
  };
  sessions.set(descriptor.profileKey, next);
  return snapshot(next);
}

export function beginLocalProfileClosing(
  descriptor: LocalProfileDescriptorV1,
): LocalProfileCleanupMarkerV1 {
  const current = sessions.get(descriptor.profileKey) ?? {
    version: 1 as const,
    profileKey: descriptor.profileKey,
    sessionId: crypto.randomUUID(),
    state: "active" as const,
    activatedAt: new Date().toISOString(),
  };
  current.state = "closing";
  current.sessionId = crypto.randomUUID();
  sessions.set(descriptor.profileKey, current);

  const marker: LocalProfileCleanupMarkerV1 = {
    version: 1,
    profileKey: descriptor.profileKey,
    state: "closing",
    startedAt: new Date().toISOString(),
    pending: [],
  };
  if (descriptor.mode === "team") {
    fs.mkdirSync(descriptor.stateDir, { recursive: true });
    const markerPath = cleanupMarkerPath(descriptor);
    const temporaryPath = `${markerPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, markerPath);
  }
  return marker;
}

export function finishLocalProfileClosing(
  descriptor: LocalProfileDescriptorV1,
  pending: string[],
): void {
  const current = sessions.get(descriptor.profileKey);
  if (current) current.state = "closed";
  if (descriptor.mode !== "team") return;

  const markerPath = cleanupMarkerPath(descriptor);
  if (pending.length === 0) {
    fs.rmSync(markerPath, { force: true });
    return;
  }
  const marker: LocalProfileCleanupMarkerV1 = {
    version: 1,
    profileKey: descriptor.profileKey,
    state: "closing",
    startedAt: new Date().toISOString(),
    pending: [...new Set(pending)].sort(),
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
}

export function assertLocalProfileActive(descriptor: LocalProfileDescriptorV1): void {
  const runtime = getLocalProfileRuntimeSession(descriptor);
  if (runtime.state !== "active") {
    throw new LocalProfileRequestError(
      423,
      "profile_closing",
      "This local profile is closing and cannot accept new work.",
    );
  }
}

export function assertLocalProfileRequest(
  descriptor: LocalProfileDescriptorV1,
  headers: Pick<Headers, "get">,
): void {
  assertLocalProfileActive(descriptor);
  const runtime = getLocalProfileRuntimeSession(descriptor);
  const suppliedProfileKey = headers.get(LOCAL_PROFILE_KEY_HEADER)?.trim() ?? "";
  const suppliedSessionId = headers.get(LOCAL_PROFILE_SESSION_HEADER)?.trim() ?? "";
  const source = headers.get(LOCAL_PROFILE_SOURCE_HEADER)?.trim() ?? "";

  if (source === "hook" || source === "process") {
    if (suppliedProfileKey === descriptor.profileKey && !suppliedSessionId) return;
  }

  if (
    suppliedProfileKey !== descriptor.profileKey
    || suppliedSessionId !== runtime.sessionId
  ) {
    throw new LocalProfileRequestError(
      409,
      "stale_profile_session",
      "This browser tab belongs to an older local profile session. Reload the application.",
    );
  }
}

export function localProfileRequestErrorBody(error: LocalProfileRequestError): {
  error: { code: LocalProfileRequestError["code"]; message: string };
} {
  return { error: { code: error.code, message: error.message } };
}

export function resetLocalProfileLifecycleForTesting(): void {
  sessions.clear();
}
