"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const contract = loadTsModule(path.resolve(__dirname, "session-scope.ts"));

const TEAM_SCOPE = {
  version: 1,
  serverId: "server-1",
  userId: "user-1",
  teamId: "team-1",
  clientId: "client-1",
};

test("creates immutable versioned profile and session identities", () => {
  const profile = contract.createProfileIdentityV1({
    serverId: "server-1",
    userId: "user-1",
  });
  const scope = contract.createSessionScopeV1(TEAM_SCOPE);

  assert.deepEqual(profile, {
    version: 1,
    serverId: "server-1",
    userId: "user-1",
  });
  assert.deepEqual(scope, TEAM_SCOPE);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(scope), true);
  assert.throws(() => {
    scope.teamId = "team-2";
  }, TypeError);
});

test("rejects non-canonical or missing identifiers", () => {
  assert.throws(
    () => contract.createSessionScopeV1({ ...TEAM_SCOPE, serverId: "" }),
    (error) => error.code === "invalid_scope",
  );
  assert.throws(
    () => contract.createSessionScopeV1({ ...TEAM_SCOPE, userId: " user-1" }),
    (error) => error.code === "invalid_scope",
  );
  assert.throws(
    () => contract.createSessionScopeV1({ ...TEAM_SCOPE, teamId: "team-1 " }),
    (error) => error.code === "invalid_scope",
  );
});

test("interprets only absent legacy scope as Solo", () => {
  assert.deepEqual(contract.interpretStoredWorkScope(undefined), {
    mode: "solo",
    version: 1,
    clientId: null,
  });
  assert.deepEqual(
    contract.interpretStoredWorkScope(null, { legacyClientId: "acme" }),
    {
      mode: "solo",
      version: 1,
      clientId: "acme",
    },
  );
  assert.deepEqual(
    contract.interpretStoredWorkScope(undefined, { legacyClientId: "root" }),
    {
      mode: "solo",
      version: 1,
      clientId: null,
    },
  );
});

test("parses explicit Solo and Team work scopes", () => {
  const solo = contract.interpretStoredWorkScope({
    mode: "solo",
    version: 1,
    clientId: null,
  });
  const team = contract.interpretStoredWorkScope({
    mode: "team",
    scope: TEAM_SCOPE,
  });

  assert.deepEqual(solo, { mode: "solo", version: 1, clientId: null });
  assert.deepEqual(team, { mode: "team", scope: TEAM_SCOPE });
  assert.equal(Object.isFrozen(solo), true);
  assert.equal(Object.isFrozen(team), true);
  assert.equal(Object.isFrozen(team.scope), true);
});

test("does not downgrade malformed stored ownership to Solo", () => {
  for (const value of [
    {},
    { mode: "team" },
    { mode: "team", scope: { ...TEAM_SCOPE, teamId: "" } },
    { mode: "solo", version: 2, clientId: null },
    { mode: "unknown" },
  ]) {
    assert.throws(
      () => contract.interpretStoredWorkScope(value),
      (error) =>
        error.code === "invalid_scope" || error.code === "unsupported_scope_version",
    );
  }
});

test("recognizes only valid version-one session scopes", () => {
  assert.equal(contract.isSessionScopeV1(TEAM_SCOPE), true);
  assert.equal(contract.isSessionScopeV1({ ...TEAM_SCOPE, version: 2 }), false);
  assert.equal(contract.isSessionScopeV1({ ...TEAM_SCOPE, clientId: undefined }), false);
  assert.equal(contract.isSessionScopeV1(null), false);
});

test("compares profiles by immutable server and user IDs only", () => {
  assert.equal(
    contract.sameProfileIdentity(TEAM_SCOPE, { ...TEAM_SCOPE, teamId: "team-2" }),
    true,
  );
  assert.equal(
    contract.sameProfileIdentity(TEAM_SCOPE, { ...TEAM_SCOPE, userId: "user-2" }),
    false,
  );
  assert.equal(
    contract.sameProfileIdentity(TEAM_SCOPE, { ...TEAM_SCOPE, serverId: "server-2" }),
    false,
  );
});
