"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadTsModule } = require("./load-ts-module.cjs");

const fixtureRoot = process.env.AIOS_ISOLATION_FIXTURE_ROOT;
const aiOsDir = process.env.AI_OS_DIR;
const teamConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;

if (!fixtureRoot || !aiOsDir || !teamConfigDir) {
  throw new Error("The isolation fixture requires private temporary paths");
}

const resolvedFixtureRoot = path.resolve(fixtureRoot);
const resolvedTempRoot = path.resolve(os.tmpdir());
if (!resolvedFixtureRoot.startsWith(`${resolvedTempRoot}${path.sep}`)) {
  throw new Error("The isolation fixture may only clean up its own OS temporary directory");
}

const libDir = path.resolve(__dirname, "..");
const contextPath = path.join(teamConfigDir, "team-context.json");

function writeTeamContext(userId, selectedTeamId = "team-a") {
  fs.mkdirSync(teamConfigDir, { recursive: true });
  fs.writeFileSync(
    contextPath,
    `${JSON.stringify({
      version: 3,
      apiUrl: "https://team.example.test",
      token: `fixture-session-${userId}`,
      expiresAt: "2999-01-01T00:00:00.000Z",
      serverId: "server-1",
      user: { id: userId, email: `${userId}@example.test` },
      selectedTeamId,
      team: { id: selectedTeamId },
      teams: [
        { id: "team-a", membership: { role: userId === "user-a" ? "admin" : "member", status: "active" } },
        ...(userId === "user-a"
          ? [{ id: "team-b", membership: { role: "member", status: "active" } }]
          : []),
      ],
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function storedTeamScope(teamId, clientId) {
  return JSON.stringify({
    mode: "team",
    scope: {
      version: 1,
      serverId: "server-1",
      userId: "user-a",
      teamId,
      clientId,
    },
  });
}

function insertTask(db, { id, title, clientId = null, workScope = null }) {
  db.prepare(`
    INSERT INTO tasks (
      id, title, status, level, columnOrder, clientId, workScope, createdAt, updatedAt
    ) VALUES (?, ?, 'backlog', 'task', 0, ?, ?, ?, ?)
  `).run(id, title, clientId, workScope, "2026-07-13", "2026-07-13");
}

async function runFixture() {
  fs.mkdirSync(aiOsDir, { recursive: true });
  fs.mkdirSync(teamConfigDir, { recursive: true });
  fs.writeFileSync(path.join(aiOsDir, "AGENTS.md"), "# Isolation fixture\n", "utf8");

  const dbModule = loadTsModule(path.join(libDir, "db.ts"));
  const lifecycle = loadTsModule(path.join(libDir, "local-profile-lifecycle.ts"));
  const overlay = loadTsModule(path.join(libDir, "runtime-context-overlay.ts"));
  lifecycle.resetLocalProfileLifecycleForTesting();

  let result;
  try {
    const soloDb = dbModule.getDb();
    insertTask(soloDb, { id: "solo-task", title: "Solo durable history" });

    writeTeamContext("user-a", "team-a");
    const profileA = dbModule.getActiveLocalProfileDescriptor();
    const dbA = dbModule.getDb();
    const sessionA = lifecycle.activateLocalProfile(profileA);

    assert.equal(dbA.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = 'solo-task'").get().count, 0);
    insertTask(dbA, {
      id: "team-a-task",
      title: "Team A durable history",
      clientId: "client-a",
      workScope: storedTeamScope("team-a", "client-a"),
    });
    insertTask(dbA, {
      id: "team-b-task",
      title: "Team B durable history",
      clientId: "client-b",
      workScope: storedTeamScope("team-b", "client-b"),
    });

    assert.throws(
      () => dbA.prepare("UPDATE tasks SET workScope = ? WHERE id = 'team-a-task'")
        .run(storedTeamScope("team-b", "client-b")),
      /work_scope_immutable/,
    );

    const overlayA = overlay.createOrLoadRuntimeContextOverlay({
      profileTempDir: profileA.tempDir,
      ownerType: "task",
      ownerId: "team-a-task",
      profileKey: profileA.profileKey,
      serverId: "server-1",
      userId: "user-a",
      teamId: "team-a",
      clientId: "client-a",
    }, "# Team A fixture snapshot", "command-centre-task");
    const overlayB = overlay.createOrLoadRuntimeContextOverlay({
      profileTempDir: profileA.tempDir,
      ownerType: "task",
      ownerId: "team-b-task",
      profileKey: profileA.profileKey,
      serverId: "server-1",
      userId: "user-a",
      teamId: "team-b",
      clientId: "client-b",
    }, "# Team B fixture snapshot", "command-centre-task");
    assert.notEqual(overlayA.overlayDir, overlayB.overlayDir);

    const draft = path.join(profileA.tempDir, "chat-drafts", "drafts", "draft-a", "draft.txt");
    const unsent = path.join(profileA.tempDir, "goal-drafts", "goal-a", "unsent.txt");
    const sent = path.join(profileA.tempDir, "chat-drafts", "sent", "conversation-a", "message-a", "sent.txt");
    for (const filePath of [draft, unsent, sent]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "fixture-data", "utf8");
    }

    const coordinator = loadTsModule(path.join(libDir, "profile-shutdown-coordinator.ts"), {
      stubs: {
        "./cron-task-sync": { clearCronTaskSyncProfile: () => {} },
        "./cron-scheduler": { resetCronSchedulerProfile: () => {} },
        "./db": {
          closeLocalProfileHandle: dbModule.closeLocalProfileHandle,
          getDb: dbModule.getDb,
          runWithLocalProfile: dbModule.runWithLocalProfile,
        },
        "./event-bus": { closeProfileEventStreams: () => {} },
        "./file-watcher": { fileWatcher: { cleanupProfile: async () => {} } },
        "./local-profile-lifecycle": lifecycle,
        "./materialized-file-ownership": { cleanupManagedMaterializedCredentials: () => {} },
        "./process-manager": {
          processManager: { shutdownProfile: async () => ({ stopped: 2, forced: 0, pending: 0 }) },
        },
        "./team-secrets-env": { cleanupManagedTeamSecrets: async () => ({ filesChanged: 0 }) },
        "./terminal-sessions": {
          shutdownTerminalSessionsForProfile: async () => ({ stopped: 1, forced: 0, pending: 0 }),
        },
        "./subprocess": { killProcessTreeByPid: () => {} },
        "./cron-runtime.js": { closeCronProfileDatabase: () => true },
      },
    });

    const shutdown = await coordinator.shutdownLocalProfile(profileA, {
      workspaceRoot: aiOsDir,
      revokeRemote: async () => { throw new Error("fixture server offline"); },
    });
    assert.deepEqual(shutdown.warnings.map((warning) => warning.code), ["remote_revoke_failed"]);

    writeTeamContext("user-b", "team-a");
    const profileB = dbModule.getActiveLocalProfileDescriptor();
    const dbB = dbModule.getDb();
    const sessionB = lifecycle.activateLocalProfile(profileB);
    assert.notEqual(profileB.profileKey, profileA.profileKey);
    assert.notEqual(profileB.dbPath, profileA.dbPath);
    assert.notEqual(sessionB.sessionId, sessionA.sessionId);
    assert.equal(dbB.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id IN ('team-a-task', 'team-b-task')").get().count, 0);

    const staleHeaders = new Headers({
      [lifecycle.LOCAL_PROFILE_KEY_HEADER]: profileA.profileKey,
      [lifecycle.LOCAL_PROFILE_SESSION_HEADER]: sessionA.sessionId,
    });
    assert.throws(
      () => lifecycle.assertLocalProfileRequest(profileB, staleHeaders),
      (error) => error?.status === 409 && error?.code === "stale_profile_session",
    );

    writeTeamContext("user-a", "team-a");
    const profileAReturned = dbModule.getActiveLocalProfileDescriptor();
    const dbAReturned = dbModule.getDb();
    const returnedSession = lifecycle.activateLocalProfile(profileAReturned, { rotate: true });
    assert.equal(profileAReturned.profileKey, profileA.profileKey);
    assert.notEqual(returnedSession.sessionId, sessionA.sessionId);
    assert.equal(
      dbAReturned.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id IN ('team-a-task', 'team-b-task')").get().count,
      2,
    );
    assert.equal(fs.existsSync(sent), true);
    assert.equal(fs.existsSync(draft), false);
    assert.equal(fs.existsSync(unsent), false);
    assert.equal(fs.existsSync(overlayA.overlayDir), false);
    assert.equal(fs.existsSync(overlayB.overlayDir), false);
    assert.throws(
      () => lifecycle.assertLocalProfileRequest(profileAReturned, staleHeaders),
      (error) => error?.status === 409 && error?.code === "stale_profile_session",
    );

    fs.rmSync(contextPath, { force: true });
    assert.equal(dbModule.getDb().prepare("SELECT title FROM tasks WHERE id = 'solo-task'").get().title, "Solo durable history");
    assert.equal(dbModule.getDb().prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = 'team-a-task'").get().count, 0);

    result = {
      profileKeysRotated: profileA.profileKey !== profileB.profileKey,
      durableTeamRowsRecovered: 2,
      volatileArtifactsRemoved: 4,
      soloRowsRecovered: 1,
      offlineRevokeFailedClosed: true,
    };
  } finally {
    try { dbModule.closeAllLocalProfileHandles(); } catch { /* cleanup continues */ }
    fs.rmSync(resolvedFixtureRoot, { recursive: true, force: true });
  }
  return result;
}

runFixture()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    try { fs.rmSync(resolvedFixtureRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(1);
  });
