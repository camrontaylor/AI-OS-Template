import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { getConfig, resolvePlanningDir } from "@/lib/config";
import { parseRoadmap } from "@/lib/gsd-parser";
import { emitTaskEvent } from "@/lib/event-bus";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import type { Task, GsdStep } from "@/types/task";

/**
 * POST /api/gsd/ensure-task
 *
 * Ensures a GSD parent task exists on the board when .planning/ is active.
 * - If .planning/ROADMAP.md exists but no GSD task is on the board, creates one
 * - If a GSD task exists, updates its status based on current phase state
 * - Also syncs phase subtasks if the parent exists
 *
 * Called on dashboard and board mount to keep things in sync.
 */

const GSD_STEPS: GsdStep[] = ["discuss", "plan", "execute", "verify"];
const STEP_TITLES: Record<GsdStep, string> = {
  discuss: "Discuss",
  plan: "Plan",
  execute: "Execute",
  verify: "Verify",
};

export async function POST(request: Request) {
  try {
    const { agenticOsDir } = getConfig();
    const url = new URL(request.url);
    const projectOverride = url.searchParams.get("project");
    const resolved = resolvePlanningDir({ overrideSlug: projectOverride });

    if (!resolved) {
      return NextResponse.json({ synced: false, reason: "no-planning" });
    }

    const { planningDir, projectSlug: resolvedSlug } = resolved;
    const roadmapPath = path.join(planningDir, "ROADMAP.md");

    if (!fs.existsSync(roadmapPath)) {
      return NextResponse.json({ synced: false, reason: "no-planning" });
    }

    const roadmapContent = fs.readFileSync(roadmapPath, "utf-8");
    const nameMatch = roadmapContent.match(/^# Roadmap:\s*(.+)/m);
    const projectName = nameMatch ? nameMatch[1].trim() : "GSD Project";

    const phasesDir = path.join(planningDir, "phases");
    const phases = parseRoadmap(roadmapContent, phasesDir);

    if (phases.length === 0) {
      return NextResponse.json({ synced: false, reason: "no-phases" });
    }

    // Prefer the slug the resolver gave us (the brief owning this .planning/).
    // Verify the brief actually exists & is level 3.
    let projectSlug: string | null = null;
    const briefsDir = path.join(agenticOsDir, "projects", "briefs");
    const candidateBrief = path.join(briefsDir, resolvedSlug, "brief.md");
    if (fs.existsSync(candidateBrief)) {
      const content = fs.readFileSync(candidateBrief, "utf-8");
      if (content.includes("level: 3")) {
        projectSlug = resolvedSlug;
      }
    }

    const db = getDb();
    const now = new Date().toISOString();

    // Check if a GSD-level parent task already exists for this project
    let parentTask: Task | undefined;

    if (projectSlug) {
      parentTask = db.prepare(
        "SELECT * FROM tasks WHERE level = 'gsd' AND projectSlug = ? ORDER BY createdAt DESC LIMIT 1"
      ).get(projectSlug) as Task | undefined;
    }

    if (!parentTask) {
      // Also check by title match as fallback
      parentTask = db.prepare(
        "SELECT * FROM tasks WHERE level = 'gsd' AND title LIKE ? ORDER BY createdAt DESC LIMIT 1"
      ).get(`%${projectName}%`) as Task | undefined;
    }

    const completedPhases = phases.filter((p) => p.status === "complete").length;
    const allComplete = completedPhases === phases.length;
    const currentPhase = phases.find((p) => p.status !== "complete");

    // Determine parent task status
    const parentStatus = allComplete ? "done" : "running";
    const activityLabel = currentPhase
      ? `Phase ${currentPhase.number} of ${phases.length}: ${currentPhase.name}`
      : allComplete
        ? `All ${phases.length} phases complete`
        : "Starting...";

    if (!parentTask) {
      // Create the GSD parent task
      const minOrder = db.prepare(
        "SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE status = ?"
      ).get(parentStatus) as { minOrder: number };

      const task: Task = {
        id: crypto.randomUUID(),
        title: projectName,
        description: `Deep build project — ${phases.length} phases. Managed via /gsd commands.`,
        status: parentStatus as Task["status"],
        level: "gsd",
        parentId: null,
        projectSlug,
        columnOrder: minOrder.minOrder - 1,
        createdAt: now,
        updatedAt: now,
        costUsd: null,
        tokensUsed: null,
        durationMs: null,
        activityLabel,
        errorMessage: null,
        startedAt: now,
        completedAt: allComplete ? now : null,
        clientId: null,
        needsInput: false,
        phaseNumber: currentPhase?.number ?? null,
        gsdStep: null,
        contextSources: null,
        cronJobSlug: null,
        claudeSessionId: null,
        permissionMode: "bypassPermissions",
        executionPermissionMode: "bypassPermissions",
        lastReplyAt: null,
        goalGroup: null,
        tag: null,
        pinnedAt: null,
      };

      db.prepare(
        `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode, executionPermissionMode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        task.id, task.title, task.description, task.status, task.level,
        task.parentId, task.projectSlug, task.columnOrder,
        task.createdAt, task.updatedAt, task.costUsd, task.tokensUsed,
        task.durationMs, task.activityLabel, task.errorMessage,
        task.startedAt, task.completedAt, task.clientId, 0,
        task.phaseNumber, task.gsdStep, task.cronJobSlug, task.permissionMode, task.executionPermissionMode
      );

      emitTaskEvent({ type: "task:created", task, timestamp: now });
      parentTask = task;
    } else {
      // Update existing parent task status and activity
      const updates: Record<string, unknown> = {
        activityLabel,
        updatedAt: now,
        phaseNumber: currentPhase?.number ?? parentTask.phaseNumber,
      };

      // Respect user-initiated done/review states — never resurrect a task
      // the user has manually completed. Only update status for active tasks.
      const userSettled = parentTask.status === "done" || parentTask.status === "review";
      if (!userSettled && parentTask.status !== "running" && !allComplete) {
        updates.status = "running";
        if (!parentTask.startedAt) updates.startedAt = now;
      }
      if (allComplete && !userSettled) {
        updates.status = "done";
        updates.completedAt = now;
      }

      const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
      const values = Object.values(updates);

      db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`).run(...values, parentTask.id);

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(parentTask.id) as Task;
      emitTaskEvent({
        type: "task:status",
        task: { ...updated, needsInput: Boolean(updated.needsInput) },
        timestamp: now,
      });
      parentTask = updated;
    }

    // Now sync phase subtasks under the parent
    const existingChildren = db.prepare(
      "SELECT phaseNumber, gsdStep, id, status FROM tasks WHERE parentId = ? AND phaseNumber IS NOT NULL AND gsdStep IS NOT NULL"
    ).all(parentTask.id) as Array<{ phaseNumber: number; gsdStep: string; id: string; status: string }>;

    const existingMap = new Map(
      existingChildren.map((c) => [`${c.phaseNumber}:${c.gsdStep}`, c])
    );

    const hasPlanForPhase = (phaseNum: number): boolean => {
      const phase = phases.find((p) => p.number === phaseNum);
      if (!phase) return false;
      return phase.plans.length > 0 && phase.plans.some((p) => p.hasPlanFile);
    };

    let createdCount = 0;

    for (const phase of phases) {
      for (let stepIdx = 0; stepIdx < GSD_STEPS.length; stepIdx++) {
        const step = GSD_STEPS[stepIdx];
        const key = `${phase.number}:${step}`;
        const existing = existingMap.get(key);

        // Determine target status
        let targetStatus: string;
        if (phase.status === "complete") {
          targetStatus = "done";
        } else if (phase.status === "in-progress") {
          if (step === "discuss") {
            targetStatus = hasPlanForPhase(phase.number) ? "done" : "queued";
          } else if (step === "plan") {
            targetStatus = hasPlanForPhase(phase.number) ? "done" : "backlog";
          } else {
            targetStatus = "backlog";
          }
        } else {
          targetStatus = "backlog";
        }

        if (existing) {
          // Only update if status needs to change (don't overwrite manual changes for active tasks)
          if (existing.status !== targetStatus && existing.status !== "running" && existing.status !== "review") {
            db.prepare("UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?")
              .run(targetStatus, now, existing.id);
          }
          continue;
        }

        // Create new subtask
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
        const task: Task = {
          id: crypto.randomUUID(),
          title,
          description: `Run /gsd-${step === "execute" ? "execute-phase" : step === "verify" ? "verify-work" : step === "plan" ? "plan-phase" : "discuss-phase"} for Phase ${phase.number}: ${phase.name}`,
          status: targetStatus as Task["status"],
          level: "task",
          parentId: parentTask.id,
          projectSlug: parentTask.projectSlug,
          columnOrder,
          createdAt: now,
          updatedAt: now,
          costUsd: null,
          tokensUsed: null,
          durationMs: null,
          activityLabel: null,
          errorMessage: null,
          startedAt: targetStatus === "done" ? now : null,
          completedAt: targetStatus === "done" ? now : null,
          clientId: parentTask.clientId,
          needsInput: false,
          phaseNumber: phase.number,
          gsdStep: step,
          contextSources: null,
          cronJobSlug: null,
          claudeSessionId: null,
          permissionMode: inheritedPermissionMode,
          executionPermissionMode: inheritedExecutionMode,
          model: parentTask.model ?? null,
          thinkingEffort: parentTask.thinkingEffort ?? null,
          lastReplyAt: null,
          goalGroup: null,
          tag: null,
          pinnedAt: null,
        };

        db.prepare(
          `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, needsInput, phaseNumber, gsdStep, permissionMode, executionPermissionMode, model, thinkingEffort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          task.id, task.title, task.description, task.status, task.level,
          task.parentId, task.projectSlug, task.columnOrder,
          task.createdAt, task.updatedAt, task.costUsd, task.tokensUsed,
          task.durationMs, task.activityLabel, task.errorMessage,
          task.startedAt, task.completedAt, task.clientId, 0,
          task.phaseNumber, task.gsdStep, task.permissionMode, task.executionPermissionMode, task.model, task.thinkingEffort
        );

        emitTaskEvent({ type: "task:created", task, timestamp: now });
        createdCount++;
      }
    }

    return NextResponse.json({
      synced: true,
      parentTaskId: parentTask.id,
      projectName,
      phases: phases.length,
      completedPhases,
      newSubtasks: createdCount,
    });
  } catch (error) {
    console.error("POST /api/gsd/ensure-task error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
