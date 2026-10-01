import type { GsdStep, TaskUpdateInput } from "@/types/task";

export function buildReopenTaskUpdate(): TaskUpdateInput {
  return {
    status: "review",
    completedAt: null,
    activityLabel: null,
    errorMessage: null,
    needsInput: false,
  };
}

export function getGsdSyncedTaskStatus(
  phaseStatus: string,
  step: GsdStep,
  hasPlan: boolean,
): "backlog" | "queued" | "review" {
  if (phaseStatus === "complete") return "review";

  if (phaseStatus === "in-progress") {
    if ((step === "discuss" || step === "plan") && hasPlan) {
      return "review";
    }
    return step === "discuss" ? "queued" : "backlog";
  }

  return "backlog";
}

export function shouldApplySyncedTaskStatus(
  currentStatus: string,
  targetStatus: string,
): boolean {
  return (
    currentStatus !== targetStatus &&
    currentStatus !== "done" &&
    currentStatus !== "review" &&
    currentStatus !== "running"
  );
}
