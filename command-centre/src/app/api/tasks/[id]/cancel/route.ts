import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { processManager, TaskCancellationError } from "@/lib/process-manager";
import type { Task } from "@/types/task";
import {
  isWorkScopeError,
  normalizeWorkScopedRow,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import { isTaskArchived } from "@/lib/task-archive";

/**
 * POST /api/tasks/[id]/cancel
 * Stop a running task. Kills the Claude CLI process and moves task to review.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const rawTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | Task
      | undefined;

    if (!rawTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const task = normalizeWorkScopedRow(rawTask);
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "This Goal is archived and has no active run." }, { status: 409 });
    }

    if (task.status !== "running" && task.status !== "queued") {
      return NextResponse.json({ ...task, needsInput: Boolean(task.needsInput) });
    }

    await processManager.cancelTask(id);

    const updated = normalizeWorkScopedRow(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task);
    return NextResponse.json({ ...updated, needsInput: Boolean(updated.needsInput) });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("POST /api/tasks/[id]/cancel error:", error);
    if (error instanceof TaskCancellationError) {
      return NextResponse.json(
        { code: "task_stop_failed", error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
