import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Task } from "@/types/task";
import { getVisibleEditedTasks } from "@/lib/task-branch-ui";
import {
  isWorkScopeError,
  normalizeWorkScopedRow,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import {
  resolveTaskHasMainChat,
  shouldShowTaskInChatFeed,
} from "@/lib/task-main-chat";

function timeValue(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortValue(task: Task, sortBy: string): number | string {
  switch (sortBy) {
    case "startedAt":
      return timeValue(task.startedAt ?? task.createdAt);
    case "durationMs":
      return task.durationMs ?? 0;
    case "tokensUsed":
      return task.tokensUsed ?? 0;
    case "costUsd":
      return task.costUsd ?? 0;
    case "level":
      return task.level;
    case "completedAt":
    default:
      return timeValue(task.completedAt ?? task.updatedAt);
  }
}

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const clientId = searchParams.get("clientId");
    const type = searchParams.get("type"); // task level: task, project, gsd
    const status = searchParams.get("status"); // done, review, failed
    const projectSlug = searchParams.get("projectSlug"); // filter by project
    const dateRange = searchParams.get("dateRange"); // today, week, month, 90days
    const sortBy = searchParams.get("sortBy") || "completedAt"; // completedAt, startedAt, durationMs, tokensUsed, costUsd, level
    const sortDir = searchParams.get("sortDir") || "desc"; // asc, desc

    const clientWhere = clientId === "root"
      ? " WHERE clientId IS NULL"
      : clientId ? " WHERE clientId = ?" : "";
    const clientParams = clientId && clientId !== "root" ? [clientId] : [];

    // Date range filter (based on startedAt)
    let cutoff: Date | null = null;
    if (dateRange) {
      const now = new Date();

      switch (dateRange) {
        case "today": {
          cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        }
        case "week": {
          cutoff = new Date(now);
          cutoff.setDate(cutoff.getDate() - 7);
          break;
        }
        case "month": {
          cutoff = new Date(now);
          cutoff.setMonth(cutoff.getMonth() - 1);
          break;
        }
        case "90days": {
          cutoff = new Date(now);
          cutoff.setDate(cutoff.getDate() - 90);
          break;
        }
      }
    }

    const rows = db.prepare(`SELECT * FROM tasks${clientWhere}`).all(...clientParams) as Array<Task & { workScope: string | null }>;
    const directLogTaskIds = new Set(
      (db.prepare("SELECT DISTINCT taskId FROM task_logs").all() as Array<{ taskId: string }>)
        .map((row) => row.taskId),
    );
    const conversationIdsWithMessages = new Set(
      (db.prepare("SELECT DISTINCT conversationId FROM messages").all() as Array<{ conversationId: string }>)
        .map((row) => row.conversationId),
    );
    const visibleTasks = getVisibleEditedTasks(
      rows.map((t) => ({
        ...normalizeWorkScopedRow(t),
        needsInput: Boolean(t.needsInput),
        hasMainChat: resolveTaskHasMainChat(t, {
          directLogTaskIds,
          conversationIdsWithMessages,
        }),
      })),
    );

    const filtered = visibleTasks
      .filter((task) => {
        if (!shouldShowTaskInChatFeed(task)) return false;
        // History only shows tasks that have run and settled into review/done.
        if (status === "done") {
          if (task.status !== "done") return false;
        } else if (status === "review") {
          if (task.status !== "review") return false;
        } else if (status === "failed") {
          if (task.errorMessage == null) return false;
          if (task.status !== "done" && task.status !== "review") return false;
        } else if (task.status !== "done" && task.status !== "review") {
          return false;
        }

        if (projectSlug === "__none__") {
          if (task.projectSlug) return false;
        } else if (projectSlug && task.projectSlug !== projectSlug) {
          return false;
        }

        if (type && ["task", "project", "gsd"].includes(type) && task.level !== type) {
          return false;
        }

        if (cutoff && timeValue(task.startedAt ?? task.createdAt) < cutoff.getTime()) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const aValue = sortValue(a, sortBy);
        const bValue = sortValue(b, sortBy);
        const result = typeof aValue === "string" || typeof bValue === "string"
          ? String(aValue).localeCompare(String(bValue))
          : aValue - bValue;
        return sortDir === "asc" ? result : -result;
      });

    const tasks = filtered.slice(offset, offset + limit);

    return NextResponse.json({ tasks, total: filtered.length });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("GET /api/tasks/history error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
