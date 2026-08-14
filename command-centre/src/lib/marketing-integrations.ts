export interface McpServer {
  name: string;
  command: string;
  source: string;
}

export interface ApiService {
  key: string;
  service: string;
  usedBy: string;
  configured: boolean;
}

export interface ComposioSnapshot {
  active: string[];
  needsReconnect: string[];
  updatedAt: string | null;
  source: string;
}

export interface ConnectorsData {
  mcpServers: McpServer[];
  services: ApiService[];
  configuredCount: number;
  composio?: ComposioSnapshot;
}

export type IntegrationSignalType = "env" | "mcp" | "composio" | "local" | "native";
export type IntegrationReadiness = "ready" | "native" | "partial" | "reconnect" | "missing";
export type IntegrationGate = "read-only" | "email" | "social" | "content" | "spend" | "code" | "external";

export interface IntegrationSignal {
  type: IntegrationSignalType;
  key: string;
  label: string;
}

export interface IntegrationCheck {
  label: string;
  anyOf: IntegrationSignal[];
  optional?: boolean;
}

export interface MarketingIntegration {
  key: string;
  title: string;
  group: string;
  magisterPattern: string;
  localPath: string;
  gate: IntegrationGate;
  draftRule: string;
  checks: IntegrationCheck[];
}

export interface MarketingIntegrationCheckStatus extends IntegrationCheck {
  matchedSignals: string[];
  reconnectSignals: string[];
  missingSignals: string[];
  satisfied: boolean;
}

export interface MarketingIntegrationStatus extends MarketingIntegration {
  readiness: IntegrationReadiness;
  readinessPercent: number;
  matchedSignals: string[];
  reconnectSignals: string[];
  missingSignals: string[];
  checkStatuses: MarketingIntegrationCheckStatus[];
}

const composioLinePattern = /^\|\s*(Active|Needs reconnect before use)\s*\|\s*(.*?)\s*\|?\s*$/i;

