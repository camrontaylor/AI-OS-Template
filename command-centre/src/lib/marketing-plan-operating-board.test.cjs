const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const analytics = loadTsModule(path.resolve(__dirname, "marketing-analytics.ts"));
const compiler = loadTsModule(path.resolve(__dirname, "marketing-plan-compiler.ts"));
const boardModule = loadTsModule(path.resolve(__dirname, "marketing-plan-operating-board.ts"), {
  stubs: {
    "@/lib/marketing-plan-compiler": compiler,
  },
});

const repoRoot = path.resolve(__dirname, "../../..");
const auditFile = "projects/briefs/magister-replication/magister-generated-docs/2026-07-27-light-audit.md";
const planFile = "projects/briefs/magister-replication/magister-generated-docs/PLAN.md";

function buildPlan() {
  const snapshot = analytics.buildMarketingAnalyticsSnapshot({
    auditMarkdown: fs.readFileSync(path.join(repoRoot, auditFile), "utf8"),
    planMarkdown: fs.readFileSync(path.join(repoRoot, planFile), "utf8"),
    auditFile,
    planFile,
  });
  return compiler.compileMarketingPlan(snapshot);
}

function taskForDraft(draft, overrides = {}) {
  return {
    id: `task-${draft.id}`,
    title: draft.title,
    description: compiler.buildPlanTaskDescription(draft),
    status: "queued",
    level: "task",
    parentId: null,
    projectSlug: null,
    columnOrder: 0,
    createdAt: "2026-08-04T01:00:00.000Z",
    updatedAt: "2026-08-04T02:00:00.000Z",
    costUsd: null,
    tokensUsed: null,
    durationMs: null,
    activityLabel: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    clientId: null,
    needsInput: false,
    phaseNumber: null,
    gsdStep: null,
    contextSources: null,
    cronJobSlug: null,
    claudeSessionId: null,
    permissionMode: "plan",
    executionPermissionMode: "acceptEdits",
    lastReplyAt: null,
    goalGroup: null,
    tag: null,
    pinnedAt: null,
    ...overrides,
  };
}

test("buildMarketingPlanOperatingBoard groups plan drafts into execution lanes", () => {
  const plan = buildPlan();
  const [llms, playbook, ssrAudit, ssrImplementation] = plan.taskDrafts;
  const tasks = [
    taskForDraft(playbook, { status: "running", activityLabel: "Writing playbook outline" }),
    taskForDraft(ssrAudit, { status: "review", needsInput: true, activityLabel: "Needs approval before code changes" }),
    taskForDraft(ssrImplementation, { status: "done", completedAt: "2026-08-04T03:00:00.000Z" }),
  ];

  const board = boardModule.buildMarketingPlanOperatingBoard(plan, tasks);

  assert.equal(board.primaryAction.draft.id, llms.id);
  assert.equal(board.primaryAction.laneKey, "work_now");
  assert.deepEqual(
    board.lanes.map((lane) => [lane.key, lane.items.map((item) => item.draft.title)]),
    [
      ["work_now", ["Draft and publish llms.txt file"]],
      ["needs_attention", ["Audit current React build and plan SSR migration"]],
      ["in_motion", ["Write and publish 'AI Operations Playbook for Early-Stage Teams'"]],
      ["ready_next", ["Create and validate JSON-LD schema (Org + Service + FAQ)"]],
      ["planned", ["Rewrite homepage H1 and deploy schema", "Draft pricing comparison page with cost/benefit tables", "Write 5 pillar pages (1,500+ words each)"]],
      ["done", ["Implement SSR for homepage and top 3 landing pages"]],
    ],
  );
  assert.equal(board.summary.total, 8);
  assert.equal(board.summary.completed, 1);
  assert.equal(board.summary.active, 2);
  assert.equal(board.summary.needsAttention, 1);
  assert.equal(board.summary.ready, 2);
  assert.equal(board.summary.planned, 3);
});

test("plan operating board exposes action labels and approval context", () => {
  const plan = buildPlan();
  const llms = plan.nextBestAction;
  const blockedTask = taskForDraft(llms, {
    status: "review",
    needsInput: true,
    activityLabel: "Approve draft-before-live handoff",
  });

  const board = boardModule.buildMarketingPlanOperatingBoard(plan, [blockedTask]);
  const item = board.lanes.find((lane) => lane.key === "needs_attention").items[0];

  assert.equal(board.primaryAction.draft.id, llms.id);
  assert.equal(item.statusLabel, "Needs input");
  assert.equal(item.statusBadgeVariant, "destructive");
  assert.equal(item.actionLabel, "Review task");
  assert.equal(item.approvalLabel, "Content publishing");
  assert.equal(item.guardrailLabel, "Approval required");
  assert.equal(item.localTaskLabel, "Local task");
});
