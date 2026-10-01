import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "@/lib/file-service";
import { getDb } from "@/lib/db";
import { getClientAiOsDir } from "@/lib/config";
import {
  parseDeliverables,
  appendDeliverable,
  findNewDeliverables,
  toggleDeliverableCheckbox,
} from "@/lib/brief-sync";
import { assertTaskMutable, isTaskTreeReadOnlyError, TaskArchiveError } from "@/lib/task-archive";
import { normalizeClientId } from "@/lib/clients";
import crypto from "crypto";
import {
  assertNoWorkScopeInput,
  inheritWorkScope,
  isWorkScopeError,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";

/**
 * POST /api/briefs/sync
 *
 * Two operations:
 *
 * 1. action: "sync-deliverables-to-tasks"
 *    Reads the brief, finds deliverables that don't have matching subtasks,
 *    creates tasks for them.
 *
 * 2. action: "add-to-brief"
 *    Appends a new deliverable line to the brief and optionally returns updated content.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    assertNoWorkScopeInput(body);
    const { action, projectSlug, parentId, clientId } = body as {
      action: string;
      projectSlug: string;
      parentId: string;
      clientId?: string | null;
    };

    if (!projectSlug) {
      return NextResponse.json({ error: "projectSlug is required" }, { status: 400 });
    }

    const db = getDb();
    const normalizedClientId = normalizeClientId(clientId);
    const clientIdProvided = Object.prototype.hasOwnProperty.call(body, "clientId");
    let guardedTask: {
      id: string;
      clientId: string | null;
      projectSlug: string | null;
      workScope: string | null;
    } | undefined;

    if (parentId) {
      guardedTask = db.prepare(
        `SELECT id, clientId, projectSlug, workScope FROM tasks
         WHERE id = ? AND parentId IS NULL AND projectSlug = ?`
      ).get(parentId, projectSlug) as typeof guardedTask;

      if (
        !guardedTask ||
        (clientIdProvided && normalizeClientId(guardedTask.clientId) !== normalizedClientId)
      ) {
        return NextResponse.json(
          { error: "Goal not found for this client and project" },
          { status: 404 }
        );
      }
    } else {
      guardedTask = db.prepare(
          `SELECT id, clientId, projectSlug, workScope FROM tasks
           WHERE projectSlug = ?
             AND parentId IS NULL
             AND ((? IS NULL AND clientId IS NULL) OR clientId = ?)
           ORDER BY createdAt DESC
           LIMIT 1`
        ).get(projectSlug, normalizedClientId, normalizedClientId) as typeof guardedTask;
    }

    const effectiveClientId = guardedTask
      ? normalizeClientId(guardedTask.clientId)
      : normalizedClientId;
    const baseDir = getClientAiOsDir(effectiveClientId);
    const briefPath = `projects/briefs/${projectSlug}/brief.md`;

    const inherited = guardedTask ? inheritWorkScope(guardedTask) : null;
    if (guardedTask) {
      assertTaskMutable(db, guardedTask.id);
    }

    if (action === "sync-deliverables-to-tasks") {
      if (!guardedTask) {
        return NextResponse.json(
          { error: "No parent Goal found for this project" },
          { status: 400 }
        );
      }

      // Read the brief
      let briefContent: string;
      try {
        const file = readFile(briefPath, baseDir);
        briefContent = file.content;
      } catch {
        return NextResponse.json({ error: "Brief not found" }, { status: 404 });
      }

      const deliverables = parseDeliverables(briefContent);
      if (deliverables.length === 0) {
        return NextResponse.json({ created: [], message: "No deliverables found in brief" });
      }

      // Get existing child task titles
      const existingTasks = db
        .prepare("SELECT title FROM tasks WHERE parentId = ?")
        .all(guardedTask.id) as { title: string }[];

      const newDeliverables = findNewDeliverables(
        deliverables,
        existingTasks.map((t) => t.title),
      );

      if (newDeliverables.length === 0) {
        return NextResponse.json({ created: [], message: "All deliverables already have matching tasks" });
      }

      // Create tasks for new deliverables
      const now = new Date().toISOString();
      const created: { id: string; title: string }[] = [];
      const maxOrder = (
        db.prepare("SELECT MAX(columnOrder) as m FROM tasks WHERE parentId = ?").get(guardedTask.id) as { m: number | null }
      )?.m ?? 0;

      for (let i = 0; i < newDeliverables.length; i++) {
        const id = crypto.randomUUID();
        const title = newDeliverables[i];
        db.prepare(
          `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, needsInput, clientId, workScope)
           VALUES (?, ?, ?, 'backlog', 'task', ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(
          id,
          title,
          null,
          guardedTask.id,
          guardedTask.projectSlug,
          maxOrder + i + 1,
          now,
          now,
          inherited!.clientId,
          inherited!.serialized,
        );
        created.push({ id, title });
      }

      return NextResponse.json({ created });

    } else if (action === "add-to-brief") {
      const { deliverable } = body as { deliverable: string };
      if (!deliverable) {
        return NextResponse.json({ error: "deliverable is required" }, { status: 400 });
      }

      // Read current brief
      let briefContent: string;
      let lastModified: string | undefined;
      try {
        const file = readFile(briefPath, baseDir);
        briefContent = file.content;
        lastModified = file.lastModified;
      } catch {
        return NextResponse.json({ error: "Brief not found" }, { status: 404 });
      }

      // Append the new deliverable
      const updatedContent = appendDeliverable(briefContent, deliverable);
      writeFile(briefPath, updatedContent, lastModified, baseDir);

      return NextResponse.json({ success: true });

    } else if (action === "mark-deliverable") {
      const { subtaskTitle, checked } = body as { subtaskTitle: string; checked: boolean };
      if (!subtaskTitle) {
        return NextResponse.json({ error: "subtaskTitle is required" }, { status: 400 });
      }

      // Read current brief
      let briefContent: string;
      let lastModified: string | undefined;
      try {
        const file = readFile(briefPath, baseDir);
        briefContent = file.content;
        lastModified = file.lastModified;
      } catch {
        return NextResponse.json({ error: "Brief not found" }, { status: 404 });
      }

      const updatedContent = toggleDeliverableCheckbox(briefContent, subtaskTitle, checked ?? true);
      if (updatedContent !== briefContent) {
        writeFile(briefPath, updatedContent, lastModified, baseDir);
      }

      return NextResponse.json({ success: true });

    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
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
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
