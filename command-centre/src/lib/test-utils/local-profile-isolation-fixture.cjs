"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { loadTsModule } = require("./load-ts-module.cjs");

const root = process.env.AI_OS_DIR;
const teamConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
if (!root || !teamConfigDir) throw new Error("Fixture requires isolated profile paths");

function writeTeamContext(userId) {
  fs.writeFileSync(
    path.join(teamConfigDir, "team-context.json"),
    JSON.stringify({
      version: 3,
      apiUrl: "https://team.example.test",
      token: "session-token",
      expiresAt: "2999-01-01T00:00:00.000Z",
      serverId: "server-1",
      user: { id: userId, email: `${userId}@example.test` },
      selectedTeamId: "team-1",
      team: { id: "team-1" },
    }),
  );
}

const libDir = path.resolve(__dirname, "..");
const dbModule = loadTsModule(path.join(libDir, "db.ts"));
const contextPath = path.join(teamConfigDir, "team-context.json");

const soloDb = dbModule.getDb();
soloDb.prepare("INSERT INTO tasks (id, title, status, level, columnOrder, createdAt, updatedAt) VALUES (?, ?, 'backlog', 'task', 0, ?, ?)")
  .run("solo-task", "Solo only", "2026-01-01", "2026-01-01");
assert.equal(dbModule.getActiveLocalProfileDescriptor().dbPath, path.join(root, ".command-centre", "data.db"));

writeTeamContext("user-a");
const profileA = dbModule.getActiveLocalProfileDescriptor();
const dbA = dbModule.getDb();
assert.equal(dbA.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = 'solo-task'").get().count, 0);
dbA.prepare("INSERT INTO tasks (id, title, status, level, columnOrder, createdAt, updatedAt) VALUES (?, ?, 'backlog', 'task', 0, ?, ?)")
  .run("a-task", "A only", "2026-01-01", "2026-01-01");
const leaseA = dbModule.acquireLocalProfileLease(profileA);

writeTeamContext("user-b");
const profileB = dbModule.getActiveLocalProfileDescriptor();
const dbB = dbModule.getDb();
assert.notEqual(profileB.profileKey, profileA.profileKey);
assert.equal(dbB.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = 'a-task'").get().count, 0);
assert.equal(dbModule.getOpenLocalProfileHandlesForTesting().length, 3);
assert.equal(
  dbModule.runWithLocalProfile(profileA, () => dbModule.getDb().prepare("SELECT title FROM tasks WHERE id = 'a-task'").get().title),
  "A only",
);
leaseA.release();

fs.rmSync(contextPath);
assert.equal(dbModule.getDb().prepare("SELECT title FROM tasks WHERE id = 'solo-task'").get().title, "Solo only");
dbModule.closeAllLocalProfileHandles();
assert.equal(soloDb.open, false);
assert.equal(dbA.open, false);
assert.equal(dbB.open, false);
