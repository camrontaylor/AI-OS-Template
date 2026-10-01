const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "task-composer.ts");

test("getTaskComposerPrimaryAction uses Stop only for running tasks", () => {
  const { getTaskComposerPrimaryAction } = loadTsModule(modulePath);

  assert.equal(getTaskComposerPrimaryAction("running"), "stop");
  assert.equal(getTaskComposerPrimaryAction("review"), "send");
  assert.equal(getTaskComposerPrimaryAction("queued"), "send");
  assert.equal(getTaskComposerPrimaryAction(null), "send");
});

test("getTaskComposerPrimaryAction uses Send for running parent containers", () => {
  const { getTaskComposerPrimaryAction } = loadTsModule(modulePath);

  assert.equal(
    getTaskComposerPrimaryAction("running", {
      parentId: null,
      childCount: 2,
      claudePid: null,
    }),
    "send",
  );
  assert.equal(
    getTaskComposerPrimaryAction("running", {
      parentId: null,
      childCount: 2,
      claudePid: 1234,
      activityLabel: "1/2 tasks done - next task queued",
    }),
    "send",
  );
  assert.equal(
    getTaskComposerPrimaryAction("running", {
      parentId: null,
      childCount: 2,
      claudePid: 1234,
    }),
    "stop",
  );
  assert.equal(
    getTaskComposerPrimaryAction("running", {
      parentId: "parent-task",
      childCount: 0,
      claudePid: null,
    }),
    "stop",
  );
});
