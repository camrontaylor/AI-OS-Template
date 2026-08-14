import {
  taskMatchesPlanDraft,
  type MarketingPlanCompile,
  type MarketingPlanTaskDraft,
} from "@/lib/marketing-plan-compiler";
import type { Task } from "@/types/task";

export type MarketingPlanBoardLaneKey =
  | "work_now"
  | "needs_attention"
  | "in_motion"
  | "ready_next"
  | "planned"
  | "done";

export type MarketingPlanBoardBadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface MarketingPlanBoardItem {
  draft: MarketingPlanTaskDraft;
  task: Task | null;
  laneKey: MarketingPlanBoardLaneKey;
  statusLabel: string;
  statusBadgeVariant: MarketingPlanBoardBadgeVariant;
  actionLabel: string;
  approvalLabel: string;
  guardrailLabel: string;
  localTaskLabel: string | null;
  dueLabel: string;
  timeframeLabel: string;
  activityLabel: string | null;
  sortIndex: number;
}

export interface MarketingPlanBoardLane {
  key: MarketingPlanBoardLaneKey;
  title: string;
  description: string;
  items: MarketingPlanBoardItem[];
}

export interface MarketingPlanBoardSummary {
  total: number;
  completed: number;
  active: number;
  needsAttention: number;
  ready: number;
  planned: number;
  approvalGated: number;
  completionPercent: number;
}

export interface MarketingPlanOperatingBoard {
  primaryAction: MarketingPlanBoardItem;
  items: MarketingPlanBoardItem[];
  lanes: MarketingPlanBoardLane[];
  summary: MarketingPlanBoardSummary;
}

export const marketingPlanBoardLaneMeta: Record<
  MarketingPlanBoardLaneKey,
  Pick<MarketingPlanBoardLane, "key" | "title" | "description">
> = {
  work_now: {
    key: "work_now",
    title: "Work on now",
    description: "The single next action to start or reopen.",
  },
  needs_attention: {
    key: "needs_attention",
    title: "Needs attention",
    description: "Blocked, review, or needs-input plan work.",
  },
  in_motion: {
    key: "in_motion",
    title: "In motion",
    description: "Queued or running local tasks.",
  },
  ready_next: {
    key: "ready_next",
    title: "Ready next",
    description: "Unblocked work that can be started after the current action.",
  },
  planned: {
    key: "planned",
    title: "Planned later",
    description: "Roadmap items waiting for the right phase.",
  },
  done: {
    key: "done",
    title: "Completed",
    description: "Plan items already marked complete locally.",
  },
};

const laneOrder: MarketingPlanBoardLaneKey[] = [
  "work_now",
  "needs_attention",
  "in_motion",
  "ready_next",
  "planned",
  "done",
];

const phaseOrder: Record<string, number> = {
  today: 0,
  this_week: 1,
  this_month: 2,
};

