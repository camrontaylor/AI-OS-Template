import {
  classifyMarketingWorkflow,
  formatScheduleLabel,
  getMarketingWorkflowTemplate,
  marketingWorkflowTemplates,
} from "@/lib/marketing-workflows";
import type { CronJob } from "@/types/cron";

export type ScheduledOperationLaneKey = "running" | "needs_attention" | "upcoming" | "paused";
export type ScheduledOperationBadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface ScheduledOperationActiveRun {
  taskId: string;
  status: string;
  activityLabel: string | null;
}

export interface ScheduledOperationsBuildOptions {
  now?: Date;
}

export interface ScheduledOperation {
  job: CronJob;
  originalIndex: number;
  jobKey: string;
  laneKey: ScheduledOperationLaneKey;
  workflowKey: string;
  workflowTitle: string;
  categoryLabel: string;
  approvalLabel: string;
  scheduleLabel: string;
  nextRunLabel: string;
  lastRunLabel: string;
  statusLabel: string;
  statusBadgeVariant: ScheduledOperationBadgeVariant;
  nextActionLabel: string;
  activityLabel: string | null;
  taskId: string | null;
}

export interface ScheduledOperationLane {
  key: ScheduledOperationLaneKey;
  title: string;
  description: string;
  operations: ScheduledOperation[];
}

export interface ScheduledOperationsSummary {
  total: number;
  active: number;
  paused: number;
  running: number;
  needsAttention: number;
  upcoming: number;
  mappedTemplates: number;
  coveragePercent: number;
  approvalGated: number;
}

export interface ScheduledOperationsBoard {
  operations: ScheduledOperation[];
  lanes: ScheduledOperationLane[];
  summary: ScheduledOperationsSummary;
}

export const scheduledOperationLaneMeta: Record<
  ScheduledOperationLaneKey,
  Pick<ScheduledOperationLane, "key" | "title" | "description">
> = {
  running: {
    key: "running",
    title: "Running now",
    description: "Live agent sessions started from a scheduled workflow.",
  },
  needs_attention: {
    key: "needs_attention",
    title: "Needs attention",
    description: "Failed, timed out, or unscheduled active jobs that need operator review.",
  },
  upcoming: {
    key: "upcoming",
    title: "Upcoming",
    description: "Active jobs with a valid next run time.",
  },
  paused: {
    key: "paused",
    title: "Paused",
    description: "Configured workflows that will not run until resumed.",
  },
};

const laneOrder: ScheduledOperationLaneKey[] = ["running", "needs_attention", "upcoming", "paused"];

function getCronScopeKey(clientId: string | null): string {
  return clientId || "root";
}

export function getScheduledOperationJobKey(job: Pick<CronJob, "slug" | "clientId">): string {
  return `${getCronScopeKey(job.clientId)}:${job.slug}`;
}

