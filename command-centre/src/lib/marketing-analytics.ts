export type AuditChannelKey =
  | "ai_visibility"
  | "geo"
  | "seo"
  | "website_content"
  | "social_media"
  | "paid_ads";

export type CheckStatus = "pass" | "fail";

export interface AuditFinding {
  text: string;
}

export interface AuditOpportunity {
  text: string;
}

export interface GeoCheck {
  label: string;
  status: CheckStatus;
  detail: string;
  group: "geo" | "site";
}

export interface VisibilityPrompt {
  source: string;
  status: string;
  prompt: string;
  score: number | null;
}

export interface TrackedKeyword {
  keyword: string;
  status: string;
  volume: number | null;
}

export interface AuditChannel {
  key: AuditChannelKey;
  title: string;
  readiness: number;
  projected: number | null;
  summary: string;
  findings: AuditFinding[];
  opportunities: AuditOpportunity[];
  prompts: VisibilityPrompt[];
  geoChecks: GeoCheck[];
  keywords: TrackedKeyword[];
}

export interface PlanActivity {
  timestamp: string;
  event: string;
  detail: string;
}

export interface PlanItem {
  status: string;
  title: string;
  due: string | null;
  phase: string | null;
  stage: string | null;
  channel: string | null;
  workflow: string | null;
  approval: string | null;
  prompt: string | null;
  expectedImpact: string | null;
  estimatedPaidSpend: string | null;
  evidence: string[];
}

export interface AiVisibilityDimension {
  label: string;
  points: number;
  mode: "deterministic" | "graded";
  detail: string;
}

export interface MarketingAnalyticsSnapshot {
  auditDate: string | null;
  auditType: string | null;
  sourceAuditId: string | null;
  healthCurrent: number;
  healthProjected: number;
  channels: AuditChannel[];
  geoChecks: GeoCheck[];
  planItems: PlanItem[];
  activity: PlanActivity[];
  aiVisibilityDimensions: AiVisibilityDimension[];
  sources: {
    auditFile: string;
    planFile: string;
  };
}

const channelTitles: Record<AuditChannelKey, string> = {
  ai_visibility: "AI Visibility",
  geo: "GEO",
  seo: "SEO",
  website_content: "Website & Content",
  social_media: "Social Media",
  paid_ads: "Paid Ads",
};

const titleToKey: Record<string, AuditChannelKey> = Object.fromEntries(
  Object.entries(channelTitles).map(([key, title]) => [title, key]),
) as Record<string, AuditChannelKey>;

const projectedChannelScores: Record<AuditChannelKey, number> = {
  ai_visibility: 32,
  geo: 65,
  seo: 28,
  website_content: 100,
  social_media: 60,
  paid_ads: 60,
};

export const aiVisibilityDimensions: AiVisibilityDimension[] = [
  {
    label: "Visibility",
    points: 25,
    mode: "deterministic",
    detail: "Where the brand appears in the answer.",
  },
  {
    label: "Recommendation",
    points: 20,
    mode: "graded",
    detail: "What the answer ultimately recommends.",
  },
  {
    label: "Depth",
    points: 15,
    mode: "graded",
    detail: "How much answer real estate the brand gets.",
  },
  {
    label: "Framing",
    points: 15,
    mode: "graded",
    detail: "How the brand is positioned.",
  },
  {
    label: "Citation",
    points: 10,
    mode: "deterministic",
    detail: "Which sources back the answer.",
  },
  {
    label: "Competitive Frame",
    points: 10,
    mode: "graded",
    detail: "Who the brand is grouped with.",
  },
  {
    label: "Accuracy",
    points: 5,
    mode: "graded",
    detail: "Whether claims about the brand are correct.",
  },
];

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function cleanListText(line: string): string {
  return normalizeLine(line).replace(/^-\s*/, "");
}

function getBlocksByHeading(markdown: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const start = (match.index ?? 0) + match[0].length;
    const end = next?.index ?? markdown.length;
    blocks.set(match[1].trim(), markdown.slice(start, end).trim());
  }
  return blocks;
}

function extractListAfter(block: string, heading: string): string[] {
  const start = block.indexOf(`**${heading}**`);
  if (start === -1) return [];
  const rest = block.slice(start + heading.length + 4);
  const stopMatch = rest.match(/\n\s*(?:\*\*[^*]+\*\*|---)/);
  const section = stopMatch ? rest.slice(0, stopMatch.index) : rest;
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map(cleanListText);
}

