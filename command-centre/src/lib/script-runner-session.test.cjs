const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "script-runner-session.ts");
const sessionModule = loadTsModule(modulePath);

test("script runner session only starts once per execution even after dispose and reattach", () => {
  const session = sessionModule.createScriptRunnerSession();

  assert.equal(session.begin(), true);
  session.dispose();
  assert.equal(session.isDisposed(), true);

  assert.equal(session.begin(), false);
  assert.equal(session.isDisposed(), false);
});

test("script runner session only completes once", () => {
  const session = sessionModule.createScriptRunnerSession();

  session.begin();
  assert.equal(session.complete(), true);
  assert.equal(session.complete(), false);
});
