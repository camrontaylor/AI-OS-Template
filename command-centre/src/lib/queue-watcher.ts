import { onTaskEvent, emitTaskEvent, type TaskEvent } from "./event-bus";
import { processManager } from "./process-manager";
import { getActiveLocalProfileDescriptor, getDb } from "./db";
import { getConfig } from "./config";
import { getCronSystemStatus } from "./cron-system-status";
import { getInProcessCronRuntimeIdentifier } from "./cron-scheduler";
import { isProcessAlive, killProcessTreeByPid } from "./subprocess";
import type { CronRunCompletionReason } from "@/types/cron";
import type { Task } from "@/types/task";
import { LocalProfileLockedError, type LocalProfileDescriptorV1 } from "./local-profile";
import {
  assertLocalProfileActive,
  getLocalProfileRuntimeSession,
  LocalProfileRequestError,
} from "./local-profile-lifecycle";

const cronRuntime = require("./cron-runtime.js");

let initialized = false;
const startingCronTaskIds = new Set<string>();
let recoveredProfileActivation: string | null = null;
let recoveringProfileActivation: string | null = null;

function getQueueProfile() {
  if (typeof getActiveLocalProfileDescriptor === "function") return getActiveLocalProfileDescriptor();
  const config = getConfig();
  return { version: 1 as const, mode: "solo" as const, profileKey: "solo" as const, dataDir: config.dataDir, stateDir: config.dataDir, tempDir: config.dataDir, dbPath: config.dbPath };
}

interface QueueProfileActivation {
  profile: LocalProfileDescriptorV1;
  key: string;
}

function isExpectedProfilePause(error: unknown): boolean {
  return error instanceof LocalProfileLockedError || error instanceof LocalProfileRequestError;
}

function pauseQueueWatcher(): void {
  recoveredProfileActivation = null;
  recoveringProfileActivation = null;
}

function getQueueProfileActivation(): QueueProfileActivation {
  const profile = getQueueProfile();
  assertLocalProfileActive(profile);
  const runtime = getLocalProfileRuntimeSession(profile);
  return { profile, key: `${profile.profileKey}:${runtime.sessionId}` };
}

function getRecoveredCronRunCompletionReason(
  row: {
    taskId: string | null;
    taskStatus: string | null;
  },
  fallback: CronRunCompletionReason = "recovered_inferred_state"
): CronRunCompletionReason {
  if (!row.taskId) {
    return "recovered_missing_task";
  }

  if (!row.taskStatus) {
    return "recovered_missing_task";
  }

  if (row.taskStatus === "running" || row.taskStatus === "queued") {
    return "recovered_orphaned_task";
  }

  if (row.taskStatus === "review" || row.taskStatus === "done") {
    return "recovered_from_terminal_task_state";
  }

  return fallback;
}

function shouldSkipQueuedCronTaskBecauseDaemonIsLeader(taskId: string): boolean {
  const runtimeStatus = getCronSystemStatus(getInProcessCronRuntimeIdentifier());
  if (runtimeStatus.runtime === "daemon") {
    console.log(
      `[queue-watcher] Skipping queued cron task ${taskId} because daemon runtime is leader`
    );
    return true;
  }

  return false;
}

function isValidPid(pid: unknown): pid is number {
  return Number.isInteger(pid) && (pid as number) > 0;
}

// Only a PID this Command Centre spawned may be stopped. Cron runs, sessions
// registered through sync-session and legacy rows carry no ownership record,
// so their live processes belong to someone else and are left alone.
function isProvablyOwnedPid(task: Pick<Task, "claudePid" | "ownedClaudePid">): boolean {
  return isValidPid(task.claudePid) && task.ownedClaudePid === task.claudePid;
}

function isLiveForeignProcess(task: Pick<Task, "claudePid" | "ownedClaudePid">): boolean {
  return isValidPid(task.claudePid) && isProcessAlive(task.claudePid) && !isProvablyOwnedPid(task);
}

