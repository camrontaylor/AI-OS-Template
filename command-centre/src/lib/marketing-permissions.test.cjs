const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const permissions = loadTsModule(path.resolve(__dirname, "marketing-permissions.ts"));

function request(overrides = {}) {
  return {
    toolName: "Bash",
    title: "Needs permission",
    description: "Claude wants to run a command.",
    inputJson: JSON.stringify({ command: "echo ok" }),
    ...overrides,
  };
}

test("classifyPermissionGate detects destructive shell commands before code gates", () => {
  const gate = permissions.classifyPermissionGate(
    request({ inputJson: JSON.stringify({ command: "rm -rf dist" }) }),
  );

  assert.equal(gate, "destructive");
});

test("classifyPermissionGate detects account upgrades and spend controls", () => {
  const gate = permissions.classifyPermissionGate(
    request({
      toolName: "mcp__billing__upgrade",
      description: "Upgrade account subscription for Magister.",
      inputJson: JSON.stringify({ plan: "pro", action: "upgrade" }),
    }),
  );

  assert.equal(gate, "spend");
});

test("classifyPermissionGate splits email, social, content, and code requests", () => {
  assert.equal(
    permissions.classifyPermissionGate(
      request({ toolName: "Gmail", description: "Send newsletter campaign." }),
    ),
    "email",
  );
  assert.equal(
    permissions.classifyPermissionGate(
      request({ description: "Schedule LinkedIn launch post." }),
    ),
    "social",
  );
  assert.equal(
    permissions.classifyPermissionGate(
      request({ description: "Publish article in Webflow CMS." }),
    ),
    "content",
  );
  assert.equal(
    permissions.classifyPermissionGate(
      request({ toolName: "Edit", inputJson: JSON.stringify({ file_path: "src/app/page.tsx" }) }),
    ),
    "code",
  );
});

test("getPermissionModeProfile flags full-auto modes as high risk", () => {
  assert.equal(permissions.getPermissionModeProfile("bypassPermissions").risk, "high");
  assert.equal(permissions.getPermissionModeProfile("plan").risk, "low");
});

