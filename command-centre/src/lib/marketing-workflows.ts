import type { CronJob, CronJobCreateInput } from "@/types/cron";

export type MarketingWorkflowKey = string;

export type MarketingWorkflowCategory =
  | "orchestrator"
  | "analytics"
  | "content"
  | "copywriting"
  | "cro"
  | "email"
  | "growth"
  | "outreach"
  | "paid-ads"
  | "research"
  | "retention"
  | "revops"
  | "seo"
  | "social"
  | "strategy";

export type MarketingWorkflowApprovalLevel =
  | "local_draft"
  | "read_only"
  | "approval_required"
  | "gateway_owned";

export interface MarketingWorkflowInput {
  name: string;
  type: "text" | "url";
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface MarketingWorkflowStep {
  title: string;
  detail: string;
}

export interface MarketingWorkflowSchedule {
  time: string;
  days: string;
  cronExpression: string;
  timezoneStrategy: "user_local";
}

export interface MarketingWorkflowTemplate {
  key: MarketingWorkflowKey;
  magisterSlug: string;
  title: string;
  category: MarketingWorkflowCategory;
  cadence: string;
  purpose: string;
  approvalGate: string;
  approvalLevel: MarketingWorkflowApprovalLevel;
  expectedEvidence: string;
  evidenceArtifacts: string[];
  schedule: MarketingWorkflowSchedule | null;
  defaultSchedule: Pick<MarketingWorkflowSchedule, "time" | "days">;
  requiredConnections: string[];
  focusSkills: string[];
  inputs: MarketingWorkflowInput[];
  steps: MarketingWorkflowStep[];
  isSystemLoop: boolean;
  isGatewayOwned: boolean;
  isReporting: boolean;
  notifyOnComplete: boolean;
}

interface MarketingWorkflowTemplateDefinition {
  key?: MarketingWorkflowKey;
  magisterSlug: string;
  title: string;
  category: MarketingWorkflowCategory;
  purpose: string;
  steps: MarketingWorkflowStep[];
  cadence?: string;
  approvalGate?: string;
  approvalLevel?: MarketingWorkflowApprovalLevel;
  expectedEvidence?: string;
  evidenceArtifacts?: string[];
  schedule?: MarketingWorkflowSchedule | null;
  defaultSchedule?: Pick<MarketingWorkflowSchedule, "time" | "days">;
  requiredConnections?: string[];
  focusSkills?: string[];
  inputs?: MarketingWorkflowInput[];
  isSystemLoop?: boolean;
  isGatewayOwned?: boolean;
  isReporting?: boolean;
  notifyOnComplete?: boolean;
}

const weekdayReviewSchedule = { time: "09:00", days: "weekdays" } as const;

function textInput(
  name: string,
  label: string,
  required = true,
  placeholder?: string,
): MarketingWorkflowInput {
  return { name, label, required, placeholder, type: "text" };
}

function urlInput(
  name: string,
  label: string,
  required = true,
  placeholder?: string,
): MarketingWorkflowInput {
  return { name, label, required, placeholder, type: "url" };
}

function defaultApprovalGate(level: MarketingWorkflowApprovalLevel): string {
  switch (level) {
    case "approval_required":
      return "Ask before external action";
    case "gateway_owned":
      return "Gateway source mirrored locally";
    case "read_only":
      return "Read-only connectors";
    case "local_draft":
      return "Local draft only";
  }
}

function workflowTemplate(definition: MarketingWorkflowTemplateDefinition): MarketingWorkflowTemplate {
  const approvalLevel = definition.approvalLevel ?? "local_draft";
  const cadence = definition.schedule
    ? `${formatScheduleLabel(definition.schedule.days, definition.schedule.time)} local`
    : definition.cadence ?? "Campaign-triggered";

  return {
    key: definition.key ?? definition.magisterSlug,
    magisterSlug: definition.magisterSlug,
    title: definition.title,
    category: definition.category,
    cadence,
    purpose: definition.purpose,
    approvalGate: definition.approvalGate ?? defaultApprovalGate(approvalLevel),
    approvalLevel,
    expectedEvidence:
      definition.expectedEvidence ?? "Markdown report, recommendations, key metrics, and blocker state",
    evidenceArtifacts: definition.evidenceArtifacts ?? ["markdown report", "key metrics", "blocker state"],
    schedule: definition.schedule ?? null,
    defaultSchedule: definition.defaultSchedule ?? definition.schedule ?? weekdayReviewSchedule,
    requiredConnections: definition.requiredConnections ?? [],
    focusSkills: definition.focusSkills ?? [],
    inputs: definition.inputs ?? [],
    steps: definition.steps,
    isSystemLoop: definition.isSystemLoop ?? false,
    isGatewayOwned: definition.isGatewayOwned ?? false,
    isReporting: definition.isReporting ?? false,
    notifyOnComplete: definition.notifyOnComplete ?? true,
  };
}

export const marketingWorkflowTemplates: MarketingWorkflowTemplate[] = [
  workflowTemplate({
    key: "standard_brief",
    magisterSlug: "default-brief-orchestrator",
    title: "Standard brief",
    category: "orchestrator",
    purpose: "Turn current evidence into a capped marketing action list.",
    approvalGate: "Local draft only",
    approvalLevel: "local_draft",
    expectedEvidence: "Brief file, chosen next action, source links",
    evidenceArtifacts: ["daily brief", "priority list", "source links"],
    schedule: { time: "08:00", days: "daily", cronExpression: "0 8 * * *", timezoneStrategy: "user_local" },
    requiredConnections: ["dataforseo", "zernio"],
    focusSkills: [
      "magister-orchestrator",
      "magister-findings",
      "magister-analytics-tracker",
      "magister-analytics-read",
      "magister-dataforseo",
      "magister-brave-search",
      "magister-zernio",
    ],
    inputs: [textInput("today", "Today", true, "Use the user's local date"), textInput("project_id", "Project")],
    steps: [
      { title: "Gather signals", detail: "Read unconsumed findings, tracker scorecard, due plan tasks, site detections, and pending approvals." },
      { title: "Decide today's focus", detail: "Prioritise approvals, anomalies, lagging trackers, due plan tasks, and planned content. Cap the list at 3 items." },
      { title: "Synthesize the brief", detail: "Fill only sections with evidence, drop empty sections, and pair each number with interpretation." },
    ],
    isSystemLoop: true,
    isReporting: true,
    notifyOnComplete: false,
  }),
  workflowTemplate({
    key: "audit_refresh",
    magisterSlug: "audit-refresh-loop",
    title: "Audit refresh",
    category: "orchestrator",
    purpose: "Refresh health score, channel evidence, and open risks.",
    approvalGate: "No external writes",
    approvalLevel: "gateway_owned",
    expectedEvidence: "Audit markdown, score deltas, failed checks",
    evidenceArtifacts: ["audit markdown", "score deltas", "failed checks"],
    schedule: { time: "07:00", days: "mon", cronExpression: "0 7 * * 1", timezoneStrategy: "user_local" },
    focusSkills: ["magister-findings", "magister-analytics-read", "seo-audit", "cro"],
    steps: [
      { title: "Run audit generator", detail: "Refresh brand, AI visibility, GEO, SEO, website, social, and paid-readiness checks." },
      { title: "Update health state", detail: "Store the latest scores, deltas, failed checks, and open channel risks for plan compilation." },
      { title: "Emit audit finding", detail: "Record a durable finding or blocker so briefs and plan execution can consume the result." },
    ],
    isSystemLoop: true,
    isGatewayOwned: true,
    isReporting: true,
    notifyOnComplete: false,
  }),
  workflowTemplate({
    key: "impact_checkpoint",
    magisterSlug: "impact-checkpoint-loop",
    title: "Impact checkpoint",
    category: "orchestrator",
    purpose: "Sample linked metrics and compare them with plan targets.",
    approvalGate: "Read-only connectors",
    approvalLevel: "read_only",
    expectedEvidence: "Metric baselines, deltas, tracking gaps",
    evidenceArtifacts: ["metric baselines", "deltas", "tracking gaps"],
    schedule: { time: "07:30", days: "mon", cronExpression: "30 7 * * 1", timezoneStrategy: "user_local" },
    requiredConnections: ["ga4", "google_search_console", "posthog"],
    focusSkills: ["magister-analytics-read", "magister-analytics-tracker", "analytics"],
    steps: [
      { title: "Sample metrics", detail: "Read linked metric sources and compare current values with the plan targets." },
      { title: "Update impact state", detail: "Refresh baselines, deltas, missing-source flags, and confidence labels." },
      { title: "Surface gaps", detail: "Turn missing or stale tracking into a blocker finding with the next integration step." },
    ],
    isSystemLoop: true,
    isGatewayOwned: true,
    isReporting: true,
    notifyOnComplete: false,
  }),
  workflowTemplate({
    key: "plan_execution",
    magisterSlug: "plan-execution-loop",
    title: "Plan execution",
    category: "orchestrator",
    purpose: "Claim the next best action and open an agent run.",
    approvalGate: "Ask before publish/deploy",
    approvalLevel: "approval_required",
    expectedEvidence: "Task id, transcript, output artifact",
    evidenceArtifacts: ["task id", "agent transcript", "output artifact"],
    schedule: { time: "08:00", days: "mon", cronExpression: "0 8 * * 1", timezoneStrategy: "user_local" },
    focusSkills: ["magister-orchestrator", "magister-findings", "pm"],
    steps: [
      { title: "Claim due plan task", detail: "Select the highest-priority due task using plan urgency, blockers, evidence freshness, and approvals." },
      { title: "Open local agent run", detail: "Create or resume the AI-OS task and attach the plan context needed for execution." },
      { title: "Record result", detail: "Store task id, transcript reference, artifact path, and any approval or blocker state." },
    ],
    isSystemLoop: true,
    isGatewayOwned: true,
  }),
  workflowTemplate({
    key: "tracker_checkins",
    magisterSlug: "tracker-checkins-weekly",
    title: "Tracker check-ins",
    category: "orchestrator",
    purpose: "Find stuck work, stale docs, and unresolved workflow failures.",
    approvalGate: "Local updates only",
    approvalLevel: "local_draft",
    expectedEvidence: "Run state, stale locks, needs-input queue",
    evidenceArtifacts: ["tracker check-ins", "at-risk finding", "needs-input queue"],
    schedule: { time: "09:00", days: "mon", cronExpression: "0 9 * * 1", timezoneStrategy: "user_local" },
    focusSkills: ["magister-analytics-tracker", "magister-analytics-read", "magister-findings"],
    steps: [
      { title: "Load active trackers", detail: "Read active trackers and skip cleanly if there are no active trackers." },
      { title: "Iterate trackers", detail: "Gather current values, compute deltas, evaluate goals, and catch errors per tracker." },
      { title: "Surface at-risk trackers", detail: "Emit a finding when a tracker is likely to miss its target or lacks enough signal." },
    ],
    isSystemLoop: true,
    isReporting: true,
  }),
  workflowTemplate({
    magisterSlug: "posthog-funnel-analysis",
    title: "PostHog Funnel Analysis",
    category: "analytics",
    purpose: "Find the highest-impact funnel drop-off and produce CRO recommendations.",
    approvalLevel: "read_only",
    requiredConnections: ["posthog"],
    inputs: [textInput("funnel_name", "Funnel"), textInput("conversion_goal", "Conversion goal")],
    steps: [
      { title: "Pull funnel data", detail: "Load the last 30 days and break down conversion rates by the most useful property." },
      { title: "Map drop-offs", detail: "Flag the largest volume losses and any step under 50 percent completion." },
      { title: "Recommend CRO tests", detail: "Prioritise 5-7 recommendations with friction hypothesis, effort, uplift, and top experiments." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "monthly-marketing-report",
    title: "Monthly Marketing Report",
    category: "analytics",
    purpose: "Compile executive marketing performance, anomalies, and next actions.",
    approvalLevel: "read_only",
    isReporting: true,
    inputs: [urlInput("website_url", "Website URL"), textInput("company_name", "Company")],
    steps: [
      { title: "Gather traffic data", detail: "Summarise 30-day sessions, uniques, sources, landing pages, engagement, and spikes." },
      { title: "Analyse conversion", detail: "Compare leads, conversion rate, channel performance, and month-over-month changes." },
      { title: "Compile summary", detail: "Produce key numbers, wins, concerns, anomalies, and the top 3 recommended actions." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "product-launch-campaign",
    title: "Product Launch Campaign",
    category: "content",
    purpose: "Create a launch package across blog, social, email, ads, and checklist.",
    focusSkills: ["launch", "content-strategy"],
    inputs: [textInput("product_name", "Product"), textInput("launch_date", "Launch date"), textInput("target_audience", "Audience")],
    steps: [
      { title: "Draft launch story", detail: "Write the announcement blog post, SEO title, and meta description." },
      { title: "Create channel assets", detail: "Draft social posts, launch email, and ad copy variants." },
      { title: "Build checklist", detail: "Prepare T-7 through T+7 launch tasks with timing and owners." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "wordpress-blog-publisher",
    title: "WordPress Blog Publisher",
    category: "content",
    purpose: "Research, draft, format, and save a WordPress blog post as a draft.",
    approvalGate: "Ask before publishing live",
    approvalLevel: "approval_required",
    requiredConnections: ["wordpress"],
    inputs: [textInput("topic", "Topic"), textInput("target_keyword", "Target keyword"), urlInput("website_url", "Website URL")],
    steps: [
      { title: "Research the SERP", detail: "Inspect top pages, structure, snippets, PAA, and gaps." },
      { title: "Write and format", detail: "Draft the post, SEO title, meta description, slug, categories, and tags." },
      { title: "Prepare WordPress draft", detail: "Create or update the draft and request approval before any live publish action." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "blog-post",
    title: "Blog Post",
    category: "content",
    purpose: "Create an SEO-informed blog draft and publishing package.",
    focusSkills: ["content-strategy", "ai-seo"],
    inputs: [textInput("topic", "Topic"), urlInput("website_url", "Website URL"), textInput("target_keyword", "Target keyword", false)],
    steps: [
      { title: "Research intent", detail: "Review competing pages, dominant intent, and related subtopics." },
      { title: "Draft article", detail: "Write the outline, full draft, SEO title, meta description, and slug." },
      { title: "Format package", detail: "Return clean Markdown with labelled publishing sections." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "landing-page-copy",
    title: "Landing Page Copy",
    category: "copywriting",
    purpose: "Write positioning, hero copy, benefits, proof, FAQ, and final CTA.",
    inputs: [textInput("product_name", "Product"), textInput("target_audience", "Audience"), textInput("primary_cta", "Primary CTA")],
    steps: [
      { title: "Define positioning", detail: "Compare alternatives and write the one-sentence positioning." },
      { title: "Write core sections", detail: "Draft hero, benefit-led feature blocks, social proof, FAQ, and final CTA." },
      { title: "Package variants", detail: "Include headline alternatives and objection-handling copy." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "marketing-psychology-copy-review",
    title: "Marketing Psychology Copy Review",
    category: "copywriting",
    purpose: "Audit and improve copy using persuasion levers and trust signals.",
    inputs: [urlInput("page_url", "Page URL")],
    steps: [
      { title: "Score six levers", detail: "Rate social proof, authority, scarcity, reciprocity, liking, and commitment with examples." },
      { title: "Rewrite weak sections", detail: "Rewrite the headline and weakest sections with the principle applied." },
      { title: "Add friction reducers", detail: "Propose trust signals, CTA microcopy, risk reversal, and authority markers." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "cro-audit",
    title: "Conversion Rate Optimization Audit",
    category: "cro",
    purpose: "Find conversion friction and prioritise high-impact fixes.",
    inputs: [urlInput("page_url", "Page URL"), textInput("current_conversion_rate", "Current conversion rate", false)],
    steps: [
      { title: "Inspect page flow", detail: "Identify friction points, trust gaps, mobile issues, and message mismatch." },
      { title: "Score LIFT model", detail: "Rate value proposition, relevance, clarity, anxiety, distraction, and urgency." },
      { title: "Prioritise fixes", detail: "Rewrite high-impact sections and output a scored recommendation table." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "ab-test-design",
    title: "A/B Test Design",
    category: "cro",
    purpose: "Design a single-change experiment with copy, specs, and measurement plan.",
    inputs: [urlInput("page_url", "Page URL"), textInput("hypothesis", "Hypothesis"), textInput("primary_metric", "Primary metric")],
    steps: [
      { title: "Analyse control", detail: "Document 3-5 current friction points." },
      { title: "Define variant", detail: "Specify one clear change, variant copy, and design requirements." },
      { title: "Plan measurement", detail: "Define primary metric, guardrails, sample size, duration, and decision criteria." },
    ],
  }),
  workflowTemplate({
    key: "email_outbound",
    magisterSlug: "kit-email-campaign",
    title: "Kit Email Campaign",
    category: "email",
    purpose: "Draft, configure, and approval-gate a Kit email campaign.",
    approvalGate: "Ask before scheduling or sending",
    approvalLevel: "approval_required",
    requiredConnections: ["kit"],
    defaultSchedule: { time: "10:00", days: "weekdays" },
    inputs: [textInput("campaign_name", "Campaign"), textInput("segment_description", "Segment"), textInput("campaign_goal", "Goal")],
    steps: [
      { title: "Draft email", detail: "Write body, three subject lines, and a recommendation." },
      { title: "Prepare Kit settings", detail: "Specify segment, sender, send time, token fallbacks, and test-send checks." },
      { title: "Gate schedule", detail: "Request approval before Schedule or Send Immediately." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "email-newsletter",
    title: "Email Newsletter",
    category: "email",
    purpose: "Create a concise newsletter draft with subject lines, preheader, and CTA.",
    approvalGate: "Ask before send",
    approvalLevel: "approval_required",
    requiredConnections: ["gmail", "kit", "mailchimp", "resend"],
    defaultSchedule: { time: "10:00", days: "weekdays" },
    inputs: [textInput("brand_name", "Brand"), textInput("topic", "Topic"), textInput("audience_description", "Audience", false)],
    steps: [
      { title: "Review context", detail: "Read recent content, announcements, plan tasks, and audience notes." },
      { title: "Draft email", detail: "Write a concise body, subject-line options, preheader, and one CTA." },
      { title: "Record approval state", detail: "Track the send decision before any external queue action." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "lead-nurture-sequence",
    title: "Lead Nurture Sequence",
    category: "email",
    purpose: "Create a five-email journey from welcome through direct conversion ask.",
    focusSkills: ["emails", "magister-email"],
    inputs: [textInput("product_name", "Product"), textInput("segment_description", "Segment"), textInput("conversion_goal", "Conversion goal")],
    steps: [
      { title: "Map buyer journey", detail: "Define stage questions, information needs, and emotional state." },
      { title: "Write sequence", detail: "Draft five short emails with A/B subject variants." },
      { title: "Add timing logic", detail: "Include personalisation tokens, send timing, and pause-on-conversion rules." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "free-tool-strategy",
    title: "Free Tool Strategy",
    category: "growth",
    purpose: "Choose an upstream free tool and plan distribution to first 1,000 users.",
    inputs: [textInput("target_audience", "Audience"), textInput("company_name", "Company"), textInput("core_product", "Core product")],
    steps: [
      { title: "Generate ideas", detail: "List 10 simple tools from real audience pain points." },
      { title: "Score top options", detail: "Evaluate search potential, competitive gap, and build effort." },
      { title: "Plan launch", detail: "Write landing copy, long-tail keywords, community posts, and supporting content ideas." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "instantly-outreach-campaign",
    title: "Instantly Outreach Campaign",
    category: "outreach",
    purpose: "Draft and approval-gate an Instantly outbound sequence.",
    approvalGate: "Ask before launch or external sending",
    approvalLevel: "approval_required",
    requiredConnections: ["instantly"],
    inputs: [textInput("campaign_name", "Campaign"), textInput("icp_description", "ICP"), textInput("value_prop", "Value prop")],
    steps: [
      { title: "Write sequence", detail: "Draft the five-step Day 1/3/7/12/18 sequence." },
      { title: "Prepare send settings", detail: "Specify schedules, mailbox limits, random delay, stop-on-reply, and tracking." },
      { title: "Gate launch", detail: "Check unsubscribe, test messages, and request approval before launch." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "cold-outreach-campaign",
    title: "Cold Outreach Campaign",
    category: "outreach",
    purpose: "Create email and LinkedIn outbound copy from ICP pain research.",
    inputs: [textInput("icp_description", "ICP"), textInput("value_prop", "Value prop"), textInput("sender_name", "Sender")],
    steps: [
      { title: "Research language", detail: "Gather ICP pain language from reviews, communities, jobs, and LinkedIn." },
      { title: "Write email sequence", detail: "Draft Day 1/3/7/12/18 emails with subject variants and previews." },
      { title: "Add LinkedIn copy", detail: "Draft a connection request and post-accept DM without immediate hard pitch." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "apollo-prospect-list",
    title: "Apollo Prospect List Builder",
    category: "outreach",
    purpose: "Build, filter, enrich, and prioritise an Apollo prospect list.",
    approvalGate: "Ask before export, enrichment spend, or external list changes",
    approvalLevel: "approval_required",
    requiredConnections: ["apollo"],
    inputs: [textInput("icp_description", "ICP"), textInput("company_size", "Company size"), textInput("target_titles", "Target titles")],
    steps: [
      { title: "Search Apollo", detail: "Use ICP filters and gather a broad candidate pool." },
      { title: "Rank prospects", detail: "Filter to best-fit accounts by title, size, and buying signals." },
      { title: "Create priority table", detail: "Enrich top prospects and label Tier 1 manual vs Tier 2 semi-automated." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "google-ads-performance-review",
    title: "Google Ads Performance Review",
    category: "paid-ads",
    purpose: "Review campaign performance, wasted spend, scale candidates, and RSA copy gaps.",
    approvalGate: "Read-only ad account review",
    approvalLevel: "read_only",
    requiredConnections: ["google_ads"],
    inputs: [textInput("account_context", "Account context")],
    steps: [
      { title: "Pull campaign metrics", detail: "Review impressions, clicks, CTR, CPC, conversions, CPA, spend, and search terms." },
      { title: "Find wasted spend", detail: "Flag poor quality score, irrelevant terms, and high-cost zero-conversion terms." },
      { title: "Write recommendations", detail: "Identify scale candidates and draft RSA copy for weak campaigns." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "ad-copy-generation",
    title: "Ad Copy Generation",
    category: "paid-ads",
    purpose: "Create platform-native ad copy variants from competitor hook research.",
    inputs: [textInput("product_name", "Product"), textInput("target_audience", "Audience"), textInput("platform", "Platform")],
    steps: [
      { title: "Research ad libraries", detail: "Review competitor hooks and repeated formats." },
      { title: "Write short copy", detail: "Create 10 headlines and 5 descriptions within character limits." },
      { title: "Write long variants", detail: "Create story-led, listicle, and testimonial-style variants." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "competitor-analysis",
    title: "Competitor Analysis",
    category: "research",
    purpose: "Map competitor positioning, content, product, pricing, SEO, and gaps.",
    focusSkills: ["competitors", "agent-browser"],
    inputs: [urlInput("your_url", "Your URL"), textInput("competitor_urls", "Competitor URLs")],
    steps: [
      { title: "Research positioning", detail: "Review each competitor's messaging, offers, and content cadence." },
      { title: "Compare product and pricing", detail: "Build a side-by-side gap matrix." },
      { title: "Map SEO gaps", detail: "Inspect site architecture and keyword strategy, then recommend where not to compete and where to exploit gaps." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "churn-prevention-campaign",
    title: "Churn Prevention Campaign",
    category: "retention",
    purpose: "Design at-risk signals, cancellation saves, and win-back messaging.",
    inputs: [textInput("product_name", "Product"), textInput("at_risk_segment", "At-risk segment")],
    steps: [
      { title: "Define risk signals", detail: "Specify segment criteria, trigger conditions, and urgency levels." },
      { title: "Write save flow", detail: "Create exit survey, save offers, and confirmation messaging." },
      { title: "Draft win-back", detail: "Write Day 1, Day 7, and Day 21 reactivation emails plus pause/downgrade copy." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "hubspot-pipeline-review",
    title: "HubSpot Pipeline Review",
    category: "revops",
    purpose: "Analyse stage conversion, dwell time, stuck deals, and nurture opportunities.",
    approvalGate: "Read-only CRM review",
    approvalLevel: "read_only",
    requiredConnections: ["hubspot"],
    inputs: [textInput("pipeline_name", "Pipeline")],
    steps: [
      { title: "Pull pipeline data", detail: "Read 60 days of deals, values, velocity, won/lost, and stage movement." },
      { title: "Find bottlenecks", detail: "Compare conversion and dwell time to the prior period and list stuck deals." },
      { title: "Recommend nurture", detail: "Write follow-up templates and workflow recommendations without changing HubSpot." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "programmatic-seo-batch",
    title: "Programmatic SEO Pages",
    category: "seo",
    purpose: "Design a page template, variable slots, pilot pages, and scaling checklist.",
    inputs: [urlInput("website_url", "Website URL"), textInput("template_topic", "Template topic"), textInput("data_source", "Data source")],
    steps: [
      { title: "Design template", detail: "Define static and variable page sections, slug pattern, and H1 pattern." },
      { title: "Create briefs", detail: "Generate 20 unique page briefs and write 5 pilot pages." },
      { title: "Plan rollout", detail: "Document review criteria, internal linking, indexing, and publication pace." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "ai-search-optimization",
    title: "AI Search Optimization",
    category: "seo",
    purpose: "Improve citation readiness for AI answers and entity-rich extraction.",
    focusSkills: ["ai-seo"],
    inputs: [urlInput("website_url", "Website URL"), textInput("target_topics", "Target topics")],
    steps: [
      { title: "Audit citation readiness", detail: "Rate top pages for direct answers, structure, and authority signals." },
      { title: "Research AI answers", detail: "Check how AI systems answer target questions and which sources appear." },
      { title: "Rewrite priority pages", detail: "Add direct answers, query-shaped headings, credibility signals, FAQ, and schema." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "ahrefs-keyword-research",
    title: "Ahrefs Keyword Research",
    category: "seo",
    purpose: "Collect keywords, cluster intent, score opportunities, and build a content calendar.",
    approvalLevel: "read_only",
    requiredConnections: ["ahrefs"],
    focusSkills: ["ai-seo", "magister-dataforseo"],
    inputs: [textInput("seed_keywords", "Seed keywords"), urlInput("website_url", "Website URL")],
    steps: [
      { title: "Pull keywords", detail: "Gather 50-100 keywords with volume, difficulty, CPC, parent topic, and current positions." },
      { title: "Cluster intent", detail: "Group informational, commercial, transactional, and navigational opportunities." },
      { title: "Prioritise calendar", detail: "Score opportunities and output keyword, content type, title, priority, and publish month." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "site-architecture-audit",
    title: "Site Architecture Audit",
    category: "seo",
    purpose: "Map site structure, detect architecture issues, and propose redirects and internal links.",
    inputs: [urlInput("website_url", "Website URL")],
    steps: [
      { title: "Map structure", detail: "Read sitemap, menus, footer, URL patterns, and page depth." },
      { title: "Find issues", detail: "Flag orphaned, near-duplicate, deep, paginated, and thin taxonomy pages." },
      { title: "Redesign architecture", detail: "Produce pillar tree, redirect plan, and internal linking plan." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "schema-markup-audit",
    title: "Schema Markup Audit",
    category: "seo",
    purpose: "Audit existing schema and generate production-ready JSON-LD recommendations.",
    inputs: [urlInput("website_url", "Website URL")],
    steps: [
      { title: "Audit schema", detail: "Inspect homepage, blog, product/service, FAQ, and pricing pages." },
      { title: "Identify gaps", detail: "Find missing Article, FAQPage, Product, BreadcrumbList, Organization, WebSite, SoftwareApplication, and HowTo types." },
      { title: "Generate implementation", detail: "Create JSON-LD for priority pages and validation rollout guidance." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "seo-site-audit",
    title: "SEO Site Audit",
    category: "seo",
    purpose: "Run a legacy-format SEO audit with step-completion markers.",
    focusSkills: ["seo-audit", "cro", "agent-browser"],
    inputs: [urlInput("website_url", "Website URL")],
    steps: [
      { title: "Crawl top pages", detail: "List the top 10 pages and capture core metadata." },
      { title: "Analyse on-page SEO", detail: "Review titles, meta descriptions, H1s, alt text, and internal links." },
      { title: "Check technical SEO", detail: "Inspect robots, sitemap, canonicals, viewport, and load indicators." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "seo-page-map-url-structure-planner-dataforseo",
    title: "SEO Page Map + URL Structure Planner",
    category: "seo",
    purpose: "Build an implementation-ready SEO page architecture handoff.",
    focusSkills: ["ai-seo", "magister-dataforseo"],
    inputs: [urlInput("website_url", "Website URL"), textInput("market_context", "Market context", false)],
    steps: [
      { title: "Expand keywords", detail: "Collect and cluster keyword opportunities with competition and impact." },
      { title: "Map pages", detail: "Assign clusters to new or updated pages, URL patterns, buyer stage, and priority." },
      { title: "Generate handoff", detail: "Write README, page lists, URL rules, internal linking plan, and per-page briefs." },
    ],
  }),
  workflowTemplate({
    key: "social_publishing",
    magisterSlug: "buffer-social-queue",
    title: "Buffer Social Queue",
    category: "social",
    purpose: "Plan, write, review, and approval-gate a social queue in Buffer.",
    approvalGate: "Ask before scheduling or posting externally",
    approvalLevel: "approval_required",
    requiredConnections: ["buffer", "linkedin", "x", "instagram", "facebook"],
    focusSkills: ["social", "copywriting"],
    inputs: [textInput("brand_name", "Brand"), textInput("week_theme", "Week theme"), textInput("platforms", "Platforms")],
    steps: [
      { title: "Plan mix", detail: "Create a balanced 7-day queue with varied content types and platforms." },
      { title: "Write platform copy", detail: "Draft platform-native posts with hashtags, links, and timing." },
      { title: "Review queue", detail: "Check spacing, balance, links, and request approval before scheduling." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "social-content-calendar",
    title: "Social Content Calendar",
    category: "social",
    purpose: "Draft a 7-day platform-adapted social content calendar.",
    approvalGate: "Ask before external post",
    approvalLevel: "approval_required",
    requiredConnections: ["linkedin", "x", "threads", "instagram"],
    focusSkills: ["social", "copywriting"],
    inputs: [textInput("brand_name", "Brand"), textInput("topic_focus", "Topic focus"), textInput("platforms", "Platforms")],
    steps: [
      { title: "Research angles", detail: "Shortlist five current angles the brand can credibly own." },
      { title: "Plan the mix", detail: "Build a 7-day mix across educational, promotional, and engagement posts." },
      { title: "Draft platform copy", detail: "Write platform-adapted copy with hashtags, timing, and approval state." },
    ],
  }),
  workflowTemplate({
    magisterSlug: "pricing-strategy-review",
    title: "Pricing Strategy Review",
    category: "strategy",
    purpose: "Compare pricing pages and recommend a value-aligned pricing structure and test.",
    inputs: [textInput("product_name", "Product"), textInput("current_pricing", "Current pricing"), textInput("target_market", "Target market")],
    steps: [
      { title: "Research pricing", detail: "Compare 5-7 competitors by price points, tiers, discounts, and packaging." },
      { title: "Analyse value metric", detail: "Check whether the charging unit scales with customer success." },
      { title: "Recommend structure", detail: "Propose tiers, names, pricing page copy, and one quick-win test." },
    ],
  }),
];

export const marketingWorkflowFindingContract = {
  findingPathPattern: "resources/findings/{TODAY}/{SLUG}-{RUN_ID}.md",
  idempotency: "Use the workflow run id as the idempotency key.",
  verification: "Reference the real artifact path in one passed verification check.",
  blocker:
    "If the workflow cannot finish, emit a blocker finding with owner, retryable, reason, and next step.",
} as const;

const workflowKeywords: Array<[MarketingWorkflowKey, RegExp]> = [
  ["audit_refresh", /\b(audit|health|score|crawl|crawler|seo|geo)\b/i],
  ["impact_checkpoint", /\b(impact|metric|analytics|gsc|ga4|checkpoint|baseline|delta)\b/i],
  ["plan_execution", /\b(plan|next best action|execute|execution|task|roadmap)\b/i],
  ["tracker_checkins", /\b(tracker|stuck|check[- ]?in|needs input|follow[- ]?up|reconcile)\b/i],
  ["social_publishing", /\b(social|linkedin|twitter|x |threads|instagram|tiktok|post|publish)\b/i],
  ["email_outbound", /\b(email|gmail|newsletter|resend|mailchimp|kit|klaviyo|send)\b/i],
  ["standard_brief", /\b(brief|daily|summary|action list)\b/i],
];

export function classifyMarketingWorkflow(job: Pick<CronJob, "name" | "description" | "prompt">): MarketingWorkflowKey {
  const haystack = `${job.name}\n${job.description}\n${job.prompt}`;
  const normalized = haystack.toLowerCase();
  for (const template of marketingWorkflowTemplates) {
    const keyMarker = template.key.replace(/_/g, "-");
    const titleMarker = `magister - ${template.title.toLowerCase()}`;
    if (
      normalized.includes(template.magisterSlug.toLowerCase()) ||
      normalized.includes(keyMarker) ||
      normalized.includes(titleMarker)
    ) {
      return template.key;
    }
  }

  return workflowKeywords.find(([, pattern]) => pattern.test(haystack))?.[0] ?? "custom";
}

export function getMarketingWorkflowTemplate(key: MarketingWorkflowKey): MarketingWorkflowTemplate | null {
  return marketingWorkflowTemplates.find((template) => template.key === key) ?? null;
}

export function getMarketingWorkflowTemplateBySlug(slug: string): MarketingWorkflowTemplate | null {
  return marketingWorkflowTemplates.find((template) => template.magisterSlug === slug) ?? null;
}

export function requiresMarketingApproval(template: MarketingWorkflowTemplate): boolean {
  return template.approvalLevel === "approval_required";
}

export function getMarketingWorkflowSchedule(template: MarketingWorkflowTemplate): Pick<MarketingWorkflowSchedule, "time" | "days"> {
  return template.schedule ?? template.defaultSchedule;
}

export function buildMarketingWorkflowPrompt(template: MarketingWorkflowTemplate): string {
  const schedule = template.schedule
    ? `${template.schedule.cronExpression} (${template.schedule.time}, ${template.schedule.days}, ${template.schedule.timezoneStrategy})`
    : `Campaign-triggered template. Default local review cadence: ${template.defaultSchedule.days} at ${template.defaultSchedule.time}.`;
  const connectionList =
    template.requiredConnections.length > 0
      ? template.requiredConnections.join(", ")
      : "No required external connector.";
  const skillList = template.focusSkills.length > 0 ? template.focusSkills.join(", ") : "Use the closest AI-OS marketing skill.";
  const inputList =
    template.inputs.length > 0
      ? template.inputs
          .map((input) => `- ${input.label}${input.required ? " (required)" : ""}: ${input.placeholder ?? input.name}`)
          .join("\n")
      : "- No template-specific inputs. Read the selected client context and current plan.";
  const stepList = template.steps
    .map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`)
    .join("\n");
  const artifactSlug = template.magisterSlug;
  const gatewayNote = template.isGatewayOwned
    ? "This Magister source loop is gateway-owned. In AI-OS, mirror the gateway responsibility locally. If the local implementation is missing, record a blocker finding instead of pretending it ran."
    : "Run this as a local AI-OS scheduled agent workflow.";
  const externalGuard = requiresMarketingApproval(template)
    ? "External action guard: do not publish, schedule, send, deploy, spend, delete, upgrade, or modify any external account without explicit user approval in this task. Draft local artifacts and record the approval request instead."
    : "External action guard: keep the run local/read-only unless the user explicitly approves a live action in this task.";

  return [
    `You are running the AI-OS local version of the Magister workflow "${template.title}" (${artifactSlug}).`,
    "",
    `Purpose: ${template.purpose}`,
    `Category: ${template.category}`,
    `Schedule: ${schedule}`,
    `Approval gate: ${template.approvalGate}`,
    `Required connections: ${connectionList}`,
    `Source focus skills: ${skillList}`,
    "",
    "Inputs to gather:",
    inputList,
    "",
    "Steps:",
    stepList,
    "",
    gatewayNote,
    externalGuard,
    "",
    "Completion contract:",
    `- Write a complete markdown report to resources/findings/{TODAY}/${artifactSlug}-{RUN_ID}.md. Never write a placeholder report.`,
    "- Upsert one local marketing finding with version=1 and the workflow run id as the idempotency key.",
    "- Include one verification check that points at the report artifact path.",
    `- Key evidence expected: ${template.expectedEvidence}.`,
    `- ${marketingWorkflowFindingContract.blocker}`,
  ].join("\n");
}

export function buildMarketingWorkflowCronInput(key: Exclude<MarketingWorkflowKey, "custom">): CronJobCreateInput {
  const template = getMarketingWorkflowTemplate(key);
  if (!template || template.key === "custom") {
    throw new Error(`Unknown marketing workflow template: ${key}`);
  }

  const schedule = getMarketingWorkflowSchedule(template);
  return {
    name: `Magister - ${template.title}`,
    description: `Magister ${template.category} template ${template.magisterSlug}. ${template.purpose}`,
    time: schedule.time,
    days: schedule.days,
    model: "sonnet",
    notify: template.notifyOnComplete ? "on_finish" : "silent",
    timeout: template.isGatewayOwned ? "45m" : "60m",
    retry: template.approvalLevel === "approval_required" ? 0 : 1,
    prompt: buildMarketingWorkflowPrompt(template),
  };
}

export function formatScheduleLabel(days: string, time: string): string {
  const dayMap: Record<string, string> = {
    daily: "Daily",
    weekdays: "Weekdays",
    weekends: "Weekends",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };

  const dayParts = days.split(",").map((day) => dayMap[day.trim()] || day.trim());
  return `${dayParts.join(", ")} at ${time}`;
}

export function formatRelativeRunTime(iso: string | null): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const absDiffMs = Math.abs(diffMs);
  const diffMin = Math.floor(absDiffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return future ? "in < 1m" : "just now";
  if (diffMin < 60) return future ? `in ${diffMin}m` : `${diffMin}m ago`;
  if (diffHr < 24) return future ? `in ${diffHr}h` : `${diffHr}h ago`;
  if (diffDays < 30) return future ? `in ${diffDays}d` : `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
