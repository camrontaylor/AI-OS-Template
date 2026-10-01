const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const overlay = loadTsModule(path.resolve(__dirname, "runtime-context-overlay.ts"));

function tempProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-overlay-"));
}

function expectation(profileTempDir, overrides = {}) {
  return {
    profileTempDir,
    ownerType: "task",
    ownerId: "task-1",
    profileKey: "profile-a",
    serverId: "server-1",
    userId: "user-1",
    teamId: "team-a",
    clientId: null,
    ...overrides,
  };
}

test("runtime context overlays isolate owners and Teams inside the profile temp directory", () => {
  const root = tempProfile();
  try {
    const teamA = overlay.createOrLoadRuntimeContextOverlay(
      expectation(root),
      "# Team A snapshot\n",
      "command-centre-task",
      new Date("2026-07-12T12:00:00.000Z"),
    );
    const teamB = overlay.createOrLoadRuntimeContextOverlay(
      expectation(root, { ownerId: "task-2", teamId: "team-b" }),
      "# Team B snapshot\n",
      "command-centre-task",
      new Date("2026-07-12T12:01:00.000Z"),
    );

    assert.notEqual(teamA.overlayDir, teamB.overlayDir);
    assert.equal(teamA.metadata.teamId, "team-a");
    assert.equal(teamB.metadata.teamId, "team-b");
    assert.ok(teamA.overlayDir.startsWith(`${path.resolve(root)}${path.sep}`));
    assert.ok(teamB.overlayDir.startsWith(`${path.resolve(root)}${path.sep}`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime context overlay reuse keeps the original immutable snapshot", () => {
  const root = tempProfile();
  try {
    const expected = expectation(root);
    const first = overlay.createOrLoadRuntimeContextOverlay(
      expected,
      "Original snapshot",
      "command-centre-task",
      new Date("2026-07-12T12:00:00.000Z"),
    );
    const resumed = overlay.createOrLoadRuntimeContextOverlay(
      expected,
      "New server snapshot that must not replace the original",
      "command-centre-task",
      new Date("2026-07-12T13:00:00.000Z"),
    );

    assert.equal(resumed.snapshotMarkdown, "Original snapshot");
    assert.equal(resumed.metadata.snapshotSha256, first.metadata.snapshotSha256);
    assert.equal(resumed.metadata.createdAt, "2026-07-12T12:00:00.000Z");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime context overlays fail closed for cross-scope reads and checksum changes", () => {
  const root = tempProfile();
  try {
    const expected = expectation(root);
    const created = overlay.createOrLoadRuntimeContextOverlay(
      expected,
      "Protected snapshot",
      "command-centre-task",
    );

    assert.throws(
      () => overlay.loadRuntimeContextOverlay(expectation(root, { teamId: "team-b" })),
      (error) => error?.code === "invalid_context_overlay",
    );

    fs.writeFileSync(created.snapshotPath, "Tampered snapshot", "utf8");
    assert.throws(
      () => overlay.loadRuntimeContextOverlay(expected),
      (error) => error?.code === "invalid_context_overlay",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime context overlay deletion removes only the requested owner", () => {
  const root = tempProfile();
  try {
    const firstExpected = expectation(root);
    const secondExpected = expectation(root, { ownerId: "task-2" });
    const first = overlay.createOrLoadRuntimeContextOverlay(
      firstExpected,
      "First snapshot",
      "command-centre-task",
    );
    const second = overlay.createOrLoadRuntimeContextOverlay(
      secondExpected,
      "Second snapshot",
      "command-centre-task",
    );

    overlay.deleteRuntimeContextOverlay(firstExpected);
    assert.equal(fs.existsSync(first.overlayDir), false);
    assert.equal(fs.existsSync(second.overlayDir), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
