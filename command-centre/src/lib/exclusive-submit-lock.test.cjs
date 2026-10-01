const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const { createExclusiveSubmitLock } = loadTsModule(path.resolve(__dirname, "exclusive-submit-lock.ts"));

test("only one concurrent first Chat submission can acquire the creation lock", () => {
  const lock = createExclusiveSubmitLock();
  assert.equal(lock.tryAcquire(), true);
  assert.equal(lock.tryAcquire(), false);
  lock.release();
  assert.equal(lock.tryAcquire(), true);
});
