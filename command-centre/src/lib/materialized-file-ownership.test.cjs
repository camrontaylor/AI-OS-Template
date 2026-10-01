"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

test("new Team materialization is visible only to its owning local profile", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-material-owner-"));
  const dataDir = path.join(root, ".command-centre");
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(root, "team_context", "notes.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "owned\n");
  const unownedPath = path.join(root, "README.md");
  fs.writeFileSync(unownedPath, "legacy solo\n");
  let activeProfile = { version: 1, mode: "team", profileKey: "profile-a", identity: { version: 1, serverId: "server", userId: "user-a" } };

  try {
    const ownership = loadTsModule(path.join(__dirname, "materialized-file-ownership.ts"), {
      stubs: {
        "./config": { getConfig: () => ({ aiOsDir: root, dataDir }) },
        "./db": { getActiveLocalProfileDescriptor: () => activeProfile },
      },
    });
    ownership.registerMaterializedFiles([filePath], { scope: "team", kind: "shared-context" });
    assert.equal(ownership.isMaterializedPathAccessible(filePath), true);
    assert.equal(ownership.isMaterializedPathAccessible(path.dirname(filePath)), true);

    activeProfile = { version: 1, mode: "team", profileKey: "profile-b", identity: { version: 1, serverId: "server", userId: "user-b" } };
    assert.equal(ownership.isMaterializedPathAccessible(filePath), false);
    assert.equal(ownership.isMaterializedPathAccessible(path.dirname(filePath)), false);
    assert.equal(ownership.isMaterializedPathAccessible(unownedPath), false);
    assert.throws(() => ownership.assertMaterializedPathAccessible(filePath), (error) => error.status === 404);
    assert.throws(() => ownership.assertMaterializedPathWritable(filePath), (error) => error.status === 404);
    assert.doesNotThrow(() => ownership.assertMaterializedPathWritable(path.join(root, "new-team-file.md")));

    activeProfile = { version: 1, mode: "solo", profileKey: "solo" };
    assert.equal(ownership.isMaterializedPathAccessible(filePath), false);
    assert.equal(ownership.isMaterializedPathAccessible(path.dirname(filePath)), false);
    assert.equal(ownership.isMaterializedPathAccessible(unownedPath), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
