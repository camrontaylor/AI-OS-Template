import path from "node:path";
import fs from "node:fs";

import { getClientAiOsDir, getConfig } from "./config";
import { getCronSystemStatus } from "./cron-system-status";
import { getActiveLocalProfileDescriptor } from "./db";
import {
  assertMaterializedPathAccessible,
  assertMaterializedPathWritable,
  isMaterializedPathAccessible,
  registerMaterializedFiles,
  removeMaterializedOwnership,
} from "./materialized-file-ownership";
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
  return getConfig().aiOsDir;
}

function withProfileDatabase<T>(operation: () => T): T {
  const runtime = getCronRuntime();
  const profile = getActiveLocalProfileDescriptor();
  return typeof runtime.runWithDbPath === "function"
    ? runtime.runWithDbPath(profile.dbPath, operation)
    : operation();
}

function cronJobPath(slug: string, clientId?: string | null): string {
  return path.join(getClientAiOsDir(clientId ?? null), "cron", "jobs", `${slug}.md`);
}

function cronSlug(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function accessibleCronJobsForClient(clientId?: string | null): CronJob[] {
  const jobsDir = path.join(getClientAiOsDir(clientId ?? null), "cron", "jobs");
  let fileNames: string[];
  try {
    fileNames = fs.readdirSync(jobsDir).filter((fileName) => fileName.endsWith(".md"));
  } catch {
    return [];
  }
  return fileNames
    .filter((fileName) => isMaterializedPathAccessible(path.join(jobsDir, fileName)))
    .map((fileName) => withProfileDatabase(() => getCronRuntime().getCronJob(
      getAiOsDir(),
      fileName.slice(0, -3),
      clientId ?? null,
    )))
    .filter((job): job is CronJob => Boolean(job));
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
  return accessibleCronJobsForClient(clientId);
}

export function listAllCronJobs(): CronJob[] {
  return getCronRuntime().listWorkspaceDescriptors(getAiOsDir())
    .flatMap((workspace: { clientId?: string | null }) => accessibleCronJobsForClient(workspace.clientId ?? null));
}

export function getCronJob(slug: string, clientId?: string | null): CronJob | null {
  if (clientId === undefined) {
    const matches = listAllCronJobs().filter((job) => job.slug === slug);
    if (matches.length > 1) throw new Error(`Cron job slug "${slug}" exists in multiple workspaces. Pass a clientId to disambiguate.`);
    return matches[0] ?? null;
  }
  const filePath = cronJobPath(slug, clientId);
  if (!isMaterializedPathAccessible(filePath)) return null;
  return withProfileDatabase(() => getCronRuntime().getCronJob(getAiOsDir(), slug, clientId ?? null));
}

export function createCronJob(
  input: CronJobCreateInput,
  clientId?: string | null
): CronJob {
  const filePath = cronJobPath(cronSlug(input.name), clientId);
  assertMaterializedPathWritable(filePath);
  const job = withProfileDatabase(() => getCronRuntime().createCronJob(getAiOsDir(), clientId ?? null, input));
  registerMaterializedFiles([filePath], {
    scope: clientId ? "client" : "team",
    kind: "cron-job",
  });
  return job;
}

export function updateCronJob(
  slug: string,
  input: CronJobUpdateInput,
  clientId?: string | null
): CronJob {
  const filePath = cronJobPath(slug, clientId);
  assertMaterializedPathAccessible(filePath);
  const job = withProfileDatabase(() => getCronRuntime().updateCronJob(getAiOsDir(), clientId ?? null, slug, input));
  registerMaterializedFiles([filePath], {
    scope: clientId ? "client" : "team",
    kind: "cron-job",
  });
  return job;
}

export function deleteCronJob(slug: string, clientId?: string | null): void {
  const filePath = cronJobPath(slug, clientId);
  assertMaterializedPathAccessible(filePath);
  withProfileDatabase(() => getCronRuntime().deleteCronJob(getAiOsDir(), clientId ?? null, slug));
  removeMaterializedOwnership([filePath]);
}

export function getCronRunHistory(
  slug: string,
  clientId?: string | null
): CronRun[] {
  const job = getCronJob(slug, clientId);
  if (!job) return [];
  return withProfileDatabase(() => getCronRuntime().getCronRunHistory(getAiOsDir(), slug, job.clientId));
}

export function getRawJobFile(
  slug: string,
  clientId?: string | null
): string | null {
  const job = getCronJob(slug, clientId);
  if (!job) return null;
  return getCronRuntime().getRawJobFile(getAiOsDir(), slug, job.clientId);
}

export function getCronJobLog(
  slug: string,
  clientId?: string | null
): string {
  const job = getCronJob(slug, clientId);
  if (!job) return "";
  return getCronRuntime().getCronJobLog(getAiOsDir(), slug, job.clientId);
}

export function enqueueCronJob(
  job: CronJob,
  options?: Record<string, unknown>
): { duplicate: boolean; task: any; cronRunId: number | null; scheduledFor?: string } {
  assertMaterializedPathAccessible(cronJobPath(job.slug, job.clientId));
  return withProfileDatabase(() => getCronRuntime().enqueueCronJob(getAiOsDir(), job, options || {}));
}

export function completeCronRunForTask(
  task: any,
  payload?: Record<string, unknown>
): void {
  withProfileDatabase(() => getCronRuntime().completeCronRunForTask(getAiOsDir(), task, payload || {}));
}

export function getManagedCronRuntimeStatus(
  localIdentifier?: string | null
): CronSystemStatus {
  return getCronSystemStatus(localIdentifier);
}

export function claimCronLeadership(candidate: Record<string, unknown>) {
  const profile = getActiveLocalProfileDescriptor();
  return getCronRuntime().claimRuntimeLeadership(getAiOsDir(), { ...candidate, profileKey: profile.profileKey });
}

export function refreshCronHeartbeat(identifier: string, updates?: Record<string, unknown>) {
  return getCronRuntime().refreshRuntimeHeartbeat(getAiOsDir(), identifier, updates || {});
}

export function releaseCronLeadership(identifier: string) {
  return getCronRuntime().releaseRuntimeLeadership(getAiOsDir(), identifier);
}

export function hasActiveCronJobs(): boolean {
  return listAllCronJobs().some((job) => job.active);
}

export function getCronWorkspaceCount(): number {
  return new Set(listAllCronJobs().map((job) => job.workspaceKey)).size;
}

export function getMissedFixedRuns(time: string, days: string, start: Date, end: Date): Date[] {
  return getCronRuntime().getMissedFixedRuns(time, days, start, end);
}

export function matchesCronTime(now: Date, schedule: string): boolean {
  return getCronRuntime().matchesTime(now, schedule);
}

export function shouldDispatchNow(now: Date, job: CronJob): boolean {
  return getCronRuntime().shouldDispatchNow(now, job);
}

export function toCronMinuteIso(date: Date): string {
  return getCronRuntime().toMinuteIso(date);
}
