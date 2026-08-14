"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Play,
  ShieldCheck,
} from "lucide-react";
import {
  classifyMarketingWorkflow,
  formatRelativeRunTime,
  marketingWorkflowTemplates,
} from "@/lib/marketing-workflows";
import type { CronJob, CronSystemStatus } from "@/types/cron";
import type { ScheduledOperation, ScheduledOperationsBoard } from "@/lib/marketing-scheduled-operations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

interface ScheduledOperationsOverviewProps {
  jobs: CronJob[];
  operationsBoard: ScheduledOperationsBoard;
  systemStatus: CronSystemStatus | null;
  selectedClientId: string | null;
  onCreateJob: () => void;
}

interface CronBlockerFinding {
  id: string;
  headline: string;
  summary: string;
  occurredAt: string;
  severity: string;
  taskId: string | null;
  blocker: {
    retryable?: boolean;
    nextStep?: string;
  } | null;
}

interface CronBlockerPayload {
  findings: CronBlockerFinding[];
  summary: {
    blocked: number;
  };
}

export function ScheduledOperationsOverview({
  jobs,
  operationsBoard,
  systemStatus,
  selectedClientId,
  onCreateJob,
}: ScheduledOperationsOverviewProps) {
  const [blockerFindings, setBlockerFindings] = useState<CronBlockerFinding[]>([]);
  const [blockerCount, setBlockerCount] = useState(0);
  const [blockerError, setBlockerError] = useState<string | null>(null);
  const coverage = operationsBoard.summary.coveragePercent;
  const nextOperations =
    operationsBoard.lanes.find((lane) => lane.key === "upcoming")?.operations.slice(0, 4) ?? [];
  const attentionOperations =
    operationsBoard.lanes.find((lane) => lane.key === "needs_attention")?.operations.slice(0, 5) ?? [];
  const isRuntimeHealthy = systemStatus?.leaderState === "active";

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      status: "blocked",
      source: "cron-run",
      limit: "5",
    });
    if (selectedClientId) {
      params.set("clientId", selectedClientId);
    }

    fetch(`/api/marketing-findings?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load blocker findings");
        return (await res.json()) as CronBlockerPayload;
      })
      .then((payload) => {
        if (cancelled) return;
        setBlockerFindings(payload.findings);
        setBlockerCount(payload.summary.blocked);
        setBlockerError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setBlockerFindings([]);
        setBlockerCount(0);
        setBlockerError(error instanceof Error ? error.message : "Failed to load blocker findings");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClientId, jobs]);

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Scheduled Workflows
              </p>
              <h1 className="m-0 text-2xl font-semibold tracking-normal text-foreground">
                Cron control plane
              </h1>
              <p className="m-0 mt-2 max-w-3xl text-sm text-muted-foreground">
                Runtime health, marketing-loop coverage, next runs, and jobs that need operator attention.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onCreateJob}>
                <CalendarClock data-icon="inline-start" />
                New scheduled job
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/workflows">
                  Workflow map
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{operationsBoard.summary.active}</div>
                <div className="mt-1 text-xs text-muted-foreground">Active jobs</div>
                <Progress value={jobs.length ? (operationsBoard.summary.active / jobs.length) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{operationsBoard.summary.paused}</div>
                <div className="mt-1 text-xs text-muted-foreground">Paused jobs</div>
                <Progress value={jobs.length ? (operationsBoard.summary.paused / jobs.length) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{operationsBoard.summary.needsAttention}</div>
                <div className="mt-1 text-xs text-muted-foreground">Need attention</div>
                <Progress value={jobs.length ? (operationsBoard.summary.needsAttention / jobs.length) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{coverage}%</div>
                <div className="mt-1 text-xs text-muted-foreground">Loop coverage</div>
                <Progress value={coverage} className="mt-3" />
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              {isRuntimeHealthy ? (
                <ShieldCheck className="text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="text-amber-600 dark:text-amber-400" />
              )}
              Runtime
            </CardTitle>
            <CardDescription>{systemStatus?.statusSummary ?? "Runtime status loading"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-background p-3">
                <div className="text-xs text-muted-foreground">Leader</div>
                <div className="mt-1 font-medium text-foreground">
                  {systemStatus?.leader ? "Local owner" : "Standby"}
                </div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-xs text-muted-foreground">Running now</div>
                <div className="mt-1 font-medium text-foreground">{operationsBoard.summary.running}</div>
              </div>
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              {systemStatus
                ? `Runtime ${systemStatus.runtime}; ownership reason ${systemStatus.ownershipReason}.`
                : "Runtime metadata will appear once the cron API responds."}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px_340px]">
        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="text-muted-foreground" />
              Next Runs
            </CardTitle>
            <CardDescription>Upcoming scheduled jobs in run order</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {nextOperations.length === 0 ? (
              <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                No active jobs have a next run scheduled.
              </div>
            ) : (
              nextOperations.map((operation) => {
                const job = operation.job;
                return (
                  <div key={`${job.clientId ?? "root"}:${job.slug}`} className="rounded-lg border bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{job.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {operation.workflowTitle} - {operation.scheduleLabel}
                        </div>
                      </div>
                      <Badge variant="secondary">{operation.nextRunLabel}</Badge>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="text-muted-foreground" />
              Attention Queue
            </CardTitle>
            <CardDescription>Failed, timed-out, or unscheduled active jobs</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {attentionOperations.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                No scheduled job currently needs attention.
              </div>
            ) : (
              attentionOperations.map((operation: ScheduledOperation) => (
                <div key={operation.jobKey} className="rounded-lg border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-foreground">{operation.job.name}</div>
                    <Badge variant={operation.statusBadgeVariant}>{operation.statusLabel}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {operation.nextActionLabel} - Last run {operation.lastRunLabel}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="text-muted-foreground" />
              Blocker Findings
            </CardTitle>
            <CardDescription>{blockerCount} persisted cron blocker{blockerCount === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {blockerError ? (
              <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                {blockerError}
              </div>
            ) : blockerFindings.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                No stored cron blockers.
              </div>
            ) : (
              blockerFindings.map((finding) => (
                <div key={finding.id} className="rounded-lg border bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{finding.headline}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{finding.summary}</div>
                    </div>
                    <Badge variant="destructive">{finding.severity}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatRelativeRunTime(finding.occurredAt)}</span>
                    {finding.taskId ? (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                        <Link href={`/agent?task=${encodeURIComponent(finding.taskId)}`}>
                          Open task
                          <ArrowRight data-icon="inline-end" />
                        </Link>
                      </Button>
                    ) : (
                      <Badge variant="outline">
                        {finding.blocker?.retryable === false ? "Needs input" : "Retryable"}
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Marketing Loop Coverage</CardTitle>
          <CardDescription>Magister-inspired workflow templates mapped to local cron jobs</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {marketingWorkflowTemplates.map((template) => {
            const matchingJobs = jobs.filter((job) => classifyMarketingWorkflow(job) === template.key);
            const isCovered = matchingJobs.length > 0;
            return (
              <div key={template.key} className="rounded-lg border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{template.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{template.cadence}</div>
                  </div>
                  {isCovered ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
                  )}
                </div>
                <Separator className="my-3" />
                <div className="text-xs leading-5 text-muted-foreground">
                  {isCovered ? `${matchingJobs.length} job${matchingJobs.length === 1 ? "" : "s"} mapped` : "No job mapped yet"}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
