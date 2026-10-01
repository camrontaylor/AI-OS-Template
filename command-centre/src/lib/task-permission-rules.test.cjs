const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const rules = loadTsModule(path.resolve(__dirname, "task-permission-rules.ts"), {
  stubs: { "./db": { getDb: () => { throw new Error("database not needed"); } } },
});
const taskPermissions = loadTsModule(path.resolve(__dirname, "task-permissions.ts"));

test("subchat permission scopes are normalized without broadening access", () => {
  assert.deepEqual(
    rules.normalizeTaskPermission("Bash", { command: "  npm run test  " }),
    { matcherType: "bash_exact", matcherValue: "npm run test" },
  );
  for (const tool of ["Write", "Edit", "MultiEdit"]) {
    assert.deepEqual(
      rules.normalizeTaskPermission(tool, { file_path: "src/app.ts" }),
      { matcherType: "edit_session", matcherValue: "file_edits" },
    );
  }
  assert.deepEqual(
    rules.normalizeTaskPermission("WebFetch", { url: "https://Docs.Example.com/path" }),
    { matcherType: "web_domain", matcherValue: "docs.example.com" },
  );
  assert.deepEqual(
    rules.normalizeTaskPermission("mcp__demo__search", { query: "x" }),
    { matcherType: "exact_tool", matcherValue: "mcp__demo__search" },
  );
});

test("only Claude workspace-policy denials are shown as absolute blocks", () => {
  assert.equal(
    taskPermissions.isWorkspacePolicyDenialText("Permission to use Bash with command rm x has been denied."),
    true,
  );
  assert.equal(taskPermissions.isWorkspacePolicyDenialText("Permission denied in the UI."), false);
  assert.equal(taskPermissions.isWorkspacePolicyDenialText("Blocked in test."), false);
});