const CRON_RUN_BUDGET_MARGIN_MS = 10 * 60_000;
const UNKNOWN_CRON_JOB_BUDGET_MS = 24 * 60 * 60_000;

// How long an open cron run may go without a live Claude before the reaper
// stops waiting for the cron runtime: every attempt's timeout plus a margin,
// or a day when the job definition can no longer be read.
function getCronRunBudgetMs(task: Task): number {
  try {
    const readJob = () =>
      cronRuntime.getCronJob(getConfig().aiOsDir, task.cronJobSlug, task.clientId ?? null);
    const job = typeof cronRuntime.runWithDbPath === "function"
      ? cronRuntime.runWithDbPath(getQueueProfile().dbPath, readJob)
      : readJob();
    if (job) {
      const attempts = Math.max(1, Number(job.retry || 0) + 1);
      return cronRuntime.parseTimeoutToMs(job.timeout) * attempts + CRON_RUN_BUDGET_MARGIN_MS;
    }
  } catch {
    // Unreadable or ambiguous definition: fall back to the one-day budget.
  }
  return UNKNOWN_CRON_JOB_BUDGET_MS;
}

// The cron runtime closes its own run and finalizes the task. While the run is
// open and within budget, a missing or dead PID only means the hook has not
// reported the Claude yet or a retry is starting.
function isAwaitingCronRuntime(db: ReturnType<typeof getDb>, task: Task, nowMs: number): boolean {
  if (!task.cronJobSlug) return false;
  const run = db
    .prepare("SELECT startedAt FROM cron_runs WHERE taskId = ? AND result = 'running' ORDER BY id DESC LIMIT 1")
    .get(task.id) as { startedAt: string } | undefined;
  if (!run) return false;
  // cron_runs.startedAt is set at enqueue; a job that waited in the queue only
  // starts spending its budget once it is claimed (tasks.startedAt).
  const startedMs = Math.max(Date.parse(run.startedAt), task.startedAt ? Date.parse(task.startedAt) : -Infinity);
  return nowMs - startedMs < getCronRunBudgetMs(task);
}

function closeRunningCronRuns(
  db: ReturnType<typeof getDb>,
  task: Task,
  reason: CronRunCompletionReason,
  now: string
): void {
  const recovery = cronRuntime.buildRecoveredCronRunUpdate(reason, {
    completedAt: now,
    durationMs: task.durationMs || 0,
    costUsd: task.costUsd ?? null,
  });
  db.prepare(
    `UPDATE cron_runs
     SET completedAt = ?, result = ?, resultSource = ?, completionReason = ?,
         durationSec = ?, costUsd = ?, exitCode = ?
     WHERE taskId = ? AND result = 'running'`
  ).run(
    recovery.completedAt,
    recovery.result,
    recovery.resultSource,
    recovery.completionReason,
    recovery.durationSec,
    recovery.costUsd,
    recovery.exitCode,
    task.id
  );
}

// Cron tasks are runtime-owned so UI-led and daemon-led execution share the same
// cronRuntime path. Interactive tasks remain process-manager-owned.
function dispatchQueuedCronTask(taskId: string, source: string): void {
  const config = getConfig();
  const profile = getQueueProfile();
  assertLocalProfileActive(profile);
  const scopedTaskId = `${profile.profileKey}:${taskId}`;
  if (startingCronTaskIds.has(scopedTaskId)) {
    console.log(
      `[queue-watcher] Skipping queued cron task ${taskId} from ${source} because runtime dispatch already started`
    );
    return;
  }

  startingCronTaskIds.add(scopedTaskId);
  const aiOsDir = config.aiOsDir;
  console.log(
    `[queue-watcher] Cron task ${taskId} entered queued status (via ${source}), triggering runtime execution`
  );

  const execution = typeof cronRuntime.runWithDbPath === "function"
    ? cronRuntime.runWithDbPath(profile.dbPath, () => cronRuntime.executeCronTask(aiOsDir, taskId))
    : cronRuntime.executeCronTask(aiOsDir, taskId);
  Promise.resolve(execution)
    .catch((err: unknown) => {
      console.error(`[queue-watcher] Failed to execute queued cron task ${taskId}:`, err);
    })
    .finally(() => {
      startingCronTaskIds.delete(scopedTaskId);
    });
}