function formatCategoryLabel(category: string | null): string {
  if (!category) return "Custom";
  if (category === "cro") return "CRO";
  if (category === "seo") return "SEO";
  if (category === "revops") return "RevOps";
  if (category === "paid-ads") return "Paid Ads";
  return category
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRelativeTime(iso: string | null, now: Date): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";

  const diffMs = date.getTime() - now.getTime();
  const future = diffMs >= 0;
  const absDiffMs = Math.abs(diffMs);
  const diffMin = Math.floor(absDiffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return future ? "in < 1m" : "just now";
  if (diffMin < 60) return future ? `in ${diffMin}m` : `${diffMin}m ago`;
  if (diffHr < 24) return future ? `in ${diffHr}h` : `${diffHr}h ago`;
  if (diffDays < 30) return future ? `in ${diffDays}d` : `${diffDays}d ago`;

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function getLaneKey(job: CronJob, activeRun: ScheduledOperationActiveRun | undefined): ScheduledOperationLaneKey {
  if (activeRun) return "running";
  if (!job.active) return "paused";
  if (job.lastRun?.result === "failure" || job.lastRun?.result === "timeout") return "needs_attention";
  if (!job.nextRun) return "needs_attention";
  return "upcoming";
}

function getStatusLabel(job: CronJob, activeRun: ScheduledOperationActiveRun | undefined): string {
  if (activeRun) return activeRun.status === "queued" ? "Queued" : "Running";
  if (!job.active) return "Paused";
  if (job.lastRun?.result === "failure") return "Failed";
  if (job.lastRun?.result === "timeout") return "Timed out";
  if (!job.nextRun) return "No next run";
  return "Scheduled";
}

function getStatusBadgeVariant(job: CronJob, activeRun: ScheduledOperationActiveRun | undefined): ScheduledOperationBadgeVariant {
  if (activeRun) return "default";
  if (!job.active) return "outline";
  if (job.lastRun?.result === "failure" || job.lastRun?.result === "timeout" || !job.nextRun) {
    return job.lastRun?.result === "failure" ? "destructive" : "outline";
  }
  return "secondary";
}

function getNextActionLabel(
  job: CronJob,
  activeRun: ScheduledOperationActiveRun | undefined,
  approvalRequired: boolean,
): string {
  if (activeRun) return "Open live task";
  if (!job.active) return "Resume or edit schedule";
  if (job.lastRun?.result === "failure") return "Review failure output";
  if (job.lastRun?.result === "timeout") return "Review timeout";
  if (!job.nextRun) return "Check schedule parser";
  if (approvalRequired) return "Review approval gate";
  return "Monitor next run";
}

function compareOperations(a: ScheduledOperation, b: ScheduledOperation): number {
  if (a.laneKey === "upcoming" && b.laneKey === "upcoming") {
    const aTime = a.job.nextRun ? Date.parse(a.job.nextRun) : Number.POSITIVE_INFINITY;
    const bTime = b.job.nextRun ? Date.parse(b.job.nextRun) : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
  }

  if (a.laneKey === "needs_attention" && b.laneKey === "needs_attention") {
    const aTime = a.job.lastRun?.lastRun ? Date.parse(a.job.lastRun.lastRun) : 0;
    const bTime = b.job.lastRun?.lastRun ? Date.parse(b.job.lastRun.lastRun) : 0;
    if (aTime !== bTime) return bTime - aTime;
  }

  return a.originalIndex - b.originalIndex;
}

export function buildScheduledOperationsBoard(
  jobs: CronJob[],
  activeRuns: Record<string, ScheduledOperationActiveRun> = {},
  options: ScheduledOperationsBuildOptions = {},
): ScheduledOperationsBoard {
  const now = options.now ?? new Date();
  const operations = jobs.map((job, originalIndex) => {
    const jobKey = getScheduledOperationJobKey(job);
    const activeRun = activeRuns[jobKey];
    const workflowKey = classifyMarketingWorkflow(job);
    const template = getMarketingWorkflowTemplate(workflowKey);
    const approvalRequired = template?.approvalLevel === "approval_required";

    return {
      job,
      originalIndex,
      jobKey,
      laneKey: getLaneKey(job, activeRun),
      workflowKey,
      workflowTitle: template?.title ?? "Custom workflow",
      categoryLabel: formatCategoryLabel(template?.category ?? null),
      approvalLabel: approvalRequired ? "Approval required" : template?.approvalGate ?? "Local/read-only",
      scheduleLabel: formatScheduleLabel(job.days, job.time),
      nextRunLabel: job.active ? formatRelativeTime(job.nextRun, now) : "Paused",
      lastRunLabel: formatRelativeTime(job.lastRun?.lastRun ?? null, now),
      statusLabel: getStatusLabel(job, activeRun),
      statusBadgeVariant: getStatusBadgeVariant(job, activeRun),
      nextActionLabel: getNextActionLabel(job, activeRun, approvalRequired),
      activityLabel: activeRun?.activityLabel ?? null,
      taskId: activeRun?.taskId ?? null,
    } satisfies ScheduledOperation;
  });

  const lanes = laneOrder.map((key) => ({
    ...scheduledOperationLaneMeta[key],
    operations: operations
      .filter((operation) => operation.laneKey === key)
      .sort(compareOperations),
  }));

  const mappedTemplates = new Set(
    operations
      .map((operation) => operation.workflowKey)
      .filter((key) => key !== "custom"),
  ).size;

  return {
    operations,
    lanes,
    summary: {
      total: operations.length,
      active: jobs.filter((job) => job.active).length,
      paused: lanes.find((lane) => lane.key === "paused")?.operations.length ?? 0,
      running: lanes.find((lane) => lane.key === "running")?.operations.length ?? 0,
      needsAttention: lanes.find((lane) => lane.key === "needs_attention")?.operations.length ?? 0,
      upcoming: lanes.find((lane) => lane.key === "upcoming")?.operations.length ?? 0,
      mappedTemplates,
      coveragePercent: Math.round((mappedTemplates / marketingWorkflowTemplates.length) * 100),
      approvalGated: operations.filter((operation) => operation.approvalLabel === "Approval required").length,
    },
  };
}
