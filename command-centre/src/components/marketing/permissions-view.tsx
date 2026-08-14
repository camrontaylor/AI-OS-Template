"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  RefreshCw,
  ShieldAlert,
  WalletCards,
  XCircle,
} from "lucide-react";
import { getApprovalRequestDisplay } from "@/lib/approval-request-format";
import {
  classifyPermissionGate,
  getPermissionGateLabel,
  getPermissionModeProfile,
  permissionGates,
  type PermissionGateKey,
} from "@/lib/marketing-permissions";
import { useClientStore } from "@/store/client-store";
import { useTaskStore } from "@/store/task-store";
import type { ApprovalDecision, ApprovalRequestWithTask } from "@/types/approval";
import type { Task } from "@/types/task";
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
import { Skeleton } from "@/components/ui/skeleton";

function formatAge(iso: string | null): string {
  if (!iso) return "n/a";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "n/a";
  const diffMs = Date.now() - time;
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function isWaitingPermissionTask(task: Task): boolean {
  const text = [task.title, task.description, task.activityLabel, task.errorMessage].filter(Boolean).join("\n");
  return (
    task.status !== "done" &&
    (
      task.needsInput ||
      /\b(permission|approval|approve|denied|blocked|needs input)\b/i.test(text)
    )
  );
}

function isHighRiskTask(task: Task): boolean {
  if (task.status === "done") return false;
  const activeProfile = getPermissionModeProfile(task.permissionMode);
  const executionProfile = getPermissionModeProfile(task.executionPermissionMode ?? task.permissionMode);
  return activeProfile.risk === "high" || executionProfile.risk === "high";
}

function gateCounts(requests: ApprovalRequestWithTask[]): Record<PermissionGateKey, number> {
  return requests.reduce((counts, request) => {
    const key = classifyPermissionGate(request);
    return {
      ...counts,
      [key]: (counts[key] ?? 0) + 1,
    };
  }, {} as Record<PermissionGateKey, number>);
}

function ApprovalRequestCard({
  request,
  resolving,
  onResolve,
  onOpenTask,
}: {
  request: ApprovalRequestWithTask;
  resolving: boolean;
  onResolve: (request: ApprovalRequestWithTask, decision: ApprovalDecision) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const display = getApprovalRequestDisplay(request);
  const gate = classifyPermissionGate(request);

  return (
    <div className="rounded-lg border bg-background">
      <div className="p-4 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{getPermissionGateLabel(gate)}</Badge>
              <Badge variant="outline">{request.toolName}</Badge>
              <Badge variant="outline">{formatAge(request.createdAt)}</Badge>
            </div>
            <CardTitle className="text-base leading-snug">{display.summary}</CardTitle>
            <CardDescription>
              {request.taskTitle ?? request.taskId}
              {request.taskProjectSlug ? ` / ${request.taskProjectSlug}` : ""}
            </CardDescription>
          </div>
          <Badge variant={request.status === "pending" ? "destructive" : "outline"}>
            {request.status}
          </Badge>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {display.detailText && (
          <div className="rounded-lg border bg-background p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {display.detailLabel ?? "Input"}
            </div>
            <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
              {display.detailText}
            </pre>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenTask(request.taskId)}>
            <FileText data-icon="inline-start" />
            Open task
          </Button>
          {request.status === "pending" && (
            <>
              <Button size="sm" onClick={() => onResolve(request, "allow_once")} disabled={resolving}>
                Approve once
              </Button>
              <Button variant="outline" size="sm" onClick={() => onResolve(request, "allow_for_task")} disabled={resolving}>
                Approve for task
              </Button>
              <Button variant="destructive" size="sm" onClick={() => onResolve(request, "deny")} disabled={resolving}>
                Deny
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PermissionsView() {
  const [requests, setRequests] = useState<ApprovalRequestWithTask[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const selectedClientId = useClientStore((s) => s.selectedClientId);
  const tasks = useTaskStore((s) => s.tasks);
  const tasksLoading = useTaskStore((s) => s.isLoading);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const openPanel = useTaskStore((s) => s.openPanel);

  const fetchRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    setRequestError(null);
    try {
      const res = await fetch("/api/approval-requests?limit=100");
      if (!res.ok) throw new Error("Failed to fetch approval requests");
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unknown approval queue error");
    } finally {
      setIsLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
    void fetchRequests();
  }, [fetchRequests, fetchTasks, selectedClientId]);

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests],
  );
  const resolvedRequests = useMemo(
    () => requests.filter((request) => request.status !== "pending").slice(0, 8),
    [requests],
  );
  const pendingCounts = useMemo(() => gateCounts(pendingRequests), [pendingRequests]);
  const waitingTasks = useMemo(
    () => tasks.filter(isWaitingPermissionTask).slice(0, 8),
    [tasks],
  );
  const highRiskTasks = useMemo(
    () => tasks.filter(isHighRiskTask).slice(0, 8),
    [tasks],
  );
  const isLoading = isLoadingRequests || tasksLoading;
  const gateCoverage = Math.min(100, Math.round((permissionGates.length / 7) * 100));

  const resolveRequest = useCallback(async (request: ApprovalRequestWithTask, decision: ApprovalDecision) => {
    setResolvingId(request.id);
    try {
      const res = await fetch(`/api/tasks/${request.taskId}/approval-requests/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error("Failed to resolve approval request");
      await Promise.all([fetchRequests(), fetchTasks()]);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unknown approval decision error");
    } finally {
      setResolvingId(null);
    }
  }, [fetchRequests, fetchTasks]);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Permission Control
              </p>
              <h1 className="m-0 text-2xl font-semibold tracking-normal text-foreground">
                External action gates
              </h1>
              <p className="m-0 mt-2 max-w-3xl text-sm text-muted-foreground">
                Pending approvals, high-risk execution modes, publishing gates, destructive actions, and account-change protections.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { void fetchTasks(); void fetchRequests(); }}>
                <RefreshCw data-icon="inline-start" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings">
                  Settings
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{pendingRequests.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">Pending approvals</div>
                <Progress value={pendingRequests.length ? 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{waitingTasks.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">Waiting tasks</div>
                <Progress value={tasks.length ? (waitingTasks.length / tasks.length) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{highRiskTasks.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">Full-auto tasks</div>
                <Progress value={tasks.length ? (highRiskTasks.length / tasks.length) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{gateCoverage}%</div>
                <div className="mt-1 text-xs text-muted-foreground">Gate model</div>
                <Progress value={gateCoverage} className="mt-3" />
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <WalletCards className="text-muted-foreground" />
              Account Upgrade Lock
            </CardTitle>
            <CardDescription>Billing and account changes are never automatic</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="rounded-lg border bg-background p-3">
              <div className="font-medium text-foreground">Magister account</div>
              <div className="mt-1 text-muted-foreground">Do not upgrade the account. Any upgrade, plan, billing, or spend request routes to the paid spend and accounts gate.</div>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <div className="font-medium text-foreground">Ad platforms</div>
              <div className="mt-1 text-muted-foreground">Campaign drafts can be created paused; activation is a separate approval.</div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="text-muted-foreground" />
                Pending Queue
              </CardTitle>
              <CardDescription>Requests that can unblock a running or waiting task</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {isLoading && (
                <>
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-28 w-full" />
                </>
              )}
              {requestError && (
                <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                  {requestError}
                </div>
              )}
              {!isLoading && pendingRequests.length === 0 && (
                <div className="flex items-start gap-3 rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-muted-foreground" />
                  No pending approval requests.
                </div>
              )}
              {!isLoading && pendingRequests.map((request) => (
                <ApprovalRequestCard
                  key={request.id}
                  request={request}
                  resolving={resolvingId === request.id}
                  onResolve={resolveRequest}
                  onOpenTask={openPanel}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock3 className="text-muted-foreground" />
                Recently Resolved
              </CardTitle>
              <CardDescription>Approval history from the local request ledger</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {resolvedRequests.length === 0 ? (
                <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                  No resolved approvals in the latest queue window.
                </div>
              ) : (
                resolvedRequests.map((request) => {
                  const display = getApprovalRequestDisplay(request);
                  const gate = classifyPermissionGate(request);
                  return (
                    <div key={request.id} className="rounded-lg border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{getPermissionGateLabel(gate)}</Badge>
                            <Badge variant={request.status === "denied" ? "destructive" : "outline"}>
                              {request.decisionMessage ?? request.status}
                            </Badge>
                          </div>
                          <div className="mt-2 truncate text-sm font-medium text-foreground">{display.summary}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {request.taskTitle ?? request.taskId} / resolved {formatAge(request.resolvedAt)}
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => openPanel(request.taskId)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Seven Gates</CardTitle>
              <CardDescription>Magister-style categories mapped to local approvals</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {permissionGates.map((gate) => (
                <div key={gate.key} className="rounded-lg border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{gate.title}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{gate.policy}</div>
                    </div>
                    <Badge variant={pendingCounts[gate.key] ? "destructive" : "outline"}>
                      {pendingCounts[gate.key] ?? 0}
                    </Badge>
                  </div>
                  <Separator className="my-3" />
                  <div className="text-xs leading-5 text-muted-foreground">{gate.proof}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Waiting Tasks</CardTitle>
              <CardDescription>Tasks that look blocked on input or permission</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {waitingTasks.length === 0 ? (
                <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                  No task is currently waiting on permission.
                </div>
              ) : (
                waitingTasks.map((task) => (
                  <div key={task.id} className="rounded-lg border bg-background p-3">
                    <div className="truncate text-sm font-medium text-foreground">{task.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{task.activityLabel ?? task.errorMessage ?? task.status}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">{task.status}</Badge>
                      <Button variant="outline" size="sm" onClick={() => openPanel(task.id)}>
                        Open
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <XCircle className="text-muted-foreground" />
                High-Risk Modes
              </CardTitle>
              <CardDescription>Full-auto work should be intentional</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {highRiskTasks.length === 0 ? (
                <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                  No open task is currently in full-auto mode.
                </div>
              ) : (
                highRiskTasks.map((task) => {
                  const profile = getPermissionModeProfile(task.executionPermissionMode ?? task.permissionMode);
                  return (
                    <div key={task.id} className="rounded-lg border bg-background p-3">
                      <div className="truncate text-sm font-medium text-foreground">{task.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{profile.detail}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="destructive">{profile.label}</Badge>
                        <Button variant="outline" size="sm" onClick={() => openPanel(task.id)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}
