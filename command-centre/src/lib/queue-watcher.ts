import { onTaskEvent, emitTaskEvent, type TaskEvent } from "./event-bus";
import { processManager } from "./process-manager";
import { getDb } from "./db";
import { getConfig } from "./config";
import { getCronSystemStatus } from "./cron-system-status";
import { getInProcessCronRuntimeIdentifier } from "./cron-scheduler";
import type { CronRunCompletionReason } from "@/types/cron";
import type { Task } from "@/types/task";

const cronRuntime = require("./cron-runtime.js");

let initialized = false;
const startingCronTaskIds = new Set<string>();

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

// Cron tasks are runtime-owned so UI-led and daemon-led execution share the same
// cronRuntime path. Interactive tasks remain process-manager-owned.
function dispatchQueuedCronTask(taskId: string, source: string): void {
  if (startingCronTaskIds.has(taskId)) {
    console.log(
      `[queue-watcher] Skipping queued cron task ${taskId} from ${source} because runtime dispatch already started`
    );
    return;
  }

  startingCronTaskIds.add(taskId);
  const agenticOsDir = getConfig().agenticOsDir;
  console.log(
    `[queue-watcher] Cron task ${taskId} entered queued status (via ${source}), triggering runtime execution`
  );

  cronRuntime.executeCronTask(agenticOsDir, taskId)
    .catch((err: unknown) => {
      console.error(`[queue-watcher] Failed to execute queued cron task ${taskId}:`, err);
    })
    .finally(() => {
      startingCronTaskIds.delete(taskId);
    });
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

    console.log(`[queue-watcher] Task ${event.task.id} entered queued status (via ${event.type}), triggering execution`);
    processManager.executeTask(event.task.id).catch((err) => {
      console.error(`[queue-watcher] Failed to execute task ${event.task.id}:`, err);
    });
  });

  // Recovery: handle orphaned tasks from previous server session
  try {
    const db = getDb();
    const now = new Date().toISOString();

    // Any task left in 'running' or 'queued' from a previous session is an
    // orphan. Instead of auto-resuming them (which can spawn many concurrent
    // Claude CLI processes and peg the CPU), move them all to 'review' so the
    // user explicitly decides whether to continue them.
    // Parent tasks with children stay as-is — they're containers, not executed.
    const orphans = db
      .prepare(
        `SELECT t.* FROM tasks t
         WHERE t.status IN ('running', 'queued')
         AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parentId = t.id)
         ORDER BY t.columnOrder ASC`
      )
      .all() as Task[];

    if (orphans.length > 0) {
      console.log(
        `[queue-watcher] Moving ${orphans.length} orphaned task(s) from previous session to review (no auto-resume)`
      );
      for (const task of orphans) {
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

    // Reconcile stuck cron_runs: rows with result='running' whose linked tasks
    // are already in a terminal state (review/done) or were reset to backlog.
    // This handles cases where recordCronRun didn't fire (e.g. server restart mid-run).
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

    if (stuckCronRuns.length > 0) {
      console.log(`[queue-watcher] Reconciling ${stuckCronRuns.length} stuck cron_runs row(s)`);
      for (const row of stuckCronRuns) {
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
  } catch (err) {
    console.error("[queue-watcher] Error during recovery scan:", err);
  }

  // Reaper: periodically check for stuck tasks
  const REAP_INTERVAL_MS = 10_000;
  setInterval(() => {
    try {
      const db = getDb();
      const now = new Date().toISOString();

      const runtimeStatus = getCronSystemStatus(getInProcessCronRuntimeIdentifier());
      if (runtimeStatus.runtime !== "daemon") {
        const queuedCronTasks = db
          .prepare(
            `SELECT * FROM tasks
             WHERE status = 'queued'
               AND cronJobSlug IS NOT NULL
             ORDER BY createdAt ASC, rowid ASC`
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

        let alive = false;
        try {
          process.kill(task.claudePid!, 0);
          alive = true;
        } catch {
          alive = false;
        }

        if (!alive) {
          // Cron tasks go to "done" (no one to review). Interactive tasks go to
          // "review" so the user can check the work before marking it done.
          const isCronTask = !!task.cronJobSlug;
          const reaperStatus = isCronTask ? "done" : "review";
          console.log(
            `[queue-watcher] Reaper: Claude PID ${task.claudePid} for task ${task.id} is dead — marking ${reaperStatus}`
          );
          db.prepare(
            `UPDATE tasks SET status = ?, completedAt = COALESCE(completedAt, ?), updatedAt = ?,
             activityLabel = 'Session ended — review output', claudePid = NULL,
             durationMs = CASE WHEN startedAt IS NOT NULL
               THEN CAST((julianday(?) - julianday(startedAt)) * 86400000 AS INTEGER)
               ELSE durationMs END
             WHERE id = ?`
          ).run(reaperStatus, now, now, now, task.id);
          const updated = db
            .prepare("SELECT * FROM tasks WHERE id = ?")
            .get(task.id) as Task;
          emitTaskEvent({
            type: "task:status",
            task: { ...updated, needsInput: Boolean(updated.needsInput) },
            timestamp: now,
          });
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
          const recovery = cronRuntime.buildRecoveredCronRunUpdate(
            "recovered_from_stuck_needs_input",
            {
              completedAt: now,
              durationMs: updated.durationMs || 0,
              costUsd: updated.costUsd ?? null,
            }
          );
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
      }
    } catch (err) {
      console.error("[queue-watcher] Reaper error:", err);
    }
  }, REAP_INTERVAL_MS);

  console.log("[queue-watcher] Queue watcher ready (reaper interval: 10s)");
}
