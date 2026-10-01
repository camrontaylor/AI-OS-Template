import { NextRequest, NextResponse } from "next/server";

import { fetchCompanyState, postCompanyAction } from "@/lib/team-api-context";
import { companyRouteError } from "../route-utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await fetchCompanyState("teams", request.nextUrl.searchParams.get("teamId")));
  } catch (error) {
    return companyRouteError(error, "Company Teams unavailable");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await postCompanyAction("teams", body));
  } catch (error) {
    return companyRouteError(error, "Company Team action failed");
  }
}
