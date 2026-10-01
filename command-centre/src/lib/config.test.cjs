const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const config = loadTsModule(path.resolve(__dirname, "config.ts"));

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-config-"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Test\n");
  fs.mkdirSync(path.join(root, "command-centre"), { recursive: true });
  fs.mkdirSync(path.join(root, "clients", "acme", "context"), { recursive: true });
  return root;
}

test("detectClientIdFromCwd returns the client slug for paths under clients/{slug}", () => {
  const root = tempWorkspace();
  try {
    assert.equal(
      config.detectClientIdFromCwd(path.join(root, "clients", "acme"), root),
      "acme",
    );
    assert.equal(
      config.detectClientIdFromCwd(path.join(root, "clients", "acme", "context"), root),
      "acme",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("detectClientIdFromCwd keeps root, command-centre, and outside paths unscoped", () => {
  const root = tempWorkspace();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aios-outside-"));
  try {
    assert.equal(config.detectClientIdFromCwd(root, root), null);
    assert.equal(config.detectClientIdFromCwd(path.join(root, "command-centre"), root), null);
    assert.equal(config.detectClientIdFromCwd(outside, root), null);
    assert.equal(config.detectClientIdFromCwd(null, root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("detectClientIdFromCwd ignores missing client directories", () => {
  const root = tempWorkspace();
  try {
    assert.equal(
      config.detectClientIdFromCwd(path.join(root, "clients", "missing", "context"), root),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
