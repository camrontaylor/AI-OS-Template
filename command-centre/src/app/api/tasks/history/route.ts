import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Task } from "@/types/task";

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

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Only completed/review tasks (history = things that ran)
    conditions.push("status IN ('done', 'review')");

    if (clientId && clientId !== "root") {
      conditions.push("clientId = ?");
      params.push(clientId);
    }

    // Project filter
    if (projectSlug === "__none__") {
      conditions.push("(projectSlug IS NULL OR projectSlug = '')");
    } else if (projectSlug) {
      conditions.push("projectSlug = ?");
      params.push(projectSlug);
    }

    // Type filter (task level)
    if (type && ["task", "project", "gsd"].includes(type)) {
      conditions.push("level = ?");
      params.push(type);
    }

    // Status filter
    if (status === "done") {
      // Override the IN clause — only done
      conditions[0] = "status = 'done'";
    } else if (status === "review") {
      conditions[0] = "status = 'review'";
    } else if (status === "failed") {
      conditions.push("errorMessage IS NOT NULL");
    }

    // Date range filter (based on startedAt)
    if (dateRange) {
      const now = new Date();
      let cutoff: Date | null = null;

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

      if (cutoff) {
        conditions.push("COALESCE(startedAt, createdAt) >= ?");
        params.push(cutoff.toISOString());
      }
    }

    // Validate sort column
    const allowedSortCols: Record<string, string> = {
      completedAt: "COALESCE(completedAt, updatedAt)",
      startedAt: "COALESCE(startedAt, createdAt)",
      durationMs: "COALESCE(durationMs, 0)",
      tokensUsed: "COALESCE(tokensUsed, 0)",
      costUsd: "COALESCE(costUsd, 0)",
      level: "level",
    };
    const sortCol = allowedSortCols[sortBy] || allowedSortCols.completedAt;
    const direction = sortDir === "asc" ? "ASC" : "DESC";

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

    const rows = db
      .prepare(
        `SELECT * FROM tasks${where} ORDER BY ${sortCol} ${direction} LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Task[];

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM tasks${where}`)
      .get(...params) as { total: number };

    const tasks = rows.map((t) => ({ ...t, needsInput: Boolean(t.needsInput) }));

    return NextResponse.json({ tasks, total: countRow.total });
  } catch (error) {
    console.error("GET /api/tasks/history error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
