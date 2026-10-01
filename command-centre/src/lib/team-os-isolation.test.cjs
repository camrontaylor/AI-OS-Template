"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const commandCentreRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(commandCentreRoot, "..");
const workScopePath = path.join(__dirname, "identity", "work-scope.ts");
const overlayPath = path.join(__dirname, "runtime-context-overlay.ts");
const lifecyclePath = path.join(__dirname, "local-profile-lifecycle.ts");

function teamProfile(root, userId = "user-a") {
  const profileKey = `profile-${userId}`;
  const dataDir = path.join(root, profileKey);
  return {
    version: 1,
    mode: "team",
    profileKey,
    identity: { version: 1, serverId: "server-1", userId },
    dataDir,
    stateDir: path.join(dataDir, "state"),
    tempDir: path.join(dataDir, "tmp"),
    dbPath: path.join(dataDir, "data.db"),
  };
}

test("ISO-01/06/07 focused command keeps authorization, revocation, outage, route, and memory proofs", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(commandCentreRoot, "package.json"), "utf8"));
  const command = packageJson.scripts["test:isolation"];
  assert.equal(typeof command, "string");
  for (const requiredFile of [
    "src/lib/identity/team-auth.test.cjs",
    "src/lib/team-api-context.test.cjs",
    "src/lib/process-manager.test.cjs",
    "src/proxy.test.cjs",
    "src/lib/memory/api.test.cjs",
    "src/lib/memory/no-leak.test.cjs",
    "src/lib/memory/scoped-access.test.cjs",
  ]) {
    assert.match(command, new RegExp(requiredFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("ISO-02/03 switching Teams cannot mutate stored work, process scope, or concurrent overlays", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-isolation-scope-"));
  const descriptor = teamProfile(root);
  let selectedTeamId = "team-a";
  try {
    const workScope = loadTsModule(workScopePath, {
      stubs: {
        "@/lib/clients": {
          normalizeClientId: (value) => value == null || value === "" || value === "root" ? null : value,
        },
        "@/lib/db": { getActiveLocalProfileDescriptor: () => descriptor },
        "@/lib/local-profile": {},
        "@/lib/team-api-context": {
          readTeamContext: async () => ({
            serverId: "server-1",
            user: { id: "user-a" },
            selectedTeamId,
            teams: [{ id: "team-a" }, { id: "team-b" }],
            expiresAt: "2999-01-01T00:00:00.000Z",
          }),
        },
      },
    });
    const overlay = loadTsModule(overlayPath);

    const teamA = await workScope.captureNewWorkScope("client-a");
    selectedTeamId = "team-b";
    const teamB = await workScope.captureNewWorkScope("client-b");

    assert.equal(teamA.scope.scope.teamId, "team-a");
    assert.equal(teamB.scope.scope.teamId, "team-b");
    assert.equal(Object.isFrozen(teamA.scope.scope), true);
    assert.equal(Object.isFrozen(teamB.scope.scope), true);
    assert.deepEqual(workScope.inheritWorkScope({ clientId: "client-a", workScope: teamA.serialized }, descriptor), teamA);
    assert.throws(
      () => workScope.assertNoWorkScopeInput({ teamId: "browser-forged-team", userId: "forged-user" }),
      (error) => error?.code === "invalid_scope_input" && error?.status === 400,
    );

    const envA = workScope.buildWorkScopeEnvironment(teamA.scope, descriptor.profileKey);
    const envB = workScope.buildWorkScopeEnvironment(teamB.scope, descriptor.profileKey);
    assert.deepEqual(
      [envA.AI_OS_TEAM_ID, envA.AI_OS_CLIENT_ID, envB.AI_OS_TEAM_ID, envB.AI_OS_CLIENT_ID],
      ["team-a", "client-a", "team-b", "client-b"],
    );

    const expectationA = {
      profileTempDir: descriptor.tempDir,
      ownerType: "task",
      ownerId: "task-a",
      profileKey: descriptor.profileKey,
      serverId: "server-1",
      userId: "user-a",
      teamId: "team-a",
      clientId: "client-a",
    };
    const expectationB = { ...expectationA, ownerId: "task-b", teamId: "team-b", clientId: "client-b" };
    const createdA = overlay.createOrLoadRuntimeContextOverlay(expectationA, "Team A snapshot", "agent");
    const createdB = overlay.createOrLoadRuntimeContextOverlay(expectationB, "Team B snapshot", "agent");

    selectedTeamId = "team-a";
    selectedTeamId = "team-b";
    assert.equal(overlay.loadRuntimeContextOverlay(expectationA).metadata.teamId, "team-a");
    assert.equal(overlay.loadRuntimeContextOverlay(expectationB).metadata.teamId, "team-b");
    assert.notEqual(createdA.overlayDir, createdB.overlayDir);
    assert.notEqual(createdA.metadata.snapshotSha256, createdB.metadata.snapshotSha256);

    overlay.deleteRuntimeContextOverlay(expectationA);
    assert.equal(fs.existsSync(createdA.overlayDir), false);
    assert.equal(fs.existsSync(createdB.overlayDir), true);
    assert.equal(teamA.scope.scope.teamId, "team-a");
    assert.equal(teamB.scope.scope.teamId, "team-b");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ISO-04 stale and closing profile sessions are rejected before route work", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-isolation-stale-"));
  const descriptor = teamProfile(root);
  const lifecycle = loadTsModule(lifecyclePath);
  lifecycle.resetLocalProfileLifecycleForTesting();
  let sentinelCalls = 0;
  const guardedRoute = (headers) => {
    lifecycle.assertLocalProfileRequest(descriptor, headers);
    sentinelCalls += 1;
  };

  try {
    const first = lifecycle.activateLocalProfile(descriptor);
    const firstHeaders = new Headers({
      [lifecycle.LOCAL_PROFILE_KEY_HEADER]: descriptor.profileKey,
      [lifecycle.LOCAL_PROFILE_SESSION_HEADER]: first.sessionId,
    });
    guardedRoute(firstHeaders);
    assert.equal(sentinelCalls, 1);

    const rotated = lifecycle.activateLocalProfile(descriptor, { rotate: true });
    const rotatedHeaders = new Headers({
      [lifecycle.LOCAL_PROFILE_KEY_HEADER]: descriptor.profileKey,
      [lifecycle.LOCAL_PROFILE_SESSION_HEADER]: rotated.sessionId,
    });
    assert.throws(
      () => guardedRoute(firstHeaders),
      (error) => error?.status === 409 && error?.code === "stale_profile_session",
    );
    assert.equal(sentinelCalls, 1);

    lifecycle.beginLocalProfileClosing(descriptor);
    assert.throws(
      () => guardedRoute(rotatedHeaders),
      (error) => error?.status === 423 && error?.code === "profile_closing",
    );
    assert.equal(sentinelCalls, 1);
    lifecycle.finishLocalProfileClosing(descriptor, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ISO-05/08 sequential users isolate databases and volatile data while Solo and durable history recover", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aios-isolation-users-"));
  const fixturePath = path.join(__dirname, "test-utils", "team-os-isolation-fixture.cjs");
  const result = spawnSync(process.execPath, [fixturePath], {
    cwd: commandCentreRoot,
    env: {
      ...process.env,
      AIOS_ISOLATION_FIXTURE_ROOT: fixtureRoot,
      AI_OS_DIR: path.join(fixtureRoot, "workspace"),
      AI_OS_TEAM_CONFIG_DIR: path.join(fixtureRoot, "team-config"),
    },
    encoding: "utf8",
    timeout: 60_000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(fixtureRoot), false, "the child fixture must remove only its temporary root");
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    profileKeysRotated: true,
    durableTeamRowsRecovered: 2,
    volatileArtifactsRemoved: 4,
    soloRowsRecovered: 1,
    offlineRevokeFailedClosed: true,
  });
});

