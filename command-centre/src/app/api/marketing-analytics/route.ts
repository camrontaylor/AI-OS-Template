import { NextResponse } from "next/server";
import { readMarketingAnalyticsSnapshot } from "@/lib/marketing-analytics-source.server";

export async function GET() {
  try {
    return NextResponse.json(readMarketingAnalyticsSnapshot());
  } catch (error) {
    if (error instanceof Error && /source files are missing/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("GET /api/marketing-analytics error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
