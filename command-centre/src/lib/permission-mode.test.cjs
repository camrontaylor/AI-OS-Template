const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const permissions = loadTsModule(path.resolve(__dirname, "permission-mode.ts"), {
  stubs: { "@/types/task": {} },
});

test("native Auto is preserved as a canonical permission mode", () => {
  assert.equal(permissions.normalizePermissionMode("auto"), "auto");
  assert.equal(permissions.getActivePermissionMode("auto"), "auto");
  assert.equal(permissions.getExecutionPermissionMode("auto"), "auto");
});

test("Plan remembers Auto and selecting a normal mode exits immediately", () => {
  assert.deepEqual(
    permissions.getPermissionStateForPickerChange("plan", "auto", "auto"),
    { permissionMode: "plan", executionPermissionMode: "auto" },
  );
  assert.deepEqual(
    permissions.getPermissionStateForPickerChange("auto", "plan", "default"),
    { permissionMode: "auto", executionPermissionMode: "auto" },
  );
});
