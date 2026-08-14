const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const workflows = loadTsModule(path.resolve(__dirname, "marketing-workflows.ts"));
const calendar = loadTsModule(path.resolve(__dirname, "marketing-calendar.ts"), {
  stubs: {
    "@/lib/marketing-workflows": workflows,
  },
});

function localIso(year, month, day, hour, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function makeJob(overrides = {}) {
  return {
    name: "Daily brief",
    slug: "daily-brief",
    description: "Compile daily brief",
    time: "08:00",
    days: "daily",
    active: true,
    model: "sonnet",
    notify: "silent",
    timeout: "30s",
    retry: 0,
    nextRun: localIso(2026, 8, 3, 22),
    lastRun: null,
    stats: { totalRuns: 0, avgDurationSec: 0, avgCostUsd: 0 },
    prompt: "Create a capped daily marketing brief.",
    clientId: null,
    workspaceKey: "root",
    workspaceLabel: "Root",
    workspaceDir: "/tmp/ai-os",
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: "task-1",
    title: "Draft homepage schema",
    description: "Plan task",
    status: "queued",
    level: "task",
    parentId: null,
    projectSlug: "marketing-plan",
    columnOrder: 0,
    createdAt: localIso(2026, 8, 2, 8),
    updatedAt: localIso(2026, 8, 3, 8),
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
    permissionMode: "default",
    executionPermissionMode: "default",
    model: null,
    thinkingEffort: null,
    lastReplyAt: null,
    goalGroup: null,
    tag: null,
    pinnedAt: null,
    ...overrides,
  };
}

test("buildMarketingCalendarItems maps scheduled jobs and open plan work into one ordered calendar", () => {
  const now = new Date(2026, 7, 3, 9);
  const items = calendar.buildMarketingCalendarItems({
    now,
    jobs: [
      makeJob({
        name: "Schedule LinkedIn launch post",
        slug: "linkedin-launch",
        description: "Social publishing",
        prompt: "Draft and schedule a LinkedIn post after approval.",
        nextRun: localIso(2026, 8, 4, 10),
      }),
      makeJob({
        name: "Paused audit",
        slug: "paused-audit",
        active: false,
        nextRun: localIso(2026, 8, 4, 11),
      }),
    ],
    tasks: [
      makeTask({
        id: "task-plan",
        title: "Rewrite homepage H1",
        updatedAt: localIso(2026, 8, 3, 12),
      }),
    ],
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].id, "task:task-plan");
  assert.equal(items[0].type, "plan");
  assert.equal(items[1].id, "cron:root:linkedin-launch");
  assert.equal(items[1].type, "social");
  assert.equal(items[1].requiresApproval, true);
});

test("buildMarketingCalendarItems surfaces needs-input tasks as approval items today", () => {
  const now = new Date(2026, 7, 3, 9);
  const [item] = calendar.buildMarketingCalendarItems({
    now,
    jobs: [],
    tasks: [
      makeTask({
        id: "task-approval",
        title: "Approve newsletter send",
        status: "review",
        needsInput: true,
        activityLabel: "Needs permission to send campaign.",
        updatedAt: localIso(2026, 7, 29, 8),
      }),
    ],
  });

  assert.equal(item.type, "approval");
  assert.equal(item.status, "needs_input");
  assert.equal(item.requiresApproval, true);
  assert.equal(item.at, now.toISOString());
});

test("getCalendarTypeForTask does not treat review wording as approval without review state", () => {
  const type = calendar.getCalendarTypeForTask(
    makeTask({
      title: "Review competitor ad hooks",
      status: "queued",
      needsInput: false,
    }),
  );

  assert.equal(type, "plan");
});

test("getCalendarTypeForJob uses workflow catalog category, not only legacy family keys", () => {
  const socialInput = workflows.buildMarketingWorkflowCronInput("social-content-calendar");
  const emailInput = workflows.buildMarketingWorkflowCronInput("email-newsletter");

  assert.equal(calendar.getCalendarTypeForJob(makeJob(socialInput)), "social");
  assert.equal(calendar.getCalendarTypeForJob(makeJob(emailInput)), "email");
});

test("groupMarketingCalendarItemsByDay returns a stable seven-day agenda", () => {
  const now = new Date(2026, 7, 3, 9);
  const items = calendar.buildMarketingCalendarItems({
    now,
    jobs: [
      makeJob({ nextRun: localIso(2026, 8, 3, 22) }),
      makeJob({
        name: "Weekly audit refresh",
        slug: "weekly-audit",
        description: "Audit refresh",
        prompt: "Run audit refresh.",
        nextRun: localIso(2026, 8, 6, 8),
      }),
    ],
    tasks: [],
  });
  const days = calendar.groupMarketingCalendarItemsByDay({ items, now, dayCount: 7 });

  assert.equal(days.length, 7);
  assert.equal(days[0].label, "Today");
  assert.equal(days[0].items.length, 1);
  assert.equal(days[3].date, "2026-08-06");
  assert.equal(days[3].items[0].id, "cron:root:weekly-audit");
});
