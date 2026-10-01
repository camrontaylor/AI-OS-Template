import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import { PermissionModeControlError, processManager } from "@/lib/process-manager";
import { getAutoModeUnavailability } from "@/lib/claude-capabilities.server";
import {
  isClaudeModel,
  isNullableClaudeThinkingEffort,
  normalizeClaudeModel,
  normalizeClaudeThinkingEffortForModel,
} from "@/lib/claude-options";
import type { Task, TaskUpdateInput } from "@/types/task";
import type Database from "better-sqlite3";
import {
  assertNoWorkScopeInput,
  inheritWorkScope,
  isWorkScopeError,
  normalizeWorkScopedRow,
  readWorkScopeFromRow,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import { isTaskArchived, isTaskTreeReadOnlyError } from "@/lib/task-archive";
import { revokeTaskPermissionRules } from "@/lib/task-permission-rules";

/**
 * Parse dependsOn metadata from task description.
 * Format: [depends_on: 0,2,3] at end of description.
 */
function parseDependsOn(description: string | null): number[] {
  if (!description) return [];
  const match = description.match(/\[depends_on:\s*([\d,\s]+)\]\s*$/);
  if (!match) return [];
  return match[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

/**
 * Check if a sibling's dependencies are all satisfied (done).
 * Dependencies are stored as indices in the original creation order (columnOrder).
 */
function areDependenciesSatisfied(
  db: Database.Database,
  sibling: Task,
  parentId: string
): boolean {
  const deps = parseDependsOn(sibling.description);
  if (deps.length === 0) return true; // No dependencies = independent

  // Get all siblings sorted by columnOrder to map indices
  const allSiblings = db.prepare(
    `SELECT id, status, columnOrder FROM tasks WHERE parentId = ? ORDER BY columnOrder ASC`
  ).all(parentId) as { id: string; status: string; columnOrder: number }[];

  for (const depIdx of deps) {
    if (depIdx >= 0 && depIdx < allSiblings.length) {
      if (allSiblings[depIdx].status !== "done") return false;
    }
  }
  return true;
}

/**
 * When a child task completes, auto-queue unblocked siblings.
 * Supports dependency-aware parallel execution:
 * - If siblings have dependsOn metadata: queue all whose deps are satisfied
 * - If no dependsOn metadata (legacy): sequential — queue next backlog sibling
 */
function autoQueueUnblockedSiblings(db: Database.Database, completedChild: Task, now: string): void {
  if (!completedChild.parentId) return;

  const backlogSiblings = db.prepare(
    `SELECT * FROM tasks WHERE parentId = ? AND status = 'backlog' ORDER BY columnOrder ASC`
  ).all(completedChild.parentId) as Task[];

  if (backlogSiblings.length === 0) {
    // Check if all siblings are done
    const remaining = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ? AND status != 'done'`
    ).get(completedChild.parentId) as { count: number };

    if (remaining.count === 0) {
      // All done — check if this is a GSD verify completion that should trigger next phase
      autoQueueNextPhase(db, completedChild, now);

      // Don't override a user-initiated "done" state — only move to review if not already done
      const parent = db.prepare("SELECT status FROM tasks WHERE id = ?").get(completedChild.parentId) as { status: string } | undefined;
      if (parent && parent.status !== "done") {
        db.prepare(
          "UPDATE tasks SET status = 'review', updatedAt = ?, activityLabel = NULL, needsInput = 0 WHERE id = ?"
        ).run(now, completedChild.parentId);
        const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(completedChild.parentId) as Task;
        emitTaskEvent({ type: "task:status", task: { ...updatedParent, needsInput: Boolean(updatedParent.needsInput) }, timestamp: now });
      }
    }
    return;
  }

  // Check if any siblings have dependsOn metadata
  const hasDependencyMetadata = backlogSiblings.some(s => parseDependsOn(s.description).length > 0);

  if (hasDependencyMetadata) {
    // Dependency-aware: queue ALL siblings whose dependencies are satisfied
    let queuedCount = 0;
    for (const sibling of backlogSiblings) {
      if (areDependenciesSatisfied(db, sibling, completedChild.parentId)) {
        // Auto-queue — no user gate for parallel execution
        db.prepare(
          "UPDATE tasks SET status = 'queued', updatedAt = ?, activityLabel = NULL WHERE id = ?"
        ).run(now, sibling.id);
        const updatedSibling = db.prepare("SELECT * FROM tasks WHERE id = ?").get(sibling.id) as Task;
        emitTaskEvent({ type: "task:status", task: { ...updatedSibling, needsInput: Boolean(updatedSibling.needsInput) }, timestamp: now });
        queuedCount++;
      }
    }

    // Update parent progress
    const completedCount = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ? AND status = 'done'`
    ).get(completedChild.parentId) as { count: number };
    const totalCount = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ?`
    ).get(completedChild.parentId) as { count: number };

    const label = queuedCount > 1
      ? `${completedCount.count}/${totalCount.count} done — ${queuedCount} tasks running in parallel`
      : `${completedCount.count}/${totalCount.count} tasks done — next task queued`;

    db.prepare(
      "UPDATE tasks SET status = 'running', updatedAt = ?, activityLabel = ?, startedAt = COALESCE(startedAt, ?) WHERE id = ?"
    ).run(now, label, now, completedChild.parentId);
    const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(completedChild.parentId) as Task;
    emitTaskEvent({ type: "task:status", task: { ...updatedParent, needsInput: Boolean(updatedParent.needsInput) }, timestamp: now });
  } else {
    // Legacy sequential: queue next backlog sibling with user gate
    const nextSibling = backlogSiblings[0];

    db.prepare(
      "UPDATE tasks SET status = 'review', updatedAt = ?, needsInput = 1, activityLabel = ? WHERE id = ?"
    ).run(now, "Ready to start — waiting for go-ahead", nextSibling.id);
    const updatedSibling = db.prepare("SELECT * FROM tasks WHERE id = ?").get(nextSibling.id) as Task;
    emitTaskEvent({ type: "task:status", task: { ...updatedSibling, needsInput: Boolean(updatedSibling.needsInput) }, timestamp: now });

    // Update parent progress
    const completedCount = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ? AND status = 'done'`
    ).get(completedChild.parentId) as { count: number };
    const totalCount = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ?`
    ).get(completedChild.parentId) as { count: number };

    db.prepare(
      "UPDATE tasks SET status = 'running', updatedAt = ?, activityLabel = ?, startedAt = COALESCE(startedAt, ?) WHERE id = ?"
    ).run(now, `${completedCount.count}/${totalCount.count} tasks done — next task queued`, now, completedChild.parentId);
    const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(completedChild.parentId) as Task;
    emitTaskEvent({ type: "task:status", task: { ...updatedParent, needsInput: Boolean(updatedParent.needsInput) }, timestamp: now });
  }
}

/**
 * Step 5b: GSD phase auto-progression.
 * When a GSD subtask with gsdStep "verify" completes, create the next phase's subtask.
 */
function autoQueueNextPhase(db: Database.Database, completedChild: Task, now: string): void {
  // Only applies to GSD verify steps
  if (completedChild.gsdStep !== "verify" || !completedChild.parentId) return;

  const parent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(completedChild.parentId) as
    | (Omit<Task, "workScope"> & { workScope: string | null })
    | undefined;
  if (!parent || parent.level !== "gsd") return;
  const inherited = inheritWorkScope(parent);

  const currentPhase = completedChild.phaseNumber;
  if (currentPhase == null) return;

  // Try to read total phases from the owning project's .planning/ROADMAP.md
  let totalPhases = 0;
  try {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const { isMaterializedPathAccessible } = require("@/lib/materialized-file-ownership") as typeof import("@/lib/materialized-file-ownership");
    const { resolvePlanningDir } = require("@/lib/config") as typeof import("@/lib/config");
    // Walk up from the completed child to find its GSD parent for the slug
    const parent = db.prepare("SELECT projectSlug FROM tasks WHERE id = ?")
      .get(completedChild.parentId) as { projectSlug: string | null } | undefined;
    const resolved = resolvePlanningDir({ overrideSlug: parent?.projectSlug ?? null });
    const roadmapPath = resolved ? path.join(resolved.planningDir, "ROADMAP.md") : "";
    if (roadmapPath && fs.existsSync(roadmapPath) && isMaterializedPathAccessible(roadmapPath)) {
      const content = fs.readFileSync(roadmapPath, "utf-8");
      // Count phase headings (## Phase N or ### Phase N)
      const phaseMatches = content.match(/^#{2,3}\s+Phase\s+\d+/gm);
      totalPhases = phaseMatches ? phaseMatches.length : 0;
    }
  } catch { /* proceed without roadmap info */ }

  const nextPhase = currentPhase + 1;

  if (totalPhases > 0 && nextPhase > totalPhases) {
    // Final phase verified — mark parent as review (project complete)
    db.prepare(
      "UPDATE tasks SET status = 'review', updatedAt = ?, activityLabel = ? WHERE id = ?"
    ).run(now, `All ${totalPhases} phases verified — project complete`, parent.id);
    const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(parent.id) as Task;
    emitTaskEvent({ type: "task:status", task: { ...updatedParent, needsInput: Boolean(updatedParent.needsInput) }, timestamp: now });
    return;
  }

  // Create next phase subtask
  const nextPhaseId = crypto.randomUUID();
  const nextTitle = `Phase ${nextPhase}: discuss`;

  db.prepare(
    `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, clientId, workScope, phaseNumber, gsdStep, permissionMode, executionPermissionMode, model, thinkingEffort)
     VALUES (?, ?, ?, 'queued', 'gsd', ?, ?, ?, ?, ?, ?, ?, ?, 'discuss', ?, ?, ?, ?)`
  ).run(
    nextPhaseId,
    nextTitle,
    `Phase ${nextPhase} discussion — auto-started after Phase ${currentPhase} verification`,
    parent.id,
    parent.projectSlug,
    Date.now(),
    now,
    now,
    inherited.clientId,
    inherited.serialized,
    nextPhase,
    parent.permissionMode || "bypassPermissions",
    parent.executionPermissionMode || parent.permissionMode || "bypassPermissions",
    parent.model ?? null,
    parent.thinkingEffort ?? null,
  );

  const newPhaseTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(nextPhaseId) as Task;
  emitTaskEvent({ type: "task:created", task: { ...newPhaseTask, needsInput: Boolean(newPhaseTask.needsInput) }, timestamp: now });

  // Update parent activity
  db.prepare(
    "UPDATE tasks SET updatedAt = ?, activityLabel = ? WHERE id = ?"
  ).run(now, `Phase ${currentPhase} verified — Phase ${nextPhase} starting`, parent.id);
  const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(parent.id) as Task;
  emitTaskEvent({ type: "task:status", task: { ...updatedParent, needsInput: Boolean(updatedParent.needsInput) }, timestamp: now });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | (Omit<Task, "workScope"> & { workScope: string | null })
      | undefined;

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...normalizeWorkScopedRow(task),
      needsInput: Boolean(task.needsInput),
    });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("GET /api/tasks/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const existing = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as (Omit<Task, "workScope"> & { workScope: string | null }) | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    readWorkScopeFromRow(existing);
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "Restore this Goal before making changes." }, { status: 409 });
    }

    const body = (await request.json()) as TaskUpdateInput;
    assertNoWorkScopeInput(body);
    const now = new Date().toISOString();

    if (body.status === "done") {
      body.needsInput = false;
      body.errorMessage = null;
      if (!("activityLabel" in body)) {
        body.activityLabel = null;
      }
      if (!("completedAt" in body) || body.completedAt == null) {
        body.completedAt = existing.completedAt ?? now;
      }
      revokeTaskPermissionRules(id, db);
    }

    if (body.status === "queued") {
      body.cancelRequestedAt = null;
      revokeTaskPermissionRules(id, db);
    }

    if ("thinkingEffort" in body && !isNullableClaudeThinkingEffort(body.thinkingEffort)) {
      return NextResponse.json(
        { error: 'thinkingEffort must be "auto", "low", "medium", "high", "xhigh", "max", or null' },
        { status: 400 }
      );
    }
    if ("model" in body && body.model !== null && body.model !== undefined && !isClaudeModel(body.model)) {
      return NextResponse.json(
        { error: "model must be a Claude model alias or model ID without spaces, or null" },
        { status: 400 }
      );
    }

    if ("model" in body || "thinkingEffort" in body) {
      const nextModel = "model" in body ? normalizeClaudeModel(body.model) : normalizeClaudeModel(existing.model);
      if ("model" in body) {
        body.model = nextModel;
      }
      const nextThinkingEffort = "thinkingEffort" in body
        ? body.thinkingEffort ?? null
        : existing.thinkingEffort ?? null;
      body.thinkingEffort = normalizeClaudeThinkingEffortForModel(nextModel, nextThinkingEffort);
    }

    if ("permissionMode" in body) {
      const normalizedPermission = getActivePermissionMode(
        body.permissionMode ?? existing.permissionMode,
        existing.permissionMode ?? "bypassPermissions",
      );
      body.permissionMode = normalizedPermission;
      if (!("executionPermissionMode" in body)) {
        body.executionPermissionMode =
          normalizedPermission === "plan"
            ? getExecutionPermissionMode(
                existing.executionPermissionMode ?? existing.permissionMode,
                "bypassPermissions",
              )
            : normalizedPermission;
      }
    }

    if ("executionPermissionMode" in body) {
      body.executionPermissionMode = getExecutionPermissionMode(
        body.executionPermissionMode ?? body.permissionMode ?? existing.executionPermissionMode ?? existing.permissionMode,
        existing.executionPermissionMode ?? "bypassPermissions",
      );
    }

    const hasPermissionUpdate = "permissionMode" in body || "executionPermissionMode" in body;
    const nextPermissionMode = getActivePermissionMode(
      body.permissionMode ?? existing.permissionMode,
      existing.permissionMode ?? "bypassPermissions",
    );
    const nextExecutionPermissionMode = getExecutionPermissionMode(
      body.executionPermissionMode ?? existing.executionPermissionMode ?? nextPermissionMode,
      existing.executionPermissionMode ?? "bypassPermissions",
    );
    const nextModel = normalizeClaudeModel("model" in body ? body.model : existing.model);
    const autoModeUnavailable = await getAutoModeUnavailability({
      permissionMode: nextPermissionMode,
      executionPermissionMode: nextExecutionPermissionMode,
      model: nextModel,
    });
    if (autoModeUnavailable) {
      return NextResponse.json(autoModeUnavailable, { status: 409 });
    }

    if (hasPermissionUpdate) {
      await processManager.applyPermissionState(id, {
        permissionMode: nextPermissionMode,
        executionPermissionMode: nextExecutionPermissionMode,
      });
      delete body.permissionMode;
      delete body.executionPermissionMode;
    }

    // Build dynamic update
    const updates: string[] = ["updatedAt = ?"];
    const values: unknown[] = [now];

    const allowedFields: (keyof TaskUpdateInput)[] = [
      "title",
      "description",
      "status",
      "level",
      "parentId",
      "columnOrder",
      "costUsd",
      "tokensUsed",
      "durationMs",
      "activityLabel",
      "errorMessage",
      "needsInput",
      "startedAt",
      "completedAt",
      "phaseNumber",
      "gsdStep",
      "permissionMode",
      "executionPermissionMode",
      "model",
      "thinkingEffort",
      "tag",
      "pinnedAt",
      "cancelRequestedAt",
    ];

    for (const field of allowedFields) {
      if (field in body) {
        updates.push(`${field} = ?`);
        // Convert boolean needsInput to integer for SQLite
        const val = body[field];
        values.push(field === "needsInput" ? (val ? 1 : 0) : (val ?? null));
      }
    }

    // Auto-set startedAt when transitioning to running/review/done if not already set
    const newStatus = body.status;
    if (newStatus && ["running", "review", "done"].includes(newStatus) && !existing.startedAt && !("startedAt" in body)) {
      updates.push("startedAt = ?");
      values.push(now);
    }

    values.push(id);

    db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(
      ...values
    );

    const updatedRaw = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as Omit<Task, "workScope"> & { workScope: string | null };

    const updated = normalizeWorkScopedRow(updatedRaw) as Task;
    const normalized = { ...updated, needsInput: Boolean(updated.needsInput) };
    emitTaskEvent({
      type: "task:updated",
      task: normalized,
      timestamp: now,
    });

    // Kill running process when task is manually marked done
    if (body.status === "done" && processManager.hasActiveSession(id)) {
      processManager.addLogEntry(id, {
        id: crypto.randomUUID(),
        type: "system" as const,
        timestamp: now,
        content: "Process terminated — task marked as done.",
        toolName: undefined,
        toolArgs: undefined,
        toolResult: undefined,
        isCollapsed: false,
        questionSpec: undefined,
        questionAnswers: undefined,
      });
      // Kill process only — don't touch DB or emit SSE (we already set status=done above)
      await processManager.killSession(id).catch(() => {});
    }

    // Auto-queue unblocked siblings when a child task is marked done
    if (body.status === "done" && updated.parentId) {
      autoQueueUnblockedSiblings(db, updated, now);

      // Auto-check the matching deliverable in brief.md
      if (updated.projectSlug) {
        try {
          const { getClientAiOsDir } = require("@/lib/config") as typeof import("@/lib/config");
          const { toggleDeliverableCheckbox } = require("@/lib/brief-sync") as typeof import("@/lib/brief-sync");
          const { readFile, writeFile } = require("@/lib/file-service") as typeof import("@/lib/file-service");

          const baseDir = getClientAiOsDir(updated.clientId ?? null);
          const briefRelPath = `projects/briefs/${updated.projectSlug}/brief.md`;
          const file = readFile(briefRelPath, baseDir);
          const updatedContent = toggleDeliverableCheckbox(file.content, updated.title, true);
          if (updatedContent !== file.content) {
            writeFile(briefRelPath, updatedContent, file.lastModified, baseDir);
          }
        } catch {
          // Non-critical — skip silently on failure
        }
      }
    }

    // When a parent task is moved to "queued", auto-queue independent children in parallel
    if (body.status === "queued" && !updated.parentId) {
      const backlogChildren = db.prepare(
        `SELECT * FROM tasks WHERE parentId = ? AND status = 'backlog' ORDER BY columnOrder ASC`
      ).all(id) as Task[];

      if (backlogChildren.length > 0) {
        const hasDeps = backlogChildren.some(c => parseDependsOn(c.description).length > 0);

        if (hasDeps) {
          // Queue all independent children (no dependencies) simultaneously
          for (const child of backlogChildren) {
            if (parseDependsOn(child.description).length === 0) {
              db.prepare(
                "UPDATE tasks SET status = 'queued', updatedAt = ? WHERE id = ?"
              ).run(now, child.id);
              const updatedChild = db.prepare("SELECT * FROM tasks WHERE id = ?").get(child.id) as Task;
              emitTaskEvent({ type: "task:status", task: { ...updatedChild, needsInput: Boolean(updatedChild.needsInput) }, timestamp: now });
            }
          }
        } else {
          // Sequential: queue first child only
          const firstChild = backlogChildren[0];
          db.prepare(
            "UPDATE tasks SET status = 'queued', updatedAt = ? WHERE id = ?"
          ).run(now, firstChild.id);
          const updatedChild = db.prepare("SELECT * FROM tasks WHERE id = ?").get(firstChild.id) as Task;
          emitTaskEvent({ type: "task:status", task: { ...updatedChild, needsInput: Boolean(updatedChild.needsInput) }, timestamp: now });
        }
      }
    }

    return NextResponse.json(normalized);
  } catch (error) {
    console.error("PATCH /api/tasks/[id] error:", error);
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    if (isTaskTreeReadOnlyError(error)) {
      return NextResponse.json(
        { error: "Restore this Goal before moving or creating tasks." },
        { status: 409 },
      );
    }
    if (error instanceof PermissionModeControlError) {
      return NextResponse.json(
        { code: "permission_mode_change_failed", error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const existing = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as (Omit<Task, "workScope"> & { workScope: string | null }) | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const normalizedExisting = normalizeWorkScopedRow(existing) as Task;
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "Restore this Goal before deleting tasks." }, { status: 409 });
    }

    // Kill any running session first
    await processManager.killSession(id).catch(() => {});
    // Also kill child task sessions
    const children = db.prepare("SELECT id FROM tasks WHERE parentId = ?").all(id) as { id: string }[];
    for (const child of children) {
      await processManager.killSession(child.id).catch(() => {});
    }

    processManager.removeTaskContextOverlay(id);
    for (const child of children) {
      processManager.removeTaskContextOverlay(child.id);
    }

    // Delete child tasks first
    db.prepare("DELETE FROM tasks WHERE parentId = ?").run(id);
    // Delete the task itself
    db.prepare("DELETE FROM tasks WHERE id = ?").run(id);

    emitTaskEvent({
      type: "task:deleted",
      task: normalizedExisting,
      timestamp: new Date().toISOString(),
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("DELETE /api/tasks/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
