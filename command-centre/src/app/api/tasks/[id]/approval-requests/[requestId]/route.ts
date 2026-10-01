import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import {
  getApprovalRequest,
  getPendingApprovalCount,
  resolveApprovalRequest,
} from "@/lib/approval-requests";
import { getClientAiOsDir } from "@/lib/config";
import {
  createTaskPermissionRule,
  getRuleForApprovalRequest,
} from "@/lib/task-permission-rules";
import {
  PERMISSION_DENIED_ACTIVITY_LABEL,
  PERMISSION_RESUMING_ACTIVITY_LABEL,
} from "@/lib/task-permissions";
import type { ApprovalDecision, TaskPermissionRule } from "@/types/approval";
import type { Task } from "@/types/task";
import {
  isWorkScopeError,
  normalizeWorkScopedRow,
  readWorkScopeFromRow,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import { isTaskArchived } from "@/lib/task-archive";

const VALID_DECISIONS: ApprovalDecision[] = ["allow_once", "allow_for_task", "deny"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  try {
    const { id, requestId } = await params;
    const body = await request.json().catch(() => ({}));
    const decision = body?.decision as ApprovalDecision | undefined;
    if (!decision || !VALID_DECISIONS.includes(decision)) {
      return NextResponse.json({ error: "Invalid approval decision" }, { status: 400 });
    }

    const db = getDb();
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    readWorkScopeFromRow(task);
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "Restore this Goal before resolving approvals." }, { status: 409 });
    }

    const existing = getApprovalRequest(id, requestId);
    if (!existing) {
      return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
    }

    if (existing.status !== "pending") {
      if (existing.decision !== decision) {
        return NextResponse.json(
          { error: `This request was already resolved as ${existing.decision}.` },
          { status: 409 },
        );
      }
      const currentTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
      return NextResponse.json({
        request: existing,
        task: { ...currentTask, needsInput: Boolean(currentTask.needsInput) },
        grantedRule: getRuleForApprovalRequest(requestId, db) ?? null,
      });
    }

    let resolved: ReturnType<typeof resolveApprovalRequest>;
    let grantedRule: TaskPermissionRule | null = null;
    const now = new Date().toISOString();

    if (decision === "allow_for_task") {
      const resolveWithRule = db.transaction(() => {
        const pending = getApprovalRequest(id, requestId);
        if (!pending || pending.status !== "pending") {
          throw new Error("Approval request is no longer pending");
        }
        grantedRule = createTaskPermissionRule(
          pending,
          getClientAiOsDir(task.clientId),
          db,
        );
        return resolveApprovalRequest(id, requestId, decision);
      });
      resolved = resolveWithRule();
    } else if (decision === "allow_once") {
      resolved = resolveApprovalRequest(id, requestId, decision);
    } else {
      resolved = resolveApprovalRequest(id, requestId, decision);
    }

    const remainingApprovals = getPendingApprovalCount(db, id);
    if (decision !== "deny") {
      db.prepare(
        "UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = ?, errorMessage = NULL WHERE id = ?"
      ).run(now, PERMISSION_RESUMING_ACTIVITY_LABEL, remainingApprovals > 0 ? 1 : 0, id);
    } else {
      db.prepare(
        "UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 1 WHERE id = ?"
      ).run(now, PERMISSION_DENIED_ACTIVITY_LABEL, id);
    }

    const updatedTask = normalizeWorkScopedRow(
      db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task & { workScope: string | null },
    ) as Task;
    emitTaskEvent({
      type: "task:updated",
      task: { ...updatedTask, needsInput: Boolean(updatedTask.needsInput) },
      timestamp: now,
    });

    return NextResponse.json({
      request: resolved,
      task: { ...updatedTask, needsInput: Boolean(updatedTask.needsInput) },
      grantedRule,
    });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("POST /api/tasks/[id]/approval-requests/[requestId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
