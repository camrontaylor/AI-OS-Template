import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolvePlanningDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import type { Task } from "@/types/task";

/**
 * PATCH /api/gsd/phase-status
 * Body: { phaseNumber: number, status: "complete" | "in-progress" | "not-started" }
 *
 * Updates the ## Progress table in ROADMAP.md and the phase checklist.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { phaseNumber, status } = (await request.json()) as {
      phaseNumber: number;
      status: "complete" | "in-progress" | "not-started";
    };

    if (!phaseNumber || !status) {
      return NextResponse.json({ error: "phaseNumber and status required" }, { status: 400 });
    }

    const projectOverride = request.nextUrl.searchParams.get("project");
    const resolved = resolvePlanningDir({ overrideSlug: projectOverride });

    if (!resolved) {
      return NextResponse.json({ error: "No active planning directory" }, { status: 404 });
    }

    const roadmapPath = path.join(resolved.planningDir, "ROADMAP.md");

    if (!fs.existsSync(roadmapPath)) {
      return NextResponse.json({ error: "ROADMAP.md not found" }, { status: 404 });
    }

    let content = fs.readFileSync(roadmapPath, "utf-8");
    const today = new Date().toISOString().slice(0, 10);

    // 1. Update the ## Progress table row for this phase
    const progressTableRegex = new RegExp(
      `^(\\|\\s*${phaseNumber}\\.\\s*.+?\\|.+?\\|)\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|`,
      "m"
    );
    const progressMatch = content.match(progressTableRegex);
    if (progressMatch) {
      const statusText = status === "complete" ? "Complete" : status === "in-progress" ? "In Progress" : "Not Started";
      const dateText = status === "complete" ? today : "-";
      content = content.replace(
        progressTableRegex,
        `${progressMatch[1]} ${statusText} | ${dateText} |`
      );
    }

    // 2. Update the phase checklist line: - [x] **Phase N: or - [ ] **Phase N:
    const checklistRegex = new RegExp(
      `^- \\[[ x]\\] (\\*\\*Phase ${phaseNumber}:.+)$`,
      "m"
    );
    const checklistMatch = content.match(checklistRegex);
    if (checklistMatch) {
      const check = status === "complete" ? "x" : " ";
      let line = `- [${check}] ${checklistMatch[1]}`;
      // Add/update completion date for complete phases
      if (status === "complete") {
        // Remove any existing date annotation
        line = line.replace(/\s*\(completed [^)]+\)\s*$/, "");
        line += ` (completed ${today})`;
      }
      content = content.replace(checklistRegex, line);
    }

    fs.writeFileSync(roadmapPath, content);

    // 3. Sync child task rows for this phase in the DB so the board stops
    //    re-queueing Plan/Execute/Verify tasks for a phase the user has
    //    manually marked complete (or reopened).
    let updatedTaskCount = 0;
    try {
      const db = getDb();
      const existing = db
        .prepare(
          "SELECT * FROM tasks WHERE phaseNumber = ? AND gsdStep IS NOT NULL"
        )
        .all(phaseNumber) as Task[];

      const now = new Date().toISOString();

      for (const task of existing) {
        let nextStatus: string | null = null;
        if (status === "complete") {
          if (task.status !== "done") nextStatus = "done";
        } else if (status === "not-started") {
          if (task.status === "done") nextStatus = "backlog";
        } else if (status === "in-progress") {
          // Leave discuss as done, reset later steps to backlog if they had
          // been force-completed.
          if (task.gsdStep !== "discuss" && task.status === "done") {
            nextStatus = "backlog";
          }
        }

        if (!nextStatus) continue;

        db.prepare(
          "UPDATE tasks SET status = ?, completedAt = ?, updatedAt = ? WHERE id = ?"
        ).run(
          nextStatus,
          nextStatus === "done" ? now : null,
          now,
          task.id
        );

        const updated = db
          .prepare("SELECT * FROM tasks WHERE id = ?")
          .get(task.id) as Task;
        emitTaskEvent({
          type: "task:updated",
          task: { ...updated, needsInput: Boolean(updated.needsInput) },
          timestamp: now,
        });
        updatedTaskCount++;
      }

      // Update parent project activity label with fresh phase progress count
      if (existing.length > 0 && existing[0].parentId) {
        const parentId = existing[0].parentId;
        // Count distinct phases that are fully done for this parent
        const phaseRows = db
          .prepare(
            "SELECT phaseNumber, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as doneSteps, COUNT(*) as total FROM tasks WHERE parentId = ? AND phaseNumber IS NOT NULL AND gsdStep IS NOT NULL GROUP BY phaseNumber"
          )
          .all(parentId) as Array<{ phaseNumber: number; doneSteps: number; total: number }>;
        const donePhases = phaseRows.filter((r) => r.total > 0 && r.doneSteps === r.total).length;
        const totalPhases = phaseRows.length;
        if (totalPhases > 0) {
          db.prepare(
            "UPDATE tasks SET activityLabel = ?, updatedAt = ? WHERE id = ?"
          ).run(`${donePhases}/${totalPhases} phases complete`, now, parentId);
        }
      }
    } catch (dbError) {
      console.error("PATCH /api/gsd/phase-status db sync error:", dbError);
      // Don't fail the whole request — the roadmap was already updated.
    }

    return NextResponse.json({ success: true, phaseNumber, status, updatedTaskCount });
  } catch (error) {
    console.error("PATCH /api/gsd/phase-status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
