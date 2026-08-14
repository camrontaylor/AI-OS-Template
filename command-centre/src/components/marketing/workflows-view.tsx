"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Database,
  FileText,
  ListChecks,
  PlayCircle,
  PlugZap,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useClientStore } from "@/store/client-store";
import { useCronStore } from "@/store/cron-store";
import {
  buildMarketingWorkflowCronInput,
  classifyMarketingWorkflow,
  formatRelativeRunTime,
  formatScheduleLabel,
  marketingWorkflowFindingContract,
  marketingWorkflowTemplates,
  requiresMarketingApproval,
} from "@/lib/marketing-workflows";
import type { MarketingWorkflowTemplate } from "@/lib/marketing-workflows";
import type { CronJob } from "@/types/cron";
import { CreateJobPanel } from "@/components/cron/create-job-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function getMappedJobs(templateKey: string, jobs: CronJob[]): CronJob[] {
  return jobs.filter((job) => classifyMarketingWorkflow(job) === templateKey);
}

function getUniqueConnections(templates: MarketingWorkflowTemplate[]): string[] {
  return Array.from(new Set(templates.flatMap((template) => template.requiredConnections))).sort();
}

function formatConnectionLabel(connection: string): string {
  return connection
    .split("_")
    .map((token) => token.toUpperCase() === token ? token : token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    cro: "CRO",
    seo: "SEO",
    revops: "RevOps",
    "paid-ads": "Paid Ads",
  };
  if (labels[category]) return labels[category];

  return category
    .split("-")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function WorkflowsView() {
  const jobs = useCronStore((s) => s.jobs);
  const isLoading = useCronStore((s) => s.isLoading);
  const fetchJobs = useCronStore((s) => s.fetchJobs);
  const setShowCreatePanel = useCronStore((s) => s.setShowCreatePanel);
  const setCreateJobDraft = useCronStore((s) => s.setCreateJobDraft);
  const selectedClientId = useClientStore((s) => s.selectedClientId);
  const [categoryFilter, setCategoryFilter] = useState("orchestrator");

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, selectedClientId]);

  const coveredTemplates = marketingWorkflowTemplates.filter(
    (template) => getMappedJobs(template.key, jobs).length > 0,
  );
  const coverage = Math.round((coveredTemplates.length / marketingWorkflowTemplates.length) * 100);
  const systemLoopCount = marketingWorkflowTemplates.filter((template) => template.isSystemLoop).length;
  const approvalLoopCount = marketingWorkflowTemplates.filter(requiresMarketingApproval).length;
  const requiredConnections = getUniqueConnections(marketingWorkflowTemplates);
  const categories = Array.from(new Set(marketingWorkflowTemplates.map((template) => template.category)));
  const categoryOptions = [
    { value: "all", label: "All", count: marketingWorkflowTemplates.length },
    ...categories.map((category) => ({
      value: category,
      label: formatCategoryLabel(category),
      count: marketingWorkflowTemplates.filter((template) => template.category === category).length,
    })),
  ];
  const visibleTemplates =
    categoryFilter === "all"
      ? marketingWorkflowTemplates
      : marketingWorkflowTemplates.filter((template) => template.category === categoryFilter);

  const openTemplateDraft = (template: MarketingWorkflowTemplate) => {
    if (template.key === "custom") return;
    setCreateJobDraft(buildMarketingWorkflowCronInput(template.key));
  };

  const renderTemplateCard = (template: MarketingWorkflowTemplate) => {
    const mappedJobs = getMappedJobs(template.key, jobs);
    const isMapped = mappedJobs.length > 0;

    return (
      <div key={template.magisterSlug} className="rounded-lg border bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-base font-semibold text-foreground">{template.title}</h2>
              <Badge variant="outline">{template.category}</Badge>
              <Badge variant={isMapped ? "secondary" : "outline"}>
                {isMapped ? "Mapped" : "Unscheduled"}
              </Badge>
              {template.isGatewayOwned && <Badge variant="outline">Gateway source</Badge>}
              {requiresMarketingApproval(template) && <Badge variant="destructive">Approval</Badge>}
            </div>
            <p className="m-0 mt-1 text-sm text-muted-foreground">{template.purpose}</p>
          </div>
          {isMapped ? (
            <CheckCircle2 className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <CircleDashed className="shrink-0 text-muted-foreground" />
          )}
        </div>

        <Separator className="my-4" />

        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cadence</div>
            <div className="mt-1 text-foreground">{template.cadence}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {template.schedule?.cronExpression ?? "Campaign-triggered"}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Gate</div>
            <div className="mt-1 text-foreground">{template.approvalGate}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Inputs</div>
            <div className="mt-1 text-foreground">
              {template.inputs.length === 0
                ? "Client context"
                : `${template.inputs.length} field${template.inputs.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Connections
            </div>
            <div className="mt-1 text-foreground">
              {template.requiredConnections.length === 0
                ? "None required"
                : template.requiredConnections.slice(0, 2).map(formatConnectionLabel).join(", ")}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-md border bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <ListChecks />
            Steps
          </div>
          <ol className="m-0 mt-2 flex list-decimal flex-col gap-1 pl-4 text-xs leading-5 text-muted-foreground">
            {template.steps.slice(0, 3).map((step) => (
              <li key={step.title}>
                <span className="font-medium text-foreground">{step.title}:</span> {step.detail}
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {template.evidenceArtifacts.map((artifact) => (
            <Badge key={artifact} variant="outline">
              {artifact}
            </Badge>
          ))}
        </div>

        {mappedJobs.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {mappedJobs.map((job) => (
              <div key={`${job.clientId ?? "root"}:${job.slug}`} className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{job.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatScheduleLabel(job.days, job.time)}
                    </div>
                  </div>
                  <Badge variant={job.active ? "default" : "outline"}>
                    {job.active ? "Active" : "Paused"}
                  </Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Next run {formatRelativeRunTime(job.nextRun)}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => openTemplateDraft(template)}>
            <CalendarClock data-icon="inline-start" />
            Prefill job
          </Button>
          {isMapped && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/cron">
                Open cron
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Workflow Compiler
              </p>
              <h1 className="m-0 text-2xl font-semibold tracking-normal text-foreground">
                Marketing loops
              </h1>
              <p className="m-0 mt-2 max-w-3xl text-sm text-muted-foreground">
                Magister-style operating procedures mapped onto local AI-OS cron jobs, approvals, skills, and evidence.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setShowCreatePanel(true)}>
                <CalendarClock data-icon="inline-start" />
                Schedule loop
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/cron">
                  Scheduled jobs
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{marketingWorkflowTemplates.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">Templates</div>
                <Progress value={100} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{systemLoopCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">System loops</div>
                <Progress value={(systemLoopCount / marketingWorkflowTemplates.length) * 100} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{coveredTemplates.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">Mapped loops</div>
                <Progress value={coverage} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{approvalLoopCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">Approval gated</div>
                <Progress value={(approvalLoopCount / marketingWorkflowTemplates.length) * 100} className="mt-3" />
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Workflow className="text-muted-foreground" />
              Compiler Path
            </CardTitle>
            <CardDescription>How a workflow becomes a scheduled run</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {[
              ["Template", "Start from the reverse-engineered Magister schema."],
              ["Context", "Gather inputs, client facts, connector state, and plan tasks."],
              ["Gate", "Keep publish, spend, send, deploy, and delete actions approval-bound."],
              ["Finding", "Persist a finding or blocker with artifact evidence."],
            ].map(([label, detail]) => (
              <div key={label} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <div className="font-medium text-foreground">{label}</div>
                  <div className="text-muted-foreground">{detail}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Loop Templates</CardTitle>
                <CardDescription>
                  Showing {visibleTemplates.length} of {marketingWorkflowTemplates.length} Magister workflow templates
                </CardDescription>
              </div>
              <Badge variant="secondary">{formatCategoryLabel(categoryFilter)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Tabs value={categoryFilter} onValueChange={setCategoryFilter} className="gap-4">
              <TabsList className="h-9 w-full justify-start overflow-x-auto">
                {categoryOptions.map((option) => (
                  <TabsTrigger key={option.value} value={option.value} className="flex-none">
                    {option.label} ({option.count})
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={categoryFilter} className="grid gap-3 xl:grid-cols-2">
                {visibleTemplates.map(renderTemplateCard)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="text-muted-foreground" />
                Approval Gates
              </CardTitle>
              <CardDescription>External writes remain human-gated</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {marketingWorkflowTemplates.filter(requiresMarketingApproval).map((template) => (
                <div key={template.key} className="rounded-lg border bg-background p-3">
                  <div className="font-medium text-foreground">{template.title}</div>
                  <div className="mt-1 text-muted-foreground">{template.approvalGate}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <PlugZap className="text-muted-foreground" />
                Integration Needs
              </CardTitle>
              <CardDescription>Connectors these loops depend on</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {requiredConnections.map((connection) => (
                  <Badge key={connection} variant="outline">
                    {formatConnectionLabel(connection)}
                  </Badge>
                ))}
              </div>
              <div className="rounded-lg border bg-background p-3 text-muted-foreground">
                Missing or miswired connectors should create blocker findings instead of silent zero-data reports.
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/integrations">
                  Review integrations
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="text-muted-foreground" />
                Finding Contract
              </CardTitle>
              <CardDescription>Every loop must leave durable evidence</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="rounded-lg border bg-background p-3">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Artifact</div>
                <div className="mt-1 break-words text-foreground">{marketingWorkflowFindingContract.findingPathPattern}</div>
              </div>
              <div className="rounded-lg border bg-background p-3 text-muted-foreground">
                {marketingWorkflowFindingContract.blocker}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="text-muted-foreground" />
                Build Evidence
              </CardTitle>
              <CardDescription>Reference docs behind this surface</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/docs?file=projects/briefs/magister-replication/workflow-templates.md">
                  Workflow teardown
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

      {isLoading && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Loading workflow mappings from scheduled jobs...
        </div>
      )}

      <div className="flex justify-end">
        <Button asChild>
          <Link href="/cron">
            <PlayCircle data-icon="inline-start" />
            Open scheduled runs
          </Link>
        </Button>
      </div>

      <CreateJobPanel />
    </div>
  );
}
