import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listPendingApprovalRequests } from "@/lib/approval-requests";
import type { Task } from "@/types/task";
import { isWorkScopeError, readWorkScopeFromRow, workScopeErrorBody } from "@/lib/identity/work-scope";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    readWorkScopeFromRow(task);

    return NextResponse.json(listPendingApprovalRequests(id));
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("GET /api/tasks/[id]/approval-requests error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
