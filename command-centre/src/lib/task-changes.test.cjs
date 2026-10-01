const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const changes = loadTsModule(path.resolve(__dirname, "task-changes.ts"), {
  stubs: { "./file-diff": { computeUnifiedDiff: (before, after) => `${before}->${after}` } },
});

test("classifies text additions, modifications, unchanged files, and deletions", () => {
  const result = changes.buildTaskChanges(
    { "same.md": { size: 1, content: "a" }, "edit.md": { size: 1, content: "a" }, "gone.md": { size: 1, content: "x" } },
    { "same.md": { size: 1, content: "a" }, "edit.md": { size: 1, content: "b" }, "new.md": { size: 1, content: "n" } },
    "projects/briefs/demo",
  );
  assert.deepEqual(result.map((item) => [item.projectRelativePath, item.status]), [
    ["edit.md", "modified"], ["gone.md", "deleted"], ["new.md", "added"], ["same.md", "unchanged"],
  ]);
  assert.equal(result[0].diff, "a->b");
  assert.equal(result[1].unavailableReason, "deleted");
});

test("explains binary and oversized files without exposing content", () => {
  const result = changes.buildTaskChanges({}, {
    "asset.png": { size: 20 },
    "large.txt": { size: 300000 },
  }, "projects/briefs/demo");
  assert.equal(result[0].unavailableReason, "binary");
  assert.equal(result[1].unavailableReason, "oversized");
});

test("detects same-size binary changes by digest and reports unreadable files", () => {
  const result = changes.buildTaskChanges(
    { "asset.png": { size: 20, digest: "before", unavailableReason: "binary" } },
    {
      "asset.png": { size: 20, digest: "after", unavailableReason: "binary" },
      "locked.md": { size: 0, unavailableReason: "unreadable" },
    },
    "projects/briefs/demo",
  );
  assert.equal(result[0].status, "modified");
  assert.equal(result[0].unavailableReason, "binary");
  assert.equal(result[1].status, "added");
  assert.equal(result[1].unavailableReason, "unreadable");
});
