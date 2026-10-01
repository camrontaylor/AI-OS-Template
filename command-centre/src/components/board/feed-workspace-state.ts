export interface FeedWorkspaceTask {
  id: string;
  parentId?: string | null;
  clientId?: string | null;
}

export interface FeedWorkspaceSelection {
  goalId: string;
  activeTaskId: string;
  clientId: string | null;
}

export function isPermanentFeedTaskId(taskId: string): boolean {
  return !taskId.startsWith("temp-");
}

export function clearAffectedFeedSelection(
  currentTaskId: string | null,
  affectedTaskIds: ReadonlySet<string>,
  taskIdAliases: Readonly<Record<string, string>> = {},
): string | null {
  if (!currentTaskId) return null;
  const resolvedTaskId = taskIdAliases[currentTaskId] ?? currentTaskId;
  return affectedTaskIds.has(currentTaskId) || affectedTaskIds.has(resolvedTaskId)
    ? null
    : currentTaskId;
}

export function resolveFeedWorkspaceSelection(
  requestedTaskId: string | null | undefined,
  tasks: FeedWorkspaceTask[],
): FeedWorkspaceSelection | null {
  if (!requestedTaskId) return null;

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const activeTask = byId.get(requestedTaskId);
  if (!activeTask) return null;

  let goal = activeTask;
  const visited = new Set<string>([goal.id]);
  while (goal.parentId) {
    const parent = byId.get(goal.parentId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    goal = parent;
  }

  return {
    goalId: goal.id,
    activeTaskId: activeTask.id,
    clientId: activeTask.clientId ?? goal.clientId ?? null,
  };
}
