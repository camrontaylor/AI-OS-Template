const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const analytics = loadTsModule(path.resolve(__dirname, "marketing-analytics.ts"));
const repoRoot = path.resolve(__dirname, "../../..");
const auditFile = "projects/briefs/magister-replication/magister-generated-docs/2026-07-27-light-audit.md";
const planFile = "projects/briefs/magister-replication/magister-generated-docs/PLAN.md";

function buildSnapshot() {
  return analytics.buildMarketingAnalyticsSnapshot({
    auditMarkdown: fs.readFileSync(path.join(repoRoot, auditFile), "utf8"),
    planMarkdown: fs.readFileSync(path.join(repoRoot, planFile), "utf8"),
    auditFile,
    planFile,
  });
}

test("buildMarketingAnalyticsSnapshot parses audit header and health projection", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.auditDate, "2026-07-27");
  assert.equal(snapshot.auditType, "light audit");
  assert.equal(snapshot.sourceAuditId, "8bb7c0b7-0464-48c4-bf6c-238b6d8f7b1b");
  assert.equal(snapshot.healthCurrent, 19);
  assert.equal(snapshot.healthProjected, 51);
});

test("buildMarketingAnalyticsSnapshot parses channels, prompts, geo checks, and keywords", () => {
  const snapshot = buildSnapshot();
  const aiVisibility = analytics.getChannelByTitle(snapshot.channels, "AI Visibility");
  const geo = analytics.getChannelByTitle(snapshot.channels, "GEO");
  const seo = analytics.getChannelByTitle(snapshot.channels, "SEO");

  assert.equal(snapshot.channels.length, 6);
  assert.equal(aiVisibility.readiness, 0);
  assert.equal(aiVisibility.prompts.length, 3);
  assert.equal(aiVisibility.prompts[0].status, "not mentioned");
  assert.equal(geo.readiness, 40);
  assert.equal(snapshot.geoChecks.length, 16);
  assert.equal(snapshot.geoChecks.filter((check) => check.status === "fail").length, 8);
  assert.equal(seo.keywords.length, 5);
  assert.equal(seo.keywords.find((item) => item.keyword === "automation for professional services").volume, 10);
});

test("buildMarketingAnalyticsSnapshot parses active plan items and activity", () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.planItems.length, 8);
  assert.equal(snapshot.planItems.filter((item) => item.status === "ready").length, 3);
  assert.equal(snapshot.planItems[0].phase, "today");
  assert.equal(snapshot.planItems[0].channel, "AI visibility");
  assert.equal(snapshot.planItems[0].approval, "publish");
  assert.match(snapshot.planItems[0].prompt, /plain-text llms\.txt file/);
  assert.ok(snapshot.planItems[0].evidence.length >= 2);
  assert.equal(snapshot.activity.length, 6);
  assert.equal(snapshot.activity[0].event, "metric_baseline_captured");
});

test("getAnalyticsSummary returns Magister-style operating counts", () => {
  const snapshot = buildSnapshot();
  const summary = analytics.getAnalyticsSummary(snapshot);

  assert.equal(summary.healthDelta, 32);
  assert.equal(summary.readyPlanItems, 3);
  assert.equal(summary.approvalPlanItems, 5);
  assert.equal(summary.promptCount, 3);
  assert.equal(summary.absentPromptCount, 3);
  assert.equal(summary.failedGeoChecks, 8);
  assert.equal(summary.passedGeoChecks, 8);
});
