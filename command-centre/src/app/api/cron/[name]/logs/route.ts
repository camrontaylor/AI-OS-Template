import { NextRequest, NextResponse } from "next/server";
import { getCronJobLog } from "@/lib/cron-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const clientId = request.nextUrl.searchParams.get("clientId");
    const log = getCronJobLog(name, clientId);
    return NextResponse.json({ log });
  } catch (error) {
    console.error("GET /api/cron/[name]/logs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
