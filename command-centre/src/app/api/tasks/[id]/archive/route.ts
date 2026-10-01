import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { processManager } from "@/lib/process-manager";
import { archiveGoal, TaskArchiveError, TaskArchiveStopError } from "@/lib/task-archive";
import {
  isWorkScopeError,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const tasks = await archiveGoal({
      db: getDb(),
      goalId: id,
      stopTask: (taskId) => processManager.quiesceTaskForArchive(taskId),
    });
    for (const task of tasks) {
      emitTaskEvent({ type: "task:updated", task, timestamp: task.updatedAt });
    }
    return NextResponse.json({ tasks });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    if (error instanceof TaskArchiveStopError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.status },
      );
    }
    const status = error instanceof TaskArchiveError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to archive Goal";
    return NextResponse.json({ error: message }, { status });
  }
}
