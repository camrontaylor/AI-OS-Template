import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import type { Task } from "@/types/task";

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

    const baseDir =
      body.clientId && body.clientId !== "root"
        ? getClientAiOsDir(body.clientId)
        : getConfig().agenticOsDir;

    const briefPath = path.join(baseDir, "projects", "briefs", slug, "brief.md");
    if (!fs.existsSync(briefPath)) {
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

    const db = getDb();
    const clientId = body.clientId && body.clientId !== "root" ? body.clientId : null;

    // Find or create the parent task for this project
    let parentId: string | null = body.parentTaskId || null;
    if (!parentId) {
      const existing = db
        .prepare(
          "SELECT id FROM tasks WHERE projectSlug = ? AND parentId IS NULL LIMIT 1"
        )
        .get(slug) as { id: string } | undefined;
      parentId = existing?.id ?? null;
    }

    if (!parentId) {
      return NextResponse.json(
        { error: "No parent task found for this project" },
        { status: 400 }
      );
    }

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

    // Create subtasks
    const insertStmt = db.prepare(
      `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode, executionPermissionMode, model, thinkingEffort, dependsOnTaskIds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        task.id, task.title, task.description, task.status, task.level,
        task.parentId, task.projectSlug, task.columnOrder, task.createdAt,
        task.updatedAt, null, null, null, null, null, null, null,
        task.clientId, 0, null, null, null, task.permissionMode, task.executionPermissionMode, task.model, task.thinkingEffort, null
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
