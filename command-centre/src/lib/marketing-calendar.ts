import type { CronJob } from "@/types/cron";
import type { Task, TaskStatus } from "@/types/task";
import {
  classifyMarketingWorkflow,
  formatScheduleLabel,
  getMarketingWorkflowTemplate,
} from "@/lib/marketing-workflows";

export type MarketingCalendarItemType =
  | "workflow"
  | "plan"
  | "social"
  | "email"
  | "brief"
  | "approval";

export type MarketingCalendarItemStatus =
  | "backlog"
  | "scheduled"
  | "queued"
  | "running"
  | "review"
  | "done"
  | "paused"
  | "needs_input"
  | "failed";

export interface MarketingCalendarItem {
  id: string;
  type: MarketingCalendarItemType;
  status: MarketingCalendarItemStatus;
  title: string;
  detail: string;
  sourceLabel: string;
  at: string;
  sortTime: number;
  clientId: string | null;
  jobSlug?: string;
  taskId?: string;
  requiresApproval: boolean;
}

export interface MarketingCalendarDay {
  date: string;
  label: string;
  items: MarketingCalendarItem[];
}

const externalActionPattern =
  /\b(publish|post|schedule|send|email|newsletter|ad|campaign|linkedin|twitter|threads|instagram|tiktok|deploy|pull request|delete)\b/i;
const socialPattern = /\b(social|linkedin|twitter|x\.com|threads|instagram|tiktok|post|publish)\b/i;
const emailPattern = /\b(email|gmail|newsletter|resend|mailchimp|kit|klaviyo|send)\b/i;
const briefPattern = /\b(brief|daily summary|weekly summary|standup|check[- ]?in)\b/i;
const approvalPattern = /\b(approval|permission|needs input|waiting|blocked)\b/i;

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

function toDayKey(time: number): string {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(time: Date): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDays(time: number, days: number): number {
  return time + days * 24 * 60 * 60 * 1000;
}

function taskText(task: Pick<Task, "title" | "description" | "activityLabel" | "errorMessage">): string {
  return [task.title, task.description, task.activityLabel, task.errorMessage].filter(Boolean).join("\n");
}

export function getCalendarTypeForTask(
  task: Pick<Task, "title" | "description" | "activityLabel" | "errorMessage" | "needsInput"> &
    Partial<Pick<Task, "status">>,
): MarketingCalendarItemType {
  const text = taskText(task);
  if (task.needsInput || task.status === "review" || approvalPattern.test(text)) return "approval";
  if (socialPattern.test(text)) return "social";
  if (emailPattern.test(text)) return "email";
  if (briefPattern.test(text)) return "brief";
  return "plan";
}

export function getCalendarTypeForJob(
  job: Pick<CronJob, "name" | "description" | "prompt">,
): MarketingCalendarItemType {
  const workflowType = classifyMarketingWorkflow(job);
  const template = getMarketingWorkflowTemplate(workflowType);
  if (template?.category === "social") return "social";
  if (template?.category === "email") return "email";
  if (workflowType === "social_publishing") return "social";
  if (workflowType === "email_outbound") return "email";
  if (workflowType === "standard_brief") return "brief";
  return "workflow";
}

function getTaskStatus(task: Pick<Task, "status" | "needsInput" | "errorMessage">): MarketingCalendarItemStatus {
  if (task.needsInput) return "needs_input";
  if (task.errorMessage) return "failed";
  return task.status as TaskStatus;
}

function taskDate(task: Pick<Task, "needsInput" | "status" | "startedAt" | "lastReplyAt" | "updatedAt" | "createdAt">, now: Date): number | null {
  if (task.needsInput || task.status === "review") {
    return now.getTime();
  }
  return parseTime(task.startedAt) ?? parseTime(task.lastReplyAt) ?? parseTime(task.updatedAt) ?? parseTime(task.createdAt);
}

export function buildMarketingCalendarItems({
  jobs,
  tasks,
  now = new Date(),
  daysAhead = 14,
}: {
  jobs: CronJob[];
  tasks: Task[];
  now?: Date;
  daysAhead?: number;
}): MarketingCalendarItem[] {
  const start = startOfDay(now);
  const end = addDays(start, daysAhead + 1);
  const items: MarketingCalendarItem[] = [];

  for (const job of jobs) {
    const sortTime = parseTime(job.nextRun);
    if (!job.active || sortTime === null || sortTime < start || sortTime >= end) continue;

    const type = getCalendarTypeForJob(job);
    const template = getMarketingWorkflowTemplate(classifyMarketingWorkflow(job));
    const status: MarketingCalendarItemStatus =
      job.lastRun?.result === "failure" || job.lastRun?.result === "timeout" ? "failed" : "scheduled";

    items.push({
      id: `cron:${job.clientId ?? "root"}:${job.slug}`,
      type,
      status,
      title: job.name,
      detail: `${template?.title ?? "Custom workflow"} - ${formatScheduleLabel(job.days, job.time)}`,
      sourceLabel: "Scheduled job",
      at: new Date(sortTime).toISOString(),
      sortTime,
      clientId: job.clientId,
      jobSlug: job.slug,
      requiresApproval: type === "social" || type === "email" || externalActionPattern.test(job.prompt),
    });
  }

  for (const task of tasks) {
    if (task.status === "done") continue;

    const sortTime = taskDate(task, now);
    if (sortTime === null || sortTime >= end) continue;

    const type = getCalendarTypeForTask(task);
    const text = taskText(task);

    items.push({
      id: `task:${task.id}`,
      type,
      status: getTaskStatus(task),
      title: task.title,
      detail: task.activityLabel || task.description || "Open AI-OS task",
      sourceLabel: task.projectSlug ? `Plan task / ${task.projectSlug}` : "AI-OS task",
      at: new Date(sortTime).toISOString(),
      sortTime,
      clientId: task.clientId,
      taskId: task.id,
      requiresApproval: type === "approval" || externalActionPattern.test(text),
    });
  }

  return items.sort((a, b) => a.sortTime - b.sortTime || a.title.localeCompare(b.title));
}

export function groupMarketingCalendarItemsByDay({
  items,
  now = new Date(),
  dayCount = 7,
}: {
  items: MarketingCalendarItem[];
  now?: Date;
  dayCount?: number;
}): MarketingCalendarDay[] {
  const start = startOfDay(now);

  return Array.from({ length: dayCount }, (_, index) => {
    const dayStart = addDays(start, index);
    const dayEnd = addDays(dayStart, 1);
    const date = new Date(dayStart);
    const dateKey = toDayKey(dayStart);
    const label =
      index === 0
        ? "Today"
        : date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

    return {
      date: dateKey,
      label,
      items: items.filter((item) => item.sortTime >= dayStart && item.sortTime < dayEnd),
    };
  });
}
