/**
 * Cron-Task Sync Service
 *
 * Polls the SQLite database for tasks created by the managed cron runtime
 * and emits SSE events so the frontend kanban board updates in real-time.
 */
import { getDb } from "./db";
import { emitTaskEvent } from "./event-bus";
import type { Task } from "@/types/task";

const POLL_INTERVAL_MS = 3000;
const globalKey = "__cron_task_sync__";
const globalObj = globalThis as Record<string, unknown>;

interface SyncState {
  interval: ReturnType<typeof setInterval> | null;
  // Track task states we've already emitted events for
  knownTaskStates: Map<string, string>; // taskId -> "status:updatedAt"
}

function getState(): SyncState {
  if (!globalObj[globalKey]) {
    globalObj[globalKey] = {
      interval: null,
      knownTaskStates: new Map(),
    } satisfies SyncState;
  }
  return globalObj[globalKey] as SyncState;
}

function pollCronTasks() {
  try {
    const db = getDb();
    const state = getState();

    // Find all tasks with cronJobSlug set
    const cronTasks = db
      .prepare("SELECT * FROM tasks WHERE cronJobSlug IS NOT NULL ORDER BY createdAt DESC LIMIT 50")
      .all() as Task[];

    for (const task of cronTasks) {
      const stateKey = `${task.status}:${task.updatedAt}`;
      const prevState = state.knownTaskStates.get(task.id);

      if (prevState === stateKey) continue; // No change

      const normalized = { ...task, needsInput: Boolean(task.needsInput) };

      if (!prevState) {
        // New cron task we haven't seen before
        emitTaskEvent({
          type: "task:created",
          task: normalized,
          timestamp: task.createdAt,
        });
      } else {
        // Task state changed (e.g., running -> done)
        emitTaskEvent({
          type: "task:status",
          task: normalized,
          timestamp: task.updatedAt,
        });
      }

      state.knownTaskStates.set(task.id, stateKey);
    }

    // Clean up old entries (tasks no longer in the last 50)
    const activeIds = new Set(cronTasks.map((t) => t.id));
    for (const id of state.knownTaskStates.keys()) {
      if (!activeIds.has(id)) {
        state.knownTaskStates.delete(id);
      }
    }
  } catch (err) {
    // Silently fail — this is a background service
    console.error("[cron-task-sync] Poll error:", err);
  }
}

export function startCronTaskSync() {
  const state = getState();
  if (state.interval) return; // Already running

  // Seed known states from current DB to avoid emitting events for existing tasks
  try {
    const db = getDb();
    const existing = db
      .prepare("SELECT id, status, updatedAt FROM tasks WHERE cronJobSlug IS NOT NULL")
      .all() as Pick<Task, "id" | "status" | "updatedAt">[];
    for (const t of existing) {
      state.knownTaskStates.set(t.id, `${t.status}:${t.updatedAt}`);
    }
  } catch {
    // DB might not be ready yet
  }

  state.interval = setInterval(pollCronTasks, POLL_INTERVAL_MS);
  console.log("[cron-task-sync] Started polling every", POLL_INTERVAL_MS, "ms");
}
