"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { NextRequest } = require("next/server");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const soloProfile = {
  version: 1,
  mode: "solo",
  profileKey: "solo",
  dataDir: "C:/workspace",
  stateDir: "C:/workspace",
  tempDir: "C:/workspace",
  dbPath: "C:/workspace/command-centre.db",
};
const teamProfile = {
  version: 1,
  mode: "team",
  profileKey: "profile-a",
  identity: { version: 1, serverId: "server-1", userId: "user-1" },
  dataDir: "C:/profiles/a",
  stateDir: "C:/profiles/a",
  tempDir: "C:/profiles/a/tmp",
  dbPath: "C:/profiles/a/command-centre.db",
};

function loadContract({ profile = soloProfile, teamContext = null, NextRequestImpl = class {} } = {}) {
  return loadTsModule(path.resolve(__dirname, "work-scope.ts"), {
    stubs: {
      "next/server": { NextRequest: NextRequestImpl },
      "@/lib/clients": {
        normalizeClientId(value) {
          return value == null || value === "" || value === "root" ? null : value;
        },
      },
      "@/lib/db": {
        getActiveLocalProfileDescriptor() {
          return profile;
        },
      },
      "@/lib/local-profile": {},
      "@/lib/team-api-context": {
        async readTeamContext() {
          return teamContext;
        },
      },
    },
  });
}

test("Team request scoping rebuilds a consumed NextRequest from safe primitives", async () => {
  const contract = loadContract({ profile: teamProfile, NextRequestImpl: NextRequest });
  const request = new NextRequest("http://localhost:3001/api/tasks?source=new-goal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "team-session=active",
      "x-ai-team-id": "browser-forged-team",
      "x-original-header": "preserved",
    },
    body: JSON.stringify({ title: "Create a Team goal" }),
  });
  await request.json();

  const scope = {
    mode: "team",
    scope: {
      version: 1,
      serverId: "server-1",
      userId: "user-1",
      teamId: "team-a",
      clientId: null,
    },
  };
  const scopedRequest = contract.requestWithWorkScope(request, scope);

  assert.notStrictEqual(scopedRequest, request);
  assert.equal(scopedRequest.url, request.url);
  assert.equal(scopedRequest.nextUrl.searchParams.get("source"), "new-goal");
  assert.equal(scopedRequest.method, "POST");
  assert.equal(scopedRequest.headers.get("cookie"), "team-session=active");
  assert.equal(scopedRequest.headers.get("x-original-header"), "preserved");
  assert.equal(scopedRequest.headers.get("x-ai-team-id"), "team-a");
  assert.equal(scopedRequest.body, null);
  assert.equal(scopedRequest.bodyUsed, false);

  assert.strictEqual(
    contract.requestWithWorkScope(request, { mode: "solo", version: 1, clientId: null }),
    request,
  );
});

test("legacy rows remain explicit Solo and never inherit the selected Team", () => {
  const contract = loadContract({ profile: teamProfile });
  assert.deepEqual(contract.readWorkScopeFromRow({ clientId: "acme", workScope: null }), {
    mode: "solo",
    version: 1,
    clientId: "acme",
  });
});

test("malformed, unknown, cross-profile, and client-mismatched scopes fail closed", () => {
  const contract = loadContract({ profile: teamProfile });
  const valid = {
    mode: "team",
    scope: {
      version: 1,
      serverId: "server-1",
      userId: "user-1",
      teamId: "team-a",
      clientId: "acme",
    },
  };
  for (const row of [
    { clientId: "acme", workScope: "{" },
    { clientId: "acme", workScope: JSON.stringify({ mode: "solo", version: 2, clientId: "acme" }) },
    { clientId: "other", workScope: JSON.stringify(valid) },
    { clientId: "acme", workScope: JSON.stringify({ ...valid, scope: { ...valid.scope, userId: "user-2" } }) },
  ]) {
    assert.throws(
      () => contract.readWorkScopeFromRow(row),
      (error) => error.code === "invalid_work_scope",
    );
  }
});

