"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Megaphone,
  Play,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { CreateJobPanel } from "@/components/cron/create-job-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  buildMarketingCalendarItems,
  groupMarketingCalendarItemsByDay,
  type MarketingCalendarItem,
  type MarketingCalendarItemType,
} from "@/lib/marketing-calendar";
import { getCronJobKey, useCronStore } from "@/store/cron-store";
import { useClientStore } from "@/store/client-store";
import { useTaskStore } from "@/store/task-store";

type CalendarFilter = "all" | "workflow" | "plan" | "publishing" | "approval";

const typeLabel: Record<MarketingCalendarItemType, string> = {
  workflow: "Workflow",
  plan: "Plan",
  social: "Social",
  email: "Email",
  brief: "Brief",
  approval: "Approval",
};

const statusLabel: Record<MarketingCalendarItem["status"], string> = {
  backlog: "Backlog",
  scheduled: "Scheduled",
  queued: "Queued",
  running: "Running",
  review: "Review",
  done: "Done",
  paused: "Paused",
  needs_input: "Needs input",
  failed: "Failed",
};

function formatItemTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function filterItem(item: MarketingCalendarItem, filter: CalendarFilter): boolean {
  if (filter === "all") return true;
  if (filter === "publishing") return item.type === "social" || item.type === "email";
  return item.type === filter;
}

function isApprovalItem(item: MarketingCalendarItem): boolean {
  return item.type === "approval" || item.requiresApproval || item.status === "needs_input";
}

