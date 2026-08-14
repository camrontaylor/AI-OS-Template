import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { ApprovalRequestStatus, ApprovalRequestWithTask } from "@/types/approval";

const VALID_STATUSES: ApprovalRequestStatus[] = ["pending", "approved", "denied"];

function normalizeLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(200, Math.floor(parsed));
}

function normalizeStatus(value: string | null): ApprovalRequestStatus | null {
  if (!value) return null;
  return VALID_STATUSES.includes(value as ApprovalRequestStatus)
    ? (value as ApprovalRequestStatus)
    : null;
}

export async function GET(request: NextRequest) {
  try {
    const status = normalizeStatus(request.nextUrl.searchParams.get("status"));
    const limit = normalizeLimit(request.nextUrl.searchParams.get("limit"));
    const db = getDb();
    const whereClause = status ? "WHERE ar.status = ?" : "";
    const args = status ? [status, limit] : [limit];
    const rows = db
      .prepare(
        `SELECT
          ar.*,
          t.title AS taskTitle,
          t.status AS taskStatus,
          t.clientId AS taskClientId,
          t.projectSlug AS taskProjectSlug,
          t.needsInput AS taskNeedsInput,
          t.permissionMode AS taskPermissionMode,
          t.executionPermissionMode AS taskExecutionPermissionMode
         FROM approval_requests ar
         LEFT JOIN tasks t ON t.id = ar.taskId
         ${whereClause}
         ORDER BY
          CASE ar.status WHEN 'pending' THEN 0 ELSE 1 END ASC,
          COALESCE(ar.resolvedAt, ar.createdAt) DESC
         LIMIT ?`,
      )
      .all(...args) as Array<Omit<ApprovalRequestWithTask, "taskNeedsInput"> & { taskNeedsInput: number | null }>;

    return NextResponse.json(
      rows.map((row) => ({
        ...row,
        taskNeedsInput: Boolean(row.taskNeedsInput),
      })),
    );
  } catch (error) {
    console.error("GET /api/approval-requests error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

