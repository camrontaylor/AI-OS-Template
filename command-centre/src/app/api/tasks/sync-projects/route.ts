import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { getConfig, getClientAiOsDir, resolvePlanningDir } from "@/lib/config";
import { emitTaskEvent } from "@/lib/event-bus";
import { parseRoadmap } from "@/lib/gsd-parser";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import type { Task, GsdStep } from "@/types/task";

const GSD_STEPS: GsdStep[] = ["discuss", "plan", "execute", "verify"];
const STEP_TITLES: Record<GsdStep, string> = {
  discuss: "Discuss", plan: "Plan", execute: "Execute", verify: "Verify",
};

// POST /api/tasks/sync-projects?clientId=xxx
// Ensures every active project brief has a corresponding task in the DB.
// For GSD projects, also syncs phases from ROADMAP.md as child tasks.
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    const config = getConfig();
    const baseDir =
      clientId && clientId !== "root"
        ? getClientAiOsDir(clientId)
        : config.agenticOsDir;

    const briefsDir = path.join(baseDir, "projects", "briefs");
    if (!fs.existsSync(briefsDir)) {
      return NextResponse.json({ synced: 0 });
    }

    const db = getDb();
    const entries = fs.readdirSync(briefsDir, { withFileTypes: true });
    let synced = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const briefPath = path.join(briefsDir, entry.name, "brief.md");
      if (!fs.existsSync(briefPath)) continue;

      const content = fs.readFileSync(briefPath, "utf-8");
      const parsed = parseBrief(content, entry.name);
      if (!parsed || parsed.status !== "active") continue;

      const level = parsed.level === 3 ? "gsd" : parsed.level === 2 ? "project" : "task";

      // Check if a task with this projectSlug already exists
      let parentTask = db.prepare(
        "SELECT * FROM tasks WHERE projectSlug = ? AND parentId IS NULL"
      ).get(parsed.slug) as Task | undefined;

      if (!parentTask) {
        // Create a task for this project
        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        const minOrder = db.prepare(
          "SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE status = 'queued'"
        ).get() as { minOrder: number };

        db.prepare(
          `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, clientId, permissionMode, executionPermissionMode)
           VALUES (?, ?, ?, 'running', ?, NULL, ?, ?, ?, ?, ?, 'bypassPermissions', 'bypassPermissions')`
        ).run(
          id,
          parsed.name,
          parsed.goal,
          level,
          parsed.slug,
          minOrder.minOrder - 1,
          now,
          now,
          clientId || null,
        );

        parentTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
        emitTaskEvent({
          type: "task:created",
          task: { ...parentTask, needsInput: Boolean(parentTask.needsInput) },
          timestamp: now,
        });

        synced++;
      }

      // For GSD projects, sync phases from the brief's own .planning/ROADMAP.md
      if (level === "gsd" && parentTask) {
        const resolved = resolvePlanningDir({ baseDir, overrideSlug: parsed.slug });
        const planningDir = resolved?.planningDir ?? "";
        const roadmapPath = planningDir ? path.join(planningDir, "ROADMAP.md") : "";

        if (planningDir && fs.existsSync(roadmapPath)) {
          const roadmapContent = fs.readFileSync(roadmapPath, "utf-8");
          const phasesDir = path.join(planningDir, "phases");
          const phases = parseRoadmap(roadmapContent, phasesDir);

          // Get existing children
          const existingChildren = db.prepare(
            "SELECT phaseNumber, gsdStep FROM tasks WHERE parentId = ? AND phaseNumber IS NOT NULL AND gsdStep IS NOT NULL"
          ).all(parentTask.id) as Array<{ phaseNumber: number; gsdStep: string }>;

          const existingSet = new Set(existingChildren.map((c) => `${c.phaseNumber}:${c.gsdStep}`));

          const now = new Date().toISOString();

          for (const phase of phases) {
            for (let stepIdx = 0; stepIdx < GSD_STEPS.length; stepIdx++) {
              const step = GSD_STEPS[stepIdx];
              const key = `${phase.number}:${step}`;
              if (existingSet.has(key)) continue;

              let status: string;
              if (phase.status === "complete") {
                status = "done";
              } else if (phase.status === "in-progress") {
                status = step === "discuss" ? "done" : "backlog";
              } else {
                status = "backlog";
              }

              const taskId = crypto.randomUUID();
              const title = `Phase ${phase.number}: ${STEP_TITLES[step]} — ${phase.name}`;
              const columnOrder = phase.number * 100 + stepIdx;

              const inheritedPermissionMode = getActivePermissionMode(
                parentTask.permissionMode ?? "bypassPermissions",
                "bypassPermissions",
              );
              const inheritedExecutionMode = getExecutionPermissionMode(
                parentTask.executionPermissionMode ?? parentTask.permissionMode,
                "bypassPermissions",
              );
              db.prepare(
                `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, clientId, needsInput, phaseNumber, gsdStep, permissionMode, executionPermissionMode, model, thinkingEffort)
                 VALUES (?, ?, ?, ?, 'task', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
              ).run(
                taskId, title,
                `Run /gsd-${step === "execute" ? "execute-phase" : step === "verify" ? "verify-work" : step === "plan" ? "plan-phase" : "discuss-phase"} for Phase ${phase.number}`,
                status,
                parentTask!.id, parentTask!.projectSlug, columnOrder,
                now, now, parentTask!.clientId,
                phase.number, step, inheritedPermissionMode, inheritedExecutionMode, parentTask!.model ?? null, parentTask!.thinkingEffort ?? null,
              );

              const childTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
              emitTaskEvent({ type: "task:created", task: { ...childTask, needsInput: false }, timestamp: now });
            }
          }

          // Update parent activity label with phase progress.
          // IMPORTANT: never force status back to 'running' — if the user has
          // manually marked the project done (or review), respect that and
          // only refresh the activity label. Forcing status here would
          // resurrect completed GSD projects on every sync.
          const donePhases = phases.filter((p) => p.status === "complete").length;
          const activityLabel = `${donePhases}/${phases.length} phases complete`;
          const currentStatus = parentTask.status;
          if (currentStatus === "done" || currentStatus === "review") {
            db.prepare(
              "UPDATE tasks SET activityLabel = ?, updatedAt = ? WHERE id = ?"
            ).run(activityLabel, new Date().toISOString(), parentTask.id);
          } else {
            db.prepare(
              "UPDATE tasks SET activityLabel = ?, status = 'running', updatedAt = ? WHERE id = ?"
            ).run(activityLabel, new Date().toISOString(), parentTask.id);
          }
        }
      }

      // For Level 2 projects, sync deliverables from brief as child tasks.
      // IMPORTANT: only run this on the FIRST sync (when no children exist yet).
      // After initial creation the subtask table is authoritative — re-parsing
      // brief.md on every sync causes duplicate rows whenever Claude rewrites
      // a bullet with slightly different phrasing, and can leak prompt-prefix
      // artifacts ("[Project Context: ...]") into the subtask list.
      if (level === "project" && parentTask) {
        const existingCount = db.prepare(
          "SELECT COUNT(*) as cnt FROM tasks WHERE parentId = ?"
        ).get(parentTask.id) as { cnt: number };

        if (existingCount.cnt === 0) {
          const deliverables = parseDeliverables(content)
            // Drop garbage: prompt-prefix artifacts, empty strings, dupes.
            .map((d) => d.trim())
            .filter((d) => d.length > 0 && !d.startsWith("[Project Context:"));
          const seen = new Set<string>();
          const now = new Date().toISOString();
          let order = 0;

          for (const title of deliverables) {
            if (seen.has(title)) continue;
            seen.add(title);

            const taskId = crypto.randomUUID();
            db.prepare(
              `INSERT INTO tasks (id, title, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, clientId, needsInput, permissionMode, executionPermissionMode, model, thinkingEffort)
               VALUES (?, ?, 'backlog', 'task', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
            ).run(
              taskId, title,
              parentTask.id, parentTask.projectSlug, order++,
              now, now, parentTask.clientId,
              getActivePermissionMode(parentTask.permissionMode ?? "bypassPermissions", "bypassPermissions"),
              getExecutionPermissionMode(parentTask.executionPermissionMode ?? parentTask.permissionMode, "bypassPermissions"),
              parentTask.model ?? null,
              parentTask.thinkingEffort ?? null,
            );
          }
        }
      }
    }

    return NextResponse.json({ synced });
  } catch (error) {
    console.error("POST /api/tasks/sync-projects error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function parseBrief(content: string, slug: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    fields[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
  }

  // Extract project name from H1 heading
  const h1 = content.match(/^# (.+)$/m);
  const name = h1 ? h1[1].trim() : slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  // Extract goal
  const goalMatch = content.match(/## Goal\s*\n+(.+)/);
  const goal = goalMatch ? goalMatch[1].trim() : null;

  return {
    slug,
    name,
    status: fields.status || "unknown",
    level: parseInt(fields.level || "2", 10),
    goal,
  };
}

// Extract deliverable items from brief markdown (lines starting with - [ ] or - [x])
function parseDeliverables(content: string): string[] {
  const section = content.match(/## Deliverables\s*\n([\s\S]*?)(?=\n##|\n---|\Z)/);
  if (!section) return [];
  const lines = section[1].split("\n");
  const items: string[] = [];
  for (const line of lines) {
    const match = line.match(/^-\s+\[[ x]\]\s+(.+)/i);
    if (match) items.push(match[1].trim());
  }
  return items;
}