function CalendarItemRow({
  item,
  isRunning,
  onOpenTask,
  onRunJob,
}: {
  item: MarketingCalendarItem;
  isRunning: boolean;
  onOpenTask: (taskId: string) => void;
  onRunJob: (slug: string) => void;
}) {
  const statusVariant = item.status === "failed" || item.status === "needs_input" ? "destructive" : "outline";

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md border bg-card">
            <CalendarClock className="text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{typeLabel[item.type]}</Badge>
              <Badge variant={statusVariant}>{isRunning ? "Running" : statusLabel[item.status]}</Badge>
              {item.requiresApproval && <Badge variant="outline">Approval gated</Badge>}
            </div>
            <h3 className="m-0 mt-2 text-sm font-semibold text-foreground">{item.title}</h3>
            <p className="m-0 mt-1 text-sm text-muted-foreground">{item.detail}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{formatItemTime(item.at)}</span>
              <span>{item.sourceLabel}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {item.taskId && (
            <Button variant="outline" size="sm" onClick={() => onOpenTask(item.taskId!)}>
              <FileText data-icon="inline-start" />
              Open task
            </Button>
          )}
          {item.jobSlug && (
            <Button size="sm" onClick={() => onRunJob(item.jobSlug!)} disabled={isRunning}>
              <Play data-icon="inline-start" />
              {isRunning ? "Running" : "Run now"}
            </Button>
          )}
          {isApprovalItem(item) && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/permissions">
                Gate
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CalendarView() {
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const now = useMemo(() => new Date(), []);
  const selectedClientId = useClientStore((s) => s.selectedClientId);
  const jobs = useCronStore((s) => s.jobs);
  const activeRuns = useCronStore((s) => s.activeRuns);
  const cronLoading = useCronStore((s) => s.isLoading);
  const fetchJobs = useCronStore((s) => s.fetchJobs);
  const runJobNow = useCronStore((s) => s.runJobNow);
  const setShowCreatePanel = useCronStore((s) => s.setShowCreatePanel);
  const tasks = useTaskStore((s) => s.tasks);
  const tasksLoading = useTaskStore((s) => s.isLoading);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const openPanel = useTaskStore((s) => s.openPanel);

  useEffect(() => {
    fetchJobs();
    fetchTasks();
  }, [fetchJobs, fetchTasks, selectedClientId]);

  const items = useMemo(
    () => buildMarketingCalendarItems({ jobs, tasks, now, daysAhead: 14 }),
    [jobs, tasks, now],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => filterItem(item, filter)),
    [filter, items],
  );
  const days = useMemo(
    () => groupMarketingCalendarItemsByDay({ items: visibleItems, now, dayCount: 7 }),
    [visibleItems, now],
  );

  const upcomingCount = items.filter((item) => item.status === "scheduled").length;
  const approvalCount = items.filter(isApprovalItem).length;
  const publishingCount = items.filter((item) => item.type === "social" || item.type === "email").length;
  const activeRunCount = Object.keys(activeRuns).length;
  const coverage = Math.min(100, Math.round((items.length / 12) * 100));
  const isLoading = cronLoading || tasksLoading;

  const handleCreateSocialDraft = async () => {
    const taskId = await createTask(
      "Draft social post for review",
      "Create a social post draft from the current marketing plan. Do not publish or schedule externally without approval.",
      "task",
      null,
      null,
      "plan",
      "backlog",
      selectedClientId,
    );
    if (taskId) openPanel(taskId);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Execution Calendar
              </p>
              <h1 className="m-0 text-2xl font-semibold tracking-normal text-foreground">
                Dated marketing work
              </h1>
              <p className="m-0 mt-2 max-w-3xl text-sm text-muted-foreground">
                Upcoming cron runs, open plan work, publishing drafts, briefs, and approval-gated items in one local schedule.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setShowCreatePanel(true)}>
                <Plus data-icon="inline-start" />
                Schedule item
              </Button>
              <Button variant="outline" size="sm" onClick={handleCreateSocialDraft}>
                <Megaphone data-icon="inline-start" />
                Social draft
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{upcomingCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">Scheduled</div>
                <Progress value={coverage} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{approvalCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">Approval gated</div>
                <Progress value={items.length ? (approvalCount / items.length) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{publishingCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">Publishing items</div>
                <Progress value={items.length ? (publishingCount / items.length) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{activeRunCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">Running now</div>
                <Progress value={activeRunCount ? 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="text-muted-foreground" />
              Publishing Gate
            </CardTitle>
            <CardDescription>Draft-before-live remains the default</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="rounded-lg border bg-background p-3">
              <div className="font-medium text-foreground">Social posts</div>
              <div className="mt-1 text-muted-foreground">Draft and schedule locally before any external post.</div>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <div className="font-medium text-foreground">Email campaigns</div>
              <div className="mt-1 text-muted-foreground">Approve or edit before any send.</div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/permissions">
                Review gates
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock3 className="text-muted-foreground" />
                  Seven-Day Agenda
                </CardTitle>
                <CardDescription>
                  {isLoading ? "Refreshing local schedule..." : `${visibleItems.length} visible item${visibleItems.length === 1 ? "" : "s"}`}
                </CardDescription>
              </div>
              <Tabs value={filter} onValueChange={(value) => setFilter(value as CalendarFilter)}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="workflow">Workflows</TabsTrigger>
                  <TabsTrigger value="plan">Plan</TabsTrigger>
                  <TabsTrigger value="publishing">Publishing</TabsTrigger>
                  <TabsTrigger value="approval">Approvals</TabsTrigger>
                </TabsList>
                <TabsContent value={filter} className="hidden" />
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {days.map((day) => (
              <section key={day.date} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-sm font-semibold text-foreground">{day.label}</h2>
                    <p className="m-0 text-xs text-muted-foreground">{day.date}</p>
                  </div>
                  <Badge variant="outline">{day.items.length}</Badge>
                </div>
                {day.items.length === 0 ? (
                  <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                    No local work scheduled for this day.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {day.items.map((item) => (
                      <CalendarItemRow
                        key={item.id}
                        item={item}
                        isRunning={Boolean(item.jobSlug && activeRuns[getCronJobKey(item.jobSlug, item.clientId)])}
                        onOpenTask={openPanel}
                        onRunJob={runJobNow}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Source Coverage</CardTitle>
              <CardDescription>What is feeding the calendar today</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="rounded-lg border bg-background p-3">
                <div className="font-medium text-foreground">{jobs.length} scheduled jobs</div>
                <div className="mt-1 text-muted-foreground">Cron is the source for workflow, brief, social, and email runs.</div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="font-medium text-foreground">{tasks.filter((task) => task.status !== "done").length} open tasks</div>
                <div className="mt-1 text-muted-foreground">Tasks supply plan work and approval-needed items.</div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="font-medium text-foreground">Connector-backed publishing pending</div>
                <div className="mt-1 text-muted-foreground">LinkedIn, email, and paid channels stay gated until integrations are connected.</div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="text-muted-foreground" />
                Expected Objects
              </CardTitle>
              <CardDescription>Calendar items remain executable</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {[
                ["Cron run", "Run now or edit the schedule from the shared job panel."],
                ["Plan task", "Open the task detail panel and continue the AI-OS run."],
                ["Publishing draft", "Create the local draft first, then gate schedule or publish."],
                ["Brief", "Keep daily and weekly briefs anchored to real scheduled jobs."],
              ].map(([label, detail], index) => (
                <div key={label}>
                  {index > 0 && <Separator className="mb-3" />}
                  <div className="font-medium text-foreground">{label}</div>
                  <div className="mt-1 text-muted-foreground">{detail}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Build Evidence</CardTitle>
              <CardDescription>Reference docs behind this calendar</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/docs?file=projects/briefs/magister-replication/workflow-templates.md">
                  Workflow templates
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/docs?file=projects/briefs/magister-command-centre/brief.md">
                  Command-center brief
                </Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </section>

      <CreateJobPanel />
    </div>
  );
}
