import type { Task } from "@/types/task";

export type BranchCreatedContext = {
  sourceTaskId: string;
};

export type BranchSurfaceAction =
  | { kind: "pane"; paneId: string }
  | { kind: "main" };

type BranchPaneCandidate = {
  id: string;
  taskId?: string;
};

type TaskLineageFields = Pick<
  Task,
  | "id"
  | "title"
  | "description"
  | "level"
  | "parentId"
  | "projectSlug"
  | "columnOrder"
  | "createdAt"
  | "updatedAt"
  | "clientId"
  | "phaseNumber"
  | "gsdStep"
  | "goalGroup"
  | "tag"
  | "pinnedAt"
  | "forkedFromTaskId"
  | "forkedFromLogId"
  | "forkedFromClaudeSessionId"
>;

function byId<T extends TaskLineageFields>(tasks: T[]): Map<string, T> {
  return new Map(tasks.map((task) => [task.id, task]));
}

function timeValue(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isNewerTask<T extends TaskLineageFields>(candidate: T, current: T): boolean {
  const candidateTime = timeValue(candidate.createdAt) || timeValue(candidate.updatedAt);
  const currentTime = timeValue(current.createdAt) || timeValue(current.updatedAt);
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  return candidate.id > current.id;
}

function getLineageRootIdFromMap<T extends TaskLineageFields>(
  task: T,
  taskById: Map<string, T>,
): string {
  let current = task;
  const seen = new Set<string>();

  while (current.forkedFromTaskId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = taskById.get(current.forkedFromTaskId);
    if (!parent) {
      return current.forkedFromTaskId;
    }
    current = parent;
  }

  return current.id;
}

function getLatestReplacementByRoot<T extends TaskLineageFields>(
  tasks: T[],
  taskById: Map<string, T>,
): Map<string, T> {
  const latestByRoot = new Map<string, T>();
  for (const task of tasks) {
    const rootId = getLineageRootIdFromMap(task, taskById);
    const current = latestByRoot.get(rootId);
    if (!current || isNewerTask(task, current)) {
      latestByRoot.set(rootId, task);
    }
  }
  return latestByRoot;
}

function withOriginalDisplayFields<T extends TaskLineageFields>(active: T, original: T): T {
  if (active.id === original.id) {
    return active;
  }

  return {
    ...active,
    title: original.title,
    description: original.description,
    level: original.level,
    parentId: original.parentId,
    projectSlug: original.projectSlug,
    columnOrder: original.columnOrder,
    createdAt: original.createdAt,
    clientId: original.clientId,
    phaseNumber: original.phaseNumber,
    gsdStep: original.gsdStep,
    goalGroup: original.goalGroup,
    tag: original.tag,
    pinnedAt: original.pinnedAt,
    forkedFromTaskId: null,
    forkedFromLogId: null,
  } as T;
}

export function getEditedLineageRootTaskId<T extends TaskLineageFields>(
  taskId: string,
  tasks: T[],
): string {
  const taskById = byId(tasks);
  const task = taskById.get(taskId);
  if (!task) {
    return taskId;
  }
  return getLineageRootIdFromMap(task, taskById);
}

export function resolveEditedTaskId<T extends TaskLineageFields>(
  taskId: string,
  tasks: T[],
): string {
  const taskById = byId(tasks);
  const task = taskById.get(taskId);
  if (!task) {
    return taskId;
  }
  const latestByRoot = getLatestReplacementByRoot(tasks, taskById);
  const rootId = getLineageRootIdFromMap(task, taskById);
  return latestByRoot.get(rootId)?.id ?? taskId;
}

export function resolveEditedTask<T extends TaskLineageFields>(
  taskId: string,
  tasks: T[],
): T | undefined {
  const taskById = byId(tasks);
  const task = taskById.get(taskId);
  if (!task) {
    return undefined;
  }

  const latestByRoot = getLatestReplacementByRoot(tasks, taskById);
  const rootId = getLineageRootIdFromMap(task, taskById);
  const active = latestByRoot.get(rootId) ?? task;
  const original = taskById.get(rootId) ?? task;
  return withOriginalDisplayFields(active, original);
}

export function getVisibleEditedTasks<T extends TaskLineageFields>(tasks: T[]): T[] {
  const taskById = byId(tasks);
  const latestByRoot = getLatestReplacementByRoot(tasks, taskById);
  const rootIds: string[] = [];
  const seenRoots = new Set<string>();

  for (const task of tasks) {
    const rootId = getLineageRootIdFromMap(task, taskById);
    if (!seenRoots.has(rootId)) {
      seenRoots.add(rootId);
      rootIds.push(rootId);
    }
  }

  const visible: T[] = [];
  const seenTaskIds = new Set<string>();
  for (const rootId of rootIds) {
    const active = latestByRoot.get(rootId);
    if (!active || seenTaskIds.has(active.id)) {
      continue;
    }
    const original = taskById.get(rootId) ?? active;
    visible.push(withOriginalDisplayFields(active, original));
    seenTaskIds.add(active.id);
  }
  return visible.map((task) =>
    task.parentId
      ? { ...task, parentId: resolveEditedTaskId(task.parentId, tasks) } as T
      : task,
  );
}

export function getVisibleEditedGoalTaskIds<T extends TaskLineageFields>(
  selectedTaskId: string,
  tasks: T[],
  visibleTasks: T[] = getVisibleEditedTasks(tasks),
): string[] {
  const visibleTaskById = byId(visibleTasks);
  let goal = visibleTaskById.get(resolveEditedTaskId(selectedTaskId, tasks));
  if (!goal) return [];

  const visited = new Set<string>();
  while (goal.parentId && !visited.has(goal.id)) {
    visited.add(goal.id);
    const parent = visibleTaskById.get(goal.parentId);
    if (!parent) break;
    goal = parent;
  }

  return [
    goal.id,
    ...visibleTasks
      .filter((task) => task.parentId === goal.id)
      .map((task) => task.id),
  ];
}

export function resolveEditedPaneTasks<TPane extends BranchPaneCandidate, TTask extends TaskLineageFields>(
  panes: TPane[],
  tasks: TTask[],
): TPane[] {
  return panes.map((pane) =>
    pane.taskId
      ? { ...pane, taskId: resolveEditedTaskId(pane.taskId, tasks) }
      : pane,
  );
}

export function resolveBranchSurface(
  sourceTaskId: string,
  openPanes: BranchPaneCandidate[],
  tasks: TaskLineageFields[] = [],
): BranchSurfaceAction {
  const resolvedSourceTaskId = tasks.length > 0
    ? resolveEditedTaskId(sourceTaskId, tasks)
    : sourceTaskId;
  const pane = openPanes.find((item) => {
    if (!item.taskId) return false;
    if (item.taskId === sourceTaskId || item.taskId === resolvedSourceTaskId) return true;
    return tasks.length > 0 && resolveEditedTaskId(item.taskId, tasks) === resolvedSourceTaskId;
  });
  if (pane) {
    return { kind: "pane", paneId: pane.id };
  }
  return { kind: "main" };
}

export function isVisibleGoalChildTask(task: Task): boolean {
  return !task.forkedFromTaskId;
}
