import { getConfig } from "./config";
import type { CronSystemStatus } from "@/types/cron";

const cronRuntime = require("./cron-runtime.js");

function getAiOsDir(): string {
  return getConfig().aiOsDir;
}

export function getCronSystemStatus(
  localIdentifier?: string | null
): CronSystemStatus {
  const status = cronRuntime.getManagedRuntimeStatus(
    getAiOsDir(),
    localIdentifier || undefined
  ) as CronSystemStatus;

  return {
    ...status,
    statusSummary: status.statusSummary || "No cron runtime is active.",
  };
}

export function isLocalCronSchedulingLeader(
  localIdentifier?: string | null
): boolean {
  const status = getCronSystemStatus(localIdentifier);
  return status.leader && status.leaderState === "active";
}

export function getCronSystemStatusSummary(
  localIdentifier?: string | null
): string {
  return getCronSystemStatus(localIdentifier).statusSummary;
}
