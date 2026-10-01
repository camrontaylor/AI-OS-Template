import { NextResponse } from "next/server";
import { SCRIPT_REGISTRY } from "@/lib/script-registry";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";

export async function GET() {
  if (isHostedTeamMode()) {
    return hostedModeForbiddenResponse();
  }

  return NextResponse.json(SCRIPT_REGISTRY);
}