function performStartupRecovery(
  activation: QueueProfileActivation,
  protectedTaskId?: string,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Tasks left by an earlier server session are never resumed automatically.
  // Parent tasks with children stay as-is because they are containers.
  const orphans = db
    .prepare(
      `SELECT t.* FROM tasks t
       WHERE t.status IN ('running', 'queued')
       AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parentId = t.id)
       ORDER BY t.columnOrder ASC`
    )
    .all() as Task[];
  // Live processes owned by the cron daemon or an external terminal survive a
  // Command Centre restart, so their tasks keep running.
  const foreignLiveTaskIds = new Set(
    orphans.filter(isLiveForeignProcess).map((task) => task.id)
  );
  const recoverableOrphans = orphans.filter(
    (task) => task.id !== protectedTaskId && !foreignLiveTaskIds.has(task.id)
  );

  if (recoverableOrphans.length > 0) {
    console.log(
      `[queue-watcher] Moving ${recoverableOrphans.length} orphaned task(s) from previous session to review (no auto-resume)`
    );
    for (const task of recoverableOrphans) {
      db.prepare(
        `UPDATE tasks
         SET status = 'review',
             updatedAt = ?,
             activityLabel = NULL,
             needsInput = 0,
             errorMessage = CASE WHEN errorMessage IS NULL THEN 'Session ended before this task finished — re-kick from the board to continue.' ELSE errorMessage END
         WHERE id = ?`
      ).run(now, task.id);
      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as Task;
      emitTaskEvent({ type: "task:status", task: updated, timestamp: now });
    }
  }

  // Reconcile cron runs whose task already reached a terminal state or was reset.
  const stuckCronRuns = db
    .prepare(
      `SELECT cr.id as cronRunId, cr.taskId, cr.jobSlug, t.status as taskStatus,
              t.completedAt, t.errorMessage, t.costUsd, t.durationMs, t.startedAt as taskStartedAt
       FROM cron_runs cr
       LEFT JOIN tasks t ON cr.taskId = t.id
       WHERE cr.result = 'running'`
    )
    .all() as Array<{
      cronRunId: number; taskId: string | null; jobSlug: string;
      taskStatus: string | null; completedAt: string | null;
      errorMessage: string | null; costUsd: number | null;
      durationMs: number | null; taskStartedAt: string | null;
    }>;

  const reconcilableCronRuns = stuckCronRuns.filter(
    (row) => !row.taskId || !foreignLiveTaskIds.has(row.taskId)
  );
  if (reconcilableCronRuns.length > 0) {
    console.log(`[queue-watcher] Reconciling ${reconcilableCronRuns.length} stuck cron_runs row(s)`);
    for (const row of reconcilableCronRuns) {
      const recoveryReason = getRecoveredCronRunCompletionReason(row);
      const recovery = cronRuntime.buildRecoveredCronRunUpdate(recoveryReason, {
        completedAt: row.completedAt || now,
        durationMs: row.durationMs || 0,
        costUsd: row.costUsd ?? null,
      });

      db.prepare(
        `UPDATE cron_runs
         SET completedAt = ?, result = ?, resultSource = ?, completionReason = ?,
             durationSec = ?, costUsd = ?, exitCode = ?
         WHERE id = ?`
      ).run(
        recovery.completedAt,
        recovery.result,
        recovery.resultSource,
        recovery.completionReason,
        recovery.durationSec,
        recovery.costUsd,
        recovery.exitCode,
        row.cronRunId
      );
    }
  }

}

