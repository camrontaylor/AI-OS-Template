import { NextResponse } from "next/server";
import { fetchTeamStatus } from "../../../../lib/team-api-context";
import {
  LocalProfileLockedError,
  localProfileErrorBody,
  toBrowserLocalProfile,
} from "@/lib/local-profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await fetchTeamStatus();
  let localProfile;
  let localProfileError;
  try {
    localProfile = toBrowserLocalProfile();
  } catch (error) {
    if (!(error instanceof LocalProfileLockedError)) throw error;
    localProfile = { version: 1 as const, mode: "team" as const, profileKey: "locked", sessionId: "locked" };
    localProfileError = localProfileErrorBody(error).error;
  }
  return NextResponse.json({
    ...status,
    localProfile,
    ...(localProfileError ? { localProfileError } : {}),
  });
}
