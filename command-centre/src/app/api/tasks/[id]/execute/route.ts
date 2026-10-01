import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { RequestPrincipalError } from "@/lib/identity/request-principal";
import { requireSkillUseForRequest } from "@/lib/identity/skill-authorization";
import type { Task } from "@/types/task";
import {
  isWorkScopeError,
  normalizeWorkScopedRow,
  readWorkScopeFromRow,
  requestWithWorkScope,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import { isTaskArchived } from "@/lib/task-archive";
import { revokeTaskPermissionRules } from "@/lib/task-permission-rules";

/**
 * POST /api/tasks/[id]/execute
 * Manually trigger execution of a task by setting it to 'queued'.
 * The queue watcher picks up the status change and spawns Claude CLI.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | (Omit<Task, "workScope"> & { workScope: string | null })
      | undefined;

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const workScope = readWorkScopeFromRow(task);
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "Restore this Goal before running tasks." }, { status: 409 });
    }

    // Cannot execute an already running task
    if (task.status === "running") {
      return NextResponse.json(
        { error: "Task is already running" },
        { status: 409 }
      );
    }

    try {
      await requireSkillUseForRequest(requestWithWorkScope(request, workScope), task.title, task.description);
    } catch (error) {
      if (error instanceof RequestPrincipalError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const now = new Date().toISOString();
    revokeTaskPermissionRules(id, db);

    // Set to queued -- the queue watcher handles the rest
    db.prepare(
      "UPDATE tasks SET status = ?, updatedAt = ?, errorMessage = NULL, cancelRequestedAt = NULL WHERE id = ?"
    ).run("queued", now, id);

    const updated = normalizeWorkScopedRow(
      db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task & { workScope: string | null },
    ) as Task;

    emitTaskEvent({
      type: "task:updated",
      task: updated,
      timestamp: now,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("POST /api/tasks/[id]/execute error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
