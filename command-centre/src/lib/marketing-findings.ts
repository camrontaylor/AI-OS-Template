import crypto from "crypto";
import type Database from "better-sqlite3";
import type {
  AuditChannel,
  AuditChannelKey,
  GeoCheck,
  MarketingAnalyticsSnapshot,
  PlanItem,
  VisibilityPrompt,
} from "@/lib/marketing-analytics";

export type MarketingFindingType =
  | "audit_finding"
  | "opportunity"
  | "geo_check"
  | "prompt_visibility"
  | "plan_task"
  | "workflow"
  | "tracker_checkin"
  | "blocker";

export type MarketingFindingStatus =
  | "open"
  | "materialized"
  | "blocked"
  | "verified"
  | "consumed"
  | "dismissed";

export type MarketingFindingSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

export interface MarketingFinding {
  id: string;
  source: string;
  sourceId: string;
  idempotencyKey: string;
  findingType: MarketingFindingType;
  status: MarketingFindingStatus;
  severity: MarketingFindingSeverity;
  channel: string;
  headline: string;
  summary: string;
  occurredAt: string;
  evidenceRefs: string[];
  artifactRefs: string[];
  verification: Array<Record<string, unknown>>;
  blocker: Record<string, unknown> | null;
  keyMetrics: Record<string, unknown>;
  planTaskDraftId: string | null;
  taskId: string | null;
  clientId: string | null;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingFindingInput
  extends Omit<MarketingFinding, "id" | "createdAt" | "updatedAt" | "consumedAt"> {
  id?: string;
  consumedAt?: string | null;
}

export interface MarketingFindingListOptions {
  status?: MarketingFindingStatus;
  channel?: string;
  source?: string;
  clientId?: string | null;
  since?: string;
  unconsumedOnly?: boolean;
  limit?: number;
}

export interface MarketingFindingUpsertResult {
  inserted: number;
  updated: number;
  rows: MarketingFinding[];
}

export interface CronRunBlockerFindingInput {
  jobSlug: string;
  jobName?: string | null;
  runId?: number | string | null;
  taskId?: string | null;
  clientId?: string | null;
  result: "failure" | "timeout";
  exitCode?: number | null;
  completionReason?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt: string;
  durationSec?: number | null;
  trigger?: string | null;
  scheduledFor?: string | null;
  channel?: string | null;
}

const channelKeyToFindingChannel: Record<AuditChannelKey, string> = {
  ai_visibility: "ai_visibility",
  geo: "geo",
  seo: "seo",
  website_content: "website_content",
  social_media: "social_media",
  paid_ads: "paid_ads",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableId(source: string, idempotencyKey: string): string {
  const digest = crypto
    .createHash("sha1")
    .update(`${source}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 16);
  return `mf_${digest}`;
}

function auditOccurredAt(snapshot: MarketingAnalyticsSnapshot): string {
  if (!snapshot.auditDate) return new Date(0).toISOString();
  const date = new Date(`${snapshot.auditDate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function sourceId(snapshot: MarketingAnalyticsSnapshot): string {
  return snapshot.sourceAuditId ?? `audit:${snapshot.auditDate ?? "unknown"}`;
}

function artifactRefs(snapshot: MarketingAnalyticsSnapshot): string[] {
  return [`artifact:${snapshot.sources.auditFile}`];
}

function planArtifactRefs(snapshot: MarketingAnalyticsSnapshot): string[] {
  return [`artifact:${snapshot.sources.planFile}`, `artifact:${snapshot.sources.auditFile}`];
}

function splitHeadline(text: string): { headline: string; summary: string } {
  const [headlinePart, ...summaryParts] = text.split(/\s+—\s+/);
  const headline = (headlinePart || text).trim().slice(0, 200);
  const summary = (summaryParts.join(" — ").trim() || text.trim()).slice(0, 1000);
  return { headline, summary };
}

function auditSeverity(channel: AuditChannel, text: string): MarketingFindingSeverity {
  if (/llms\.txt/i.test(text)) return "high";
  if (/low search volume/i.test(text)) return "medium";
  if (channel.readiness <= 0) return "high";
  if (channel.readiness < 50) return "medium";
  return "low";
}

function opportunitySeverity(channel: AuditChannel): MarketingFindingSeverity {
  return channel.key === "seo" ? "high" : "medium";
}

function checkSeverity(check: GeoCheck): MarketingFindingSeverity {
  return check.status === "fail" ? "high" : "low";
}

function planTaskDraftId(item: PlanItem): string {
  return `magister-plan:${slugify(item.title)}`;
}

function normalizeReason(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function defaultCronBlockerReason(input: CronRunBlockerFindingInput): string {
  if (input.completionReason === "needs_input") {
    return "The scheduled workflow stopped because it needs operator input.";
  }
  if (input.result === "timeout") {
    return "The scheduled workflow exceeded its timeout before completing.";
  }
  if (input.exitCode !== null && input.exitCode !== undefined) {
    return `The scheduled workflow exited with code ${input.exitCode}.`;
  }
  return "The scheduled workflow failed before completing.";
}

function cronBlockerIdempotencyKey(input: CronRunBlockerFindingInput): string {
  const runKey = input.runId ?? input.taskId ?? input.startedAt ?? input.completedAt;
  return `cron:${input.jobSlug}:${runKey}`;
}

export function buildCronRunBlockerFinding(
  input: CronRunBlockerFindingInput,
): MarketingFindingInput {
  const jobName = normalizeReason(input.jobName) || input.jobSlug;
  const reason = normalizeReason(input.errorMessage) || defaultCronBlockerReason(input);
  const idempotencyKey = cronBlockerIdempotencyKey(input);
  const retryable = input.completionReason !== "needs_input";

  return {
    id: stableId("cron-run", idempotencyKey),
    source: "cron-run",
    sourceId: `${input.jobSlug}:${input.runId ?? input.taskId ?? "unknown"}`,
    idempotencyKey,
    findingType: "blocker",
    status: "blocked",
    severity: "high",
    channel: input.channel || "scheduled_workflows",
    headline: `Scheduled workflow blocked: ${jobName}`.slice(0, 200),
    summary: reason.slice(0, 1000),
    occurredAt: input.completedAt,
    evidenceRefs: [
      `cron-job:${input.jobSlug}`,
      ...(input.runId !== null && input.runId !== undefined ? [`cron-run:${input.runId}`] : []),
      ...(input.taskId ? [`task:${input.taskId}`] : []),
    ],
    artifactRefs: [],
    verification: [],
    blocker: {
      code: `cron_${input.completionReason || input.result}`,
      reason,
      retryable,
      owner: retryable ? "automation" : "operator",
      nextStep: retryable
        ? "Inspect the run log, fix the cause, then rerun the scheduled workflow."
        : "Review the task and answer the pending question before rerunning.",
    },
    keyMetrics: {
      result: input.result,
      exitCode: input.exitCode ?? null,
      completionReason: input.completionReason ?? null,
      durationSec: input.durationSec ?? null,
      trigger: input.trigger ?? null,
      scheduledFor: input.scheduledFor ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt,
    },
    planTaskDraftId: null,
    taskId: input.taskId ?? null,
    clientId: input.clientId ?? null,
  };
}

function baseFinding({
  snapshot,
  source,
  idempotencyKey,
  findingType,
  status,
  severity,
  channel,
  headline,
  summary,
  evidenceRefs,
  artifactRefs: refs = artifactRefs(snapshot),
  keyMetrics,
  planTaskDraftId = null,
}: {
  snapshot: MarketingAnalyticsSnapshot;
  source: string;
  idempotencyKey: string;
  findingType: MarketingFindingType;
  status: MarketingFindingStatus;
  severity: MarketingFindingSeverity;
  channel: string;
  headline: string;
  summary: string;
  evidenceRefs: string[];
  artifactRefs?: string[];
  keyMetrics: Record<string, unknown>;
  planTaskDraftId?: string | null;
}): MarketingFindingInput {
  return {
    id: stableId(source, idempotencyKey),
    source,
    sourceId: sourceId(snapshot),
    idempotencyKey,
    findingType,
    status,
    severity,
    channel,
    headline: headline.slice(0, 200),
    summary,
    occurredAt: auditOccurredAt(snapshot),
    evidenceRefs,
    artifactRefs: refs,
    verification: [],
    blocker: null,
    keyMetrics,
    planTaskDraftId,
    taskId: null,
    clientId: null,
  };
}

function findingFromChannelItem({
  snapshot,
  channel,
  text,
  index,
  findingType,
}: {
  snapshot: MarketingAnalyticsSnapshot;
  channel: AuditChannel;
  text: string;
  index: number;
  findingType: "audit_finding" | "opportunity";
}): MarketingFindingInput {
  const { headline, summary } = splitHeadline(text);
  const source = "magister-audit";
  const findingChannel = channelKeyToFindingChannel[channel.key];
  return baseFinding({
    snapshot,
    source,
    idempotencyKey: `${sourceId(snapshot)}:${channel.key}:${findingType}:${index}:${slugify(headline)}`,
    findingType,
    status: "open",
    severity: findingType === "opportunity" ? opportunitySeverity(channel) : auditSeverity(channel, text),
    channel: findingChannel,
    headline,
    summary,
    evidenceRefs: [`artifact:${snapshot.sources.auditFile}`, `audit-channel:${channel.title}`],
    keyMetrics: {
      readiness: channel.readiness,
      projected: channel.projected,
    },
  });
}

function findingFromGeoCheck(
  snapshot: MarketingAnalyticsSnapshot,
  check: GeoCheck,
): MarketingFindingInput | null {
  if (check.status !== "fail") return null;
  return baseFinding({
    snapshot,
    source: "magister-audit",
    idempotencyKey: `${sourceId(snapshot)}:geo-check:${check.group}:${slugify(check.label)}`,
    findingType: "geo_check",
    status: "open",
    severity: checkSeverity(check),
    channel: "geo",
    headline: check.label,
    summary: check.detail,
    evidenceRefs: [`artifact:${snapshot.sources.auditFile}`, `geo-check:${check.group}:${check.label}`],
    keyMetrics: {
      status: check.status,
      group: check.group,
    },
  });
}

function findingFromPrompt(
  snapshot: MarketingAnalyticsSnapshot,
  channel: AuditChannel,
  prompt: VisibilityPrompt,
): MarketingFindingInput | null {
  if (!/not mentioned/i.test(prompt.status)) return null;
  return baseFinding({
    snapshot,
    source: "magister-audit",
    idempotencyKey: `${sourceId(snapshot)}:prompt:${prompt.source}:${slugify(prompt.prompt)}`,
    findingType: "prompt_visibility",
    status: "open",
    severity: "high",
    channel: "ai_visibility",
    headline: `Not visible for "${prompt.prompt}"`,
    summary: `${prompt.source} reported ${prompt.status}.`,
    evidenceRefs: [`artifact:${snapshot.sources.auditFile}`, `prompt:${prompt.source}:${prompt.prompt}`],
    keyMetrics: {
      score: prompt.score,
      readiness: channel.readiness,
    },
  });
}

function findingFromPlanTask(
  snapshot: MarketingAnalyticsSnapshot,
  item: PlanItem,
): MarketingFindingInput {
  return baseFinding({
    snapshot,
    source: "magister-plan",
    idempotencyKey: `${sourceId(snapshot)}:plan-task:${slugify(item.title)}`,
    findingType: "plan_task",
    status: "materialized",
    severity: item.status === "ready" ? "medium" : "low",
    channel: slugify(item.channel ?? "unknown").replace(/-/g, "_"),
    headline: item.title,
    summary: item.expectedImpact ?? item.prompt ?? "Plan task compiled from Magister audit evidence.",
    evidenceRefs: [
      `artifact:${snapshot.sources.planFile}`,
      ...item.evidence.map((entry) => `plan-evidence:${entry}`),
    ],
    artifactRefs: planArtifactRefs(snapshot),
    keyMetrics: {
      status: item.status,
      phase: item.phase,
      stage: item.stage,
      due: item.due,
      approval: item.approval,
      estimated_paid_spend: item.estimatedPaidSpend ?? "$0/month",
    },
    planTaskDraftId: planTaskDraftId(item),
  });
}

export function compileMarketingFindingsFromSnapshot(
  snapshot: MarketingAnalyticsSnapshot,
): MarketingFindingInput[] {
  const rows: MarketingFindingInput[] = [];

  for (const channel of snapshot.channels) {
    channel.findings.forEach((finding, index) => {
      rows.push(findingFromChannelItem({
        snapshot,
        channel,
        text: finding.text,
        index,
        findingType: "audit_finding",
      }));
    });
    channel.opportunities.forEach((opportunity, index) => {
      rows.push(findingFromChannelItem({
        snapshot,
        channel,
        text: opportunity.text,
        index,
        findingType: "opportunity",
      }));
    });
    channel.prompts.forEach((prompt) => {
      const finding = findingFromPrompt(snapshot, channel, prompt);
      if (finding) rows.push(finding);
    });
  }

  for (const check of snapshot.geoChecks) {
    const finding = findingFromGeoCheck(snapshot, check);
    if (finding) rows.push(finding);
  }

  for (const item of snapshot.planItems) {
    rows.push(findingFromPlanTask(snapshot, item));
  }

  return rows;
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function decodeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toFinding(row: Record<string, unknown>): MarketingFinding {
  return {
    id: String(row.id),
    source: String(row.source),
    sourceId: String(row.sourceId),
    idempotencyKey: String(row.idempotencyKey),
    findingType: row.findingType as MarketingFindingType,
    status: row.status as MarketingFindingStatus,
    severity: row.severity as MarketingFindingSeverity,
    channel: String(row.channel),
    headline: String(row.headline),
    summary: String(row.summary),
    occurredAt: String(row.occurredAt),
    evidenceRefs: decodeJson(String(row.evidenceRefs), []),
    artifactRefs: decodeJson(String(row.artifactRefs), []),
    verification: decodeJson(String(row.verificationJson), []),
    blocker: decodeJson<Record<string, unknown> | null>(row.blockerJson as string | null, null),
    keyMetrics: decodeJson<Record<string, unknown>>(String(row.keyMetricsJson), {}),
    planTaskDraftId: (row.planTaskDraftId as string | null) ?? null,
    taskId: (row.taskId as string | null) ?? null,
    clientId: (row.clientId as string | null) ?? null,
    consumedAt: (row.consumedAt as string | null) ?? null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function normalizeLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) return 50;
  return Math.min(500, Math.floor(value));
}

export function upsertMarketingFindings(
  database: Database.Database,
  inputs: MarketingFindingInput[],
): MarketingFindingUpsertResult {
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  const selectExisting = database.prepare(
    "SELECT id FROM marketing_findings WHERE source = ? AND idempotencyKey = ?",
  );
  const upsert = database.prepare(`
    INSERT INTO marketing_findings (
      id, source, sourceId, idempotencyKey, findingType, status, severity, channel,
      headline, summary, occurredAt, evidenceRefs, artifactRefs, verificationJson,
      blockerJson, keyMetricsJson, planTaskDraftId, taskId, clientId, consumedAt,
      createdAt, updatedAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, idempotencyKey) DO UPDATE SET
      sourceId = excluded.sourceId,
      findingType = excluded.findingType,
      status = excluded.status,
      severity = excluded.severity,
      channel = excluded.channel,
      headline = excluded.headline,
      summary = excluded.summary,
      occurredAt = excluded.occurredAt,
      evidenceRefs = excluded.evidenceRefs,
      artifactRefs = excluded.artifactRefs,
      verificationJson = excluded.verificationJson,
      blockerJson = excluded.blockerJson,
      keyMetricsJson = excluded.keyMetricsJson,
      planTaskDraftId = excluded.planTaskDraftId,
      taskId = COALESCE(marketing_findings.taskId, excluded.taskId),
      clientId = excluded.clientId,
      consumedAt = marketing_findings.consumedAt,
      updatedAt = excluded.updatedAt
  `);

  const tx = database.transaction((rows: MarketingFindingInput[]) => {
    for (const input of rows) {
      const id = input.id ?? stableId(input.source, input.idempotencyKey);
      const existing = selectExisting.get(input.source, input.idempotencyKey);
      upsert.run(
        id,
        input.source,
        input.sourceId,
        input.idempotencyKey,
        input.findingType,
        input.status,
        input.severity,
        input.channel,
        input.headline,
        input.summary,
        input.occurredAt,
        encodeJson(input.evidenceRefs),
        encodeJson(input.artifactRefs),
        encodeJson(input.verification),
        input.blocker ? encodeJson(input.blocker) : null,
        encodeJson(input.keyMetrics),
        input.planTaskDraftId,
        input.taskId,
        input.clientId,
        input.consumedAt ?? null,
        now,
        now,
      );
      if (existing) updated += 1;
      else inserted += 1;
    }
  });

  tx(inputs);

  return {
    inserted,
    updated,
    rows: listMarketingFindings(database, { limit: Math.max(inputs.length, 1) }),
  };
}

export function listMarketingFindings(
  database: Database.Database,
  options: MarketingFindingListOptions = {},
): MarketingFinding[] {
  const where: string[] = [];
  const args: unknown[] = [];

  if (options.status) {
    where.push("status = ?");
    args.push(options.status);
  }
  if (options.channel) {
    where.push("channel = ?");
    args.push(options.channel);
  }
  if (options.source) {
    where.push("source = ?");
    args.push(options.source);
  }
  if (options.clientId !== undefined) {
    if (options.clientId === null) {
      where.push("clientId IS NULL");
    } else {
      where.push("clientId = ?");
      args.push(options.clientId);
    }
  }
  if (options.since) {
    where.push("occurredAt >= ?");
    args.push(options.since);
  }
  if (options.unconsumedOnly) {
    where.push("consumedAt IS NULL");
  }

  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = database
    .prepare(
      `SELECT * FROM marketing_findings
       ${clause}
       ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        occurredAt DESC,
        headline ASC
       LIMIT ?`,
    )
    .all(...args, normalizeLimit(options.limit)) as Array<Record<string, unknown>>;

  return rows.map(toFinding);
}

export function syncMarketingFindingsFromSnapshot(
  database: Database.Database,
  snapshot: MarketingAnalyticsSnapshot,
): MarketingFindingUpsertResult {
  return upsertMarketingFindings(database, compileMarketingFindingsFromSnapshot(snapshot));
}

export function recordMarketingBlockerFinding(
  database: Database.Database,
  input: CronRunBlockerFindingInput,
): MarketingFindingUpsertResult {
  return upsertMarketingFindings(database, [buildCronRunBlockerFinding(input)]);
}

export function getMarketingFindingsSummary(rows: MarketingFinding[]) {
  return {
    total: rows.length,
    open: rows.filter((row) => row.status === "open").length,
    materialized: rows.filter((row) => row.status === "materialized").length,
    blocked: rows.filter((row) => row.status === "blocked").length,
    high: rows.filter((row) => row.severity === "high" || row.severity === "critical").length,
    unconsumed: rows.filter((row) => row.consumedAt === null).length,
  };
}
