import { NextRequest, NextResponse } from "next/server";

import { fetchCompanyState, postCompanyAction } from "@/lib/team-api-context";
import { companyRouteError } from "../route-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await fetchCompanyState("access"));
  } catch (error) {
    return companyRouteError(error, "Company access unavailable");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await postCompanyAction("access", body));
  } catch (error) {
    return companyRouteError(error, "Company access action failed");
  }
}
