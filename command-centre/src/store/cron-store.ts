import { create } from "zustand";
import { useClientStore } from "./client-store";
import type {
  CronJob,
  CronRun,
  CronJobCreateInput,
  CronJobUpdateInput,
  CronSystemStatus,
} from "@/types/cron";
import type { TaskStatus } from "@/types/task";

const CRON_ORDER_KEY = "cron-job-order";
const CRON_PINNED_KEY = "cron-job-pinned";
const CRON_SYSTEM_STATUS_PATH = "/api/cron/system-status";

function getCronScopeKey(clientId: string | null): string {
  return clientId || "root";
}

export function getCronJobKey(slug: string, clientId: string | null): string {
  return `${getCronScopeKey(clientId)}:${slug}`;
}

function getScopedStorageKey(baseKey: string, clientId: string | null): string {
  return `${baseKey}:${getCronScopeKey(clientId)}`;
}

function loadCronOrder(clientId: string | null): string[] | null {
  try {
    const scopedKey = getScopedStorageKey(CRON_ORDER_KEY, clientId);
    const stored =
      typeof window !== "undefined"
        ? localStorage.getItem(scopedKey)
        : null;
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveCronOrder(clientId: string | null, slugs: string[]) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        getScopedStorageKey(CRON_ORDER_KEY, clientId),
        JSON.stringify(slugs)
      );
    }
  } catch {
    // Ignore
  }
}

function loadPinnedSlugs(clientId: string | null): string[] {
  try {
    const scopedKey = getScopedStorageKey(CRON_PINNED_KEY, clientId);
    const stored =
      typeof window !== "undefined"
        ? localStorage.getItem(scopedKey)
        : null;
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePinnedSlugs(clientId: string | null, slugs: string[]) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        getScopedStorageKey(CRON_PINNED_KEY, clientId),
        JSON.stringify(slugs)
      );
    }
  } catch {
    // Ignore
  }
}

