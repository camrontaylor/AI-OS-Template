import { NextRequest, NextResponse } from "next/server";

import {
  RequestPrincipalError,
} from "@/lib/identity/request-principal";
import { resolveSkillCatalogForRequest } from "@/lib/skill-catalog";

export async function GET(request: NextRequest) {
  let principalContext: Awaited<ReturnType<typeof resolveSkillCatalogForRequest>>["principalContext"] = null;
  try {
    const catalog = await resolveSkillCatalogForRequest(request);
    principalContext = catalog.principalContext;
    return NextResponse.json(catalog.skills);
  } catch (error) {
    if (error instanceof RequestPrincipalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("GET /api/skills error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await principalContext?.close();
  }
}
