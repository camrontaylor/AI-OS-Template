import path from "node:path";

import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import {
  PermissionError,
  requireSkillAccess,
  resolvePrincipal,
  type Principal,
} from "./permissions";
import { openIdentityStore, type IdentityStore } from "./store";
import type { SkillPermission } from "./types";

export interface RequestPrincipalContext {
  store: IdentityStore;
  principal: Principal;
  close: () => Promise<void>;
}

export class RequestPrincipalError extends Error {
  constructor(
    readonly status: number,
    readonly code: "unauthorized" | "forbidden" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "RequestPrincipalError";
  }
}

function getRequestedTeamId(request: NextRequest): string | null {
  return (
    request.headers.get("x-ai-team-id")?.trim() ||
    request.nextUrl.searchParams.get("teamId")?.trim() ||
    null
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveTeamId(store: IdentityStore, ref: string): Promise<string | null> {
  const team = UUID_RE.test(ref) ? await store.getTeam(ref) : await store.getTeamBySlug(ref);
  return team?.id ?? null;
}

async function openAppIdentityStore(): Promise<IdentityStore> {
  const hostedUrl = (process.env.MEMORY_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  if (hostedUrl) {
    return openIdentityStore({});
  }

  const dataDir = path.join(getConfig().aiOsDir, ".command-centre", "memory");
  return openIdentityStore({ backend: "pglite", dataDir });
}

export async function resolveRequestPrincipalContext(
  request: NextRequest,
): Promise<RequestPrincipalContext> {
  const teamRef = getRequestedTeamId(request);
  if (!teamRef) {
    throw new RequestPrincipalError(401, "unauthorized", "teamId is required");
  }

  const session = await auth.api.getSession({ headers: request.headers });
  const email = session?.user?.email;
  if (!email) {
    throw new RequestPrincipalError(401, "unauthorized", "sign in is required");
  }

  const store = await openAppIdentityStore();
  try {
    const teamId = await resolveTeamId(store, teamRef);
    if (!teamId) {
      throw new RequestPrincipalError(403, "forbidden", "team membership is required");
    }

    const user = await store.getUserByEmail(email);
    if (!user || user.status !== "active") {
      throw new RequestPrincipalError(403, "forbidden", "team membership is required");
    }
    const principal = await resolvePrincipal(store, {
      teamId,
      userId: user.id,
      authSource: "browser-session",
    });
    return { store, principal, close: () => store.close() };
  } catch (error) {
    await store.close();
    if (error instanceof PermissionError) {
      throw new RequestPrincipalError(403, "forbidden", error.message);
    }
    throw error;
  }
}

export function skillNameFromPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const claudeIndex = parts.findIndex((part, index) => part === ".claude" && parts[index + 1] === "skills");
  if (claudeIndex === -1) return null;
  const skillName = parts[claudeIndex + 2];
  return skillName || null;
}

export async function requireSkillPermissionForRequest(
  request: NextRequest,
  skillName: string,
  permission: SkillPermission,
): Promise<RequestPrincipalContext> {
  const ctx = await resolveRequestPrincipalContext(request);
  try {
    await requireSkillAccess(ctx.store, ctx.principal, skillName, permission);
    return ctx;
  } catch (error) {
    if (error instanceof PermissionError) {
      const grants = await ctx.store.listActiveSkillGrants(
        ctx.principal.teamId,
        skillName,
        ctx.principal.userId,
      );
      await recordDeniedSkillPermission(ctx, skillName, permission, "missing_or_insufficient_grant");
      await ctx.close();
      if (grants.length === 0) {
        throw new RequestPrincipalError(404, "not_found", "skill not found");
      }
      throw new RequestPrincipalError(403, "forbidden", error.message);
    }
    await ctx.close();
    throw error;
  }
}

function deniedActionForPermission(permission: SkillPermission) {
  if (permission === "skill.use") return "access.denied_use";
  if (permission === "skill.read") return "access.denied_read";
  return "access.denied_edit";
}

export async function recordDeniedSkillPermission(
  ctx: RequestPrincipalContext,
  skillName: string,
  permission: SkillPermission,
  reason: string,
): Promise<void> {
  await ctx.store.recordAuditEvent({
    teamId: ctx.principal.teamId,
    actorUserId: ctx.principal.userId,
    action: deniedActionForPermission(permission),
    targetType: "skill",
    targetId: null,
    summary: `denied ${permission} on skill ${skillName}`,
    metadata: {
      skillName,
      required: permission,
      reason,
      authSource: ctx.principal.authSource ?? null,
    },
  });
}
