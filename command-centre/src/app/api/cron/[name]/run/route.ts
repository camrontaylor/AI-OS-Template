import { NextRequest, NextResponse } from "next/server";
import { enqueueCronJob, getCronJob } from "@/lib/cron-service";
import { emitTaskEvent } from "@/lib/event-bus";

/**
 * POST /api/cron/[name]/run
 * Run a cron job immediately by creating a task from its prompt and queuing it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const clientId = request.nextUrl.searchParams.get("clientId");
    const job = getCronJob(name, clientId);

    if (!job) {
      return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
    }

    const queued = enqueueCronJob(job, {
      trigger: "manual",
      dedupeByMinute: false,
      titleSuffix: " (manual run)",
      activityLabel: "Queued — manual trigger",
      scheduledFor: new Date().toISOString(),
    });
    const task = queued.task;
    const now = task.updatedAt || task.createdAt || new Date().toISOString();

    // Emit events so the board updates in real-time and queue watcher picks it up
    emitTaskEvent({
      type: "task:created",
      task,
      timestamp: now,
    });

    emitTaskEvent({
      type: "task:status",
      task,
      timestamp: now,
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error("POST /api/cron/[name]/run error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
