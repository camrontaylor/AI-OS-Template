import { NextRequest, NextResponse } from "next/server";

import { fetchTeamSecrets, postTeamSecretsAction } from "@/lib/team-api-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const client = request.nextUrl.searchParams.get("client");
    return NextResponse.json(await fetchTeamSecrets(client));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Team secrets unavailable" },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await postTeamSecretsAction(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Team secret action failed" },
      { status: 400 },
    );
  }
}
