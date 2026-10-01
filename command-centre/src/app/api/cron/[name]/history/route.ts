import { NextRequest, NextResponse } from "next/server";
import { getCronRunHistory } from "@/lib/cron-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const clientId = request.nextUrl.searchParams.get("clientId");
    const history = getCronRunHistory(name, clientId);
    return NextResponse.json(history);
  } catch (error) {
    console.error("GET /api/cron/[name]/history error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
