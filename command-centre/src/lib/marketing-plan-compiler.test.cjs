const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const analytics = loadTsModule(path.resolve(__dirname, "marketing-analytics.ts"));
const compiler = loadTsModule(path.resolve(__dirname, "marketing-plan-compiler.ts"));
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

test("compileMarketingPlan groups Magister plan items into moves", () => {
  const plan = compiler.compileMarketingPlan(buildSnapshot());

  assert.equal(plan.moves.length, 5);
  assert.equal(plan.taskDrafts.length, 8);
  assert.equal(plan.nextBestAction.title, "Draft and publish llms.txt file");
  assert.equal(plan.moves[0].title, "Create llms.txt and AI-optimized playbook content");
  assert.deepEqual(plan.moves.map((move) => move.items.length), [2, 2, 2, 1, 1]);
});

test("compileMarketingPlan creates guarded local task drafts", () => {
  const plan = compiler.compileMarketingPlan(buildSnapshot());
  const llms = plan.taskDrafts[0];
  const ssr = plan.taskDrafts.find((draft) => draft.title === "Audit current React build and plan SSR migration");

  assert.equal(llms.initialStatus, "queued");
  assert.equal(llms.permissionMode, "plan");
  assert.equal(llms.approvalGate, "Content publishing");
  assert.equal(llms.estimatedPaidSpend, "$0.00/month");
  assert.ok(llms.requiresApproval);
  assert.ok(llms.guardrails.some((guardrail) => /Do not upgrade Magister/i.test(guardrail)));
  assert.ok(llms.sourceEvidence.some((evidence) => /No llms\.txt file/i.test(evidence)));
  assert.ok(llms.metricLabels.includes("AI Search"));
  assert.equal(ssr.approvalGate, "Code and pull requests");
});

test("buildPlanTaskDescription and task marker are stable", () => {
  const plan = compiler.compileMarketingPlan(buildSnapshot());
  const draft = plan.nextBestAction;
  const description = compiler.buildPlanTaskDescription(draft);

  assert.match(description, /Magister plan draft: magister-plan:draft-and-publish-llms-txt-file/);
  assert.match(description, /Do not upgrade Magister/);
  assert.match(description, /External publishing, deploys, sends, schedules, paid spend, and account changes require explicit approval/);
  assert.match(description, /Tracked metrics:/);
  assert.ok(compiler.taskMatchesPlanDraft({ title: "Other", description }, draft));
});