test("manual bootstrap and harness expose the approved multi-Team user without tokens", () => {
  const bootstrap = require(path.join(commandCentreRoot, "scripts", "team-test-bootstrap.cjs"));
  const spec = bootstrap.buildSpec("isolation-contract");
  const publicSummary = bootstrap.buildPublicSummary({
    runId: spec.runId,
    teamsCreated: 0,
    usersEnsured: 5,
    membershipsEnsured: 6,
    clientsEnsured: 2,
    grantsEnsured: 4,
  }, spec);

  assert.deepEqual(publicSummary.multiTeamUser.teams, [spec.teams.teamA.slug, spec.teams.teamB.slug]);
  assert.deepEqual(publicSummary.multiTeamUser.clients, [spec.clients.clientA.slug, spec.clients.clientB.slug]);
  assert.equal(publicSummary.multiTeamUser.initialTeam, spec.teams.teamA.slug);
  assert.equal(JSON.stringify(publicSummary).includes("password"), false);
  assert.equal(JSON.stringify(publicSummary).includes("token"), false);

  const harness = fs.readFileSync(path.join(repoRoot, "scripts", "team-os-chat-memory-test.ps1"), "utf8");
  for (const contractMarker of [
    "isolation-checklist.md",
    "revoke-multi-team-user-team-b.ps1",
    "restore-isolation-fixture.ps1",
    "switch-admin-a-instance-to-member-a.ps1",
    "switch-admin-a-instance-back.ps1",
    "teams = $_.Teams",
  ]) {
    assert.ok(harness.includes(contractMarker), `manual harness is missing ${contractMarker}`);
  }
});

test("manual bootstrap verifies the expected password on every repeat without using invitation setup", async () => {
  const bootstrap = require(path.join(commandCentreRoot, "scripts", "team-test-bootstrap.cjs"));
  const user = {
    id: "bootstrap-user-id",
    email: "bootstrap-user@example.test",
    displayName: "Bootstrap User",
    status: "active",
    metadata: {},
  };
  const store = {
    upsertUser: async () => user,
  };
  const expectedPassword = "bootstrap-password-123";
  const passwordChecks = [];
  const teamAuth = {
    ensureUserPassword: async (receivedStore, receivedUser, password) => {
      assert.equal(receivedStore, store);
      assert.equal(receivedUser, user);
      passwordChecks.push(password);
      if (password !== expectedPassword) {
        throw Object.assign(new Error("existing platform password differs"), {
          status: 409,
          code: "existing_account",
        });
      }
      return receivedUser;
    },
    setUserPassword: async () => assert.fail("bootstrap must not use invitation password setup"),
  };
  const summary = { usersEnsured: 0 };
  const input = {
    email: user.email,
    name: user.displayName,
    password: expectedPassword,
  };

  assert.equal(await bootstrap.ensureUser(store, teamAuth, summary, input), user);
  assert.equal(await bootstrap.ensureUser(store, teamAuth, summary, input), user);
  assert.deepEqual(passwordChecks, [expectedPassword, expectedPassword]);
  assert.equal(summary.usersEnsured, 2);

  await assert.rejects(
    bootstrap.ensureUser(store, teamAuth, summary, { ...input, password: "different-password-456" }),
    (error) => error?.status === 409 && error?.code === "existing_account",
  );
  assert.equal(summary.usersEnsured, 2);
});
