"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function profile(root, profileKey = "profile-a") {
  const dataDir = path.join(root, profileKey);
  return { version: 1, mode: "team", profileKey, identity: { version: 1, serverId: "server", userId: profileKey }, dataDir, stateDir: path.join(dataDir, "state"), tempDir: path.join(dataDir, "tmp"), dbPath: path.join(dataDir, "data.db") };
}

test("opaque runtime sessions reject stale tabs and block a closing profile", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-profile-lifecycle-"));
  try {
    const lifecycle = loadTsModule(path.join(__dirname, "local-profile-lifecycle.ts"));
    lifecycle.resetLocalProfileLifecycleForTesting();
    const descriptor = profile(root);
    const runtime = lifecycle.getLocalProfileRuntimeSession(descriptor);
    assert.match(runtime.sessionId, /^[0-9a-f-]{36}$/i);

    const headers = new Headers({
      [lifecycle.LOCAL_PROFILE_KEY_HEADER]: descriptor.profileKey,
      [lifecycle.LOCAL_PROFILE_SESSION_HEADER]: runtime.sessionId,
    });
    assert.doesNotThrow(() => lifecycle.assertLocalProfileRequest(descriptor, headers));
    assert.throws(
      () => lifecycle.assertLocalProfileRequest(descriptor, new Headers({
        [lifecycle.LOCAL_PROFILE_KEY_HEADER]: descriptor.profileKey,
        [lifecycle.LOCAL_PROFILE_SESSION_HEADER]: "old-session",
      })),
      (error) => error.status === 409 && error.code === "stale_profile_session",
    );

    lifecycle.beginLocalProfileClosing(descriptor);
    assert.equal(fs.existsSync(path.join(descriptor.stateDir, lifecycle.LOCAL_PROFILE_CLEANUP_MARKER)), true);
    assert.throws(
      () => lifecycle.assertLocalProfileRequest(descriptor, headers),
      (error) => error.status === 423 && error.code === "profile_closing",
    );

    lifecycle.finishLocalProfileClosing(descriptor, []);
    const next = lifecycle.activateLocalProfile(descriptor, { rotate: true });
    assert.notEqual(next.sessionId, runtime.sessionId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a pending cleanup marker keeps the profile closed across module reloads", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-profile-recovery-"));
  try {
    let lifecycle = loadTsModule(path.join(__dirname, "local-profile-lifecycle.ts"));
    lifecycle.resetLocalProfileLifecycleForTesting();
    const descriptor = profile(root);
    lifecycle.beginLocalProfileClosing(descriptor);
    lifecycle.finishLocalProfileClosing(descriptor, ["profile_database"]);
    lifecycle = loadTsModule(path.join(__dirname, "local-profile-lifecycle.ts"));
    assert.throws(
      () => lifecycle.activateLocalProfile(descriptor),
      (error) => error.code === "profile_closing",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
