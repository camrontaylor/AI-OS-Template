const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "onboarding-state.ts");
const onboarding = loadTsModule(modulePath);

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function visibility(overrides = {}) {
  return onboarding.shouldShowOnboarding({
    forceVisible: false,
    storage: { completed: false, legacySeen: false },
    tasksReady: true,
    hasBrandContext: false,
    dismissedForSession: false,
    ...overrides,
  });
}

function task(overrides = {}) {
  return {
    id: "task-1",
    title: onboarding.START_HERE_TITLE,
    description: onboarding.START_HERE_DESCRIPTION,
    status: "queued",
    clientId: null,
    parentId: null,
    ...overrides,
  };
}

test("started but incomplete onboarding shows again after reload", () => {
  assert.equal(visibility({ hasBrandContext: false }), true);
  assert.equal(visibility({ hasBrandContext: false, dismissedForSession: true }), false);
  assert.equal(visibility({ hasBrandContext: false, dismissedForSession: false }), true);
});

test("automatic onboarding is root-only", () => {
  assert.equal(visibility({ hasBrandContext: false, selectedClientId: "acme" }), false);
  assert.equal(visibility({ forceVisible: true, hasBrandContext: false, selectedClientId: "acme" }), true);
});

test("existing unfinished Start Here task is reused", () => {
  const existing = task({ id: "existing-start-here", status: "running" });
  const done = task({ id: "done-start-here", status: "done" });

  assert.equal(
    onboarding.findReusableStartHereTask([existing], null).id,
    "existing-start-here",
  );
  assert.equal(onboarding.findReusableStartHereTask([done], null), null);
});

test("completed brand context hides onboarding and records completion", () => {
  const storage = createStorage({
    [onboarding.LEGACY_ONBOARDING_SEEN_STORAGE_KEY]: "true",
  });

  assert.equal(visibility({ hasBrandContext: true }), false);

  onboarding.markOnboardingCompleted(storage);

  assert.equal(storage.getItem(onboarding.ONBOARDING_COMPLETED_STORAGE_KEY), "true");
  assert.equal(storage.getItem(onboarding.LEGACY_ONBOARDING_SEEN_STORAGE_KEY), null);
});

test("completed onboarding suppresses automatic onboarding even if root context is missing later", () => {
  assert.equal(visibility({
    hasBrandContext: false,
    storage: { completed: true, legacySeen: false },
  }), false);
});

test("old seen key does not hide onboarding when brand context is missing", () => {
  const storage = createStorage({
    [onboarding.LEGACY_ONBOARDING_SEEN_STORAGE_KEY]: "true",
  });
  const stored = onboarding.readOnboardingStorage(storage);

  assert.equal(stored.legacySeen, true);
  assert.equal(stored.completed, false);
  assert.equal(visibility({ hasBrandContext: false }), true);
});

test("backlog Start Here task should be queued before closing onboarding", () => {
  assert.equal(onboarding.shouldQueueStartHereTask(task({ status: "backlog" })), true);
  assert.equal(onboarding.shouldQueueStartHereTask(task({ status: "queued" })), false);
});

test("reusable Start Here lookup is scoped to the selected client", () => {
  const root = task({ id: "root-start", status: "backlog", clientId: null });
  const acme = task({ id: "acme-start", status: "backlog", clientId: "acme" });

  assert.equal(onboarding.findReusableStartHereTask([root, acme], "acme").id, "acme-start");
  assert.equal(onboarding.findReusableStartHereTask([root, acme], null).id, "root-start");
});
