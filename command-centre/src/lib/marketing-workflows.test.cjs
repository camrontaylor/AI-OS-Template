const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const workflows = loadTsModule(path.resolve(__dirname, "marketing-workflows.ts"));

test("marketing workflow templates include the five Magister system loop cadences", () => {
  const expected = new Map([
    ["standard_brief", ["default-brief-orchestrator", "0 8 * * *", "daily", "08:00"]],
    ["audit_refresh", ["audit-refresh-loop", "0 7 * * 1", "mon", "07:00"]],
    ["impact_checkpoint", ["impact-checkpoint-loop", "30 7 * * 1", "mon", "07:30"]],
    ["plan_execution", ["plan-execution-loop", "0 8 * * 1", "mon", "08:00"]],
    ["tracker_checkins", ["tracker-checkins-weekly", "0 9 * * 1", "mon", "09:00"]],
  ]);

  for (const [key, [slug, cronExpression, days, time]] of expected) {
    const template = workflows.getMarketingWorkflowTemplate(key);
    assert.equal(template.isSystemLoop, true);
    assert.equal(template.magisterSlug, slug);
    assert.equal(template.schedule.cronExpression, cronExpression);
    assert.equal(template.defaultSchedule.days, days);
    assert.equal(template.defaultSchedule.time, time);
  }
});

test("marketing workflow templates mirror the reverse-engineered 36-template Magister catalog", () => {
  const expectedSlugs = [
    "default-brief-orchestrator",
    "audit-refresh-loop",
    "impact-checkpoint-loop",
    "plan-execution-loop",
    "tracker-checkins-weekly",
    "posthog-funnel-analysis",
    "monthly-marketing-report",
    "product-launch-campaign",
    "wordpress-blog-publisher",
    "blog-post",
    "landing-page-copy",
    "marketing-psychology-copy-review",
    "cro-audit",
    "ab-test-design",
    "kit-email-campaign",
    "email-newsletter",
    "lead-nurture-sequence",
    "free-tool-strategy",
    "instantly-outreach-campaign",
    "cold-outreach-campaign",
    "apollo-prospect-list",
    "google-ads-performance-review",
    "ad-copy-generation",
    "competitor-analysis",
    "churn-prevention-campaign",
    "hubspot-pipeline-review",
    "programmatic-seo-batch",
    "ai-search-optimization",
    "ahrefs-keyword-research",
    "site-architecture-audit",
    "schema-markup-audit",
    "seo-site-audit",
    "seo-page-map-url-structure-planner-dataforseo",
    "buffer-social-queue",
    "social-content-calendar",
    "pricing-strategy-review",
  ];
  const actualSlugs = workflows.marketingWorkflowTemplates.map((template) => template.magisterSlug);

  assert.equal(actualSlugs.length, 36);
  assert.deepEqual(actualSlugs, expectedSlugs);
});

test("compiled workflow job prompt carries the local finding and blocker contract", () => {
  const input = workflows.buildMarketingWorkflowCronInput("tracker_checkins");

  assert.equal(input.name, "Magister - Tracker check-ins");
  assert.equal(input.days, "mon");
  assert.equal(input.time, "09:00");
  assert.match(input.prompt, /resources\/findings\/\{TODAY\}\/tracker-checkins-weekly-\{RUN_ID\}\.md/);
  assert.match(input.prompt, /workflow run id as the idempotency key/);
  assert.match(input.prompt, /blocker finding with owner, retryable, reason, and next step/);
  assert.equal(workflows.classifyMarketingWorkflow(input), "tracker_checkins");
});

test("compiled approval-gated workflows forbid live external actions without user approval", () => {
  const input = workflows.buildMarketingWorkflowCronInput("social_publishing");

  assert.equal(input.days, "weekdays");
  assert.equal(input.retry, 0);
  assert.match(input.prompt, /do not publish, schedule, send, deploy, spend, delete, upgrade/);
  assert.match(input.prompt, /record the approval request/);
  assert.equal(workflows.classifyMarketingWorkflow(input), "social_publishing");
});

test("live publishing and outbound templates are approval-gated before external side effects", () => {
  for (const slug of [
    "wordpress-blog-publisher",
    "kit-email-campaign",
    "instantly-outreach-campaign",
    "apollo-prospect-list",
    "buffer-social-queue",
  ]) {
    const template = workflows.getMarketingWorkflowTemplateBySlug(slug);
    assert.equal(template.approvalLevel, "approval_required");
    const input = workflows.buildMarketingWorkflowCronInput(template.key);
    assert.match(input.prompt, /do not publish, schedule, send, deploy, spend, delete, upgrade/);
  }
});

test("compiled workflow inputs classify back to their source template", () => {
  for (const template of workflows.marketingWorkflowTemplates) {
    const input = workflows.buildMarketingWorkflowCronInput(template.key);
    assert.equal(workflows.classifyMarketingWorkflow(input), template.key);
  }
});