function extractSummary(block: string): string {
  const readiness = block.match(/\*\*Readiness:\*\*\s*\d+\/100/);
  const start = readiness ? block.indexOf(readiness[0]) + readiness[0].length : 0;
  const afterReadiness = block.slice(start);
  const line = afterReadiness
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("**") && !item.startsWith("-") && item !== "---");
  return line ?? "";
}

function parseReadiness(block: string): number {
  const match = block.match(/\*\*Readiness:\*\*\s*(\d+)\/100/);
  return match ? Number(match[1]) : 0;
}

function parsePrompts(block: string): VisibilityPrompt[] {
  const prompts = extractListAfter(block, "Audit prompts");
  const fallbackScores: Record<string, number> = {
    "best AI tools for business growth automation 2026": 13,
    "how to implement AI operations systems": 13,
    "Growth Systems & AI Operations pricing plans": 18,
  };

  return prompts.map((line) => {
    const match = line.match(/^([^:]+):\s*([^—-]+)\s*[—-]\s*(.+)$/);
    const prompt = match ? match[3].trim() : line;
    return {
      source: match ? match[1].trim() : "unknown",
      status: match ? match[2].trim() : "unknown",
      prompt,
      score: fallbackScores[prompt] ?? null,
    };
  });
}

function parseTrackedKeywords(block: string): TrackedKeyword[] {
  return extractListAfter(block, "Tracked keywords").map((line) => {
    const volumeMatch = line.match(/,\s*(\d+)\s+searches\/mo/i);
    const [keywordPart, ...statusParts] = line.split(" — ");
    return {
      keyword: keywordPart.trim(),
      status: statusParts.join(" — ").trim() || "unknown",
      volume: volumeMatch ? Number(volumeMatch[1]) : null,
    };
  });
}

function parseGeoChecks(block: string): GeoCheck[] {
  const checks: GeoCheck[] = [];
  let group: GeoCheck["group"] = "geo";
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (line === "**Site architecture checks**") {
      group = "site";
      continue;
    }
    const match = line.match(/^-\s*(.+?)\s+\((pass|fail)\)\s+—\s+(.+)$/i);
    if (!match) continue;
    checks.push({
      label: match[1].trim(),
      status: match[2].toLowerCase() as CheckStatus,
      detail: match[3].trim(),
      group,
    });
  }
  return checks;
}

function parseAuditChannels(markdown: string): AuditChannel[] {
  const blocks = getBlocksByHeading(markdown);
  return Object.entries(channelTitles)
    .map(([key, title]) => {
      const typedKey = key as AuditChannelKey;
      const block = blocks.get(title) ?? "";
      return {
        key: typedKey,
        title,
        readiness: parseReadiness(block),
        projected: projectedChannelScores[typedKey],
        summary: extractSummary(block),
        findings: extractListAfter(block, "Top findings").map((text) => ({ text })),
        opportunities: extractListAfter(block, "Top opportunities").map((text) => ({ text })),
        prompts: typedKey === "ai_visibility" ? parsePrompts(block) : [],
        geoChecks: typedKey === "geo" ? parseGeoChecks(block) : [],
        keywords: typedKey === "seo" ? parseTrackedKeywords(block) : [],
      };
    })
    .filter((channel) => channel.summary || channel.readiness > 0 || channel.findings.length > 0);
}

