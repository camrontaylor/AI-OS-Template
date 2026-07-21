import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { resolvePlanningDir } from "@/lib/config";
import { parseRoadmap } from "@/lib/gsd-parser";
import { emitTaskEvent } from "@/lib/event-bus";
import { getActivePermissionMode, getExecutionPermissionMode } from "@/lib/permission-mode";
import type { Task, GsdStep } from "@/types/task";

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

    const parent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
    if (!parent) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
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

    if (!fs.existsSync(roadmapPath)) {
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
      "SELECT phaseNumber, gsdStep FROM tasks WHERE parentId = ? AND phaseNumber IS NOT NULL AND gsdStep IS NOT NULL"
    ).all(id) as Array<{ phaseNumber: number; gsdStep: string }>;

    const existingSet = new Set(
      existingChildren.map((c) => `${c.phaseNumber}:${c.gsdStep}`)
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

        if (existingSet.has(key)) {
          // Update status of existing children based on current phase status
          let newStatus: string;
          if (phase.status === "complete") {
            newStatus = "done";
          } else if (phase.status === "in-progress") {
            if (step === "discuss") {
              newStatus = hasPlanForPhase(phase.number) ? "done" : "queued";
            } else {
              newStatus = "backlog";
            }
          } else {
            newStatus = "backlog";
          }

          db.prepare(
            "UPDATE tasks SET status = ?, updatedAt = ? WHERE parentId = ? AND phaseNumber = ? AND gsdStep = ?"
          ).run(newStatus, now, id, phase.number, step);

          continue;
        }

        // Determine initial status
        let status: string;
        if (phase.status === "complete") {
          status = "done";
        } else if (phase.status === "in-progress") {
          if (step === "discuss") {
            status = hasPlanForPhase(phase.number) ? "done" : "queued";
          } else {
            status = "backlog";
          }
        } else {
          status = "backlog";
        }

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
          completedAt: status === "done" ? now : null,
          clientId: parent.clientId,
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
    console.error("POST /api/tasks/[id]/sync-phases error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
