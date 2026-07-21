import { getConfig } from "./config";
import { getCronSystemStatus } from "./cron-system-status";
import type {
  CronJob,
  CronRun,
  CronJobCreateInput,
  CronJobUpdateInput,
  CronSystemStatus,
} from "@/types/cron";

let cachedCronRuntime: any = null;

function getCronRuntime() {
  if (!cachedCronRuntime) {
    cachedCronRuntime = require("./cron-runtime.js");
  }

  return cachedCronRuntime;
}

function getAiOsDir(): string {
  return getConfig().agenticOsDir;
}

export function isSupportedCronDays(days: string): boolean {
  return getCronRuntime().isSupportedCronDays(days);
}

export function isSupportedCronTime(time: string): boolean {
  return getCronRuntime().isSupportedCronTime(time);
}

export function isSupportedCronSchedule(time: string, days: string): boolean {
  return getCronRuntime().isSupportedCronSchedule(time, days);
}

export function getCronScheduleValidationError(
  time: string,
  days: string
): string | null {
  return getCronRuntime().getCronScheduleValidationError(time, days);
}

export function listCronJobs(clientId?: string | null): CronJob[] {
  return getCronRuntime().listCronJobs(getAiOsDir(), clientId ?? null);
}

export function listAllCronJobs(): CronJob[] {
  return getCronRuntime().listAllCronJobs(getAiOsDir());
}

export function getCronJob(slug: string, clientId?: string | null): CronJob | null {
  return getCronRuntime().getCronJob(getAiOsDir(), slug, clientId ?? null);
}

export function createCronJob(
  input: CronJobCreateInput,
  clientId?: string | null
): CronJob {
  return getCronRuntime().createCronJob(getAiOsDir(), clientId ?? null, input);
}

export function updateCronJob(
  slug: string,
  input: CronJobUpdateInput,
  clientId?: string | null
): CronJob {
  return getCronRuntime().updateCronJob(getAiOsDir(), clientId ?? null, slug, input);
}

export function deleteCronJob(slug: string, clientId?: string | null): void {
  getCronRuntime().deleteCronJob(getAiOsDir(), clientId ?? null, slug);
}

export function getCronRunHistory(
  slug: string,
  clientId?: string | null
): CronRun[] {
  return getCronRuntime().getCronRunHistory(getAiOsDir(), slug, clientId ?? null);
}

export function getRawJobFile(
  slug: string,
  clientId?: string | null
): string | null {
  return getCronRuntime().getRawJobFile(getAiOsDir(), slug, clientId ?? null);
}

export function getCronJobLog(
  slug: string,
  clientId?: string | null
): string {
  return getCronRuntime().getCronJobLog(getAiOsDir(), slug, clientId ?? null);
}

export function enqueueCronJob(
  job: CronJob,
  options?: Record<string, unknown>
): { duplicate: boolean; task: any; cronRunId: number | null; scheduledFor?: string } {
  return getCronRuntime().enqueueCronJob(getAiOsDir(), job, options || {});
}

export function completeCronRunForTask(
  task: any,
  payload?: Record<string, unknown>
): void {
  getCronRuntime().completeCronRunForTask(getAiOsDir(), task, payload || {});
}

export function getManagedCronRuntimeStatus(
  localIdentifier?: string | null
): CronSystemStatus {
  return getCronSystemStatus(localIdentifier);
}

export function claimCronLeadership(candidate: Record<string, unknown>) {
  return getCronRuntime().claimRuntimeLeadership(getAiOsDir(), candidate);
}

export function refreshCronHeartbeat(identifier: string, updates?: Record<string, unknown>) {
  return getCronRuntime().refreshRuntimeHeartbeat(getAiOsDir(), identifier, updates || {});
}

export function releaseCronLeadership(identifier: string) {
  return getCronRuntime().releaseRuntimeLeadership(getAiOsDir(), identifier);
}

export function hasActiveCronJobs(): boolean {
  return getCronRuntime().hasActiveCronJobs(getAiOsDir());
}

export function getCronWorkspaceCount(): number {
  return getCronRuntime().listWorkspaceDescriptors(getAiOsDir()).length;
}

export function getMissedFixedRuns(time: string, days: string, start: Date, end: Date): Date[] {
  return getCronRuntime().getMissedFixedRuns(time, days, start, end);
}

export function matchesCronTime(now: Date, schedule: string): boolean {
  return getCronRuntime().matchesTime(now, schedule);
}

export function matchesCronDays(now: Date, days: string): boolean {
  return getCronRuntime().matchesDays(now, days);
}

export function toCronMinuteIso(date: Date): string {
  return getCronRuntime().toMinuteIso(date);
}
