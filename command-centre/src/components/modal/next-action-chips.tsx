"use client";

import { useCallback, useMemo, useState } from "react";
import { MessageSquare, ListChecks, Play, CheckCircle2, SkipForward, Zap } from "lucide-react";
import type { Task, GsdStep } from "@/types/task";

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
    <div
      style={{
        padding: "8px 16px 4px",
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        flexShrink: 0,
      }}
    >
      {chips.map((chip) => {
        const Icon = chip.icon;
        const isExecuting = executing === chip.executeTaskId;
        return (
          <button
            key={chip.label}
            onClick={() => handleClick(chip)}
            disabled={isExecuting}
            style={{
              display: "inline-flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 8,
              border: chip.primary
                ? "1.5px solid var(--cc-brand-alpha-35)"
                : "1px solid var(--cc-control-bg)",
              backgroundColor: chip.primary
                ? "var(--cc-brand-alpha-03)"
                : "transparent",
              cursor: isExecuting ? "wait" : "pointer",
              textAlign: "left",
              maxWidth: 220,
              transition: "all 120ms ease",
              outline: "none",
              opacity: isExecuting ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isExecuting) {
                e.currentTarget.style.backgroundColor = chip.primary
                  ? "var(--cc-brand-alpha-08)"
                  : "var(--cc-brand-alpha-03)";
                e.currentTarget.style.borderColor = "var(--cc-brand-alpha-40)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = chip.primary
                ? "var(--cc-brand-alpha-03)"
                : "transparent";
              e.currentTarget.style.borderColor = chip.primary
                ? "var(--cc-brand-alpha-35)"
                : "var(--cc-control-bg)";
            }}
          >
            <Icon
              size={14}
              style={{
                color: chip.primary ? "var(--cc-brand-primary)" : "var(--cc-text-tertiary)",
                marginTop: 1,
                flexShrink: 0,
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  color: chip.primary ? "var(--cc-brand-primary)" : "var(--cc-text-primary)",
                  lineHeight: 1.3,
                }}
              >
                {isExecuting ? "Starting..." : chip.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--cc-text-tertiary)",
                  lineHeight: 1.3,
                  marginTop: 2,
                }}
              >
                {chip.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
