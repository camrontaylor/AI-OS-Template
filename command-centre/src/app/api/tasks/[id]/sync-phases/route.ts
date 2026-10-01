import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { resolvePlanningDir } from "@/lib/config";
import { parseRoadmap } from "@/lib/gsd-parser";
import { emitTaskEvent } from "@/lib/event-bus";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import { getGsdSyncedTaskStatus, shouldApplySyncedTaskStatus } from "@/lib/task-status-transitions";
import type { Task, GsdStep } from "@/types/task";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";
import { inheritWorkScope, isWorkScopeError, workScopeErrorBody } from "@/lib/identity/work-scope";
import { isTaskArchived, isTaskTreeReadOnlyError } from "@/lib/task-archive";

const GSD_STEPS: GsdStep[] = ["discuss", "plan", "execute", "verify"];

const STEP_TITLES: Record<GsdStep, string> = {
  discuss: "Discuss",
  plan: "Plan",
  execute: "Execute",
  verify: "Verify",
};

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const parent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | (Omit<Task, "workScope"> & { workScope: string | null })
      | undefined;
    if (!parent) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const inheritedScope = inheritWorkScope(parent);
    if (isTaskArchived(db, id)) {
      return NextResponse.json({ error: "Restore this Goal before syncing phases." }, { status: 409 });
    }
    if (parent.level !== "gsd") {
      return NextResponse.json(
        { error: "Only GSD-level tasks can sync phases" },
        { status: 400 }
      );
    }
    // Read ROADMAP.md — prefer the parent task's projectSlug
    const resolved = resolvePlanningDir({ overrideSlug: parent.projectSlug });
    if (!resolved) {
      return NextResponse.json(
        { error: "No .planning/ROADMAP.md found for this project" },
        { status: 404 }
      );
    }
    const { planningDir } = resolved;
    const roadmapPath = path.join(planningDir, "ROADMAP.md");

    if (!fs.existsSync(roadmapPath) || !isMaterializedPathAccessible(roadmapPath)) {
      return NextResponse.json(
        { error: "No ROADMAP.md found in the project's .planning/" },
        { status: 404 }
      );
    }

    const roadmapContent = fs.readFileSync(roadmapPath, "utf-8");
    const phasesDir = path.join(planningDir, "phases");
    const phases = parseRoadmap(roadmapContent, phasesDir);

    if (phases.length === 0) {
      return NextResponse.json(
        { error: "No phases found in ROADMAP.md" },
        { status: 400 }
      );
    }

    // Get existing children to avoid duplicates
    const existingChildren = db.prepare(
      "SELECT id, status, phaseNumber, gsdStep FROM tasks WHERE parentId = ? AND phaseNumber IS NOT NULL AND gsdStep IS NOT NULL"
    ).all(id) as Array<{ id: string; status: string; phaseNumber: number; gsdStep: string }>;

    const existingMap = new Map(
      existingChildren.map((c) => [`${c.phaseNumber}:${c.gsdStep}`, c])
    );

    // Check for existing plan files per phase (to determine discuss step status)
    const hasPlanForPhase = (phaseNum: number): boolean => {
      const phase = phases.find((p) => p.number === phaseNum);
      if (!phase) return false;
      return phase.plans.length > 0 && phase.plans.some((p) => p.hasPlanFile);
    };

    const now = new Date().toISOString();
    const created: Task[] = [];

    for (const phase of phases) {
      for (let stepIdx = 0; stepIdx < GSD_STEPS.length; stepIdx++) {
        const step = GSD_STEPS[stepIdx];
        const key = `${phase.number}:${step}`;

        const existing = existingMap.get(key);

        if (existing) {
          const newStatus = getGsdSyncedTaskStatus(
            phase.status,
            step,
            step === "discuss" && hasPlanForPhase(phase.number),
          );

          if (shouldApplySyncedTaskStatus(existing.status, newStatus)) {
            db.prepare(
              "UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?"
            ).run(newStatus, now, existing.id);
          }

          continue;
        }

        const status = getGsdSyncedTaskStatus(
          phase.status,
          step,
          step === "discuss" && hasPlanForPhase(phase.number),
        );

        const title = `Phase ${phase.number}: ${STEP_TITLES[step]} — ${phase.name}`;
        const columnOrder = phase.number * 100 + stepIdx;

        const inheritedPermissionMode = getActivePermissionMode(
          parent.permissionMode ?? "bypassPermissions",
          "bypassPermissions",
        );
        const inheritedExecutionMode = getExecutionPermissionMode(
          parent.executionPermissionMode ?? parent.permissionMode,
          "bypassPermissions",
        );
        const task: Task = {
          id: crypto.randomUUID(),
          title,
          description: `Run /gsd-${step === "execute" ? "execute-phase" : step === "verify" ? "verify-work" : step === "plan" ? "plan-phase" : "discuss-phase"} for Phase ${phase.number}: ${phase.name}`,
          status: status as Task["status"],
          level: "task",
          parentId: id,
          projectSlug: parent.projectSlug,
          columnOrder,
          createdAt: now,
          updatedAt: now,
          costUsd: null,
          tokensUsed: null,
          durationMs: null,
          activityLabel: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          clientId: parent.clientId,
          workScope: inheritedScope.scope,
          needsInput: false,
          phaseNumber: phase.number,
          gsdStep: step,
          contextSources: null,
          cronJobSlug: null,
          claudeSessionId: null,
          permissionMode: inheritedPermissionMode,
          executionPermissionMode: inheritedExecutionMode,
          model: parent.model ?? null,
          thinkingEffort: parent.thinkingEffort ?? null,
          lastReplyAt: null,
          goalGroup: null,
          tag: null,
          pinnedAt: null,
          archivedAt: null,
        };

        db.prepare(
          `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, workScope, needsInput, phaseNumber, gsdStep, permissionMode, executionPermissionMode, model, thinkingEffort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          task.id, task.title, task.description, task.status, task.level,
          task.parentId, task.projectSlug, task.columnOrder,
          task.createdAt, task.updatedAt, task.costUsd, task.tokensUsed,
          task.durationMs, task.activityLabel, task.errorMessage,
          task.startedAt, task.completedAt, task.clientId, inheritedScope.serialized, 0,
          task.phaseNumber, task.gsdStep, task.permissionMode, task.executionPermissionMode, task.model, task.thinkingEffort
        );

        created.push(task);

        emitTaskEvent({ type: "task:created", task, timestamp: now });
      }
    }

    return NextResponse.json({
      created: created.length,
      total: phases.length * GSD_STEPS.length,
      phases: phases.length,
    });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    if (isTaskTreeReadOnlyError(error)) {
      return NextResponse.json({ error: "Restore this Goal before creating tasks." }, { status: 409 });
    }
    console.error("POST /api/tasks/[id]/sync-phases error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
