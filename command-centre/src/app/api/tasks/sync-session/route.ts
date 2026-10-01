import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { detectClientIdFromCwd } from "@/lib/config";
import { processManager } from "@/lib/process-manager";
import { isProcessAlive } from "@/lib/subprocess";
import type { Task } from "@/types/task";
import {
  assertNoWorkScopeInput,
  createSoloStoredWorkScope,
  isWorkScopeError,
  readWorkScopeFromRow,
  serializeStoredWorkScope,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";

type TaskRow = Omit<Task, "workScope"> & { workScope: string | null };

// A different Claude arriving while the recorded one is still alive was
// started from inside it (memory capture's `claude -p` inherits
// AI_OS_TASK_ID), so it must not take the task over. A dead recorded PID
// means a cron retry, which does replace it.
function isNestedSession(task: TaskRow, claudePid: number | null | undefined): boolean {
  return task.claudePid != null && task.claudePid !== claudePid && isProcessAlive(task.claudePid);
}

function managedResponse(taskId: string) {
  return NextResponse.json({
    taskId,
    isNew: false,
    syncMode: "managed" as const,
  });
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    assertNoWorkScopeInput(body);
    const { sessionId, cwd, projectSlug, claudePid, taskId } = body as {
      sessionId: string;
      cwd?: string;
      projectSlug?: string | null;
      claudePid?: number | null;
      taskId?: string | null;
    };

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const detectedClientId = detectClientIdFromCwd(cwd);

    const emitUpdated = (id: string) => {
      const updated = db
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(id) as Task;
      emitTaskEvent({
        type: "task:status",
        task: { ...updated, needsInput: Boolean(updated.needsInput) },
        timestamp: now,
      });
    };

    // Command Centre and the cron runtime pass AI_OS_TASK_ID to the Claude
    // they spawn, and current hooks always send it (null for terminal sessions).
    if (typeof taskId === "string" && taskId) {
      const target = db
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(taskId) as TaskRow | undefined;

      if (target) {
        readWorkScopeFromRow(target);
        // A live Command Centre session already recorded its own PID and
        // session; checked first because on Windows its PID (the wrapper) never
        // matches the hook's. Anything else (cron runs) is recorded without
        // ownership.
        if (processManager.hasActiveSession(target.id)) {
          return managedResponse(target.id);
        }
        // The hook reports the exact PID Command Centre spawned: it is our own
        // session even when this route cannot see it (production `next start`
        // may give the route its own empty processManager). Keep ownership.
        if (claudePid != null && claudePid === target.ownedClaudePid) {
          return managedResponse(target.id);
        }
        if (isNestedSession(target, claudePid)) {
          console.log(
            `[sync-session] Ignoring nested Claude session ${sessionId} for task ${target.id}: recorded PID ${target.claudePid} is still alive`
          );
          return managedResponse(target.id);
        }
        db.prepare(
          "UPDATE tasks SET claudeSessionId = ?, claudePid = COALESCE(?, claudePid), ownedClaudePid = NULL, updatedAt = ? WHERE id = ?"
        ).run(sessionId, claudePid ?? null, now, target.id);
        emitUpdated(target.id);
        return managedResponse(target.id);
      }
      // Unknown task (deleted, or a stale inherited env): treat as external.
    }

    // Check if a task with this sessionId already exists
    const existing = db
      .prepare("SELECT * FROM tasks WHERE claudeSessionId = ?")
      .get(sessionId) as TaskRow | undefined;

    if (existing) {
      readWorkScopeFromRow(existing);
      if (!processManager.hasActiveSession(existing.id)) {
        // Resume from outside Command Centre (e.g. `claude --resume`): the
        // hook's PID is never proof of ownership, so ownership is dropped.
        db.prepare(
          "UPDATE tasks SET status = 'running', updatedAt = ?, startedAt = COALESCE(startedAt, ?), claudePid = COALESCE(?, claudePid), ownedClaudePid = NULL WHERE id = ?"
        ).run(now, now, claudePid ?? null, existing.id);
        emitUpdated(existing.id);
      }
      return managedResponse(existing.id);
    }

    // Legacy hooks omit taskId entirely. For them only, fall back to guessing
    // the most recently started running task. We prefer one without a claudeSessionId
    // (e.g. freshly created by board/dashboard or cron), but if all running tasks have one,
    // we take the most recently started one and overwrite its sessionId (handles cron daemon retries
    // or rapid hook race conditions without spawning duplicated "Weird Path" ghost tasks).
    const isLegacyHook = !Object.prototype.hasOwnProperty.call(body, "taskId");
    const recentRunning = isLegacyHook
      ? db
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
          .get(now) as TaskRow | undefined
      : undefined;

    if (recentRunning) {
      readWorkScopeFromRow(recentRunning);
      // Attach the session ID to the existing task instead of creating a duplicate.
      // A guessed match never grants ownership and never touches a live session.
      if (!processManager.hasActiveSession(recentRunning.id) && !isNestedSession(recentRunning, claudePid)) {
        db.prepare(
          "UPDATE tasks SET claudeSessionId = ?, claudePid = COALESCE(?, claudePid), ownedClaudePid = NULL, updatedAt = ? WHERE id = ?"
        ).run(sessionId, claudePid ?? null, now, recentRunning.id);
        emitUpdated(recentRunning.id);
      }
      return managedResponse(recentRunning.id);
    }

    // Create new task (genuinely new terminal session, not spawned by the board)
    const title = projectSlug
      ? `${projectSlug} session`
      : cwd
        ? cwd.replace(/\\/g, "/").split("/").pop() || "Terminal session"
        : "Terminal session";

    // Get min columnOrder in running column
    const minOrder = db
      .prepare(
        "SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE status = 'running'"
      )
      .get() as { minOrder: number };

    const id = crypto.randomUUID();
    const sourceLessScope = createSoloStoredWorkScope(detectedClientId);
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
      clientId: detectedClientId,
      workScope: sourceLessScope,
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
      archivedAt: null,
    };

    db.prepare(
      `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, workScope, needsInput, phaseNumber, gsdStep, contextSources, cronJobSlug, claudeSessionId, claudePid, permissionMode, executionPermissionMode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      task.id, task.title, task.description, task.status, task.level,
      task.parentId, task.projectSlug, task.columnOrder, task.createdAt,
      task.updatedAt, task.costUsd, task.tokensUsed, task.durationMs,
      task.activityLabel, task.errorMessage, task.startedAt, task.completedAt,
      task.clientId, serializeStoredWorkScope(sourceLessScope), task.needsInput ? 1 : 0, task.phaseNumber, task.gsdStep,
      task.contextSources, task.cronJobSlug, task.claudeSessionId, task.claudePid,
      task.permissionMode, task.executionPermissionMode
    );

    emitTaskEvent({ type: "task:created", task, timestamp: now });

    return NextResponse.json(
      { taskId: id, isNew: true, syncMode: "hook-owned" as const },
      { status: 201 }
    );
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("POST /api/tasks/sync-session error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