test("new Solo and Team work capture the current default exactly once", async () => {
  const solo = await loadContract({ profile: soloProfile }).captureNewWorkScope("root");
  assert.deepEqual(solo.scope, { mode: "solo", version: 1, clientId: null });

  const teamContext = {
    serverId: "server-1",
    user: { id: "user-1" },
    selectedTeamId: "team-a",
    teams: [{ id: "team-a" }, { id: "team-b" }],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const team = await loadContract({ profile: teamProfile, teamContext }).captureNewWorkScope("acme");
  assert.deepEqual(team.scope, {
    mode: "team",
    scope: {
      version: 1,
      serverId: "server-1",
      userId: "user-1",
      teamId: "team-a",
      clientId: "acme",
    },
  });
  teamContext.selectedTeamId = "team-b";
  assert.equal(team.scope.scope.teamId, "team-a");
  assert.equal(Object.isFrozen(team.scope.scope), true);
});

test("browser-provided ownership is rejected and process environment is pinned", () => {
  const contract = loadContract({ profile: teamProfile });
  for (const field of ["workScope", "serverId", "userId", "teamId"]) {
    assert.throws(
      () => contract.assertNoWorkScopeInput({ [field]: "forged" }),
      (error) => error.code === "invalid_scope_input",
    );
  }
  const scope = contract.parseStoredWorkScope(JSON.stringify({
    mode: "team",
    scope: {
      version: 1,
      serverId: "server-1",
      userId: "user-1",
      teamId: "team-a",
      clientId: "acme",
    },
  }));
  assert.deepEqual(contract.buildWorkScopeEnvironment(scope, "profile-a"), {
    AI_OS_WORK_SCOPE_VERSION: "1",
    AI_OS_WORK_MODE: "team",
    AI_OS_PROFILE_KEY: "profile-a",
    AI_OS_CLIENT_ID: "acme",
    AI_OS_SERVER_ID: "server-1",
    AI_OS_USER_ID: "user-1",
    AI_OS_TEAM_ID: "team-a",
  });
  assert.deepEqual(contract.buildWorkScopeEnvironment(
    { mode: "solo", version: 1, clientId: null },
    "solo",
  ), {
    AI_OS_WORK_SCOPE_VERSION: "1",
    AI_OS_WORK_MODE: "solo",
    AI_OS_PROFILE_KEY: "solo",
    AI_OS_CLIENT_ID: "",
    AI_OS_SERVER_ID: "",
    AI_OS_USER_ID: "",
    AI_OS_TEAM_ID: "",
  });
});

test("database triggers make task and conversation work scope write-once", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.resolve(__dirname, "../schema.sql"), "utf8"));
  const now = new Date().toISOString();
  const scope = JSON.stringify({ mode: "solo", version: 1, clientId: null });
  db.prepare("INSERT INTO tasks (id, title, status, level, columnOrder, createdAt, updatedAt, workScope) VALUES (?, ?, 'backlog', 'task', 0, ?, ?, ?)")
    .run("task-1", "Task", now, now, scope);
  db.prepare("INSERT INTO conversations (id, status, createdAt, updatedAt, workScope) VALUES (?, 'active', ?, ?, ?)")
    .run("conversation-1", now, now, scope);
  assert.throws(() => db.prepare("UPDATE tasks SET workScope = NULL WHERE id = ?").run("task-1"), /work_scope_immutable/);
  assert.throws(() => db.prepare("UPDATE conversations SET workScope = NULL WHERE id = ?").run("conversation-1"), /work_scope_immutable/);
  assert.throws(() => db.prepare("UPDATE tasks SET clientId = ? WHERE id = ?").run("other", "task-1"), /work_scope_immutable/);
  assert.throws(
    () => db.prepare("INSERT INTO tasks (id, title, status, level, columnOrder, createdAt, updatedAt, clientId, workScope) VALUES (?, ?, 'backlog', 'task', 0, ?, ?, ?, ?)")
      .run("task-invalid", "Invalid", now, now, "other", scope),
    /invalid_work_scope/,
  );
  db.close();
});
