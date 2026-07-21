"use client";

import { useCallback, useMemo, useState } from "react";
import { MessageSquare, ListChecks, Play, CheckCircle2, SkipForward, Zap } from "lucide-react";
import type { Task, GsdStep } from "@/types/task";
import { cn } from "@/lib/utils";

interface NextActionChipsProps {
  task: Task;
  childTasks: Task[];
  /** Insert text into the reply input (for commands like /gsd-...) */
  onInsertCommand: (text: string) => void;
  /** Execute a subtask by ID */
  onRunSubtask?: (taskId: string) => void;
  /** Execute all backlog subtasks */
  onRunAll?: () => void;
  /** Scroll to / focus a subtask that needs input */
  onFocusSubtask?: (taskId: string) => void;
}

interface ChipDef {
  label: string;
  description: string;
  icon: typeof Play;
  primary?: boolean;
  /** If set, insert this command text into reply input */
  command?: string;
  /** If set, execute this subtask ID directly */
  executeTaskId?: string;
  /** If set, run all backlog subtasks */
  runAll?: boolean;
  /** If set, focus/scroll to this subtask */
  focusTaskId?: string;
}

const GSD_STEP_ORDER: GsdStep[] = ["discuss", "plan", "execute", "verify"];

function gsdPhaseCommand(step: GsdStep, phaseNum: number | string): string {
  if (step === "verify") return `/gsd-verify-work ${phaseNum}`;
  return `/gsd-${step}-phase ${phaseNum}`;
}

function getGsdChips(childTasks: Task[]): ChipDef[] {
  const currentPhase = childTasks.find((c) => c.status !== "done");
  if (!currentPhase) {
    return [
      {
        label: "Verify All Phases",
        description: "Run final verification across all phases",
        command: "/gsd-audit-milestone",
        icon: CheckCircle2,
        primary: true,
      },
      {
        label: "View Summary",
        description: "See a summary of all completed work",
        command: "Summarize the project status and deliverables",
        icon: ListChecks,
      },
    ];
  }

  const phaseNum = currentPhase.phaseNumber ?? "?";
  const phaseTitle = currentPhase.title;
  const currentStep = currentPhase.gsdStep;
  const currentStepIdx = currentStep ? GSD_STEP_ORDER.indexOf(currentStep) : -1;

  // Not started yet — offer to run the phase
  if (currentPhase.status === "backlog" || currentPhase.status === "queued") {
    if (!currentStep || currentStep === "discuss") {
      return [
        {
          label: `Run Phase ${phaseNum}`,
          description: `Start "${phaseTitle}"`,
          executeTaskId: currentPhase.id,
          icon: Play,
          primary: true,
        },
        {
          label: `Discuss Phase ${phaseNum}`,
          description: "Send discuss command to Claude",
          command: gsdPhaseCommand("discuss", phaseNum),
          icon: MessageSquare,
        },
        {
          label: "Skip to Execute",
          description: "Jump straight to execution",
          command: gsdPhaseCommand("execute", phaseNum),
          icon: SkipForward,
        },
      ];
    }
  }

  // Needs input — suggest replying
  if (currentPhase.needsInput) {
    return [
      {
        label: `Reply to Phase ${phaseNum}`,
        description: `"${phaseTitle}" is waiting for your input`,
        focusTaskId: currentPhase.id,
        icon: MessageSquare,
        primary: true,
      },
    ];
  }

  // In progress — suggest next GSD step
  const chips: ChipDef[] = [];

  if (currentStep === "discuss") {
    chips.push({
      label: `Plan Phase ${phaseNum}`,
      description: `Create the plan for "${phaseTitle}"`,
      command: gsdPhaseCommand("plan", phaseNum),
      icon: ListChecks,
      primary: true,
    });
  } else if (currentStep === "plan") {
    chips.push({
      label: `Execute Phase ${phaseNum}`,
      description: `Run the plan for "${phaseTitle}"`,
      command: gsdPhaseCommand("execute", phaseNum),
      icon: Play,
      primary: true,
    });
  } else if (currentStep === "execute") {
    chips.push({
      label: `Verify Phase ${phaseNum}`,
      description: `Check "${phaseTitle}" meets its goals`,
      command: gsdPhaseCommand("verify", phaseNum),
      icon: CheckCircle2,
      primary: true,
    });
  } else if (currentStep === "verify") {
    const nextPhase = childTasks.find(
      (c) => c.status !== "done" && c.id !== currentPhase.id,
    );
    if (nextPhase) {
      chips.push({
        label: `Run Phase ${nextPhase.phaseNumber ?? "?"}`,
        description: `Start "${nextPhase.title}"`,
        executeTaskId: nextPhase.id,
        icon: Play,
        primary: true,
      });
    }
  }

  if (chips.length === 0 && currentStepIdx >= 0 && currentStepIdx < GSD_STEP_ORDER.length - 1) {
    const nextStep = GSD_STEP_ORDER[currentStepIdx + 1];
    chips.push({
      label: `${nextStep.charAt(0).toUpperCase() + nextStep.slice(1)} Phase ${phaseNum}`,
      description: `Advance to the ${nextStep} step`,
      command: gsdPhaseCommand(nextStep, phaseNum),
      icon: Play,
      primary: true,
    });
  }

  return chips;
}

