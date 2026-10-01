const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const { diffContentsForConflict, diffLines } = loadTsModule(
  path.resolve(__dirname, "sync-diff.ts"),
);

function compact(lines) {
  return lines.map((line) => `${line.kind}:${line.value}`);
}

test("push diff treats local content as additions", () => {
  const content = diffContentsForConflict({
    operation: "write-remote",
    localContent: "server\nlocal add\n",
    remoteContent: "server\n",
  }, "push");

  assert.deepEqual(compact(diffLines(content.beforeContent, content.afterContent)), [
    "same:server",
    "add:local add",
  ]);
});

test("pull diff treats server content as additions", () => {
  const content = diffContentsForConflict({
    operation: "write-local",
    localContent: "local\n",
    remoteContent: "local\nserver add\n",
  }, "pull");

  assert.deepEqual(compact(diffLines(content.beforeContent, content.afterContent)), [
    "same:local",
    "add:server add",
  ]);
});

test("delete-local diff removes local content", () => {
  const content = diffContentsForConflict({
    operation: "delete-local",
    localContent: "delete me\n",
  }, "pull");

  assert.deepEqual(compact(diffLines(content.beforeContent, content.afterContent)), [
    "remove:delete me",
  ]);
});

test("delete-remote diff removes server content", () => {
  const content = diffContentsForConflict({
    operation: "delete-remote",
    remoteContent: "delete server\n",
  }, "push");

  assert.deepEqual(compact(diffLines(content.beforeContent, content.afterContent)), [
    "remove:delete server",
  ]);
});
