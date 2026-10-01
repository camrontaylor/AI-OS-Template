const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "brand-context-banner-state.ts");
const banner = loadTsModule(modulePath, {
  stubs: {
    "@/components/onboarding/onboarding-state": loadTsModule(
      path.resolve(__dirname, "../onboarding/onboarding-state.ts"),
    ),
  },
});

function task(overrides = {}) {
  return {
    id: "task-1",
    title: "Start Here",
    description: "Run /start-here",
    status: "backlog",
    clientId: null,
    parentId: null,
    ...overrides,
  };
}

test("brand context banner only shows for confirmed missing context", () => {
  assert.equal(banner.shouldShowBrandContextBanner(false), true);
  assert.equal(banner.shouldShowBrandContextBanner(true), false);
  assert.equal(banner.shouldShowBrandContextBanner(null), false);
});

test("brand context banner copy is scoped to the selected workspace", () => {
  assert.match(banner.getBrandContextBannerMessage(null), /^Brand context is missing\./);
  assert.match(banner.getBrandContextBannerMessage("acme"), /^This client is missing brand context\./);
});

test("brand context banner queues the selected client's Start Here task", () => {
  const root = task({ id: "root-start", clientId: null });
  const acme = task({ id: "acme-start", clientId: "acme" });

  assert.equal(banner.findStartHereTaskToQueue([root, acme], null, "acme").id, "acme-start");
  assert.equal(banner.findStartHereTaskToQueue([root, acme], null, null).id, "root-start");
  assert.equal(banner.shouldQueueBrandStartHereTask(acme), true);
  assert.equal(banner.shouldQueueBrandStartHereTask(task({ status: "queued" })), false);
});