export const marketingIntegrations: MarketingIntegration[] = [
  {
    key: "workflow-runtime",
    title: "Workflow runtime",
    group: "Operations",
    magisterPattern: "Five loops plus configurable workflow schedules and run history.",
    localPath: "AI-OS cron daemon, Command Center workflow map, tracked task sessions.",
    gate: "read-only",
    draftRule: "Local recurring runs can be scheduled; external side effects stay behind their own gate.",
    checks: [
      {
        label: "Local scheduler",
        anyOf: [{ type: "local", key: "aios-cron", label: "AI-OS cron runtime" }],
      },
      {
        label: "Workflow UI",
        anyOf: [{ type: "local", key: "command-centre-workflows", label: "Command Center workflows page" }],
      },
    ],
  },
  {
    key: "research-crawl",
    title: "Research and crawl",
    group: "Research",
    magisterPattern: "Firecrawl, Apify, Brave, Exa, and web context feed audits and briefs.",
    localPath: "Firecrawl, Apify, web search, AI-OS scraping skills, and local docs.",
    gate: "read-only",
    draftRule: "Reads and reports can run without approval; extracted facts still need source links.",
    checks: [
      {
        label: "Website crawl",
        anyOf: [
          { type: "composio", key: "firecrawl", label: "Firecrawl Composio" },
          { type: "env", key: "FIRECRAWL_API_KEY", label: "Firecrawl API key" },
        ],
      },
      {
        label: "Structured scraping",
        anyOf: [{ type: "composio", key: "apify", label: "Apify Composio" }],
      },
    ],
  },
  {
    key: "analytics",
    title: "Analytics and rank data",
    group: "Analytics",
    magisterPattern: "GA4, Search Console, DataForSEO, PostHog, Hotjar, Fathom, and tracker deltas.",
    localPath: "DataForSEO is documented active; GA/GSC/PostHog currently need reconnect before live reads.",
    gate: "read-only",
    draftRule: "Metric reads are safe; any account changes or spend actions route to permissions.",
    checks: [
      {
        label: "Keyword and rank source",
        anyOf: [{ type: "composio", key: "dataforseo", label: "DataForSEO Composio" }],
      },
      {
        label: "Traffic or conversion source",
        anyOf: [
          { type: "composio", key: "google_analytics", label: "Google Analytics Composio" },
          { type: "composio", key: "google_search_console", label: "Google Search Console Composio" },
          { type: "composio", key: "posthog", label: "PostHog Composio" },
        ],
      },
    ],
  },
  {
    key: "social-publishing",
    title: "Social accounts and scheduling",
    group: "Publishing",
    magisterPattern: "Draft, schedule, and publish social posts across connected accounts.",
    localPath: "Instagram, LinkedIn, and X are documented active; unified queue adapter is still a gap.",
    gate: "social",
    draftRule: "Create drafts locally. Scheduling or publishing externally requires explicit approval.",
    checks: [
      {
        label: "Connected social account",
        anyOf: [
          { type: "composio", key: "instagram", label: "Instagram Composio" },
          { type: "composio", key: "linkedin", label: "LinkedIn Composio" },
          { type: "composio", key: "twitter", label: "X/Twitter Composio" },
        ],
      },
      {
        label: "Scheduling adapter",
        anyOf: [
          { type: "composio", key: "buffer", label: "Buffer" },
          { type: "composio", key: "typefully", label: "Typefully" },
          { type: "composio", key: "postbridge", label: "PostBridge" },
          { type: "composio", key: "zernio", label: "Zernio" },
        ],
      },
    ],
  },
  {
    key: "email",
    title: "Email send and inbox",
    group: "Publishing",
    magisterPattern: "Send email from Gmail or the managed agent address, with approval verbs.",
    localPath: "AgentMail can handle agent-owned inbox work; Gmail currently needs reconnect in the connector map.",
    gate: "email",
    draftRule: "Draft and rewrite are local. Sending waits for approve/send, edit/send, or reject.",
    checks: [
      {
        label: "Send-capable mailbox",
        anyOf: [
          { type: "composio", key: "gmail", label: "Gmail Composio" },
          { type: "env", key: "AGENTMAIL_API_KEY", label: "AgentMail API key" },
        ],
      },
    ],
  },
  {
    key: "site-cms",
    title: "Website, CMS, and deploy",
    group: "Publishing",
    magisterPattern: "Create CMS drafts, update pages, open PRs, and deploy approved changes.",
    localPath: "Local repo edits are native; GitHub/Vercel connectors cover PR and deployment handoff.",
    gate: "content",
    draftRule: "Prepare diffs and drafts first. Live publish, merge, and deploy require approval.",
    checks: [
      {
        label: "Local website workspace",
        anyOf: [{ type: "local", key: "workspace", label: "Local AI-OS workspace" }],
      },
      {
        label: "Repo or deployment account",
        anyOf: [
          { type: "composio", key: "github", label: "GitHub Composio" },
          { type: "composio", key: "vercel", label: "Vercel Composio" },
        ],
      },
    ],
  },
  {
    key: "paid-ads",
    title: "Paid ads",
    group: "Acquisition",
    magisterPattern: "Create campaigns paused, then activate or pause only after a paid-spend approval.",
    localPath: "Google Ads is documented active. Other paid platforms remain future adapters.",
    gate: "spend",
    draftRule: "Campaigns are born paused. Account upgrades, billing, budgets, and activation require approval.",
    checks: [
      {
        label: "Ad platform account",
        anyOf: [{ type: "composio", key: "googleads", label: "Google Ads Composio" }],
      },
    ],
  },
  {
    key: "crm-sales",
    title: "CRM and sales systems",
    group: "CRM",
    magisterPattern: "HubSpot, Apollo, Hunter, Instantly, and CRM records feed campaigns and follow-up.",
    localPath: "HubSpot is documented as needing reconnect; Apollo/Sales plugins are available but not installed.",
    gate: "external",
    draftRule: "Research and draft updates locally. CRM writes wait for an external-change approval.",
    checks: [
      {
        label: "CRM account",
        anyOf: [
          { type: "composio", key: "hubspot", label: "HubSpot Composio" },
          { type: "composio", key: "apollo", label: "Apollo Composio" },
        ],
      },
    ],
  },
  {
    key: "docs-productivity",
    title: "Docs and collaboration",
    group: "Operations",
    magisterPattern: "Google Docs, Drive, Calendar, Slack, and Notion support briefs and collaboration.",
    localPath: "Google Workspace env keys exist; Notion, Drive, Calendar, and Slack need reconnect in Composio.",
    gate: "external",
    draftRule: "Local drafts can be prepared. Sending, sharing, or changing access requires approval.",
    checks: [
      {
        label: "Workspace docs",
        anyOf: [
          { type: "composio", key: "notion", label: "Notion Composio" },
          { type: "composio", key: "googledocs", label: "Google Docs Composio" },
          { type: "env", key: "GOOGLE_WORKSPACE_CLI_CLIENT_ID", label: "Google Workspace OAuth client" },
        ],
      },
      {
        label: "Team channel",
        anyOf: [
          { type: "composio", key: "slack", label: "Slack Composio" },
          { type: "env", key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot" },
        ],
        optional: true,
      },
    ],
  },
  {
    key: "media-generation",
    title: "Media generation",
    group: "Creative",
    magisterPattern: "Figma, fal.ai, HeyGen, Gemini, Ideogram, video, and voice generation.",
    localPath: "Figma is documented active; fal.ai and HeyGen are key-based optional services.",
    gate: "content",
    draftRule: "Generate reviewable assets first. Publishing or uploading to external accounts is separate.",
    checks: [
      {
        label: "Design context",
        anyOf: [
          { type: "composio", key: "figma", label: "Figma Composio" },
          { type: "env", key: "FIGMA_TOKEN", label: "Figma API token" },
        ],
      },
      {
        label: "Image or video generation",
        anyOf: [
          { type: "env", key: "FAL_KEY", label: "fal.ai API key" },
          { type: "env", key: "HEYGEN_API_KEY", label: "HeyGen API key" },
        ],
      },
    ],
  },
  {
    key: "notifications",
    title: "Notifications",
    group: "Operations",
    magisterPattern: "Daily briefs, completion emails, Slack sessions, and approval nudges.",
    localPath: "Pushover, Telegram, Slack, AgentMail, and local Command Center events.",
    gate: "external",
    draftRule: "Local status is always visible. External notifications send only through configured channels.",
    checks: [
      {
        label: "Operator notification channel",
        anyOf: [
          { type: "env", key: "PUSHOVER_TOKEN", label: "Pushover app token" },
          { type: "env", key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot" },
          { type: "composio", key: "slack", label: "Slack Composio" },
        ],
      },
    ],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function splitToolkits(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.replace(/`/g, "").trim())
    .filter(Boolean);
}

export function parseComposioSnapshot(markdown: string, source = "docs/connectors.md"): ComposioSnapshot {
  const active = new Set<string>();
  const needsReconnect = new Set<string>();
  const updatedAt = markdown.match(/updated\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;

  for (const raw of markdown.split("\n")) {
    const match = raw.match(composioLinePattern);
    if (!match) continue;
    const target = /^Active$/i.test(match[1]) ? active : needsReconnect;
    for (const toolkit of splitToolkits(match[2])) {
      target.add(normalize(toolkit));
    }
  }

  return {
    active: [...active].sort(),
    needsReconnect: [...needsReconnect].sort(),
    updatedAt,
    source,
  };
}

function evaluateSignal(signal: IntegrationSignal, data: ConnectorsData): "matched" | "reconnect" | "missing" {
  switch (signal.type) {
    case "local":
    case "native":
      return "matched";
    case "env":
      return data.services.some((service) => service.key === signal.key && service.configured) ? "matched" : "missing";
    case "mcp":
      return data.mcpServers.some((server) => normalize(server.name) === normalize(signal.key)) ? "matched" : "missing";
    case "composio": {
      const key = normalize(signal.key);
      if (data.composio?.active.includes(key)) return "matched";
      if (data.composio?.needsReconnect.includes(key)) return "reconnect";
      return "missing";
    }
  }
}

function evaluateCheck(check: IntegrationCheck, data: ConnectorsData): MarketingIntegrationCheckStatus {
  const matchedSignals: string[] = [];
  const reconnectSignals: string[] = [];
  const missingSignals: string[] = [];

  for (const signal of check.anyOf) {
    const result = evaluateSignal(signal, data);
    if (result === "matched") matchedSignals.push(signal.label);
    if (result === "reconnect") reconnectSignals.push(signal.label);
    if (result === "missing") missingSignals.push(signal.label);
  }

  return {
    ...check,
    matchedSignals,
    reconnectSignals,
    missingSignals,
    satisfied: matchedSignals.length > 0,
  };
}

function getReadiness(integration: MarketingIntegration, checks: MarketingIntegrationCheckStatus[]): IntegrationReadiness {
  const required = checks.filter((check) => !check.optional);
  const satisfiedCount = required.filter((check) => check.satisfied).length;
  const reconnectCount = required.filter((check) => !check.satisfied && check.reconnectSignals.length > 0).length;
  const hasOnlyLocalOrNative = required.every((check) =>
    check.anyOf.every((signal) => signal.type === "local" || signal.type === "native"),
  );

  if (required.length > 0 && satisfiedCount === required.length) {
    return hasOnlyLocalOrNative ? "native" : "ready";
  }
  if (satisfiedCount > 0) return "partial";
  if (reconnectCount > 0) return "reconnect";
  return "missing";
}

export function buildMarketingIntegrationStatuses(data: ConnectorsData): MarketingIntegrationStatus[] {
  return marketingIntegrations.map((integration) => {
    const checkStatuses = integration.checks.map((check) => evaluateCheck(check, data));
    const required = checkStatuses.filter((check) => !check.optional);
    const satisfiedCount = required.filter((check) => check.satisfied).length;
    const readiness = getReadiness(integration, checkStatuses);
    const matchedSignals = checkStatuses.flatMap((check) => check.matchedSignals);
    const reconnectSignals = checkStatuses.flatMap((check) => check.reconnectSignals);
    const missingSignals = checkStatuses
      .filter((check) => !check.satisfied)
      .flatMap((check) => check.reconnectSignals.length > 0 ? [] : check.missingSignals);

    return {
      ...integration,
      readiness,
      readinessPercent: required.length ? Math.round((satisfiedCount / required.length) * 100) : 100,
      matchedSignals,
      reconnectSignals,
      missingSignals,
      checkStatuses,
    };
  });
}

export function getReadinessLabel(readiness: IntegrationReadiness): string {
  switch (readiness) {
    case "ready":
      return "Ready";
    case "native":
      return "Native";
    case "partial":
      return "Partial";
    case "reconnect":
      return "Reconnect";
    case "missing":
      return "Missing";
  }
}

export function getIntegrationSummary(rows: MarketingIntegrationStatus[]) {
  const ready = rows.filter((row) => row.readiness === "ready" || row.readiness === "native").length;
  const partial = rows.filter((row) => row.readiness === "partial").length;
  const reconnect = rows.filter((row) => row.readiness === "reconnect").length;
  const missing = rows.filter((row) => row.readiness === "missing").length;
  const gated = rows.filter((row) => row.gate !== "read-only").length;
  return {
    total: rows.length,
    ready,
    partial,
    reconnect,
    missing,
    gated,
  };
}
