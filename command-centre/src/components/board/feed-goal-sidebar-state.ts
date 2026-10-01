import type { Client } from "@/types/client";
import type { GoalDraftPayload } from "@/types/goal-draft";
import type { Task } from "@/types/task";

export interface FeedGoalGroup {
  id: string;
  name: string;
  goals: Task[];
}

export interface FeedGoalSidebarGroup {
  id: string;
  name: string;
  drafts: GoalDraftPayload[];
  goals: Task[];
}

export const FEED_SIDEBAR_DEFAULT_WIDTH = 280;
export const FEED_SIDEBAR_MIN_WIDTH = 220;
export const FEED_SIDEBAR_MAX_WIDTH = 360;
export const FEED_SIDEBAR_MAX_VIEWPORT_RATIO = 0.4;

export function getFeedSidebarMaximumWidth(viewportWidth: number): number {
  return Math.max(
    FEED_SIDEBAR_MIN_WIDTH,
    Math.min(FEED_SIDEBAR_MAX_WIDTH, Math.floor(viewportWidth * FEED_SIDEBAR_MAX_VIEWPORT_RATIO)),
  );
}

export function clampFeedSidebarWidth(width: number, viewportWidth: number): number {
  return Math.max(
    FEED_SIDEBAR_MIN_WIDTH,
    Math.min(getFeedSidebarMaximumWidth(viewportWidth), Math.round(width)),
  );
}

export function sortFeedGoals(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt)) return a.pinnedAt ? -1 : 1;
    if (a.pinnedAt && b.pinnedAt && a.columnOrder !== b.columnOrder) return b.columnOrder - a.columnOrder;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function groupFeedGoals(
  goals: Task[],
  clients: Client[],
  selectedClientId: string | null,
): FeedGoalGroup[] {
  const groups: FeedGoalGroup[] = [
    { id: "_root", name: "AI-OS", goals: goals.filter((goal) => !goal.clientId) },
    ...clients.map((client) => ({
      id: client.slug,
      name: client.name,
      goals: goals.filter((goal) => goal.clientId === client.slug),
    })),
  ];
  return groups
    .filter((group) => selectedClientId ? group.id === selectedClientId : group.goals.length > 0)
    .map((group) => ({ ...group, goals: sortFeedGoals(group.goals) }));
}

export function groupFeedGoalSidebarItems(
  goals: Task[],
  drafts: GoalDraftPayload[],
  clients: Client[],
  selectedClientId: string | null,
): FeedGoalSidebarGroup[] {
  const groups: FeedGoalSidebarGroup[] = [
    {
      id: "_root",
      name: "AI-OS",
      drafts: drafts.filter((draft) => !draft.clientId),
      goals: goals.filter((goal) => !goal.clientId),
    },
    ...clients.map((client) => ({
      id: client.slug,
      name: client.name,
      drafts: drafts.filter((draft) => draft.clientId === client.slug),
      goals: goals.filter((goal) => goal.clientId === client.slug),
    })),
  ];

  return groups
    .filter((group) => selectedClientId
      ? group.id === selectedClientId
      : group.goals.length > 0 || group.drafts.length > 0)
    .map((group) => ({
      ...group,
      drafts: [...group.drafts].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
      goals: sortFeedGoals(group.goals),
    }));
}

export function searchArchivedFeedGoals(options: {
  goals: Task[];
  clients: Client[];
  rootName: string;
  selectedClientId: string | null;
  query: string;
}): Task[] {
  const normalized = options.query.trim().toLowerCase();
  return sortFeedGoals(options.goals).filter((goal) => {
    if (options.selectedClientId && goal.clientId !== options.selectedClientId) return false;
    if (!normalized) return true;
    const clientName = options.clients.find((client) => client.slug === goal.clientId)?.name ?? options.rootName;
    return [goal.title, goal.description, goal.clientId, clientName]
      .some((value) => value?.toLowerCase().includes(normalized));
  });
}
