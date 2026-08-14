const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const workflows = loadTsModule(path.resolve(__dirname, "marketing-workflows.ts"));
const scheduled = loadTsModule(path.resolve(__dirname, "marketing-scheduled-operations.ts"), {
  stubs: {
    "@/lib/marketing-workflows": workflows,
  },
});

function cronJob(overrides) {
  return {
    name: "Scheduled job",
    slug: "scheduled-job",
    description: "",
    time: "08:00",
    days: "daily",
    active: true,
    model: "sonnet",
    notify: "silent",
    timeout: "45m",
    retry: 1,
    nextRun: "2026-08-04T23:00:00.000Z",
    lastRun: null,
    stats: {
      totalRuns: 0,
      avgDurationSec: 0,
      avgCostUsd: 0,
    },
    prompt: "",
    clientId: null,
    workspaceKey: "root",
    workspaceLabel: "AI-OS",
    workspaceDir: "/workspace",
    ...overrides,
  };
}

test("buildScheduledOperationsBoard groups cron jobs into operator lanes", () => {
  const jobs = [
    cronJob({
      name: "Magister - Plan execution",
      slug: "plan-execution",
      prompt: workflows.buildMarketingWorkflowCronInput("plan_execution").prompt,
      nextRun: "2026-08-04T22:00:00.000Z",
    }),
    cronJob({
      name: "Magister - Audit refresh",
      slug: "audit-refresh",
      prompt: workflows.buildMarketingWorkflowCronInput("audit_refresh").prompt,
      lastRun: {
        lastRun: "2026-08-04T08:00:00.000Z",
        result: "failure",
        duration: 55,
        exitCode: 1,
        runCount: 10,
        failCount: 1,
      },
    }),
    cronJob({
      name: "Magister - Social Content Calendar",
      slug: "social-calendar",
      prompt: workflows.buildMarketingWorkflowCronInput("social-content-calendar").prompt,
      active: false,
      nextRun: null,
    }),
    cronJob({
      name: "Magister - Standard brief",
      slug: "standard-brief",
      prompt: workflows.buildMarketingWorkflowCronInput("standard_brief").prompt,
      nextRun: "2026-08-04T21:00:00.000Z",
    }),
  ];

  const board = scheduled.buildScheduledOperationsBoard(
    jobs,
    {
      "root:plan-execution": {
        taskId: "task-plan",
        status: "running",
        activityLabel: "Compiling plan context",
      },
    },
    { now: new Date("2026-08-04T20:00:00.000Z") },
  );

  assert.deepEqual(
    board.lanes.map((lane) => [lane.key, lane.operations.map((operation) => operation.job.slug)]),
    [
      ["running", ["plan-execution"]],
      ["needs_attention", ["audit-refresh"]],
      ["upcoming", ["standard-brief"]],
      ["paused", ["social-calendar"]],
    ],
  );
  assert.equal(board.summary.running, 1);
  assert.equal(board.summary.needsAttention, 1);
  assert.equal(board.summary.paused, 1);
  assert.equal(board.summary.upcoming, 1);
  assert.equal(board.lanes[1].operations[0].statusLabel, "Failed");
  assert.equal(board.lanes[1].operations[0].nextActionLabel, "Review failure output");
});

test("scheduled operations expose workflow, approval, and next action labels", () => {
  const socialInput = workflows.buildMarketingWorkflowCronInput("social_publishing");
  const board = scheduled.buildScheduledOperationsBoard(
    [
      cronJob({
        name: "Magister - Buffer Social Queue",
        slug: "buffer-social-queue",
        description: socialInput.description,
        days: socialInput.days,
        time: socialInput.time,
        prompt: socialInput.prompt,
        nextRun: "2026-08-04T21:30:00.000Z",
        stats: {
          totalRuns: 4,
          avgDurationSec: 120,
          avgCostUsd: 0,
        },
      }),
    ],
    {},
    { now: new Date("2026-08-04T20:00:00.000Z") },
  );

  const operation = board.operations[0];

  assert.equal(operation.workflowTitle, "Buffer Social Queue");
  assert.equal(operation.categoryLabel, "Social");
  assert.equal(operation.approvalLabel, "Approval required");
  assert.equal(operation.statusLabel, "Scheduled");
  assert.equal(operation.statusBadgeVariant, "secondary");
  assert.equal(operation.nextActionLabel, "Review approval gate");
  assert.equal(operation.scheduleLabel, "Weekdays at 09:00");
  assert.equal(operation.nextRunLabel, "in 1h");
  assert.equal(operation.lastRunLabel, "--");
});
