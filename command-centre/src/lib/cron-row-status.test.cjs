const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const { getCronRowStatus } = loadTsModule(path.resolve(__dirname, "cron-row-status.ts"));

test("a paused job reads Paused whatever the runtime state", () => {
  for (const leaderState of [null, "active", "stale", "absent"]) {
    const status = getCronRowStatus({ active: false, leaderState });
    assert.equal(status.kind, "paused");
    assert.equal(status.label, "Paused");
    assert.equal(status.warning, false);
  }
});

test("an enabled job reads Not running when a runtime died without releasing scheduling", () => {
  const status = getCronRowStatus({ active: true, leaderState: "stale" });
  assert.equal(status.kind, "not-running");
  assert.equal(status.label, "Not running");
  assert.equal(status.warning, true);
});

test("an enabled job reads Active when a runtime leads, after a clean release, or before status loads", () => {
  for (const leaderState of ["active", "absent", null]) {
    const status = getCronRowStatus({ active: true, leaderState });
    assert.equal(status.kind, "active");
    assert.equal(status.label, "Active");
    assert.equal(status.warning, false);
  }
});
