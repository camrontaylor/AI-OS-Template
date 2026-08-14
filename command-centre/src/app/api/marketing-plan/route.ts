import { NextResponse } from "next/server";
import { readMarketingAnalyticsSnapshot } from "@/lib/marketing-analytics-source.server";
import { compileMarketingPlan } from "@/lib/marketing-plan-compiler";

export async function GET() {
  try {
    return NextResponse.json(compileMarketingPlan(readMarketingAnalyticsSnapshot()));
  } catch (error) {
    if (error instanceof Error && /source files are missing/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("GET /api/marketing-plan error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
