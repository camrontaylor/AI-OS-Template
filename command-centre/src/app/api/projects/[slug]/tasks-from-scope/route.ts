import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import type { Task } from "@/types/task";
import type { ScopeResult } from "@/app/api/tasks/scope-goal/route";

/**
 * POST /api/projects/[slug]/tasks-from-scope
 *
 * Materialises the `suggestedSubtasks` from a ScopeResult into real tasks
 * under the given project. Runs in two passes so dependsOn indices can be
 * resolved to real task IDs after the rows exist.
 *
 * Body: { scope: ScopeResult, parentTaskId?: string, clientId?: string }
 * Returns: { taskIds: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = (await request.json()) as {
      scope: ScopeResult;
      parentTaskId?: string;
      clientId?: string;
    };

    if (!body?.scope || !Array.isArray(body.scope.suggestedSubtasks)) {
      return NextResponse.json(
        { error: "scope with suggestedSubtasks is required" },
        { status: 400 }
      );
    }

    // Look up the project via the brief file (matches existing patterns in /api/projects).
    const baseDir =
      body.clientId && body.clientId !== "root"
        ? getClientAiOsDir(body.clientId)
        : getConfig().agenticOsDir;

    const briefPath = path.join(baseDir, "projects", "briefs", slug, "brief.md");
    if (!fs.existsSync(briefPath)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const db = getDb();
    const subtasks = body.scope.suggestedSubtasks;
    const clientId = body.clientId && body.clientId !== "root" ? body.clientId : null;

    // Resolve the effective parent task id for the inserted subtasks.
    // Priority:
    //   1. Explicit parentTaskId from the caller
    //   2. The existing materialized project parent row for this slug
    //   3. Create one inline — we cannot rely on the background syncProjects
    //      having run yet, and without a parent row the subtasks surface as
    //      orphans in the feed instead of grouping under the project card.
    let parentId: string | null = body.parentTaskId || null;
    if (!parentId) {
      const existingParent = db
        .prepare(
          "SELECT id FROM tasks WHERE projectSlug = ? AND parentId IS NULL LIMIT 1"
        )
        .get(slug) as { id: string } | undefined;
      if (existingParent?.id) {
        parentId = existingParent.id;
      }
    }

    // Still no parent? Create one now from the brief.
    if (!parentId) {
      const briefContent = fs.readFileSync(briefPath, "utf-8");
      const h1 = briefContent.match(/^# (.+)$/m);
      const projectName = h1
        ? h1[1].trim()
        : slug
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
      const goalMatch = briefContent.match(/## Goal\s*\n+(.+)/);
      const goalText = goalMatch ? goalMatch[1].trim() : null;
      const fmLevelMatch = briefContent.match(/^level:\s*(\d+)/m);
      const level =
        fmLevelMatch && fmLevelMatch[1] === "3" ? "gsd" : "project";

      const now = new Date().toISOString();
      const parentTaskId = crypto.randomUUID();
      const parentMinOrderRow = db
        .prepare(
          "SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE parentId IS NULL"
        )
        .get() as { minOrder: number };

      db.prepare(
        `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, clientId, needsInput, permissionMode, executionPermissionMode)
         VALUES (?, ?, ?, 'backlog', ?, NULL, ?, ?, ?, ?, ?, 0, 'bypassPermissions', 'bypassPermissions')`
      ).run(
        parentTaskId,
        projectName,
        goalText,
        level,
        slug,
        parentMinOrderRow.minOrder - 1,
        now,
        now,
        clientId,
      );

      parentId = parentTaskId;

      const parentRow = db
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(parentTaskId) as Task | undefined;
      if (parentRow) {
        emitTaskEvent({
          type: "task:created",
          task: { ...parentRow, needsInput: Boolean(parentRow.needsInput) },
          timestamp: now,
        });
      }
    }

    const parentTask = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(parentId) as Task | undefined;
    const inheritedPermissionMode = getActivePermissionMode(
      parentTask?.permissionMode ?? "bypassPermissions",
      "bypassPermissions",
    );
    const inheritedExecutionMode = getExecutionPermissionMode(
      parentTask?.executionPermissionMode ?? parentTask?.permissionMode,
      "bypassPermissions",
    );
    const inheritedModel = parentTask?.model ?? null;
    const inheritedThinkingEffort = parentTask?.thinkingEffort ?? null;

    // Pass 1: insert a row for each suggested subtask.
    const createdIds: string[] = [];
    const createdTasks: Task[] = [];

    const insertStmt = db.prepare(
      `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode, executionPermissionMode, model, thinkingEffort, dependsOnTaskIds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // Get min columnOrder so new tasks sort to the top of queued, matching the /api/tasks POST behaviour.
    const minOrderRow = db
      .prepare(
        "SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE status = 'queued'"
      )
      .get() as { minOrder: number };
    let nextOrder = minOrderRow.minOrder - 1;

    for (const sub of subtasks) {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      // Child tasks start backlog; otherwise queued (match /api/tasks POST).
      const initialStatus = parentId ? "backlog" : "queued";

      const task: Task = {
        id,
        title: (sub.title || "Untitled").trim(),
        description: sub.description?.trim() || null,
        status: initialStatus,
        level: "task",
        parentId,
        projectSlug: slug,
        columnOrder: nextOrder,
        createdAt: now,
        updatedAt: now,
        costUsd: null,
        tokensUsed: null,
        durationMs: null,
        activityLabel: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        clientId,
        needsInput: false,
        phaseNumber: null,
        gsdStep: null,
        contextSources: null,
        cronJobSlug: null,
        claudeSessionId: null,
        permissionMode: inheritedPermissionMode,
        executionPermissionMode: inheritedExecutionMode,
        model: inheritedModel,
        thinkingEffort: inheritedThinkingEffort,
        lastReplyAt: null,
        goalGroup: null,
        tag: null,
        pinnedAt: null,
        dependsOnTaskIds: null,
      };

      insertStmt.run(
        task.id,
        task.title,
        task.description,
        task.status,
        task.level,
        task.parentId,
        task.projectSlug,
        task.columnOrder,
        task.createdAt,
        task.updatedAt,
        task.costUsd,
        task.tokensUsed,
        task.durationMs,
        task.activityLabel,
        task.errorMessage,
        task.startedAt,
        task.completedAt,
        task.clientId,
        0,
        task.phaseNumber,
        task.gsdStep,
        task.cronJobSlug,
        task.permissionMode,
        task.executionPermissionMode,
        task.model,
        task.thinkingEffort,
        null
      );

      createdIds.push(id);
      createdTasks.push(task);
      nextOrder -= 1;
    }

    // Pass 2: resolve dependsOn indices → real task IDs, UPDATE rows.
    const updateStmt = db.prepare(
      "UPDATE tasks SET dependsOnTaskIds = ?, updatedAt = ? WHERE id = ?"
    );

    for (let i = 0; i < subtasks.length; i++) {
      const depsIdx = Array.isArray(subtasks[i].dependsOn) ? subtasks[i].dependsOn : [];
      if (depsIdx.length === 0) continue;
      const depIds = depsIdx
        .map((idx) => createdIds[idx])
        .filter((v): v is string => typeof v === "string");
      if (depIds.length === 0) continue;

      const now = new Date().toISOString();
      updateStmt.run(JSON.stringify(depIds), now, createdIds[i]);
      createdTasks[i].dependsOnTaskIds = depIds;
      createdTasks[i].updatedAt = now;
    }

    for (const task of createdTasks) {
      emitTaskEvent({
        type: "task:created",
        task,
        timestamp: task.createdAt,
      });
    }

    return NextResponse.json({ taskIds: createdIds }, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[slug]/tasks-from-scope error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
