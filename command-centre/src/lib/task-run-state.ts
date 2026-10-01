export type TaskRunStateInput = {
  status?: string | null;
  parentId?: string | null;
  childCount?: number | null;
  claudePid?: number | null;
  activityLabel?: string | null;
};

function isContainerActivityLabel(label?: string | null): boolean {
  return /\b(subtasks?|tasks?) done\b|\b(first|next) task queued\b/i.test(label ?? "");
}

export function isParentContainerRun(input: TaskRunStateInput): boolean {
  if (
    input.status !== "running" ||
    input.parentId ||
    (input.childCount ?? 0) <= 0
  ) {
    return false;
  }

  if (isContainerActivityLabel(input.activityLabel)) {
    return true;
  }

  return !input.claudePid;
}

export function isTaskChatActivelyRunning(input: TaskRunStateInput): boolean {
  return input.status === "running" && !isParentContainerRun(input);
}

export function getContainerAwareStatus(input: TaskRunStateInput): string | null | undefined {
  return isParentContainerRun(input) ? "review" : input.status;
}