function getPlannedChips(childTasks: Task[]): ChipDef[] {
  const chips: ChipDef[] = [];
  const needsInput = childTasks.find((c) => c.needsInput);
  const nextBacklog = childTasks.find((c) => c.status === "backlog");
  const remainingBacklog = childTasks.filter((c) => c.status === "backlog");

  if (needsInput) {
    chips.push({
      label: `Reply to ${needsInput.title}`,
      description: "This subtask is waiting for your input",
      focusTaskId: needsInput.id,
      icon: MessageSquare,
      primary: true,
    });
  }

  if (nextBacklog) {
    chips.push({
      label: "Run next subtask",
      description: `Start "${nextBacklog.title}"`,
      executeTaskId: nextBacklog.id,
      icon: Play,
      primary: !needsInput,
    });
  }

  if (remainingBacklog.length > 1) {
    chips.push({
      label: "Run all remaining",
      description: `Execute ${remainingBacklog.length} subtasks`,
      runAll: true,
      icon: Zap,
    });
  }

  return chips;
}

export function NextActionChips({
  task,
  childTasks,
  onInsertCommand,
  onRunSubtask,
  onRunAll,
  onFocusSubtask,
}: NextActionChipsProps) {
  const [executing, setExecuting] = useState<string | null>(null);

  const chips = useMemo(() => {
    if (childTasks.length === 0) return [];
    return task.level === "gsd"
      ? getGsdChips(childTasks)
      : getPlannedChips(childTasks);
  }, [task.level, childTasks]);

  const handleClick = useCallback(
    async (chip: ChipDef) => {
      if (chip.focusTaskId && onFocusSubtask) {
        onFocusSubtask(chip.focusTaskId);
        return;
      }
      if (chip.runAll && onRunAll) {
        onRunAll();
        return;
      }
      if (chip.executeTaskId) {
        if (onRunSubtask) {
          onRunSubtask(chip.executeTaskId);
        } else {
          // Fallback: call execute API directly
          setExecuting(chip.executeTaskId);
          try {
            const res = await fetch(`/api/tasks/${chip.executeTaskId}/execute`, {
              method: "POST",
            });
            if (!res.ok) {
              console.error("[NextActionChips] execute failed:", res.status);
            }
          } catch (err) {
            console.error("[NextActionChips] execute error:", err);
          } finally {
            setExecuting(null);
          }
        }
        return;
      }
      if (chip.command) {
        onInsertCommand(chip.command);
      }
    },
    [onInsertCommand, onRunSubtask, onRunAll, onFocusSubtask],
  );

  if (chips.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap gap-2 px-4 pb-1 pt-2">
      {chips.map((chip) => {
        const Icon = chip.icon;
        const isExecuting = executing === chip.executeTaskId;
        return (
          <button
            key={chip.label}
            onClick={() => handleClick(chip)}
            disabled={isExecuting}
            className={cn(
              "inline-flex max-w-[220px] items-start gap-2 rounded-lg border p-3 text-left transition-colors",
              chip.primary
                ? "border-foreground/20 bg-muted/40 hover:border-foreground/30 hover:bg-muted/60"
                : "border-border bg-transparent hover:bg-muted/40",
              isExecuting ? "cursor-wait opacity-60" : "cursor-pointer",
            )}
          >
            <Icon
              className={cn(
                "mt-1 size-4 shrink-0",
                chip.primary ? "text-primary" : "text-muted-foreground",
              )}
            />
            <div>
              <div
                className={cn(
                  "text-xs font-semibold leading-snug",
                  chip.primary ? "text-primary" : "text-foreground",
                )}
              >
                {isExecuting ? "Starting..." : chip.label}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {chip.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
