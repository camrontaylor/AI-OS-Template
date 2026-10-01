import { NextRequest, NextResponse } from "next/server";
import { getActiveLocalProfileDescriptor, getDb } from "@/lib/db";
import { getContextStatusForSession } from "@/lib/context-status";
import type { Task } from "@/types/task";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();
    const task = db
      .prepare("SELECT id, claudeSessionId FROM tasks WHERE id = ?")
      .get(id) as Pick<Task, "id" | "claudeSessionId"> | undefined;

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json(getContextStatusForSession(task.claudeSessionId, {
      profileKey: getActiveLocalProfileDescriptor().profileKey,
    }));
  } catch (error) {
    console.error("GET /api/tasks/[id]/context-status error:", error);
    return NextResponse.json(
      { status: "unavailable", reason: "no_data" },
      { status: 200 },
    );
  }
}
