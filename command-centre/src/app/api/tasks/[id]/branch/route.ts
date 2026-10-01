import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { RequestPrincipalError } from "@/lib/identity/request-principal";
import { requireSkillUseForRequest } from "@/lib/identity/skill-authorization";
import { createTaskBranch, TaskBranchError } from "@/lib/task-branch";
import {
  isWorkScopeError,
  readWorkScopeFromRow,
  requestWithWorkScope,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import { isTaskArchived } from "@/lib/task-archive";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { fromLogId?: string; editedContent?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const editedContent = typeof body.editedContent === "string" ? body.editedContent.trim() : "";
  if (!body.fromLogId || typeof body.fromLogId !== "string") {
    return NextResponse.json({ error: "fromLogId is required" }, { status: 400 });
  }
  if (!editedContent) {
    return NextResponse.json({ error: "editedContent is required" }, { status: 400 });
  }

  const db = getDb();
  const source = db.prepare("SELECT clientId, workScope FROM tasks WHERE id = ?").get(id) as
    | { clientId: string | null; workScope: string | null }
    | undefined;
  if (!source) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  let workScope;
  try {
    workScope = readWorkScopeFromRow(source);
    await requireSkillUseForRequest(requestWithWorkScope(request, workScope), editedContent);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    if (error instanceof RequestPrincipalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    const db = getDb();
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "Restore this Goal before editing chat history." }, { status: 409 });
    }
    const result = createTaskBranch(db, id, body.fromLogId, editedContent);
    emitTaskEvent({
      type: "task:created",
      task: result.task,
      timestamp: result.task.createdAt,
    });
    return NextResponse.json(result.task, { status: 201 });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    if (error instanceof TaskBranchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("POST /api/tasks/[id]/branch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
