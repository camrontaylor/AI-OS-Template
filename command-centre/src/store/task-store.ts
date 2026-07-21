import { create } from "zustand";
import type { Task, TaskLevel, TaskUpdateInput, OutputFile, LogEntry, ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import type { TaskEvent } from "@/lib/event-bus";
import { isLegacyCronFallbackLogEntry, isLegacyCronFallbackLogSet } from "@/lib/task-logs";
import {
  getActivePermissionMode,
  getExecutionPermissionMode,
} from "@/lib/permission-mode";
import { readApiError } from "@/lib/api-error";
import { useClientStore } from "./client-store";

// SSE dedup: track IDs we created so SSE echoes are suppressed
const _recentlyCreatedIds = new Set<string>();
// Track pending optimistic creates by tempId -> title for SSE reconciliation
const _pendingCreates = new Map<string, string>();
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

interface TaskStore {
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
  outputFiles: Record<string, OutputFile[]>;
  logEntries: Record<string, LogEntry[]>;
  selectedTaskId: string | null;

  // Actions
  fetchTasks: () => Promise<void>;
  createTask: (title: string, description: string | null, level: TaskLevel, projectSlug?: string | null, parentId?: string | null, permissionMode?: string, initialStatus?: string, clientId?: string | null, model?: ClaudeModel | null, thinkingEffort?: ClaudeThinkingEffort | null) => Promise<string | null>;
  updateTask: (id: string, updates: TaskUpdateInput) => Promise<void>;
  moveTask: (id: string, newStatus: string, newOrder: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
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
  getOutputFiles: (taskId: string) => OutputFile[];
}

function getActiveTaskScope(): string[] | null {
  return useClientStore.getState().activeClientSlugs;
}

function buildTaskScopeUrl(basePath: string): string {
  const activeClientSlugs = getActiveTaskScope();
  if (activeClientSlugs === null) {
    return basePath;
  }

  const params = new URLSearchParams();
  params.set("clientIds", activeClientSlugs.join(","));
  return `${basePath}?${params.toString()}`;
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
  selectedTaskId: null,

  fetchTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const activeClientSlugs = getActiveTaskScope();
      if (activeClientSlugs !== null && activeClientSlugs.length === 0) {
        set({ tasks: [], isLoading: false });
        return;
      }

      const url = buildTaskScopeUrl("/api/tasks");
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const serverTasks: Task[] = await res.json();
      // Preserve user-done status: if the user marked a task "done" locally
      // but the server hasn't caught up yet, keep the local "done" state.
      const merged = serverTasks.map((st) => {
        if (isUserDone(st.id) && st.status !== "done") {
          console.log(`[task-store] fetchTasks: PROTECTED ${st.id.slice(0,8)} from server status=${st.status}, keeping done`);
          return { ...st, status: "done" as const, needsInput: false };
        }
        // Server confirms done — clear the protection
        if (isUserDone(st.id) && st.status === "done") {
          _userDoneIds.delete(st.id);
        }
        return st;
      });
      console.log(`[task-store] fetchTasks: applied ${merged.length} tasks, doneCount=${merged.filter(t => t.status === "done").length}`);
      set({ tasks: merged, isLoading: false });
    } catch (err) {
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
      clientId: currentClientId,
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
    _pendingCreates.set(tempId, title);

    // Optimistic: add temp task to state immediately
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
      const realTask = await res.json();

      _pendingCreates.delete(tempId);
      _recentlyCreatedIds.add(realTask.id);
      setTimeout(() => _recentlyCreatedIds.delete(realTask.id), 10000);

      set((state) => {
        // Check if SSE already added this task (SSE beat the API response)
        const sseAlreadyAdded = state.tasks.some(
          (t) => t.id === realTask.id
        );
        if (sseAlreadyAdded) {
          // Just remove the temp — SSE already has the real task in state
          return { tasks: state.tasks.filter((t) => t.id !== tempId) };
        }
        // Normal: replace temp with real
        return {
          tasks: state.tasks.map((t) => (t.id === tempId ? realTask : t)),
        };
      });
      return realTask.id as string;
    } catch (err) {
      _pendingCreates.delete(tempId);
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== tempId),
        error: err instanceof Error ? err.message : "Unknown error",
      }));
      return null;
    }
  },

  updateTask: async (id: string, updates: TaskUpdateInput) => {
    const shortId = id.slice(0, 8);
    // Track user-initiated "done" transitions so no server response or
    // fetchTasks call can revert them.
    if (updates.status === "done") {
      console.log(`[task-store] updateTask(${shortId}): marking done, setting protection`);
      markUserDone(id);
    } else if (updates.status) {
      // User explicitly moved task OUT of done — clear protection
      _userDoneIds.delete(id);
    }
    // Optimistic: apply updates immediately so the UI responds instantly
    // and SSE guards (status === "done") take effect before any events arrive.
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
      ),
    }));
    console.log(`[task-store] updateTask(${shortId}): optimistic done applied, store status=`, get().tasks.find(t => t.id === id)?.status);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update task");
      const updated = await res.json();
      console.log(`[task-store] updateTask(${shortId}): server responded status=${updated.status}, needsInput=${updated.needsInput}, isUserDone=${isUserDone(id)}`);
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (t.id !== id) return t;
          // Don't let server response revert a user-done task
          if (isUserDone(id) && updated.status !== "done") {
            console.log(`[task-store] updateTask(${shortId}): BLOCKED server revert to ${updated.status}`);
            return { ...t, ...updated, status: "done" as const, needsInput: false };
          }
          return { ...t, ...updated };
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
          return { ...t, ...patch };
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
        body: JSON.stringify({
          status: newStatus,
          columnOrder: newOrder,
          ...(newStatus === "done" ? { completedAt: new Date().toISOString(), needsInput: false, errorMessage: null } : {}),
        }),
      });
      if (!res.ok) {
        // Only revert if the user hasn't since moved the task again
        _userDoneIds.delete(id);
        set({ tasks: prev });
        throw new Error("Failed to move task");
      }
      // Apply server response to get authoritative values (startedAt, etc.)
      const serverTask = await res.json();
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (t.id !== id) return t;
          // Don't let server response revert a user-done task
          if (isUserDone(id) && serverTask.status !== "done") {
            return { ...t, ...serverTask, status: "done" as const, needsInput: false };
          }
          return { ...t, ...serverTask };
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
      if (res.ok) {
        const updated = await res.json();
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updated } : t)),
        }));
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to cancel task" });
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
        set((state) => {
          // Already exists — skip
          if (state.tasks.some((t) => t.id === event.task.id)) return state;

          // Check if this matches a pending optimistic create (SSE arrived before API response)
          const pendingEntry = [..._pendingCreates.entries()].find(
            ([, title]) => title === event.task.title
          );
          if (pendingEntry) {
            const [tempId] = pendingEntry;
            // Mark as recently created so if API response also arrives, it's handled
            _recentlyCreatedIds.add(event.task.id);
            _pendingCreates.delete(tempId);
            // Replace temp with real task from SSE
            return {
              tasks: state.tasks.map((t) =>
                t.id === tempId ? event.task : t
              ),
            };
          }

          return { tasks: [...state.tasks, event.task] };
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
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== event.task.id) return t;
            // Don't let SSE revert a task the user has manually marked done.
            // The server-side process may still emit progress/status events
            // with stale state (e.g. needsInput: true) after the user moved
            // the task to done.
            if ((t.status === "done" || isUserDone(t.id)) && event.task.status !== "done") {
              console.log(`[task-store] SSE BLOCKED: ${event.type} tried to set ${t.id.slice(0,8)} to ${event.task.status} but it's done`);
              return t;
            }
            if (t.status !== event.task.status) {
              console.log(`[task-store] SSE APPLIED: ${event.type} changed ${t.id.slice(0,8)} from ${t.status} to ${event.task.status}`);
            }
            // Preserve user-facing title: server events (progress, status) should
            // not overwrite the title with system prompt text. Only explicit
            // task:updated events with a meaningfully different title (not longer
            // than the original by 3x) should update it.
            const preserveTitle =
              event.type !== "task:updated" ||
              (event.task.title.length > t.title.length * 3 && event.task.title.length > 80);
            // Progress events must never downgrade needsInput from true to false —
            // they fire before question detection and carry stale needsInput state.
            const preserveNeedsInput =
              event.type === "task:progress" && t.needsInput && !event.task.needsInput;
            const merged = preserveTitle
              ? { ...event.task, title: t.title }
              : event.task;
            return preserveNeedsInput
              ? { ...merged, needsInput: true }
              : merged;
          }),
        }));
        break;
      case "task:output":
        // Re-fetch outputs for this task
        get().fetchOutputFiles(event.task.id);
        break;
      case "task:question":
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== event.task.id) return t;
            // Don't revert a user-done task
            if ((t.status === "done" || isUserDone(t.id)) && event.task.status !== "done") return t;
            return event.task;
          }),
        }));
        break;
      case "task:log":
        // Append log entry and update task state (needsInput, activityLabel, etc.)
        if (event.logEntry) {
          get().appendLogEntry(event.task.id, event.logEntry);
        }
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== event.task.id) return t;
            if ((t.status === "done" || isUserDone(t.id)) && event.task.status !== "done") return t;
            // Never let a log event downgrade needsInput from true to false —
            // log events fire before question detection and carry stale state.
            const newNeedsInput = (t.needsInput && !event.task.needsInput) ? true : event.task.needsInput;
            return { ...t, needsInput: newNeedsInput, activityLabel: event.task.activityLabel };
          }),
        }));
        break;
      case "task:deleted":
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
    try {
      const res = await fetch(`/api/tasks/${taskId}/logs`);
      if (!res.ok) return;
      const entries = await res.json();
      set((state) => ({
        logEntries: { ...state.logEntries, [taskId]: entries },
      }));
    } catch {
      // Silently fail
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
    return get()
      .tasks.filter((t) => t.status === status && !t.parentId)
      .sort((a, b) => a.columnOrder - b.columnOrder);
  },

  getChildTasks: (parentId: string) => {
    return get()
      .tasks.filter((t) => t.parentId === parentId)
      .sort((a, b) => a.columnOrder - b.columnOrder);
  },

  getRunningCount: () => {
    return get().tasks.filter((t) => t.status === "running").length;
  },

  getOutputFiles: (taskId: string) => {
    return get().outputFiles[taskId] || [];
  },
}));
