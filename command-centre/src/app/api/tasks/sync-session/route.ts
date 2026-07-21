import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import type { Task } from "@/types/task";

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { sessionId, cwd, projectSlug, claudePid } = body as {
      sessionId: string;
      cwd?: string;
      projectSlug?: string | null;
      claudePid?: number | null;
    };

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // Check if a task with this sessionId already exists
    const existing = db
      .prepare("SELECT * FROM tasks WHERE claudeSessionId = ?")
      .get(sessionId) as Task | undefined;

    if (existing) {
      // Resume — update status back to running
      db.prepare(
        "UPDATE tasks SET status = 'running', updatedAt = ?, startedAt = COALESCE(startedAt, ?), claudePid = COALESCE(?, claudePid) WHERE id = ?"
      ).run(now, now, claudePid ?? null, existing.id);

      const updated = db
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(existing.id) as Task;
      emitTaskEvent({
        type: "task:status",
        task: { ...updated, needsInput: Boolean(updated.needsInput) },
        timestamp: now,
      });

      return NextResponse.json({
        taskId: existing.id,
        isNew: false,
        syncMode: "managed" as const,
      });
    }

    // Check for a recently-started running task. We prefer one without a claudeSessionId
    // (e.g. freshly created by board/dashboard or cron), but if all running tasks have one,
    // we take the most recently started one and overwrite its sessionId (handles cron daemon retries
    // or rapid hook race conditions without spawning duplicated "Weird Path" ghost tasks).
    const recentRunning = db
      .prepare(
        `SELECT * FROM tasks
         WHERE status = 'running'
           AND startedAt IS NOT NULL
           AND (julianday(?) - julianday(startedAt)) * 86400 < 120
         ORDER BY 
           CASE WHEN claudeSessionId IS NULL THEN 0 ELSE 1 END ASC,
           updatedAt DESC
         LIMIT 1`
      )
      .get(now) as Task | undefined;

    if (recentRunning) {
      // Attach the session ID to the existing task instead of creating a duplicate
      db.prepare(
        "UPDATE tasks SET claudeSessionId = ?, claudePid = COALESCE(?, claudePid), updatedAt = ? WHERE id = ?"
      ).run(sessionId, claudePid ?? null, now, recentRunning.id);

      const updated = db
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(recentRunning.id) as Task;
      emitTaskEvent({
        type: "task:status",
        task: { ...updated, needsInput: Boolean(updated.needsInput) },
        timestamp: now,
      });

      return NextResponse.json({
        taskId: recentRunning.id,
        isNew: false,
        syncMode: "managed" as const,
      });
    }

    // Create new task (genuinely new terminal session, not spawned by the board)
    const title = projectSlug
      ? `${projectSlug} session`
      : cwd
        ? cwd.split("/").pop() || "Terminal session"
        : "Terminal session";

    // Get min columnOrder in running column
    const minOrder = db
      .prepare(
        "SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE status = 'running'"
      )
      .get() as { minOrder: number };

    const id = crypto.randomUUID();
    const task: Task = {
      id,
      title,
      description: cwd ? `Working directory: ${cwd}` : null,
      status: "running",
      level: "task",
      parentId: null,
      projectSlug: projectSlug || null,
      columnOrder: minOrder.minOrder - 1,
      createdAt: now,
      updatedAt: now,
      costUsd: null,
      tokensUsed: null,
      durationMs: null,
      activityLabel: "Session started",
      errorMessage: null,
      startedAt: now,
      completedAt: null,
      clientId: null,
      needsInput: false,
      phaseNumber: null,
      gsdStep: null,
      contextSources: null,
      cronJobSlug: null,
      claudeSessionId: sessionId,
      claudePid: claudePid ?? null,
      permissionMode: "bypassPermissions",
      executionPermissionMode: "bypassPermissions",
      lastReplyAt: null,
      goalGroup: null,
      tag: null,
      pinnedAt: null,
    };

    db.prepare(
      `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, needsInput, phaseNumber, gsdStep, contextSources, cronJobSlug, claudeSessionId, claudePid, permissionMode, executionPermissionMode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      task.id, task.title, task.description, task.status, task.level,
      task.parentId, task.projectSlug, task.columnOrder, task.createdAt,
      task.updatedAt, task.costUsd, task.tokensUsed, task.durationMs,
      task.activityLabel, task.errorMessage, task.startedAt, task.completedAt,
      task.clientId, task.needsInput ? 1 : 0, task.phaseNumber, task.gsdStep,
      task.contextSources, task.cronJobSlug, task.claudeSessionId, task.claudePid,
      task.permissionMode, task.executionPermissionMode
    );

    emitTaskEvent({ type: "task:created", task, timestamp: now });

    return NextResponse.json(
      { taskId: id, isNew: true, syncMode: "hook-owned" as const },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/tasks/sync-session error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
