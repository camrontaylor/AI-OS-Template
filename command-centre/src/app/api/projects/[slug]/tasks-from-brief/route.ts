import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import { assertTaskMutable, isTaskTreeReadOnlyError, TaskArchiveError } from "@/lib/task-archive";
import { normalizeClientId } from "@/lib/clients";
import type { Task } from "@/types/task";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";
import {
  assertNoWorkScopeInput,
  captureNewWorkScope,
  getTeamIdForWorkScope,
  inheritWorkScope,
  isWorkScopeError,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";

/**
 * POST /api/projects/[slug]/tasks-from-brief
 *
 * Parses the ## Deliverables section from brief.md and creates one subtask
 * per deliverable. Each list item becomes a subtask title; any nested
 * content (acceptance criteria, sub-bullets) becomes the description.
 *
 * Body: { clientId?: string, parentTaskId?: string }
 * Returns: { taskIds: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      clientId?: string;
      parentTaskId?: string;
    };
    assertNoWorkScopeInput(body);

    const db = getDb();
    const requestedClientId = normalizeClientId(body.clientId);
    const requestedScope = await captureNewWorkScope(requestedClientId);
    const requestedTeamId = getTeamIdForWorkScope(requestedScope.scope);
    const scopeFilter = requestedScope.scope.mode === "team"
      ? "AND json_extract(workScope, '$.mode') = 'team' AND json_extract(workScope, '$.scope.teamId') = ?"
      : "AND (workScope IS NULL OR json_extract(workScope, '$.mode') = 'solo')";

    let parentTask: Task | undefined;
    if (body.parentTaskId) {
      parentTask = db
        .prepare(
          "SELECT * FROM tasks WHERE id = ? AND parentId IS NULL AND projectSlug = ?"
        )
        .get(body.parentTaskId, slug) as Task | undefined;

      if (
        !parentTask ||
        (body.clientId !== undefined && normalizeClientId(parentTask.clientId) !== requestedClientId)
      ) {
        return NextResponse.json(
          { error: "Goal not found for this client and project" },
          { status: 404 }
        );
      }
    } else {
      parentTask = db
        .prepare(
          `SELECT * FROM tasks
           WHERE projectSlug = ?
             AND parentId IS NULL
             AND ((? IS NULL AND clientId IS NULL) OR clientId = ?)
             ${scopeFilter}
           ORDER BY createdAt DESC
           LIMIT 1`
        )
        .get(
          slug,
          requestedClientId,
          requestedClientId,
          ...(requestedTeamId ? [requestedTeamId] : []),
        ) as Task | undefined;
    }

    const inheritedScope = parentTask ? inheritWorkScope(parentTask) : null;
    if (parentTask) {
      assertTaskMutable(db, parentTask.id);
    }

    const clientId = parentTask
      ? normalizeClientId(parentTask.clientId)
      : requestedClientId;
    const baseDir = clientId
      ? getClientAiOsDir(clientId)
      : getConfig().aiOsDir;

    const briefPath = path.join(baseDir, "projects", "briefs", slug, "brief.md");
    if (!fs.existsSync(briefPath) || !isMaterializedPathAccessible(briefPath)) {
      return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    }

    const content = fs.readFileSync(briefPath, "utf-8");
    const deliverables = parseDeliverables(content);

    if (deliverables.length === 0) {
      return NextResponse.json(
        { error: "No deliverables found in brief.md" },
        { status: 400 }
      );
    }

    if (!parentTask) {
      return NextResponse.json(
        { error: "No parent task found for this project" },
        { status: 400 }
      );
    }

    const parentId = parentTask.id;

    // Check for existing subtasks — don't duplicate
    const existingCount = db
      .prepare("SELECT COUNT(*) as cnt FROM tasks WHERE parentId = ?")
      .get(parentId) as { cnt: number };
    if (existingCount.cnt > 0) {
      return NextResponse.json(
        { error: "Subtasks already exist for this project", existing: existingCount.cnt },
        { status: 409 }
      );
    }

    const inheritedPermissionMode = getActivePermissionMode(
      parentTask.permissionMode ?? "bypassPermissions",
      "bypassPermissions",
    );
    const inheritedExecutionMode = getExecutionPermissionMode(
      parentTask.executionPermissionMode ?? parentTask.permissionMode,
      "bypassPermissions",
    );
    const inheritedModel = parentTask.model ?? null;
    const inheritedThinkingEffort = parentTask.thinkingEffort ?? null;

    // Create subtasks
    const insertStmt = db.prepare(
      `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, workScope, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode, executionPermissionMode, model, thinkingEffort, dependsOnTaskIds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const minOrderRow = db
      .prepare(
        "SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE parentId = ?"
      )
      .get(parentId) as { minOrder: number };
    let nextOrder = minOrderRow.minOrder - 1;

    const taskIds: string[] = [];

    for (const del of deliverables) {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      const task: Task = {
        id,
        title: del.title,
        description: del.description || null,
        status: "backlog",
        level: "task",
        parentId,
        projectSlug: parentTask.projectSlug,
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
        clientId: inheritedScope!.clientId,
        workScope: inheritedScope!.scope,
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
        archivedAt: null,
        dependsOnTaskIds: null,
      };

      insertStmt.run(
        task.id, task.title, task.description, task.status, task.level,
        task.parentId, task.projectSlug, task.columnOrder, task.createdAt,
        task.updatedAt, null, null, null, null, null, null, null,
        task.clientId, inheritedScope!.serialized, 0, null, null, null, task.permissionMode, task.executionPermissionMode, task.model, task.thinkingEffort, null
      );

      emitTaskEvent({
        type: "task:created",
        task,
        timestamp: now,
      });

      taskIds.push(id);
      nextOrder -= 1;
    }

    return NextResponse.json({ taskIds }, { status: 201 });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    if (isTaskTreeReadOnlyError(error)) {
      return NextResponse.json({ error: "Restore this Goal before creating tasks." }, { status: 409 });
    }
    if (error instanceof TaskArchiveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("POST /api/projects/[slug]/tasks-from-brief error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Parse the ## Deliverables section from brief.md.
 * Expects markdown list items (- or *). Nested bullets or text after
 * the first line become the description (acceptance criteria).
 */
function parseDeliverables(
  content: string
): Array<{ title: string; description: string | null }> {
  // Find ## Deliverables section
  const sectionMatch = content.match(
    /## Deliverables\s*\n([\s\S]*?)(?=\n## |\n---|\Z)/
  );
  if (!sectionMatch) return [];

  const section = sectionMatch[1];
  const results: Array<{ title: string; description: string | null }> = [];

  // Split into top-level list items
  const lines = section.split("\n");
  let currentTitle: string | null = null;
  let currentDesc: string[] = [];

  for (const line of lines) {
    // Top-level list item: "- Something" or "* Something"
    const topLevel = line.match(/^[-*]\s+(.+)/);
    if (topLevel) {
      // Save previous item
      if (currentTitle) {
        const desc = currentDesc.join("\n").trim();
        results.push({
          title: currentTitle,
          description: desc || null,
        });
      }
      currentTitle = topLevel[1].trim();
      // Strip bold markers
      currentTitle = currentTitle.replace(/\*\*(.+?)\*\*/g, "$1");
      currentDesc = [];
      continue;
    }

    // Nested content (indented bullets, continuation text)
    if (currentTitle && line.match(/^\s{2,}/)) {
      // Clean up the nested line
      const cleaned = line.trim().replace(/^[-*]\s+/, "");
      if (cleaned) currentDesc.push(cleaned);
    }
  }

  // Save last item
  if (currentTitle) {
    const desc = currentDesc.join("\n").trim();
    results.push({
      title: currentTitle,
      description: desc || null,
    });
  }

  // Filter out placeholder text
  return results.filter(
    (d) =>
      !d.title.startsWith("_") &&
      !d.title.toLowerCase().includes("to be defined") &&
      !d.title.toLowerCase().includes("claude will define")
  );
}
