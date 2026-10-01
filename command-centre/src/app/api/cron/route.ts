import { NextRequest, NextResponse } from "next/server";
import {
  listCronJobs,
  createCronJob,
  getCronScheduleValidationError,
} from "@/lib/cron-service";
import type { CronJobCreateInput } from "@/types/cron";
import { MaterializedFileAccessError } from "@/lib/materialized-file-ownership";

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("clientId");
    const jobs = listCronJobs(clientId);
    return NextResponse.json(jobs);
  } catch (error) {
    console.error("GET /api/cron error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("clientId");
    const body = (await request.json()) as CronJobCreateInput;

    // Validate required fields
    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: "name is required and must be a non-empty string" },
        { status: 400 }
      );
    }
    if (!body.time || typeof body.time !== "string" || body.time.trim().length === 0) {
      return NextResponse.json(
        { error: "time is required and must be a non-empty string" },
        { status: 400 }
      );
    }
    if (!body.days || typeof body.days !== "string" || body.days.trim().length === 0) {
      return NextResponse.json(
        { error: "days is required and must be a non-empty string" },
        { status: 400 }
      );
    }
    if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "prompt is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    const scheduleError = getCronScheduleValidationError(body.time, body.days);
    if (scheduleError) {
      return NextResponse.json({ error: scheduleError }, { status: 400 });
    }

    const job = createCronJob(body, clientId);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    if (error instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
    }
    console.error("POST /api/cron error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
