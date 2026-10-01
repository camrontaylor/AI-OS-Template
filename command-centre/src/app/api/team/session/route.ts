import { NextRequest, NextResponse } from "next/server";
import {
  clearTeamContext,
  fetchTeamStatus,
  readTeamContext,
  revokeTeamContext,
  selectTeamContext,
  TeamApiError,
  validateTeamEmailLogin,
  validateTeamTokenContext,
  writeTeamContext,
  type TeamContextConfig,
} from "@/lib/team-api-context";
import {
  createTeamLocalProfileDescriptor,
  LocalProfileLockedError,
  localProfileErrorBody,
  resolveLocalProfileDescriptor,
  toBrowserLocalProfile,
} from "@/lib/local-profile";
import { createProfileIdentityV1 } from "@/lib/identity/session-scope";
import {
  activateLocalProfile,
  LocalProfileRequestError,
  localProfileRequestErrorBody,
  LOCAL_PROFILE_CLEANUP_MARKER,
} from "@/lib/local-profile-lifecycle";
import { getConfig } from "@/lib/config";
import { shutdownLocalProfile, type LocalProfileCleanupResultV1 } from "@/lib/profile-shutdown-coordinator";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function descriptorForTeamContext(context: TeamContextConfig) {
  const userId = asRecord(context.user).id;
  if (typeof context.serverId !== "string" || typeof userId !== "string") {
    throw new Error("Team login did not return a stable server and user identity");
  }
  return createTeamLocalProfileDescriptor(createProfileIdentityV1({
    serverId: context.serverId,
    userId,
  }));
}

function hasPendingCleanup(profile: ReturnType<typeof descriptorForTeamContext>): boolean {
  return fs.existsSync(path.join(profile.stateDir, LOCAL_PROFILE_CLEANUP_MARKER));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const apiUrl = typeof body.apiUrl === "string" ? body.apiUrl : "";
    const token = typeof body.token === "string" ? body.token : "";
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    const team = typeof body.team === "string" ? body.team : undefined;

    const candidate = token.trim() !== ""
      ? await validateTeamTokenContext(apiUrl, token)
      : await validateTeamEmailLogin(apiUrl, email, password, team);
    const candidateProfile = descriptorForTeamContext(candidate);
    const previousContext = await readTeamContext();
    let previousProfile = null;
    try {
      const descriptor = resolveLocalProfileDescriptor();
      if (descriptor.mode === "team") previousProfile = descriptor;
    } catch {
      // A damaged saved login is cleared only after the replacement is valid.
    }

    if (previousProfile && previousProfile.profileKey !== candidateProfile.profileKey) {
      await shutdownLocalProfile(previousProfile, {
        workspaceRoot: getConfig().aiOsDir,
        revokeRemote: previousContext ? () => revokeTeamContext(previousContext) : undefined,
      });
      await clearTeamContext();
    }
    if (hasPendingCleanup(candidateProfile)) {
      await shutdownLocalProfile(candidateProfile, { workspaceRoot: getConfig().aiOsDir });
    }
    await writeTeamContext(candidate);
    const activeProfile = resolveLocalProfileDescriptor();
    activateLocalProfile(activeProfile, { rotate: previousProfile?.profileKey !== activeProfile.profileKey });
    return NextResponse.json({
      ...await fetchTeamStatus(),
      localProfile: toBrowserLocalProfile(activeProfile),
    });
  } catch (error) {
    if (error instanceof LocalProfileRequestError) {
      return NextResponse.json(localProfileRequestErrorBody(error), { status: error.status });
    }
    if (error instanceof LocalProfileLockedError) {
      return NextResponse.json(localProfileErrorBody(error), { status: error.status });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not sign in",
      },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const previousContext = await readTeamContext();
  let cleanup: LocalProfileCleanupResultV1 = { version: 1, status: "complete", warnings: [] };
  try {
    const profile = resolveLocalProfileDescriptor();
    if (profile.mode === "team") {
      try {
        cleanup = await shutdownLocalProfile(profile, {
          workspaceRoot: getConfig().aiOsDir,
          revokeRemote: previousContext ? () => revokeTeamContext(previousContext) : undefined,
        });
      } catch {
        cleanup = {
          version: 1,
          status: "complete_with_warnings",
          warnings: [{ code: "process_cleanup_pending", retry: "startup" }],
        };
      }
    }
  } finally {
    await clearTeamContext();
  }
  const soloProfile = resolveLocalProfileDescriptor();
  activateLocalProfile(soloProfile, { rotate: true });
  return NextResponse.json({
    ...await fetchTeamStatus(),
    cleanup,
    localProfile: toBrowserLocalProfile(soloProfile),
  });
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const teamId = typeof body.teamId === "string" ? body.teamId : "";
    await selectTeamContext(teamId);
    return NextResponse.json({
      ...await fetchTeamStatus(),
      localProfile: toBrowserLocalProfile(),
    });
  } catch (error) {
    if (error instanceof LocalProfileLockedError) {
      return NextResponse.json(localProfileErrorBody(error), { status: error.status });
    }
    const status = error instanceof TeamApiError ? error.status : 400;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not select team",
      },
      { status },
    );
  }
}
