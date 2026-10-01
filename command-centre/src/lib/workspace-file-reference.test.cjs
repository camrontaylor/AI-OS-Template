const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const { hasWorkspaceDirectoryHint, resolveWorkspaceFileOutputPath, resolveWorkspaceFileReference } = loadTsModule(
  path.resolve(__dirname, "workspace-file-reference.ts"),
);

test("resolves supported workspace file references", () => {
  assert.equal(resolveWorkspaceFileReference("/docs/mock-file-testing.md"), "docs/mock-file-testing.md");
  assert.equal(resolveWorkspaceFileReference("docs/mock-file-testing.md"), "docs/mock-file-testing.md");
  assert.equal(resolveWorkspaceFileReference("docs/mock-file-testing.md", "projects/briefs/demo/brief.md"), "docs/mock-file-testing.md");
  assert.equal(resolveWorkspaceFileReference("./docs/mock%20file.md#heading"), "docs/mock file.md");
  assert.equal(resolveWorkspaceFileReference("other.md", "docs/guide/index.md"), "docs/guide/other.md");
  assert.equal(resolveWorkspaceFileReference("AGENTS.md"), "AGENTS.md");
});

test("rejects external and unsafe file references", () => {
  for (const value of [
    "https://example.com/docs/file.md",
    "mailto:test@example.com",
    "#heading",
    "//example.com/file.md",
    "../AGENTS.md",
    "docs/../AGENTS.md",
    "C:\\Users\\someone\\file.md",
    "src/app.tsx",
  ]) {
    assert.equal(resolveWorkspaceFileReference(value), null, value);
  }
});

test("preserves an explicit directory hint before path normalization", () => {
  assert.equal(hasWorkspaceDirectoryHint("projects/briefs/demo/"), true);
  assert.equal(hasWorkspaceDirectoryHint("<projects/briefs/demo/>#files"), true);
  assert.equal(hasWorkspaceDirectoryHint("projects\\briefs\\demo\\"), true);
  assert.equal(hasWorkspaceDirectoryHint("projects/briefs/demo/brief.md"), false);
});

test("resolves tool output paths across Windows, Unix, and renamed worktrees", () => {
  assert.equal(
    resolveWorkspaceFileOutputPath("C:\\Code Projects\\aios-pr525-integration\\projects\\briefs\\demo\\brief.md"),
    "projects/briefs/demo/brief.md",
  );
  assert.equal(
    resolveWorkspaceFileOutputPath("/tmp/renamed-worktree/docs/guide.md"),
    "docs/guide.md",
  );
  assert.equal(resolveWorkspaceFileOutputPath("D:\\outside\\not-allowed.txt"), null);
});
