import crypto from "crypto";
import type Database from "better-sqlite3";
import { formatApprovalRequestSummary } from "@/lib/approval-request-format";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { PERMISSION_REQUIRED_ACTIVITY_LABEL } from "@/lib/task-permissions";
import type { ApprovalDecision, ApprovalRequest } from "@/types/approval";
import type { Task } from "@/types/task";

export function createApprovalRequest(
  taskId: string,
  toolName: string,
  input: unknown,
): ApprovalRequest {
  const db = getDb();
  const now = new Date().toISOString();
  const inputJson = JSON.stringify(input ?? {});
  const existing = db.prepare(
    `SELECT * FROM approval_requests
     WHERE taskId = ? AND kind = 'permission' AND status = 'pending' AND toolName = ? AND inputJson = ?
     ORDER BY createdAt DESC LIMIT 1`
  ).get(taskId, toolName, inputJson) as ApprovalRequest | undefined;

  if (existing) {
    return existing;
  }

  const id = crypto.randomUUID();
  const summary = formatApprovalRequestSummary(toolName, input);
  db.prepare(
    `INSERT INTO approval_requests
      (id, taskId, kind, status, title, description, toolName, inputJson, decision, decisionMessage, createdAt, resolvedAt)
     VALUES (?, ?, 'permission', 'pending', ?, ?, ?, ?, NULL, NULL, ?, NULL)`
  ).run(id, taskId, PERMISSION_REQUIRED_ACTIVITY_LABEL, summary, toolName, inputJson, now);

  db.prepare(
    "UPDATE tasks SET needsInput = 1, updatedAt = ?, activityLabel = ? WHERE id = ?"
  ).run(now, PERMISSION_REQUIRED_ACTIVITY_LABEL, taskId);

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
  if (task) {
    emitTaskEvent({
      type: "task:question",
      task: { ...task, needsInput: true },
      timestamp: now,
      questionText: summary,
    });
  }

  return db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as ApprovalRequest;
}

export function listPendingApprovalRequests(taskId: string): ApprovalRequest[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM approval_requests
     WHERE taskId = ? AND status = 'pending'
     ORDER BY createdAt ASC`
  ).all(taskId) as ApprovalRequest[];
}

export function getApprovalRequest(taskId: string, requestId: string): ApprovalRequest | undefined {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM approval_requests WHERE id = ? AND taskId = ?"
  ).get(requestId, taskId) as ApprovalRequest | undefined;
}

export function resolveApprovalRequest(
  taskId: string,
  requestId: string,
  decision: ApprovalDecision,
): ApprovalRequest | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  const request = getApprovalRequest(taskId, requestId);
  if (!request) return undefined;

  const decisionMessage =
    decision === "allow_once"
      ? "Allowed once"
      : decision === "allow_for_task"
        ? "Allowed for this subchat"
        : "Denied";

  const result = db.prepare(
    `UPDATE approval_requests
     SET status = ?, decision = ?, decisionMessage = ?, resolvedAt = ?
     WHERE id = ? AND taskId = ? AND status = 'pending'`
  ).run(decision === "deny" ? "denied" : "approved", decision, decisionMessage, now, requestId, taskId);

  if (!result.changes) {
    return getApprovalRequest(taskId, requestId);
  }

  const pendingCount = db.prepare(
    "SELECT COUNT(*) as count FROM approval_requests WHERE taskId = ? AND status = 'pending'"
  ).get(taskId) as { count: number };

  if (pendingCount.count === 0) {
    db.prepare(
      "UPDATE tasks SET updatedAt = ?, activityLabel = CASE WHEN status = 'running' THEN 'Processing reply...' ELSE activityLabel END WHERE id = ?"
    ).run(now, taskId);
  }

  return getApprovalRequest(taskId, requestId);
}

export function getPendingApprovalCount(
  database: Database.Database,
  taskId: string,
): number {
  const row = database.prepare(
    "SELECT COUNT(*) as count FROM approval_requests WHERE taskId = ? AND status = 'pending'"
  ).get(taskId) as { count: number };
  return row.count;
}
