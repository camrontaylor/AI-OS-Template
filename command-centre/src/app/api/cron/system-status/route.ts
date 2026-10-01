import { NextResponse } from "next/server";
import { getCronSystemStatus } from "@/lib/cron-system-status";
import { getInProcessCronRuntimeIdentifier } from "@/lib/cron-scheduler";

export async function GET() {
  try {
    return NextResponse.json(
      getCronSystemStatus(getInProcessCronRuntimeIdentifier())
    );
  } catch (error) {
    console.error("GET /api/cron/system-status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
