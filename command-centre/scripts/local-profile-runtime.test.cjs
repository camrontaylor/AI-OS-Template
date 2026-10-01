"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { resolveLocalRuntimeProfile } = require("./local-profile-runtime.cjs");

test("cron runtime resolves Solo and Team profile databases without exposing the login", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cron-profile-"));
  const configDir = path.join(root, "team-config");
  const previous = process.env.AI_OS_TEAM_CONFIG_DIR;
  process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
  try {
    const solo = resolveLocalRuntimeProfile(root);
    assert.equal(solo.mode, "solo");
    assert.equal(solo.dbPath, path.join(root, ".command-centre", "data.db"));

    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "team-context.json"), JSON.stringify({
      serverId: "server-a",
      user: { id: "user-a" },
      token: "synthetic-token",
    }));
    const team = resolveLocalRuntimeProfile(root);
    const expectedKey = crypto.createHash("sha256")
      .update("team-os-profile:v1\nserver-a\nuser-a")
      .digest("hex");
    assert.equal(team.mode, "team");
    assert.equal(team.profileKey, expectedKey);
    assert.equal(team.dbPath, path.join(root, ".command-centre", "profiles", expectedKey, "data.db"));
    assert.equal(JSON.stringify(team).includes("synthetic-token"), false);
  } finally {
    if (previous === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