function findTaskForDraft(tasks: Task[], draft: MarketingPlanTaskDraft): Task | null {
  return tasks.find((task) => taskMatchesPlanDraft(task, draft)) ?? null;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDue(value: string | null): string {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getTaskStatusLabel(task: Task): string {
  if (task.needsInput) return "Needs input";
  if (task.errorMessage) return "Blocked";
  if (task.status === "review") return "Review";
  return titleCase(task.status);
}

function getLaneKey(draft: MarketingPlanTaskDraft, task: Task | null, nextBestActionId: string): MarketingPlanBoardLaneKey {
  if (task?.status === "done") return "done";
  if (task?.needsInput || task?.errorMessage || task?.status === "review") return "needs_attention";
  if (task?.status === "queued" || task?.status === "running") return "in_motion";
  if (draft.id === nextBestActionId && draft.status === "ready") return "work_now";
  if (draft.status === "ready") return "ready_next";
  return "planned";
}

function getStatusLabel(draft: MarketingPlanTaskDraft, task: Task | null): string {
  if (task) return getTaskStatusLabel(task);
  return draft.status === "ready" ? "Ready" : titleCase(draft.status);
}

function getBadgeVariant(task: Task | null, laneKey: MarketingPlanBoardLaneKey): MarketingPlanBoardBadgeVariant {
  if (task?.needsInput || task?.errorMessage || laneKey === "needs_attention") return "destructive";
  if (laneKey === "in_motion" || laneKey === "work_now") return "default";
  if (laneKey === "done") return "secondary";
  return "outline";
}

function getActionLabel(task: Task | null, laneKey: MarketingPlanBoardLaneKey): string {
  if (task?.needsInput || task?.errorMessage || task?.status === "review") return "Review task";
  if (task) return "Open task";
  if (laneKey === "work_now") return "Work on now";
  if (laneKey === "ready_next") return "Start next";
  return "Queue when ready";
}

function getSortIndex(draft: MarketingPlanTaskDraft, originalIndex: number): number {
  const phaseRank = draft.phase ? phaseOrder[draft.phase] ?? 9 : 9;
  const dueRank = draft.due ? Date.parse(draft.due) : Number.POSITIVE_INFINITY;
  return phaseRank * 1_000_000_000_000 + (Number.isFinite(dueRank) ? dueRank / 1000 : 999_999_999) + originalIndex;
}

function compareItems(a: MarketingPlanBoardItem, b: MarketingPlanBoardItem): number {
  return a.sortIndex - b.sortIndex;
}

export function buildMarketingPlanOperatingBoard(
  plan: MarketingPlanCompile,
  tasks: Task[],
): MarketingPlanOperatingBoard {
  const items = plan.taskDrafts.map((draft, originalIndex) => {
    const task = findTaskForDraft(tasks, draft);
    const laneKey = getLaneKey(draft, task, plan.nextBestAction.id);
    const requiresApproval = draft.requiresApproval || draft.approvalGate !== "Other external changes";

    return {
      draft,
      task,
      laneKey,
      statusLabel: getStatusLabel(draft, task),
      statusBadgeVariant: getBadgeVariant(task, laneKey),
      actionLabel: getActionLabel(task, laneKey),
      approvalLabel: draft.approvalGate,
      guardrailLabel: requiresApproval ? "Approval required" : "Local draft",
      localTaskLabel: task ? "Local task" : null,
      dueLabel: formatDue(draft.due),
      timeframeLabel: draft.timeframe,
      activityLabel: task?.activityLabel ?? null,
      sortIndex: getSortIndex(draft, originalIndex),
    } satisfies MarketingPlanBoardItem;
  });

  const lanes = laneOrder.map((key) => ({
    ...marketingPlanBoardLaneMeta[key],
    items: items.filter((item) => item.laneKey === key).sort(compareItems),
  }));
  const primaryAction =
    lanes.find((lane) => lane.key === "work_now")?.items[0] ??
    lanes.find((lane) => lane.key === "needs_attention")?.items[0] ??
    lanes.find((lane) => lane.key === "in_motion")?.items[0] ??
    lanes.find((lane) => lane.key === "ready_next")?.items[0] ??
    lanes.find((lane) => lane.items.length > 0)?.items[0];

  if (!primaryAction) {
    throw new Error("Marketing plan has no task drafts to operate on.");
  }

  const completed = lanes.find((lane) => lane.key === "done")?.items.length ?? 0;
  const needsAttention = lanes.find((lane) => lane.key === "needs_attention")?.items.length ?? 0;
  const inMotion = lanes.find((lane) => lane.key === "in_motion")?.items.length ?? 0;
  const workNow = lanes.find((lane) => lane.key === "work_now")?.items.length ?? 0;
  const readyNext = lanes.find((lane) => lane.key === "ready_next")?.items.length ?? 0;
  const planned = lanes.find((lane) => lane.key === "planned")?.items.length ?? 0;

  return {
    primaryAction,
    items,
    lanes,
    summary: {
      total: items.length,
      completed,
      active: workNow + inMotion,
      needsAttention,
      ready: workNow + readyNext,
      planned,
      approvalGated: items.filter((item) => item.guardrailLabel === "Approval required").length,
      completionPercent: items.length ? Math.round((completed / items.length) * 100) : 0,
    },
  };
}
