import type { CronLeaderState } from "@/types/cron";

export type CronRowStatusKind = "active" | "paused" | "not-running";

export interface CronRowStatus {
  kind: CronRowStatusKind;
  label: string;
  /** True when the row should warn instead of showing a healthy state. */
  warning: boolean;
}

export interface CronRowStatusInput {
  active: boolean;
  /** Null while the runtime status is unknown (not fetched yet or failed). */
  leaderState: CronLeaderState | null;
}

/**
 * The row chip used to show only the job's enabled flag, so a job whose runtime
 * had died still read "Active". Only a "stale" leader record means a runtime
 * died without releasing scheduling. "absent" is the normal state after a clean
 * release (e.g. every job was paused), and the Command Centre's own scheduler
 * picks jobs up again on its next tick, so it is not flagged. An unknown
 * runtime status is treated as healthy so the table does not flash warnings
 * before it loads.
 */
export function getCronRowStatus(input: CronRowStatusInput): CronRowStatus {
  if (!input.active) {
    return { kind: "paused", label: "Paused", warning: false };
  }
  if (input.leaderState === "stale") {
    return { kind: "not-running", label: "Not running", warning: true };
  }
  return { kind: "active", label: "Active", warning: false };
}
