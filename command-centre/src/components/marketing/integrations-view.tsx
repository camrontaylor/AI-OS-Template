"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import {
  buildMarketingIntegrationStatuses,
  getIntegrationSummary,
  getReadinessLabel,
  type ConnectorsData,
  type IntegrationGate,
  type IntegrationReadiness,
  type MarketingIntegrationStatus,
} from "@/lib/marketing-integrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const groupOrder = ["All", "Operations", "Research", "Analytics", "Publishing", "Acquisition", "CRM", "Creative"];

const gateLabel: Record<IntegrationGate, string> = {
  "read-only": "Read-only",
  email: "Email gate",
  social: "Social gate",
  content: "Content gate",
  spend: "Spend gate",
  code: "Code gate",
  external: "External gate",
};

function readinessVariant(readiness: IntegrationReadiness): "default" | "secondary" | "destructive" | "outline" {
  switch (readiness) {
    case "ready":
    case "native":
      return "secondary";
    case "partial":
      return "default";
    case "reconnect":
    case "missing":
      return "destructive";
  }
}

function readinessDetail(row: MarketingIntegrationStatus): string {
  switch (row.readiness) {
    case "ready":
      return "Required signals are connected.";
    case "native":
      return "Covered by local AI-OS runtime.";
    case "partial":
      return "Some capability exists, but at least one required signal is missing or disconnected.";
    case "reconnect":
      return "The documented account exists but needs re-authorization before use.";
    case "missing":
      return "No current configured signal was found.";
  }
}

function uniqueGroups(rows: MarketingIntegrationStatus[]): string[] {
  const present = new Set(rows.map((row) => row.group));
  return groupOrder.filter((group) => group === "All" || present.has(group));
}

