import { getConfig } from "./config";
import {
  claimCronLeadership,
  enqueueCronJob,
  getCronWorkspaceCount,
  getMissedFixedRuns,
  hasActiveCronJobs,
  listAllCronJobs,
  shouldDispatchNow,
  refreshCronHeartbeat,
  releaseCronLeadership,
  toCronMinuteIso,
} from "./cron-service";
import { emitTaskEvent } from "./event-bus";
import { getActiveLocalProfileDescriptor } from "./db";
import { LocalProfileLockedError } from "./local-profile";
import {
  assertLocalProfileActive,
  LocalProfileRequestError,
} from "./local-profile-lifecycle";

const TICK_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const globalKey = "__managed_cron_scheduler__";
const globalObj = globalThis as Record<string, unknown>;

interface SchedulerState {
  interval: ReturnType<typeof setInterval> | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  identifier: string;
  isLeader: boolean;
  lastSweepAt: string | null;
  profileKey: string | null;
}

function getState(): SchedulerState {
  if (!globalObj[globalKey]) {
    globalObj[globalKey] = {
      interval: null,
      heartbeat: null,
      identifier: `in-process-${process.pid}`,
      isLeader: false,
      lastSweepAt: null,
      profileKey: null,
    } satisfies SchedulerState;
  }

  return globalObj[globalKey] as SchedulerState;
}

function emitQueuedTask(task: Record<string, unknown>) {
  const timestamp =
    typeof task.updatedAt === "string"
      ? task.updatedAt
      : typeof task.createdAt === "string"
        ? task.createdAt
        : new Date().toISOString();

  emitTaskEvent({
    type: "task:created",
    task: task as never,
    timestamp,
  });

  emitTaskEvent({
    type: "task:status",
    task: task as never,
    timestamp,
  });
}

function isExpectedProfilePause(error: unknown): boolean {
  return error instanceof LocalProfileLockedError || error instanceof LocalProfileRequestError;
}

function pauseSchedulerForProfile(state: SchedulerState): void {
  const shouldReleaseLeadership = state.isLeader;
  state.isLeader = false;
  state.lastSweepAt = null;
  state.profileKey = null;

  if (!shouldReleaseLeadership) return;
  try {
    releaseCronLeadership(state.identifier);
  } catch (error) {
    if (!isExpectedProfilePause(error)) {
      console.warn("[cron-scheduler] Could not release leadership while pausing:", error);
    }
  }
}

function tickScheduler(): void {
  const state = getState();
  let profile;
  try {
    profile = getActiveLocalProfileDescriptor();
    assertLocalProfileActive(profile);
  } catch (error) {
    if (!isExpectedProfilePause(error)) throw error;
    pauseSchedulerForProfile(state);
    return;
  }
  if (state.profileKey !== profile.profileKey) {
    if (state.isLeader) releaseCronLeadership(state.identifier);
    state.isLeader = false;
    state.lastSweepAt = null;
    state.profileKey = profile.profileKey;
  }
  const workspaceCount = getCronWorkspaceCount();

  if (!hasActiveCronJobs()) {
    if (state.isLeader) {
      releaseCronLeadership(state.identifier);
      state.isLeader = false;
      state.lastSweepAt = null;
    }
    return;
  }

  const claim = claimCronLeadership({
    runtime: "in-process",
    identifier: state.identifier,
    pid: process.pid,
    workspaceCount,
    lastSweepAt: state.lastSweepAt,
  });

  if (!claim) {
    state.isLeader = false;
    return;
  }

  state.isLeader = true;
  const now = new Date();

  try {
    const activeJobs = listAllCronJobs().filter(
      (job) => job.active && job.prompt
    );

    if (state.lastSweepAt) {
      const lastSweep = new Date(state.lastSweepAt);
      for (const job of activeJobs) {
        for (const missedAt of getMissedFixedRuns(job.time, job.days, lastSweep, now)) {
          const queued = enqueueCronJob(job, {
            trigger: "scheduled",
            dedupeByMinute: true,
            activityLabel: "Queued — catch-up",
            scheduledFor: missedAt.toISOString(),
          });

          if (!queued.duplicate && queued.task) {
            emitQueuedTask(queued.task);
          }
        }
      }
    }

    for (const job of activeJobs) {
      if (!shouldDispatchNow(now, job)) {
        continue;
      }

      const queued = enqueueCronJob(job, {
        trigger: "scheduled",
        dedupeByMinute: true,
        activityLabel: "Queued — scheduled",
        scheduledFor: toCronMinuteIso(now),
      });

      if (!queued.duplicate && queued.task) {
        emitQueuedTask(queued.task);
      }
    }
  } catch (error) {
    console.error("[cron-scheduler] Tick failed:", error);
  }

  state.lastSweepAt = now.toISOString();
  refreshCronHeartbeat(state.identifier, {
    runtime: "in-process",
    workspaceCount,
    lastSweepAt: state.lastSweepAt,
  });
}

export function initCronScheduler(): void {
  const state = getState();
  if (state.interval) {
    return;
  }

  console.log("[cron-scheduler] Starting managed in-process scheduler");
  tickScheduler();
  state.interval = setInterval(tickScheduler, TICK_INTERVAL_MS);
  state.heartbeat = setInterval(() => {
    if (!state.isLeader) {
      return;
    }

    try {
      const profile = getActiveLocalProfileDescriptor();
      assertLocalProfileActive(profile);
      refreshCronHeartbeat(state.identifier, {
        runtime: "in-process",
        lastSweepAt: state.lastSweepAt,
      });
    } catch (error) {
      if (!isExpectedProfilePause(error)) throw error;
      pauseSchedulerForProfile(state);
    }
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = () => {
    const current = getState();
    if (current.interval) {
      clearInterval(current.interval);
      current.interval = null;
    }
    if (current.heartbeat) {
      clearInterval(current.heartbeat);
      current.heartbeat = null;
    }
    if (current.isLeader) {
      releaseCronLeadership(current.identifier);
      current.isLeader = false;
    }
  };

  process.on("exit", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export function isCronSchedulerRunning(): boolean {
  return getState().interval !== null;
}

export function resetCronSchedulerProfile(profileKey: string): void {
  const state = getState();
  if (state.profileKey !== profileKey) return;
  if (state.isLeader) releaseCronLeadership(state.identifier);
  state.isLeader = false;
  state.lastSweepAt = null;
  state.profileKey = null;
}

export function getInProcessCronRuntimeIdentifier(): string | null {
  const state = getState();
  return state.interval ? state.identifier : null;
}
