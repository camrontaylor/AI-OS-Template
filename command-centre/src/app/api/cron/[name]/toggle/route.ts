import { NextRequest, NextResponse } from "next/server";
import { getCronJob, updateCronJob } from "@/lib/cron-service";
import { MaterializedFileAccessError } from "@/lib/materialized-file-ownership";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const clientId = request.nextUrl.searchParams.get("clientId");
    const current = getCronJob(name, clientId);

    if (!current) {
      return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
    }

    const updated = updateCronJob(name, { active: !current.active }, clientId);
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
    }
    console.error("PATCH /api/cron/[name]/toggle error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