function IntegrationRow({ row }: { row: MarketingIntegrationStatus }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-base font-semibold text-foreground">{row.title}</h2>
            <Badge variant={readinessVariant(row.readiness)}>{getReadinessLabel(row.readiness)}</Badge>
            <Badge variant="outline">{gateLabel[row.gate]}</Badge>
          </div>
          <p className="m-0 mt-1 text-sm text-muted-foreground">{row.localPath}</p>
        </div>
        {row.readiness === "ready" || row.readiness === "native" ? (
          <CheckCircle2 className="shrink-0 text-muted-foreground" />
        ) : (
          <CircleDashed className="shrink-0 text-muted-foreground" />
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Magister pattern</div>
            <p className="m-0 mt-1 text-sm leading-6 text-foreground">{row.magisterPattern}</p>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Draft rule</div>
            <p className="m-0 mt-1 text-sm leading-6 text-muted-foreground">{row.draftRule}</p>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Readiness</div>
            <span className="text-sm font-medium text-foreground">{row.readinessPercent}%</span>
          </div>
          <Progress value={row.readinessPercent} className="mt-3" />
          <p className="m-0 mt-3 text-xs leading-5 text-muted-foreground">{readinessDetail(row)}</p>
        </div>
      </div>

      <Separator className="my-4" />

      <div className="grid gap-3 md:grid-cols-2">
        {row.checkStatuses.map((check) => (
          <div key={check.label} className="rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">{check.label}</div>
              <Badge variant={check.satisfied ? "secondary" : check.reconnectSignals.length ? "destructive" : "outline"}>
                {check.satisfied ? "Found" : check.reconnectSignals.length ? "Reconnect" : "Missing"}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {check.matchedSignals.map((signal) => (
                <Badge key={`match:${check.label}:${signal}`} variant="secondary">{signal}</Badge>
              ))}
              {!check.satisfied && check.reconnectSignals.map((signal) => (
                <Badge key={`reconnect:${check.label}:${signal}`} variant="destructive">{signal}</Badge>
              ))}
              {!check.satisfied && check.reconnectSignals.length === 0 && check.missingSignals.map((signal) => (
                <Badge key={`missing:${check.label}:${signal}`} variant="outline">{signal}</Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RawConnectorEvidence({ data }: { data: ConnectorsData }) {
  return (
    <Card className="rounded-lg shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="text-muted-foreground" />
          Raw Connector Evidence
        </CardTitle>
        <CardDescription>Read-only inventory from `.mcp.json`, `.env.example`, and `docs/connectors.md`</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">MCP servers</div>
            <Badge variant="outline">{data.mcpServers.length}</Badge>
          </div>
          {data.mcpServers.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">No repo-scoped MCP servers found.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.mcpServers.map((server) => (
                <div key={`${server.source}:${server.name}`} className="rounded-lg border bg-background p-3">
                  <div className="truncate text-sm font-medium text-foreground">{server.name}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{server.command || server.source}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">Keyed services</div>
            <Badge variant="outline">{data.configuredCount} / {data.services.length}</Badge>
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border">
            {data.services.map((service) => (
              <div key={service.key} className="flex items-center gap-3 border-b bg-background px-3 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{service.service}</div>
                  <div className="truncate text-xs text-muted-foreground">{service.usedBy || service.key}</div>
                </div>
                <Badge variant={service.configured ? "secondary" : "outline"}>
                  {service.configured ? "Configured" : "Missing"}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">Composio snapshot</div>
            <Badge variant="outline">{data.composio?.updatedAt ?? "undated"}</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border bg-background p-3">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Active</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(data.composio?.active ?? []).map((toolkit) => (
                  <Badge key={`active:${toolkit}`} variant="secondary">{toolkit}</Badge>
                ))}
              </div>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Needs reconnect</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(data.composio?.needsReconnect ?? []).map((toolkit) => (
                  <Badge key={`reconnect:${toolkit}`} variant="outline">{toolkit}</Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function IntegrationsView() {
  const [data, setData] = useState<ConnectorsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/connectors");
      if (!res.ok) throw new Error("Failed to load connector inventory");
      const payload = await res.json();
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown connector inventory error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConnectors();
  }, [fetchConnectors]);

  const rows = useMemo(
    () => data ? buildMarketingIntegrationStatuses(data) : [],
    [data],
  );
  const summary = useMemo(() => getIntegrationSummary(rows), [rows]);
  const groups = useMemo(() => uniqueGroups(rows), [rows]);
  const writableRows = rows.filter((row) => row.gate !== "read-only");
  const blockedRows = rows.filter((row) => row.readiness === "reconnect" || row.readiness === "missing");

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        {error ?? "Connector inventory is unavailable."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Integration Control Plane
              </p>
              <h1 className="m-0 text-2xl font-semibold tracking-normal text-foreground">
                Marketing connection map
              </h1>
              <p className="m-0 mt-2 max-w-3xl text-sm text-muted-foreground">
                Magister-style capabilities mapped to AI-OS connectors, Composio accounts, local runtime, and approval gates.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { void fetchConnectors(); }}>
                <RefreshCw data-icon="inline-start" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/permissions">
                  Permissions
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{summary.ready}</div>
                <div className="mt-1 text-xs text-muted-foreground">Ready or native</div>
                <Progress value={summary.total ? (summary.ready / summary.total) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{summary.partial}</div>
                <div className="mt-1 text-xs text-muted-foreground">Partial</div>
                <Progress value={summary.total ? (summary.partial / summary.total) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{summary.reconnect + summary.missing}</div>
                <div className="mt-1 text-xs text-muted-foreground">Blocked</div>
                <Progress value={summary.total ? ((summary.reconnect + summary.missing) / summary.total) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
            <Card className="gap-0 rounded-lg py-0 shadow-none">
              <CardContent className="p-4">
                <div className="text-3xl font-semibold text-foreground">{summary.gated}</div>
                <div className="mt-1 text-xs text-muted-foreground">Write-gated</div>
                <Progress value={summary.total ? (summary.gated / summary.total) * 100 : 0} className="mt-3" />
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="rounded-lg shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="text-muted-foreground" />
              Draft Before Live
            </CardTitle>
            <CardDescription>Publishing and account changes stay separated</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {[
              ["Social", "Draft locally first; schedule or publish only after approval."],
              ["Email", "Approve/send, edit/send, request rewrite, or reject."],
              ["Paid ads", "Campaigns stay paused. Budgets, billing, upgrades, and activation route to spend approval."],
            ].map(([label, detail]) => (
              <div key={label} className="rounded-lg border bg-background p-3">
                <div className="font-medium text-foreground">{label}</div>
                <div className="mt-1 text-muted-foreground">{detail}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Waypoints className="text-muted-foreground" />
                Capability Readiness
              </CardTitle>
              <CardDescription>Grouped by the marketing action each connector unlocks</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="All" className="gap-4">
                <TabsList className="flex h-auto w-full flex-wrap justify-start">
                  {groups.map((group) => (
                    <TabsTrigger key={group} value={group} className="flex-none">
                      {group}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {groups.map((group) => {
                  const visibleRows = group === "All" ? rows : rows.filter((row) => row.group === group);
                  return (
                    <TabsContent key={group} value={group} className="flex flex-col gap-3">
                      {visibleRows.map((row) => (
                        <IntegrationRow key={row.key} row={row} />
                      ))}
                    </TabsContent>
                  );
                })}
              </Tabs>
            </CardContent>
          </Card>

          <RawConnectorEvidence data={data} />
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Link2 className="text-muted-foreground" />
                External Write Gates
              </CardTitle>
              <CardDescription>Writable surfaces must route through permissions</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {writableRows.map((row) => (
                <div key={`gate:${row.key}`} className="rounded-lg border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{row.title}</div>
                    <Badge variant="outline">{gateLabel[row.gate]}</Badge>
                  </div>
                  <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">{row.draftRule}</p>
                </div>
              ))}
              <Button variant="outline" size="sm" asChild>
                <Link href="/permissions">
                  Review gates
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Needs Attention</CardTitle>
              <CardDescription>Reconnect or configure these before depending on live actions</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {blockedRows.length === 0 ? (
                <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                  No missing or reconnect-only surfaces in the current map.
                </div>
              ) : (
                blockedRows.map((row) => (
                  <div key={`blocked:${row.key}`} className="rounded-lg border bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-foreground">{row.title}</div>
                      <Badge variant={readinessVariant(row.readiness)}>{getReadinessLabel(row.readiness)}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.reconnectSignals.map((signal) => (
                        <Badge key={`blocked-reconnect:${row.key}:${signal}`} variant="destructive">{signal}</Badge>
                      ))}
                      {row.reconnectSignals.length === 0 && row.missingSignals.slice(0, 3).map((signal) => (
                        <Badge key={`blocked-missing:${row.key}:${signal}`} variant="outline">{signal}</Badge>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ExternalLink className="text-muted-foreground" />
                Source Docs
              </CardTitle>
              <CardDescription>Evidence behind this mapping</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/docs?file=docs/connectors.md">Connector map</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/docs?file=projects/briefs/magister-replication/what-magister-can-do.md">
                  Magister capabilities
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/docs?file=projects/briefs/magister-replication/magister-teardown.md">
                  Product teardown
                </Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}