function applySavedOrder(jobs: CronJob[], clientId: string | null): CronJob[] {
  const order = loadCronOrder(clientId);
  const pinned = new Set(loadPinnedSlugs(clientId));
  const sorted = [...jobs];

  // First apply saved order
  if (order) {
    sorted.sort((a, b) => {
      const ai = order.indexOf(a.slug);
      const bi = order.indexOf(b.slug);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  // Then float pinned items to top (preserving relative order among pinned)
  if (pinned.size > 0) {
    const pinnedJobs = sorted.filter((j) => pinned.has(j.slug));
    const unpinnedJobs = sorted.filter((j) => !pinned.has(j.slug));
    return [...pinnedJobs, ...unpinnedJobs];
  }

  return sorted;
}

function withClientQuery(path: string): string {
  const clientId = useClientStore.getState().selectedClientId;
  if (!clientId) {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}clientId=${encodeURIComponent(clientId)}`;
}

/** Tracks the status of a manually triggered cron run */
export interface ActiveCronRun {
  taskId: string;
  status: TaskStatus;
  activityLabel: string | null;
}

interface CronStore {
  jobs: CronJob[];
  systemStatus: CronSystemStatus | null;
  isLoading: boolean;
  error: string | null;
  expandedJob: string | null;
  runHistory: Record<string, CronRun[]>;
  showCreatePanel: boolean;
  editingJob: CronJob | null;
  createJobDraft: CronJobCreateInput | null;
  /** scoped job key → active run info (persists until task reaches review/done) */
  activeRuns: Record<string, ActiveCronRun>;
  /** Slugs pinned to the top of the list */
  pinnedSlugs: string[];

  fetchJobs: () => Promise<void>;
  fetchSystemStatus: () => Promise<void>;
  toggleJob: (slug: string) => Promise<void>;
  deleteJob: (slug: string) => Promise<void>;
  createJob: (input: CronJobCreateInput) => Promise<void>;
  updateJob: (slug: string, input: CronJobUpdateInput) => Promise<void>;
  runJobNow: (slug: string) => Promise<void>;
  expandJob: (slug: string | null) => void;
  fetchRunHistory: (slug: string, clientId?: string | null) => Promise<void>;
  setShowCreatePanel: (show: boolean) => void;
  setEditingJob: (job: CronJob | null) => void;
  setCreateJobDraft: (draft: CronJobCreateInput | null) => void;
  moveJob: (fromIndex: number, toIndex: number) => void;
  togglePin: (slug: string) => void;
}

export const useCronStore = create<CronStore>((set, get) => ({
  jobs: [],
  systemStatus: null,
  isLoading: false,
  error: null,
  expandedJob: null,
  runHistory: {},
  showCreatePanel: false,
  editingJob: null,
  createJobDraft: null,
  activeRuns: {},
  pinnedSlugs:
    typeof window !== "undefined" ? loadPinnedSlugs(useClientStore.getState().selectedClientId) : [],

  fetchJobs: async () => {
    set({ isLoading: true, error: null });
    try {
      const clientId = useClientStore.getState().selectedClientId;
      const url = clientId
        ? `/api/cron?clientId=${encodeURIComponent(clientId)}`
        : "/api/cron";
      const [jobsRes, systemStatusRes] = await Promise.allSettled([
        fetch(url),
        fetch(CRON_SYSTEM_STATUS_PATH),
      ]);

      if (jobsRes.status !== "fulfilled" || !jobsRes.value.ok) {
        throw new Error("Failed to fetch cron jobs");
      }

      const jobs = applySavedOrder(await jobsRes.value.json(), clientId);
      const systemStatus =
        systemStatusRes.status === "fulfilled" && systemStatusRes.value.ok
          ? ((await systemStatusRes.value.json()) as CronSystemStatus)
          : get().systemStatus;

      set({
        jobs,
        systemStatus,
        pinnedSlugs: loadPinnedSlugs(clientId),
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
        isLoading: false,
      });
    }
  },

  fetchSystemStatus: async () => {
    try {
      const res = await fetch(CRON_SYSTEM_STATUS_PATH);
      if (!res.ok) return;
      const systemStatus = (await res.json()) as CronSystemStatus;
      set({ systemStatus });
    } catch {
      // Silently fail -- runtime status is secondary to job loading
    }
  },

  toggleJob: async (slug: string) => {
    try {
      const res = await fetch(withClientQuery(`/api/cron/${slug}/toggle`), {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to toggle cron job");
      const updated = await res.json();
      set((state) => ({
        jobs: state.jobs.map((j) => (j.slug === slug ? updated : j)),
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  runJobNow: async (slug: string) => {
    // Prevent double-runs
    const clientId = useClientStore.getState().selectedClientId;
    const jobKey = getCronJobKey(slug, clientId);
    if (get().activeRuns[jobKey]) return;

    try {
      const res = await fetch(withClientQuery(`/api/cron/${slug}/run`), { method: "POST" });
      if (!res.ok) throw new Error("Failed to trigger cron job");
      const task = await res.json();

      // Track this active run
      set((state) => ({
        activeRuns: {
          ...state.activeRuns,
          [jobKey]: {
            taskId: task.id,
            status: task.status as TaskStatus,
            activityLabel: task.activityLabel,
          },
        },
      }));

      // Immediately refresh run history so the "Running" row appears
      if (get().expandedJob === jobKey) {
        get().fetchRunHistory(slug, clientId);
      }

      // Poll the task status until it reaches a terminal state
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/tasks/${task.id}/status`);
          if (!statusRes.ok) return;
          const statusData = await statusRes.json();

          const isTerminal = statusData.status === "review" || statusData.status === "done";

          set((state) => ({
            activeRuns: isTerminal
              ? (() => {
                  const { [jobKey]: _, ...rest } = state.activeRuns;
                  return rest;
                })()
              : {
                  ...state.activeRuns,
                  [jobKey]: {
                    taskId: task.id,
                    status: statusData.status,
                    activityLabel: statusData.activityLabel,
                  },
                },
          }));

          if (isTerminal) {
            clearInterval(pollInterval);
            // Refresh this job's metadata and history
            get().fetchJobs();
            if (get().expandedJob === jobKey) {
              get().fetchRunHistory(slug, clientId);
            }
          }
        } catch {
          // Silent fail on poll
        }
      }, 2000);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  deleteJob: async (slug: string) => {
    const prev = get().jobs;
    set((state) => ({
      jobs: state.jobs.filter((j) => j.slug !== slug),
    }));

    try {
      const res = await fetch(withClientQuery(`/api/cron/${slug}`), { method: "DELETE" });
      if (!res.ok) {
        set({ jobs: prev });
        throw new Error("Failed to delete cron job");
      }
    } catch (err) {
      set({
        jobs: prev,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  createJob: async (input: CronJobCreateInput) => {
    try {
      const url = withClientQuery("/api/cron");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to create cron job");
      const job = await res.json();
      set((state) => ({
        jobs: [job, ...state.jobs],
        showCreatePanel: false,
        createJobDraft: null,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  updateJob: async (slug: string, input: CronJobUpdateInput) => {
    try {
      const res = await fetch(withClientQuery(`/api/cron/${slug}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to update cron job");
      const updated = await res.json();
      set((state) => ({
        jobs: state.jobs.map((j) => (j.slug === slug ? updated : j)),
        editingJob: null,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  expandJob: (slug: string | null) => {
    const clientId = useClientStore.getState().selectedClientId;
    const jobKey = slug ? getCronJobKey(slug, clientId) : null;
    set({ expandedJob: jobKey });
    if (slug) {
      get().fetchRunHistory(slug, clientId);
      get().fetchSystemStatus();
      // Also refresh this job's metadata (last run, stats) from the server
      fetch(withClientQuery(`/api/cron/${slug}`))
        .then((res) => res.ok ? res.json() : null)
        .then((updated) => {
          if (updated) {
            set((state) => ({
              jobs: state.jobs.map((j) => (j.slug === slug ? updated : j)),
            }));
          }
        })
        .catch(() => {});
    }
  },

  fetchRunHistory: async (slug: string, clientId: string | null = useClientStore.getState().selectedClientId) => {
    try {
      const res = await fetch(
        clientId
          ? `/api/cron/${slug}/history?clientId=${encodeURIComponent(clientId)}`
          : `/api/cron/${slug}/history`
      );
      if (!res.ok) return;
      const history = await res.json();
      set((state) => ({
        runHistory: { ...state.runHistory, [getCronJobKey(slug, clientId)]: history },
      }));
    } catch {
      // Silently fail -- run history is non-critical
    }
  },

  setShowCreatePanel: (show: boolean) => {
    set(show ? { showCreatePanel: true } : { showCreatePanel: false, createJobDraft: null });
  },

  setEditingJob: (job: CronJob | null) => {
    set({ editingJob: job, createJobDraft: null });
  },

  setCreateJobDraft: (draft: CronJobCreateInput | null) => {
    set({
      createJobDraft: draft,
      showCreatePanel: draft !== null,
      editingJob: null,
    });
  },

  moveJob: (fromIndex: number, toIndex: number) => {
    const jobs = [...get().jobs];
    const pinned = new Set(get().pinnedSlugs);
    if (fromIndex < 0 || fromIndex >= jobs.length || toIndex < 0 || toIndex >= jobs.length) return;
    // Don't allow dragging into or out of the pinned zone
    const fromPinned = pinned.has(jobs[fromIndex].slug);
    const toPinned = toIndex < jobs.filter((j) => pinned.has(j.slug)).length;
    if (fromPinned !== toPinned) return;
    const [moved] = jobs.splice(fromIndex, 1);
    jobs.splice(toIndex, 0, moved);
    saveCronOrder(useClientStore.getState().selectedClientId, jobs.map((j) => j.slug));
    set({ jobs });
  },

  togglePin: (slug: string) => {
    const clientId = useClientStore.getState().selectedClientId;
    const current = get().pinnedSlugs;
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug];
    savePinnedSlugs(clientId, next);
    set({ pinnedSlugs: next });
    // Re-sort jobs with updated pins
    const jobs = applySavedOrder(get().jobs, clientId);
    set({ jobs });
  },
}));
