import { NextRequest, NextResponse } from "next/server";

import {
  fetchTeamAdminState,
  postTeamAdminAction,
  TeamApiError,
} from "@/lib/team-api-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await fetchTeamAdminState());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Team admin unavailable" },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await postTeamAdminAction(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Team admin action failed" },
      { status: error instanceof TeamApiError ? error.status : 400 },
    );
  }
}
