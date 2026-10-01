export type CronResult = "success" | "failure" | "timeout";
export type CronRunResult = CronResult | "running";
export type CronRunResultSource = "observed" | "inferred";
export type CronRunCompletionReason =
  | "completed"
  | "failed"
  | "needs_input"
  | "timed_out"
  | "recovered_inferred_state"
  | "recovered_missing_task"
  | "recovered_orphaned_task"
  | "recovered_from_terminal_task_state"
  | "recovered_from_stuck_needs_input";
export type CronLeaderState = "active" | "stale" | "absent";
export type CronOwnershipReason =
  | "local-leader-active"
  | "external-leader-active"
  | "stale-leader-record"
  | "daemon-process-without-lock"
  | "local-runtime-without-leader"
  | "no-runtime-detected";

export interface CronJob {
  name: string;
  slug: string;
  description: string;
  time: string;
  days: string;
  active: boolean;
  model: string;
  notify: string;
  timeout: string;
  retry: number;
  memoryCapture: boolean;
  nextRun: string | null;
  lastRun: CronRunStatus | null;
  stats: CronStats;
  prompt: string;
  clientId: string | null;
  workspaceKey: string;
  workspaceLabel: string;
  workspaceDir: string;
}

export interface CronRunStatus {
  lastRun: string;
  result: CronResult;
  duration: number;
  exitCode: number;
  runCount: number;
  failCount: number;
}

export interface CronStats {
  totalRuns: number;
  avgDurationSec: number;
  avgCostUsd: number;
}

export interface CronRunOutput {
  fileName: string;
  filePath: string;
  extension: string;
}

export interface CronRun {
  id: number;
  jobSlug: string;
  taskId: string | null;
  startedAt: string;
  completedAt: string | null;
  result: CronRunResult;
  durationSec: number | null;
  costUsd: number | null;
  exitCode: number | null;
  trigger: "manual" | "scheduled";
  resultSource: CronRunResultSource | null;
  completionReason: CronRunCompletionReason | null;
  outputs: CronRunOutput[];
}

export interface CronJobCreateInput {
  name: string;
  description: string;
  time: string;
  days: string;
  model?: string;
  notify?: string;
  timeout?: string;
  retry?: number;
  memoryCapture?: boolean;
  prompt: string;
}

export interface CronJobUpdateInput {
  name?: string;
  description?: string;
  time?: string;
  days?: string;
  active?: boolean;
  model?: string;
  notify?: string;
  timeout?: string;
  retry?: number;
  memoryCapture?: boolean;
  prompt?: string;
}

export interface CronSystemStatus {
  runtime: "in-process" | "daemon" | "stopped";
  leader: boolean;
  leaderState: CronLeaderState;
  identifier: string | null;
  localRuntimePresent: boolean;
  ownershipReason: CronOwnershipReason;
  statusSummary: string;
  startCommand: string;
  stopCommand: string;
  statusCommand: string;
  logsCommand: string;
  workspaceCount: number;
  heartbeatAt: string | null;
  pid: number | null;
}