function runStartupRecovery(
  activation: QueueProfileActivation,
  protectedTaskId?: string,
): void {
  if (recoveredProfileActivation === activation.key) return;
  if (recoveringProfileActivation === activation.key) return;

  recoveringProfileActivation = activation.key;
  try {
    performStartupRecovery(activation, protectedTaskId);
    recoveredProfileActivation = activation.key;
  } finally {
    if (recoveringProfileActivation === activation.key) {
      recoveringProfileActivation = null;
    }
  }
}

/**
 * Initialize the queue watcher.
 * Listens for task events and auto-executes tasks that enter 'queued' status.
 *
 * Startup recovery policy: orphaned running/queued tasks from a previous
 * session are moved to 'review' rather than auto-resumed. This prevents the
 * command centre from silently spawning many concurrent Claude CLI processes
 * when the server restarts mid-work (e.g. laptop sleep, crash, manual kill),
 * which can saturate CPU. The user re-kicks tasks deliberately from the board.
 *
 * Idempotent -- safe to call multiple times.
 */
export function initQueueWatcher(): void {
  if (initialized) return;
  initialized = true;

  console.log("[queue-watcher] Initializing queue watcher");

  // Listen for task events — execute when a task enters 'queued' status
  onTaskEvent((event: TaskEvent) => {
    try {
      const activation = getQueueProfileActivation();
      runStartupRecovery(activation, event.task.id);
      if (recoveredProfileActivation !== activation.key) return;
      if (event.profileKey && event.profileKey !== activation.profile.profileKey) return;
      // Trigger on status changes, updates, or newly created tasks that are already queued
      if (event.type !== "task:status" && event.type !== "task:updated" && event.type !== "task:created") return;
      if (event.task.status !== "queued") return;

      if (event.task.cronJobSlug) {
        if (shouldSkipQueuedCronTaskBecauseDaemonIsLeader(event.task.id)) {
          return;
        }

        dispatchQueuedCronTask(event.task.id, event.type);
        return;
      }

      if (processManager.hasActiveSession(event.task.id)) {
        console.log(
          `[queue-watcher] Skipping queued task ${event.task.id} from ${event.type} because it is already active`
        );
        return;
      }

      console.log(
        `[queue-watcher] Task ${event.task.id} entered queued status (via ${event.type}), triggering execution`
      );
      processManager.executeTask(event.task.id).catch((err) => {
        console.error(`[queue-watcher] Failed to execute task ${event.task.id}:`, err);
      });
    } catch (error) {
      if (!isExpectedProfilePause(error)) throw error;
      pauseQueueWatcher();
    }
  });

  try {
    runStartupRecovery(getQueueProfileActivation());
  } catch (error) {
    if (isExpectedProfilePause(error)) {
      pauseQueueWatcher();
    } else {
      console.error("[queue-watcher] Error during recovery scan:", error);
    }
  }

  // Reaper: periodically check for stuck tasks
  const REAP_INTERVAL_MS = 10_000;
  setInterval(() => {
    try {
      const activation = getQueueProfileActivation();
      runStartupRecovery(activation);
      const db = getDb();
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();

      const runtimeStatus = getCronSystemStatus(getInProcessCronRuntimeIdentifier());
      if (runtimeStatus.runtime !== "daemon") {
        const queuedCronTasks = db
          .prepare(
            `SELECT * FROM tasks
             WHERE status = 'queued'
               AND cronJobSlug IS NOT NULL
             ORDER BY createdAt ASC`
          )
          .all() as Task[];

        for (const task of queuedCronTasks) {
          dispatchQueuedCronTask(task.id, "reaper");
        }
      }

      // 1. PID-based reaping: tasks stuck in 'running' with a dead PID
      // Only reap 'running' tasks — 'review' tasks already completed normally
      // via handleTurnComplete; their stale claudePid just needs clearing.
      const pidCandidates = db
        .prepare(
          `SELECT * FROM tasks
           WHERE status = 'running'
             AND claudePid IS NOT NULL`
        )
        .all() as Task[];

      for (const task of pidCandidates) {
        if (processManager.hasActiveSession(task.id)) continue;

        // Never signal an invalid PID: on POSIX, -1 targets every process the
        // user can reach. An invalid PID with no active session is an ended one.
        const alive = isValidPid(task.claudePid) && isProcessAlive(task.claudePid);
        if (alive && !isProvablyOwnedPid(task)) continue;
        if (!alive && isAwaitingCronRuntime(db, task, nowMs)) continue;

        const unmanagedLiveProcess = alive;
        if (unmanagedLiveProcess) {
          console.warn(
            `[queue-watcher] Reaper: Claude PID ${task.claudePid} for task ${task.id} is alive but unmanaged — stopping orphan and moving to review`
          );
          try {
            killProcessTreeByPid(task.claudePid!, "SIGTERM");
          } catch (error) {
            // e.g. EPERM: the PID now belongs to a process we may not signal.
            // Finalize the task anyway and keep reaping the others.
            console.warn(
              `[queue-watcher] Reaper: could not stop Claude PID ${task.claudePid} for task ${task.id}:`,
              error
            );
          }
        }

        // Cron tasks go to "done" (no one to review). Interactive tasks go to
        // "review" so the user can check the work before marking it done.
        // A live-but-unmanaged process always goes to review because in-process
        // subagent handles cannot be recovered safely.
        const isCronTask = !!task.cronJobSlug;
        const reaperStatus = unmanagedLiveProcess ? "review" : (isCronTask ? "done" : "review");
        const needsInput = reaperStatus === "review" ? 1 : 0;
        const label = unmanagedLiveProcess
          ? "Live Claude session was lost — review output"
          : "Session ended — review output";
        const errorMessage = unmanagedLiveProcess
          ? "Command Centre found a Claude process that was still alive but no longer managed in memory. It was stopped because live subagent handles cannot be recovered safely."
          : null;
        console.log(
          `[queue-watcher] Reaper: Claude PID ${task.claudePid} for task ${task.id} is ${unmanagedLiveProcess ? "unmanaged" : "dead"} — marking ${reaperStatus}`
        );
        db.prepare(
          `UPDATE tasks SET status = ?, completedAt = COALESCE(completedAt, ?), updatedAt = ?,
           activityLabel = ?, errorMessage = ?, needsInput = ?, claudePid = NULL,
           durationMs = CASE WHEN startedAt IS NOT NULL
             THEN CAST((julianday(?) - julianday(startedAt)) * 86400000 AS INTEGER)
             ELSE durationMs END
           WHERE id = ?`
        ).run(reaperStatus, now, now, label, errorMessage, needsInput, now, task.id);
        const updated = db
          .prepare("SELECT * FROM tasks WHERE id = ?")
          .get(task.id) as Task;
        emitTaskEvent({
          type: "task:status",
          task: { ...updated, needsInput: Boolean(updated.needsInput) },
          timestamp: now,
        });
        // A run still open here is past its budget, so its runtime is gone.
        if (updated.cronJobSlug) {
          closeRunningCronRuns(db, updated, "recovered_orphaned_task", now);
        }
      }

      // Clear stale claudePid on review/done tasks (process already exited normally)
      db.prepare(
        `UPDATE tasks SET claudePid = NULL
         WHERE status IN ('review', 'done') AND claudePid IS NOT NULL`
      ).run();

      // 2. Null-PID reaping: tasks in "running" with claudePid=NULL, needsInput=0,
      //    and no active in-memory session. These lost their process reference
      //    (e.g. server restarted but recovery didn't catch them because they're
      //    parent/container tasks, or PID was never written).
      const nullPidRunning = db
        .prepare(
          `SELECT * FROM tasks
           WHERE status = 'running'
             AND claudePid IS NULL
             AND needsInput = 0`
        )
        .all() as Task[];

      for (const task of nullPidRunning) {
        if (processManager.hasActiveSession(task.id)) continue;
        if (isAwaitingCronRuntime(db, task, nowMs)) continue;

        // Check if this is a parent task with active children — if so, it's
        // legitimately "running" as a container. Only reap if all children are terminal.
        const activeChildren = db
          .prepare(
            `SELECT COUNT(*) as count FROM tasks
             WHERE parentId = ? AND status IN ('running', 'queued')`
          )
          .get(task.id) as { count: number };

        if (activeChildren.count > 0) continue; // Container still has active work

        // Check if it has any children at all — if so, it's a completed container
        const totalChildren = db
          .prepare("SELECT COUNT(*) as count FROM tasks WHERE parentId = ?")
          .get(task.id) as { count: number };

        const isCronTask = !!task.cronJobSlug;
        const reaperStatus = isCronTask ? "done" : "review";
        const label = totalChildren.count > 0
          ? "All subtasks finished — review output"
          : "Session ended — review output";

        console.log(
          `[queue-watcher] Reaper: Task ${task.id.slice(0, 8)} "${task.title}" stuck in running with null PID and no active session — marking ${reaperStatus}`
        );
        db.prepare(
          `UPDATE tasks SET status = ?, completedAt = COALESCE(completedAt, ?), updatedAt = ?,
           activityLabel = ?, claudePid = NULL,
           durationMs = CASE WHEN startedAt IS NOT NULL
             THEN CAST((julianday(?) - julianday(startedAt)) * 86400000 AS INTEGER)
             ELSE durationMs END
           WHERE id = ?`
        ).run(reaperStatus, now, now, label, now, task.id);
        const updated = db
          .prepare("SELECT * FROM tasks WHERE id = ?")
          .get(task.id) as Task;
        emitTaskEvent({
          type: "task:status",
          task: { ...updated, needsInput: Boolean(updated.needsInput) },
          timestamp: now,
        });
        // A run still open here is past its budget, so its runtime is gone.
        if (updated.cronJobSlug) {
          closeRunningCronRuns(db, updated, "recovered_orphaned_task", now);
        }
      }

      // 3. Stuck needsInput reaping: tasks in "running" + needsInput=1 with no active
      //    process-manager session. These are tasks where the Claude process exited but
      //    the task was left in "running" due to question detection. If no process is
      //    managing them, move to "review" so they're actionable.
      const stuckInputTasks = db
        .prepare(
          `SELECT * FROM tasks
           WHERE status = 'running'
             AND needsInput = 1`
        )
        .all() as Task[];

      for (const task of stuckInputTasks) {
        if (processManager.hasActiveSession(task.id)) continue;

        // Task is in "running" + needsInput but no process is managing it — it's stuck
        console.log(
          `[queue-watcher] Reaper: Task ${task.id.slice(0, 8)} "${task.title}" stuck in running+needsInput with no active session — moving to review`
        );
        db.prepare(
          `UPDATE tasks SET status = 'review', updatedAt = ?, completedAt = COALESCE(completedAt, ?), needsInput = 0 WHERE id = ?`
        ).run(now, now, task.id);

        const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as Task;
        emitTaskEvent({
          type: "task:status",
          task: { ...updated, needsInput: Boolean(updated.needsInput) },
          timestamp: now,
        });

        // Also close any stuck cron_runs for this task
        if (updated.cronJobSlug) {
          closeRunningCronRuns(db, updated, "recovered_from_stuck_needs_input", now);
        }
      }
    } catch (error) {
      if (isExpectedProfilePause(error)) {
        pauseQueueWatcher();
      } else {
        console.error("[queue-watcher] Reaper error:", error);
      }
    }
  }, REAP_INTERVAL_MS);

  console.log("[queue-watcher] Queue watcher ready (reaper interval: 10s)");
}
