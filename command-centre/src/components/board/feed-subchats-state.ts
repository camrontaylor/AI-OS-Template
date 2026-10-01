import type { FeedCanvasPanel } from "./feed-canvas-state";
import type { Task } from "@/types/task";

export interface FeedSubchatItem {
  task: Task;
  pinnedPanelId: string | null;
  current: boolean;
  unseen: boolean;
}

export function hasStartedConversation(task: Task, logCount = 0): boolean {
  return task.status !== "backlog"
    || Boolean(task.startedAt || task.claudeSessionId || task.conversationId)
    || logCount > 0;
}

export function buildFeedSubchatModel({
  rootTask,
  tasks,
  panels,
  logCounts = {},
  unreadTaskIds = new Set<string>(),
}: {
  rootTask: Task;
  tasks: Task[];
  panels: FeedCanvasPanel[];
  logCounts?: Record<string, number>;
  unreadTaskIds?: ReadonlySet<string>;
}) {
  const primary = panels.find((panel) => panel.type === "chat" && panel.resource?.primary);
  const currentTaskId = primary?.resource?.taskId ?? null;
  const pinned = new Map<string, string>();
  for (const panel of panels) {
    const taskId = panel.resource?.taskId;
    if (panel.type === "chat" && !panel.resource?.primary && taskId) pinned.set(taskId, panel.id);
  }

  const children = tasks
    .filter((task) => task.parentId === rootTask.id)
    .sort((first, second) => first.columnOrder - second.columnOrder || first.createdAt.localeCompare(second.createdAt));
  const item = (task: Task): FeedSubchatItem => ({
    task,
    pinnedPanelId: pinned.get(task.id) ?? null,
    current: currentTaskId === task.id,
    unseen: unreadTaskIds.has(task.id),
  });

  return {
    currentTaskId,
    mainCurrent: currentTaskId === rootTask.id,
    active: children.filter((task) => hasStartedConversation(task, logCounts[task.id] ?? 0)).map(item),
    fromBrief: children.filter((task) => !hasStartedConversation(task, logCounts[task.id] ?? 0)).map(item),
  };
}
