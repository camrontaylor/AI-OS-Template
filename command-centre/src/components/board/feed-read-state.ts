import type { Task } from "@/types/task";

export const FEED_READ_STATE_VERSION = 1 as const;
export const FEED_READ_STATE_STORAGE_KEY = "command-centre.feed-read-state:v1";

export interface FeedReadState {
  version: typeof FEED_READ_STATE_VERSION;
  revisions: Record<string, string>;
}

export function createEmptyFeedReadState(): FeedReadState {
  return { version: FEED_READ_STATE_VERSION, revisions: {} };
}

export function getFeedTaskResultRevision(task: Task): string {
  return JSON.stringify([
    task.status,
    Boolean(task.needsInput),
    task.errorMessage ?? null,
    task.activityLabel ?? null,
    task.completedAt ?? null,
    task.tokensUsed ?? null,
    task.durationMs ?? null,
    task.costUsd ?? null,
  ]);
}

export function isFeedTaskResultState(task: Task): boolean {
  return task.status === "review"
    || task.status === "done"
    || Boolean(task.needsInput)
    || Boolean(task.errorMessage);
}

export function isFeedTaskUnread(task: Task, state: FeedReadState): boolean {
  if (!isFeedTaskResultState(task)) return false;
  return state.revisions[task.id] !== getFeedTaskResultRevision(task);
}

export function markFeedTasksRead(state: FeedReadState, tasks: Task[]): FeedReadState {
  let changed = false;
  const revisions = { ...state.revisions };
  for (const task of tasks) {
    const revision = getFeedTaskResultRevision(task);
    if (revisions[task.id] === revision) continue;
    revisions[task.id] = revision;
    changed = true;
  }
  return changed ? { version: FEED_READ_STATE_VERSION, revisions } : state;
}

export function loadFeedReadState(storage: Pick<Storage, "getItem"> = window.localStorage): FeedReadState {
  try {
    const value = storage.getItem(FEED_READ_STATE_STORAGE_KEY);
    if (!value) return createEmptyFeedReadState();
    const parsed = JSON.parse(value) as Partial<FeedReadState>;
    if (parsed.version !== FEED_READ_STATE_VERSION || !parsed.revisions || typeof parsed.revisions !== "object") {
      return createEmptyFeedReadState();
    }
    const revisions = Object.fromEntries(
      Object.entries(parsed.revisions).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    return { version: FEED_READ_STATE_VERSION, revisions };
  } catch {
    return createEmptyFeedReadState();
  }
}

export function saveFeedReadState(state: FeedReadState, storage: Pick<Storage, "setItem"> = window.localStorage): void {
  try {
    storage.setItem(FEED_READ_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Read markers are a progressive enhancement when storage is unavailable.
  }
}
