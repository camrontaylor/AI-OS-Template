import { create } from "zustand";
import type { Task, TaskLevel, TaskUpdateInput, OutputFile, LogEntry, ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import type { TaskEvent } from "@/lib/event-bus";
import { isLegacyCronFallbackLogEntry, isLegacyCronFallbackLogSet } from "@/lib/task-logs";
import {
  getActivePermissionMode,
  getExecutionPermissionMode,
} from "@/lib/permission-mode";
import { readApiError } from "@/lib/api-error";
import { getEditedLineageRootTaskId, getVisibleEditedTasks } from "@/lib/task-branch-ui";
import {
  isTaskReadOnly as resolveTaskReadOnly,
  selectActiveGoals,
  selectArchivedGoals,
} from "@/lib/task-archive";
import { useClientStore } from "./client-store";

export type TaskLogLoadStatus = "idle" | "loading" | "loaded" | "error";

export type TaskTreeMutationResult =
  | { ok: true; tasks: Task[] }
  | { ok: false; error: string };

// SSE dedup: track IDs we created so SSE echoes are suppressed
const _recentlyCreatedIds = new Set<string>();
// Track optimistic creates by their local IDs. SSE-created rows are allowed to
// coexist briefly; the matching HTTP response removes the correct temp row.
const _pendingCreates = new Set<string>();
const _archiveRequests = new Map<string, Promise<TaskTreeMutationResult>>();
const _restoreRequests = new Map<string, Promise<TaskTreeMutationResult>>();
const _logFetchRequests = new Map<string, number>();
let _latestTaskFetchRequest = 0;
let _taskMutationRevision = 0;
// Track tasks the user has explicitly marked as "done" via the UI.
// Prevents fetchTasks / SSE / server responses from reverting them.
// Stores timestamp so protection auto-expires after 10s.
const _userDoneIds = new Map<string, number>();
const DONE_PROTECTION_MS = 10_000;
function markUserDone(id: string) { _userDoneIds.set(id, Date.now()); }
function isUserDone(id: string) {
  const ts = _userDoneIds.get(id);
  if (!ts) return false;
  if (Date.now() - ts > DONE_PROTECTION_MS) { _userDoneIds.delete(id); return false; }
  return true;
}

function noteTaskMutation(): void {
  _taskMutationRevision += 1;
}

function taskTime(task: Pick<Task, "updatedAt">): number {
  const value = Date.parse(task.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function isWorkScopeObject(value: unknown): value is Task["workScope"] {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "mode" in value);
}

function normalizeIncomingTask(
  incoming: Task & { workScope?: unknown },
  current?: Task,
): Task {
  let workScope: unknown = incoming.workScope;
  if (typeof workScope === "string") {
    try {
      workScope = JSON.parse(workScope) as unknown;
    } catch {
      workScope = null;
    }
  }
  if (!isWorkScopeObject(workScope)) {
    if (!current) throw new Error(`Task ${incoming.id} is missing a valid work scope`);
    workScope = current.workScope;
  }
  return normalizeDoneTask({
    ...incoming,
    workScope,
    needsInput: Boolean(incoming.needsInput),
    hasMainChat: typeof incoming.hasMainChat === "boolean"
      ? incoming.hasMainChat
      : current?.hasMainChat ?? true,
  } as Task);
}

function keepNewerTask(current: Task | undefined, incoming: Task): Task {
  if (!current) return incoming;
  const currentTime = taskTime(current);
  const incomingTime = taskTime(incoming);
  if (incomingTime < currentTime) return current;
  if (current.archivedAt && !incoming.archivedAt && incomingTime <= currentTime) return current;
  if (current.archivingAt && !incoming.archivingAt && incomingTime <= currentTime) return current;
  return incoming;
}

function normalizeDoneUpdate(updates: TaskUpdateInput, completedAt = new Date().toISOString()): TaskUpdateInput {
  if (updates.status !== "done") return updates;
  return {
    ...updates,
    needsInput: false,
    errorMessage: null,
    activityLabel: Object.prototype.hasOwnProperty.call(updates, "activityLabel")
      ? updates.activityLabel ?? null
      : null,
    completedAt: updates.completedAt ?? completedAt,
  };
}

function normalizeDoneTask(task: Task): Task {
  if (task.status !== "done") return task;
  return {
    ...task,
    needsInput: false,
    errorMessage: null,
  };
}

interface TaskStore {
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
  outputFiles: Record<string, OutputFile[]>;
  logEntries: Record<string, LogEntry[]>;
  logLoadStatus: Record<string, TaskLogLoadStatus>;
  logLoadErrors: Record<string, string | null>;
  archivePendingIds: string[];
  restorePendingIds: string[];
  selectedTaskId: string | null;

  // Actions
  fetchTasks: () => Promise<void>;
  createTask: (title: string, description: string | null, level: TaskLevel, projectSlug?: string | null, parentId?: string | null, permissionMode?: string, initialStatus?: string, clientId?: string | null, model?: ClaudeModel | null, thinkingEffort?: ClaudeThinkingEffort | null) => Promise<string | null>;
  updateTask: (id: string, updates: TaskUpdateInput) => Promise<void>;
  moveTask: (id: string, newStatus: string, newOrder: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<boolean>;
  archiveGoal: (id: string) => Promise<TaskTreeMutationResult>;
  restoreGoal: (id: string) => Promise<TaskTreeMutationResult>;
  branchTask: (id: string, fromLogId: string, editedContent: string) => Promise<Task | null>;
  applySSEEvent: (event: TaskEvent) => void;
  fetchOutputFiles: (taskId: string) => Promise<void>;
  fetchLogEntries: (taskId: string) => Promise<void>;
  appendLogEntry: (taskId: string, entry: LogEntry) => void;
  syncPhases: (parentTaskId: string) => Promise<void>;
  syncProjects: () => Promise<void>;
  setTaskFields: (id: string, fields: Partial<Task>) => void;
  openPanel: (taskId: string) => void;
  closePanel: () => void;

  // Selectors
  getTasksByStatus: (status: string) => Task[];
  getChildTasks: (parentId: string) => Task[];
  getRunningCount: () => number;
  getActiveGoals: () => Task[];
  getArchivedGoals: () => Task[];
  isTaskReadOnly: (taskId: string) => boolean;
  getOutputFiles: (taskId: string) => OutputFile[];
}

function getActiveTaskScope(): string[] | null {
  return useClientStore.getState().activeClientSlugs;
}

function buildSyncProjectsUrl(): string | null {
  const activeClientSlugs = getActiveTaskScope();
  if (activeClientSlugs !== null && activeClientSlugs.length === 0) {
    return null;
  }
  if (activeClientSlugs === null || activeClientSlugs.length !== 1) {
    return "/api/tasks/sync-projects";
  }

  const [onlyClient] = activeClientSlugs;
  if (onlyClient === "_root") {
    return "/api/tasks/sync-projects?clientId=root";
  }

  return `/api/tasks/sync-projects?clientId=${encodeURIComponent(onlyClient)}`;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,
  outputFiles: {},
  logEntries: {},
  logLoadStatus: {},
  logLoadErrors: {},
  archivePendingIds: [],
  restorePendingIds: [],
  selectedTaskId: null,

  fetchTasks: async () => {
    const requestId = ++_latestTaskFetchRequest;
    const mutationRevision = _taskMutationRevision;
    set({ isLoading: true, error: null });
    try {
      // Keep the local task cache profile-wide. Feed/history presentation
      // applies explicit filters without making the selected Team/client an
      // ownership boundary for existing chats.
      const res = await fetch("/api/tasks?scope=profile");
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const serverTasks = await res.json() as Array<Task & { workScope?: unknown }>;
      if (requestId !== _latestTaskFetchRequest) return;
      // Preserve user-done status: if the user marked a task "done" locally
      // but the server hasn't caught up yet, keep the local "done" state.
      set((state) => {
        const currentById = new Map(state.tasks.map((task) => [task.id, task]));
        const merged = serverTasks.map((serverTask) => {
          const current = currentById.get(serverTask.id);
          let next = normalizeIncomingTask(serverTask, current);
          next = keepNewerTask(current, next);
          if (isUserDone(next.id) && next.status !== "done") {
            return normalizeDoneTask({ ...next, status: "done" as const });
          }
          if (isUserDone(next.id) && next.status === "done") {
            _userDoneIds.delete(next.id);
          }
          return next;
        });
        if (_taskMutationRevision !== mutationRevision) {
          const serverIds = new Set(merged.map((task) => task.id));
          for (const current of state.tasks) {
            if (!serverIds.has(current.id)) merged.push(current);
          }
        }
        return { tasks: merged, isLoading: false };
      });
    } catch (err) {
      if (requestId !== _latestTaskFetchRequest) return;
      set({
        error: err instanceof Error ? err.message : "Unknown error",
        isLoading: false,
      });
    }
  },

  createTask: async (title: string, description: string | null, level: TaskLevel, projectSlug?: string | null, parentId?: string | null, permissionMode?: string, initialStatus?: string, clientIdOverride?: string | null, model?: ClaudeModel | null, thinkingEffort?: ClaudeThinkingEffort | null) => {
    const tempId = "temp-" + crypto.randomUUID();
    const now = new Date().toISOString();
    const currentClientId = clientIdOverride !== undefined ? clientIdOverride : useClientStore.getState().selectedClientId;
    const activePermissionMode = getActivePermissionMode(permissionMode, "bypassPermissions");
    const executionPermissionMode = getExecutionPermissionMode(permissionMode, "bypassPermissions");
    const tempTask: Task = {
      id: tempId,
      title,
      description: description || null,
      status: (initialStatus as Task["status"]) || "queued",
      level,
      parentId: parentId || null,
      projectSlug: projectSlug || null,
      columnOrder: -Date.now(),
      createdAt: now,
      updatedAt: now,
      costUsd: null,
      tokensUsed: null,
      durationMs: null,
      activityLabel: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      archivedAt: null,
      hasMainChat: true,
      clientId: currentClientId,
      // Optimistic-only placeholder. The server response replaces this row
      // with the authenticated immutable Team/Solo scope.
      workScope: { mode: "solo", version: 1, clientId: currentClientId },
      needsInput: false,
      phaseNumber: null,
      gsdStep: null,
      contextSources: null,
      cronJobSlug: null,
      claudeSessionId: null,
      permissionMode: activePermissionMode,
      executionPermissionMode,
      model: model ?? null,
      thinkingEffort: thinkingEffort ?? null,
      lastReplyAt: null,
      goalGroup: null,
      tag: null,
      pinnedAt: null,
    };

    // Track pending create for SSE reconciliation
    _pendingCreates.add(tempId);

    // Optimistic: add temp task to state immediately
    noteTaskMutation();
    set((state) => ({ tasks: [tempTask, ...state.tasks] }));

    try {
      const clientId = clientIdOverride !== undefined ? clientIdOverride : useClientStore.getState().selectedClientId;
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          level,
          projectSlug,
          clientId,
          parentId,
          permissionMode: activePermissionMode,
          executionPermissionMode,
          model,
          thinkingEffort,
          status: initialStatus,
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "Failed to create task"));
      }
      const realTaskRaw = await res.json() as Task & { workScope?: unknown };
      const realTask = normalizeIncomingTask(realTaskRaw, tempTask);

      _pendingCreates.delete(tempId);
      _recentlyCreatedIds.add(realTask.id);
      setTimeout(() => _recentlyCreatedIds.delete(realTask.id), 10000);

      set((state) => {
        // Check if SSE already added this task (SSE beat the API response)
        const sseAlreadyAdded = state.tasks.some(
          (t) => t.id === realTask.id
        );
        if (sseAlreadyAdded) {
          // Remove this request's temp row and merge the authoritative response.
          return {
            tasks: state.tasks
              .filter((t) => t.id !== tempId)
              .map((task) => task.id === realTask.id
                ? keepNewerTask(task, realTask)
                : task),
          };
        }
        // Normal: replace temp with real
        return {
          tasks: state.tasks.map((t) => (t.id === tempId ? realTask : t)),
        };
      });
      noteTaskMutation();
      return realTask.id as string;
    } catch (err) {
      _pendingCreates.delete(tempId);
      noteTaskMutation();
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== tempId),
        error: err instanceof Error ? err.message : "Unknown error",
      }));
      return null;
    }
  },

  updateTask: async (id: string, updates: TaskUpdateInput) => {
    const shortId = id.slice(0, 8);
    const normalizedUpdates = normalizeDoneUpdate(updates);
    // Track user-initiated "done" transitions so no server response or
    // fetchTasks call can revert them.
    if (normalizedUpdates.status === "done") {
      console.log(`[task-store] updateTask(${shortId}): marking done, setting protection`);
      markUserDone(id);
    } else if (normalizedUpdates.status) {
      // User explicitly moved task OUT of done — clear protection
      _userDoneIds.delete(id);
    }
    // Optimistic: apply updates immediately so the UI responds instantly
    // and SSE guards (status === "done") take effect before any events arrive.
    noteTaskMutation();
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? normalizeDoneTask({ ...t, ...normalizedUpdates, updatedAt: new Date().toISOString() }) : t
      ),
    }));
    console.log(`[task-store] updateTask(${shortId}): optimistic done applied, store status=`, get().tasks.find(t => t.id === id)?.status);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedUpdates),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to update task"));
      const updated = await res.json() as Task & { workScope?: unknown };
      console.log(`[task-store] updateTask(${shortId}): server responded status=${updated.status}, needsInput=${updated.needsInput}, isUserDone=${isUserDone(id)}`);
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (t.id !== id) return t;
          // Don't let server response revert a user-done task
          const normalizedUpdated = normalizeIncomingTask(updated, t);
          if (isUserDone(id) && normalizedUpdated.status !== "done") {
            console.log(`[task-store] updateTask(${shortId}): BLOCKED server revert to ${updated.status}`);
            return normalizeDoneTask({ ...t, ...normalizedUpdated, status: "done" as const });
          }
          return normalizeDoneTask({ ...t, ...normalizedUpdated });
        }),
      }));
      console.log(`[task-store] updateTask(${shortId}): final store status=`, get().tasks.find(t => t.id === id)?.status);
    } catch (err) {
      console.log(`[task-store] updateTask(${shortId}): ERROR, reverting via fetchTasks`, err);
      // Revert optimistic update on failure by re-fetching
      await get().fetchTasks();
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  moveTask: async (id: string, newStatus: string, newOrder: number) => {
    // Track user-initiated done transitions
    if (newStatus === "done") {
      markUserDone(id);
    } else {
      _userDoneIds.delete(id);
    }
    const prev = get().tasks;

    // Optimistic: reorder properly by removing the task, inserting at new position,
    // and reindexing all columnOrder values in affected columns
    noteTaskMutation();
    set((state) => {
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return state;

      const oldStatus = task.status;
      const now = new Date().toISOString();

      // Build updated tasks array
      let updated = state.tasks.map((t) => {
        if (t.id === id) {
          const patch: Partial<Task> = { status: newStatus as Task["status"], columnOrder: newOrder };
          // Optimistically set startedAt when transitioning to running/review/done
          if (["running", "review", "done"].includes(newStatus) && !t.startedAt) {
            patch.startedAt = now;
          }
          // Set completedAt when moving to done
          if (newStatus === "done" && !t.completedAt) {
            patch.completedAt = now;
          }
          if (newStatus === "done") {
            patch.needsInput = false;
            patch.errorMessage = null;
            patch.activityLabel = null;
          }
          return normalizeDoneTask({ ...t, ...patch });
        }
        return t;
      });

      // Get tasks in the destination column (sorted), reindex their columnOrder
      const destTasks = updated
        .filter((t) => t.status === newStatus && !t.parentId)
        .sort((a, b) => {
          // Put the moved task at the desired position
          if (a.id === id) return newOrder - 0.5 - b.columnOrder;
          if (b.id === id) return a.columnOrder - (newOrder - 0.5);
          return a.columnOrder - b.columnOrder;
        });

      // Reindex destination column
      const destOrderMap = new Map<string, number>();
      destTasks.forEach((t, i) => destOrderMap.set(t.id, i));

      // If moved across columns, also reindex source column
      const sourceOrderMap = new Map<string, number>();
      if (oldStatus !== newStatus) {
        const sourceTasks = updated
          .filter((t) => t.status === oldStatus && !t.parentId && t.id !== id)
          .sort((a, b) => a.columnOrder - b.columnOrder);
        sourceTasks.forEach((t, i) => sourceOrderMap.set(t.id, i));
      }

      updated = updated.map((t) => {
        if (destOrderMap.has(t.id)) {
          return { ...t, columnOrder: destOrderMap.get(t.id)! };
        }
        if (sourceOrderMap.has(t.id)) {
          return { ...t, columnOrder: sourceOrderMap.get(t.id)! };
        }
        return t;
      });

      return { tasks: updated };
    });

    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeDoneUpdate({
          status: newStatus as Task["status"],
          columnOrder: newOrder,
          ...(newStatus === "done" ? { completedAt: new Date().toISOString(), needsInput: false, errorMessage: null } : {}),
        })),
      });
      if (!res.ok) {
        // Only revert if the user hasn't since moved the task again
        _userDoneIds.delete(id);
        set({ tasks: prev });
        throw new Error("Failed to move task");
      }
      // Apply server response to get authoritative values (startedAt, etc.)
      const serverTask = await res.json() as Task & { workScope?: unknown };
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (t.id !== id) return t;
          // Don't let server response revert a user-done task
          const normalizedServerTask = normalizeIncomingTask(serverTask, t);
          if (isUserDone(id) && normalizedServerTask.status !== "done") {
            return normalizeDoneTask({ ...t, ...normalizedServerTask, status: "done" as const });
          }
          return normalizeDoneTask({ ...t, ...normalizedServerTask });
        }),
      }));
    } catch {
      _userDoneIds.delete(id);
      set({ tasks: prev });
    }
  },

  deleteTask: async (id: string) => {
    // Optimistic: remove immediately
    const prev = get().tasks;
    noteTaskMutation();
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id && t.parentId !== id),
    }));

    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Revert on error
        set({ tasks: prev });
        throw new Error("Failed to delete task");
      }
    } catch (err) {
      set({
        tasks: prev,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  cancelTask: async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        throw new Error(await readApiError(res, "Failed to stop task"));
      }
      const updatedRaw = await res.json() as Task & { workScope?: unknown };
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id
          ? normalizeIncomingTask(updatedRaw, t)
          : t)),
      }));
      noteTaskMutation();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to stop task" });
      return false;
    }
  },

  archiveGoal: (id: string) => {
    const inFlight = _archiveRequests.get(id);
    if (inFlight) return inFlight;
    if (id.startsWith("temp-")) {
      return Promise.resolve({ ok: false, error: "Wait for this Goal to finish saving before archiving it." });
    }

    set((state) => ({
      archivePendingIds: [...new Set([...state.archivePendingIds, id])],
      error: null,
    }));
    const request = (async (): Promise<TaskTreeMutationResult> => {
      try {
        const res = await fetch(`/api/tasks/${id}/archive`, { method: "POST" });
        if (!res.ok) {
          let body: { code?: unknown; error?: unknown } | null = null;
          try {
            body = await res.clone().json() as { code?: unknown; error?: unknown };
          } catch { /* use the normal API error fallback below */ }
          if (body?.code === "task_stop_failed") {
            const archivingAt = new Date().toISOString();
            noteTaskMutation();
            set((state) => ({
              tasks: state.tasks.map((task) => task.id === id
                ? { ...task, archivingAt }
                : task),
            }));
          }
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : await readApiError(res, "Failed to archive Goal"),
          );
        }
        const payload = await res.json() as { tasks: Array<Task & { workScope?: unknown }> };
        const currentById = new Map(get().tasks.map((task) => [task.id, task]));
        const tasks = payload.tasks.map((task) => normalizeIncomingTask(task, currentById.get(task.id)));
        const updatedById = new Map(tasks.map((task) => [task.id, task]));
        noteTaskMutation();
        set((state) => ({
          tasks: state.tasks.map((task) => updatedById.get(task.id) ?? task),
        }));
        return { ok: true, tasks };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Failed to archive Goal";
        set({ error });
        return { ok: false, error };
      } finally {
        _archiveRequests.delete(id);
        set((state) => ({
          archivePendingIds: state.archivePendingIds.filter((taskId) => taskId !== id),
        }));
      }
    })();
    _archiveRequests.set(id, request);
    return request;
  },

  restoreGoal: (id: string) => {
    const inFlight = _restoreRequests.get(id);
    if (inFlight) return inFlight;
    if (id.startsWith("temp-")) {
      return Promise.resolve({ ok: false, error: "Wait for this Goal to finish saving before restoring it." });
    }

    // Restore is an explicit move out of done, so the short-lived protection
    // used by Mark complete must not force the authoritative queued state back.
    _userDoneIds.delete(id);
    set((state) => ({
      restorePendingIds: [...new Set([...state.restorePendingIds, id])],
      error: null,
    }));
    const request = (async (): Promise<TaskTreeMutationResult> => {
      try {
        const res = await fetch(`/api/tasks/${id}/restore`, { method: "POST" });
        if (!res.ok) throw new Error(await readApiError(res, "Failed to restore Goal"));
        const payload = await res.json() as { tasks: Array<Task & { workScope?: unknown }> };
        const currentById = new Map(get().tasks.map((task) => [task.id, task]));
        const tasks = payload.tasks.map((task) => normalizeIncomingTask(task, currentById.get(task.id)));
        const updatedById = new Map(tasks.map((task) => [task.id, task]));
        noteTaskMutation();
        set((state) => ({
          tasks: state.tasks.map((task) => updatedById.get(task.id) ?? task),
        }));
        return { ok: true, tasks };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Failed to restore Goal";
        set({ error });
        return { ok: false, error };
      } finally {
        _restoreRequests.delete(id);
        set((state) => ({
          restorePendingIds: state.restorePendingIds.filter((taskId) => taskId !== id),
        }));
      }
    })();
    _restoreRequests.set(id, request);
    return request;
  },

  branchTask: async (id: string, fromLogId: string, editedContent: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromLogId, editedContent }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "Failed to send edited message"));
      }
      const branchRaw = await res.json() as Task & { workScope?: unknown };
      const branch = normalizeIncomingTask(branchRaw, get().tasks.find((task) => task.id === id));
      noteTaskMutation();
      set((state) => ({
        tasks: state.tasks.some((task) => task.id === branch.id)
          ? state.tasks.map((task) => (task.id === branch.id ? { ...task, ...branch } : task))
          : [branch, ...state.tasks],
      }));
      await get().fetchLogEntries(branch.id);
      return branch;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to send edited message" });
      return null;
    }
  },

  applySSEEvent: (event: TaskEvent) => {
    switch (event.type) {
      case "task:created":
        // Skip self-echo
        if (_recentlyCreatedIds.has(event.task.id)) {
          _recentlyCreatedIds.delete(event.task.id);
          break;
        }
        noteTaskMutation();
        set((state) => {
          const current = state.tasks.find((task) => task.id === event.task.id);
          let eventTask: Task;
          try {
            eventTask = normalizeIncomingTask(event.task, current);
          } catch {
            return state;
          }
          if (current) {
            return {
              tasks: state.tasks.map((task) => task.id === eventTask.id
                ? keepNewerTask(task, eventTask)
                : task),
            };
          }
          // Do not guess which same-title optimistic row this event belongs to.
          // Its HTTP response will remove the exact temporary ID.
          return { tasks: [...state.tasks, eventTask] };
        });
        break;
      case "task:updated":
      case "task:status":
      case "task:progress":
        if (event.type === "task:status" && isLegacyCronFallbackLogSet(get().logEntries[event.task.id] || [])) {
          queueMicrotask(() => {
            void get().fetchLogEntries(event.task.id);
          });
        }
        noteTaskMutation();
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== event.task.id) return t;
            // Don't let SSE revert a task the user has manually marked done.
            // The server-side process may still emit progress/status events
            // with stale state (e.g. needsInput: true) after the user moved
            // the task to done.
            let eventTask: Task;
            try {
              eventTask = normalizeIncomingTask(event.task, t);
            } catch {
              return t;
            }
            if (keepNewerTask(t, eventTask) === t) return t;
            if ((t.status === "done" || isUserDone(t.id)) && eventTask.status !== "done") {
              console.log(`[task-store] SSE BLOCKED: ${event.type} tried to set ${t.id.slice(0,8)} to ${event.task.status} but it's done`);
              return normalizeDoneTask(t);
            }
            if (t.status !== eventTask.status) {
              console.log(`[task-store] SSE APPLIED: ${event.type} changed ${t.id.slice(0,8)} from ${t.status} to ${eventTask.status}`);
            }
            // Preserve user-facing title: server events (progress, status) should
            // not overwrite the title with system prompt text. Only explicit
            // task:updated events with a meaningfully different title (not longer
            // than the original by 3x) should update it.
            const preserveTitle =
              event.type !== "task:updated" ||
              (eventTask.title.length > t.title.length * 3 && eventTask.title.length > 80);
            // Progress events must never downgrade needsInput from true to false —
            // they fire before question detection and carry stale needsInput state.
            const preserveNeedsInput =
              event.type === "task:progress" && t.needsInput && !eventTask.needsInput && eventTask.status !== "done";
            const merged = preserveTitle
              ? { ...eventTask, title: t.title }
              : eventTask;
            const nextTask = preserveNeedsInput
              ? { ...merged, needsInput: true }
              : merged;
            return normalizeDoneTask(nextTask);
          }),
        }));
        break;
      case "task:output":
        // Re-fetch outputs for this task
        get().fetchOutputFiles(event.task.id);
        break;
      case "task:question":
        noteTaskMutation();
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== event.task.id) return t;
            // Don't revert a user-done task
            let eventTask: Task;
            try {
              eventTask = normalizeIncomingTask(event.task, t);
            } catch {
              return t;
            }
            if (keepNewerTask(t, eventTask) === t) return t;
            if ((t.status === "done" || isUserDone(t.id)) && eventTask.status !== "done") return normalizeDoneTask(t);
            return eventTask;
          }),
        }));
        break;
      case "task:log":
        // Append log entry and update task state (needsInput, activityLabel, etc.)
        if (event.logEntry) {
          get().appendLogEntry(event.task.id, event.logEntry);
        }
        noteTaskMutation();
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== event.task.id) return t;
            let eventTask: Task;
            try {
              eventTask = normalizeIncomingTask(event.task, t);
            } catch {
              return t;
            }
            if (keepNewerTask(t, eventTask) === t) return t;
            if ((t.status === "done" || isUserDone(t.id)) && eventTask.status !== "done") return normalizeDoneTask(t);
            if (eventTask.status === "done") return eventTask;
            // Never let a log event downgrade needsInput from true to false —
            // log events fire before question detection and carry stale state.
            const newNeedsInput = (t.needsInput && !eventTask.needsInput) ? true : eventTask.needsInput;
            return { ...t, needsInput: newNeedsInput, activityLabel: eventTask.activityLabel };
          }),
        }));
        break;
      case "task:deleted":
        noteTaskMutation();
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== event.task.id),
        }));
        break;
    }
  },

  fetchOutputFiles: async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/outputs`);
      if (!res.ok) return;
      const files = await res.json();
      set((state) => ({
        outputFiles: { ...state.outputFiles, [taskId]: files },
      }));
    } catch {
      // Silently fail -- outputs are non-critical
    }
  },

  fetchLogEntries: async (taskId: string) => {
    const requestId = (_logFetchRequests.get(taskId) ?? 0) + 1;
    _logFetchRequests.set(taskId, requestId);
    set((state) => ({
      logLoadStatus: { ...state.logLoadStatus, [taskId]: "loading" },
      logLoadErrors: { ...state.logLoadErrors, [taskId]: null },
    }));
    try {
      const res = await fetch(`/api/tasks/${taskId}/logs`);
      if (!res.ok) {
        throw new Error(await readApiError(
          res,
          res.status === 404 ? "This chat is no longer available." : "Failed to load conversation history",
        ));
      }
      const entries = await res.json() as LogEntry[];
      if (_logFetchRequests.get(taskId) !== requestId) return;
      set((state) => ({
        logEntries: { ...state.logEntries, [taskId]: entries },
        logLoadStatus: { ...state.logLoadStatus, [taskId]: "loaded" },
        logLoadErrors: { ...state.logLoadErrors, [taskId]: null },
      }));
    } catch (err) {
      if (_logFetchRequests.get(taskId) !== requestId) return;
      const error = err instanceof Error ? err.message : "Failed to load conversation history";
      set((state) => ({
        logLoadStatus: { ...state.logLoadStatus, [taskId]: "error" },
        logLoadErrors: { ...state.logLoadErrors, [taskId]: error },
      }));
    }
  },

  appendLogEntry: (taskId: string, entry: LogEntry) => {
    const existing = get().logEntries[taskId] || [];
    const shouldRefreshLegacyCronLogs =
      !isLegacyCronFallbackLogEntry(entry) &&
      !entry.id.startsWith("local-") &&
      isLegacyCronFallbackLogSet(existing);

    if (shouldRefreshLegacyCronLogs) {
      queueMicrotask(() => {
        void get().fetchLogEntries(taskId);
      });
      return;
    }

    set((state) => {
      const existingEntries = state.logEntries[taskId] || [];
      // Deduplicate: skip if this entry ID already exists (from initial fetch)
      if (existingEntries.some((e) => e.id === entry.id)) return state;
      // Deduplicate user_reply: optimistic entry uses "local-" ID, server uses a different UUID.
      // Match by type + content to prevent double display.
      if (entry.type === "user_reply") {
        const isDuplicate = existingEntries.some(
          (e) => e.type === "user_reply" && e.content === entry.content
        );
        if (isDuplicate) return state;
      }
      return {
        logEntries: { ...state.logEntries, [taskId]: [...existingEntries, entry] },
        logLoadStatus: { ...state.logLoadStatus, [taskId]: "loaded" },
        logLoadErrors: { ...state.logLoadErrors, [taskId]: null },
      };
    });
  },

  syncPhases: async (parentTaskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${parentTaskId}/sync-phases`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to sync phases");
      // Re-fetch all tasks to pick up the new children
      await get().fetchTasks();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  syncProjects: async () => {
    try {
      const url = buildSyncProjectsUrl();
      if (!url) return;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) return;
      const { synced } = await res.json();
      if (synced > 0) {
        await get().fetchTasks();
      }
    } catch {
      // Non-critical — silently fail
    }
  },

  setTaskFields: (id: string, fields: Partial<Task>) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...fields } : t
      ),
    }));
  },

  openPanel: (taskId: string) => {
    set({ selectedTaskId: taskId });
  },

  closePanel: () => {
    set({ selectedTaskId: null });
  },

  getTasksByStatus: (status: string) => {
    return getVisibleEditedTasks(get().tasks)
      .filter((t) => t.status === status && !t.parentId)
      .sort((a, b) => a.columnOrder - b.columnOrder);
  },

  getChildTasks: (parentId: string) => {
    const tasks = get().tasks;
    const rootParentId = getEditedLineageRootTaskId(parentId, tasks);
    return getVisibleEditedTasks(tasks)
      .filter((t) => t.parentId === parentId || t.parentId === rootParentId)
      .sort((a, b) => a.columnOrder - b.columnOrder);
  },

  getRunningCount: () => {
    return getVisibleEditedTasks(get().tasks).filter((t) => t.status === "running").length;
  },

  getActiveGoals: () => selectActiveGoals(get().tasks),

  getArchivedGoals: () => selectArchivedGoals(get().tasks),

  isTaskReadOnly: (taskId: string) => resolveTaskReadOnly(get().tasks, taskId),

  getOutputFiles: (taskId: string) => {
    return get().outputFiles[taskId] || [];
  },
}));
