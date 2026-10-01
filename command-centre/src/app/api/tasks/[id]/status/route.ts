import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import type { Task } from "@/types/task";
import {
  isWorkScopeError,
  normalizeWorkScopedRow,
  readWorkScopeFromRow,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import { isTaskArchived } from "@/lib/task-archive";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const task = db.prepare("SELECT id, status, activityLabel, errorMessage, clientId, workScope FROM tasks WHERE id = ?").get(id) as
    | (Pick<Task, "id" | "status" | "activityLabel" | "errorMessage" | "clientId"> & { workScope: string | null })
    | undefined;

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  try {
    return NextResponse.json(normalizeWorkScopedRow(task));
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    throw error;
  }
}

interface StatusUpdateInput {
  status: string;
  title?: string;
  activityLabel?: string;
  costUsd?: number;
  tokensUsed?: number;
  errorMessage?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const existing = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as (Omit<Task, "workScope"> & { workScope: string | null }) | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    readWorkScopeFromRow(existing);
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "Restore this Goal before changing its status." }, { status: 409 });
    }

    const body = (await request.json()) as StatusUpdateInput;

    // Validate status if provided
    const validStatuses = ["backlog", "queued", "running", "review", "done"];
    if (body.status && !validStatuses.includes(body.status)) {
      return NextResponse.json(
        {
          error: `status must be one of: ${validStatuses.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const updates: string[] = ["updatedAt = ?"];
    const values: unknown[] = [now];

    if (body.status) {
      updates.push("status = ?");
      values.push(body.status);
    }

    // Set startedAt when transitioning to running
    if (body.status === "running" && !existing.startedAt) {
      updates.push("startedAt = ?");
      values.push(now);
    }

    // Set completedAt only when transitioning to done (not review — review is a pause)
    if (body.status === "done" && !existing.completedAt) {
      updates.push("completedAt = ?");
      values.push(now);

      // Calculate duration if we have startedAt
      if (existing.startedAt) {
        const durationMs =
          new Date(now).getTime() - new Date(existing.startedAt).getTime();
        updates.push("durationMs = ?");
        values.push(durationMs);
      }
    }

    // Clear completedAt if going back to running (session resumed)
    if (body.status === "running" && existing.completedAt) {
      updates.push("completedAt = NULL");
    }

    // Optional fields from agent/hook self-reporting
    if (body.title !== undefined) {
      updates.push("title = ?");
      values.push(body.title);
    }
    if (body.activityLabel !== undefined) {
      updates.push("activityLabel = ?");
      values.push(body.activityLabel);
    }
    if (body.costUsd !== undefined) {
      updates.push("costUsd = ?");
      values.push(body.costUsd);
    }
    if (body.tokensUsed !== undefined) {
      updates.push("tokensUsed = ?");
      values.push(body.tokensUsed);
    }
    if (body.errorMessage !== undefined) {
      updates.push("errorMessage = ?");
      values.push(body.errorMessage);
    }

    values.push(id);

    db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(
      ...values
    );

    const updatedRaw = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as Omit<Task, "workScope"> & { workScope: string | null };
    const updated = normalizeWorkScopedRow(updatedRaw) as Task;

    emitTaskEvent({
      type: "task:status",
      task: updated,
      timestamp: now,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("PATCH /api/tasks/[id]/status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