function parsePlanItems(markdown: string): PlanItem[] {
  const lines = markdown.split("\n");
  const items: PlanItem[] = [];
  let current: PlanItem | null = null;
  let inItems = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "## Active Plan Items") {
      inItems = true;
      continue;
    }
    if (inItems && line.startsWith("## ")) break;
    if (!inItems) continue;

    const itemMatch = line.match(/^-\s+\[([^\]]+)\]\s+(.+?)(?:\s+due\s+(.+))?$/);
    if (itemMatch) {
      current = {
        status: itemMatch[1].trim(),
        title: itemMatch[2].trim(),
        due: itemMatch[3]?.trim() ?? null,
        phase: null,
        stage: null,
        channel: null,
        workflow: null,
        approval: null,
        prompt: null,
        expectedImpact: null,
        estimatedPaidSpend: null,
        evidence: [],
      };
      items.push(current);
      continue;
    }

    if (!current || !line.startsWith("- ")) continue;
    const detail = cleanListText(line);
    if (detail.startsWith("phase=")) {
      for (const part of detail.split(";")) {
        const [key, value] = part.split("=").map((item) => item.trim());
        if (key === "phase") current.phase = value;
        if (key === "stage") current.stage = value;
        if (key === "channel") current.channel = value;
        if (key === "workflow") current.workflow = value;
        if (key === "approval") current.approval = value;
      }
    } else if (detail.startsWith("prompt:")) {
      current.prompt = detail.replace(/^prompt:\s*/i, "");
    } else if (detail.startsWith("expected impact:")) {
      current.expectedImpact = detail.replace(/^expected impact:\s*/i, "");
    } else if (detail.startsWith("estimated paid spend:")) {
      current.estimatedPaidSpend = detail.replace(/^estimated paid spend:\s*/i, "");
    } else if (detail.startsWith("evidence ")) {
      current.evidence.push(detail);
    }
  }

  return items;
}

function parseActivity(markdown: string): PlanActivity[] {
  const match = markdown.match(/## Recent Plan Activity\s+([\s\S]*?)(?:\n## |\n<!--|$)/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const parsed = line.match(/^-\s+(\S+)\s+\[([^\]]+)\]:\s+(.+)$/);
      return {
        timestamp: parsed?.[1] ?? "",
        event: parsed?.[2] ?? "activity",
        detail: parsed?.[3] ?? cleanListText(line),
      };
    });
}

function parseHealth(markdown: string): { current: number; projected: number } {
  const match = markdown.match(/health\s+(\d+)\s*[→-]\s*(\d+)/i);
  return {
    current: match ? Number(match[1]) : 19,
    projected: match ? Number(match[2]) : 51,
  };
}

function parseHeaderValue(markdown: string, label: string): string | null {
  const match = markdown.match(new RegExp(`^- ${label}:\\s*(.+)$`, "im"));
  return match?.[1].trim() ?? null;
}

export function buildMarketingAnalyticsSnapshot({
  auditMarkdown,
  planMarkdown,
  auditFile,
  planFile,
}: {
  auditMarkdown: string;
  planMarkdown: string;
  auditFile: string;
  planFile: string;
}): MarketingAnalyticsSnapshot {
  const channels = parseAuditChannels(auditMarkdown);
  const geoChecks = channels.flatMap((channel) => channel.geoChecks);
  const health = parseHealth(planMarkdown);

  return {
    auditDate: parseHeaderValue(auditMarkdown, "Date"),
    auditType: parseHeaderValue(auditMarkdown, "Audit type"),
    sourceAuditId: parseHeaderValue(auditMarkdown, "Source audit ID"),
    healthCurrent: health.current,
    healthProjected: health.projected,
    channels,
    geoChecks,
    planItems: parsePlanItems(planMarkdown),
    activity: parseActivity(planMarkdown),
    aiVisibilityDimensions,
    sources: {
      auditFile,
      planFile,
    },
  };
}

export function getChannelByTitle(channels: AuditChannel[], title: string): AuditChannel | null {
  const key = titleToKey[title];
  return channels.find((channel) => channel.key === key) ?? null;
}

export function getAnalyticsSummary(snapshot: MarketingAnalyticsSnapshot) {
  const failedGeoChecks = snapshot.geoChecks.filter((check) => check.status === "fail").length;
  const passedGeoChecks = snapshot.geoChecks.filter((check) => check.status === "pass").length;
  const readyPlanItems = snapshot.planItems.filter((item) => item.status === "ready").length;
  const approvalPlanItems = snapshot.planItems.filter((item) => item.approval === "publish").length;
  const aiVisibility = snapshot.channels.find((channel) => channel.key === "ai_visibility");

  return {
    healthDelta: snapshot.healthProjected - snapshot.healthCurrent,
    failedGeoChecks,
    passedGeoChecks,
    readyPlanItems,
    approvalPlanItems,
    promptCount: aiVisibility?.prompts.length ?? 0,
    absentPromptCount: aiVisibility?.prompts.filter((prompt) => /not mentioned/i.test(prompt.status)).length ?? 0,
  };
}
