const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

class LocalProfileLockedError extends Error {}
class LocalProfileRequestError extends Error {}
class TeamApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function descriptor(profileKey = "solo", mode = "solo") {
  return {
    version: 1,
    mode,
    profileKey,
    identity: mode === "team" ? { version: 1, serverId: "server-1", userId: profileKey.split(":").at(-1) } : undefined,
    dataDir: `C:/profiles/${profileKey}`,
    stateDir: `C:/profiles/${profileKey}/state`,
    tempDir: `C:/profiles/${profileKey}/tmp`,
    dbPath: `C:/profiles/${profileKey}/data.db`,
  };
}

function localProfileStub(resolve = () => descriptor()) {
  return {
    LocalProfileLockedError,
    localProfileErrorBody: (error) => ({ error: { code: "profile_locked", message: error.message } }),
    createTeamLocalProfileDescriptor: (identity) => ({ ...descriptor(`${identity.serverId}:${identity.userId}`, "team"), identity }),
    resolveLocalProfileDescriptor: resolve,
    toBrowserLocalProfile: (profile = resolve()) => ({ version: 1, mode: profile.mode, profileKey: profile.profileKey, sessionId: "session-1" }),
  };
}

function infrastructureStubs(teamApiContext, options = {}) {
  return {
    "@/lib/local-profile": options.localProfile ?? localProfileStub(),
    "@/lib/team-api-context": teamApiContext,
    "@/lib/identity/session-scope": {
      createProfileIdentityV1: ({ serverId, userId }) => ({ version: 1, serverId, userId }),
    },
    "@/lib/local-profile-lifecycle": {
      activateLocalProfile: () => {},
      LocalProfileRequestError,
      localProfileRequestErrorBody: (error) => ({ error: { code: error.code, message: error.message } }),
      LOCAL_PROFILE_CLEANUP_MARKER: "cleanup-pending-v1.json",
    },
    "@/lib/config": { getConfig: () => ({ aiOsDir: "C:/root" }) },
    "@/lib/profile-shutdown-coordinator": {
      shutdownLocalProfile: options.shutdownLocalProfile ?? (async () => ({ version: 1, status: "complete", warnings: [] })),
    },
  };
}

function request(body = {}) {
  return { json: async () => body };
}

test("team session POST validates before persisting and never returns the token", async () => {
  const calls = [];
  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: infrastructureStubs({
      validateTeamTokenContext: async (apiUrl, token) => {
        calls.push(["validate", apiUrl, token]);
        return { apiUrl, token, serverId: "server-1", user: { id: "user-1" } };
      },
      readTeamContext: async () => null,
      writeTeamContext: async () => calls.push(["write"]),
      fetchTeamStatus: async () => ({ status: "connected", signedIn: true, clients: [], user: { email: "member@example.com" } }),
      clearTeamContext: async () => {},
    }),
  });

  const response = await route.POST(request({ apiUrl: "http://team.test", token: "secret-token" }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["validate", "http://team.test", "secret-token"], ["write"]]);
  assert.equal(body.token, undefined);
});

test("team session POST leaves the old login unchanged when candidate validation fails", async () => {
  let wrote = false;
  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: infrastructureStubs({
      validateTeamTokenContext: async () => { throw new Error("missing or invalid bearer token"); },
      writeTeamContext: async () => { wrote = true; },
    }),
  });
  const response = await route.POST(request({ apiUrl: "http://team.test", token: "bad-token" }));
  assert.equal(response.status, 400);
  assert.equal(wrote, false);
  assert.match((await response.json()).error, /bearer token/);
});

test("different-user login shuts down the old profile before writing the candidate", async () => {
  const calls = [];
  const oldProfile = descriptor("server-1:user-a", "team");
  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: infrastructureStubs({
      validateTeamTokenContext: async () => ({ apiUrl: "http://team.test", token: "new", serverId: "server-1", user: { id: "user-b" } }),
      readTeamContext: async () => ({ apiUrl: "http://team.test", token: "old" }),
      revokeTeamContext: async () => calls.push("revoke"),
      clearTeamContext: async () => calls.push("clear"),
      writeTeamContext: async () => calls.push("write"),
      fetchTeamStatus: async () => ({ status: "connected", signedIn: true, clients: [] }),
    }, {
      localProfile: localProfileStub(() => oldProfile),
      shutdownLocalProfile: async (_profile, options) => {
        calls.push("shutdown");
        await options.revokeRemote();
        return { version: 1, status: "complete", warnings: [] };
      },
    }),
  });
  await route.POST(request({ apiUrl: "http://team.test", token: "new" }));
  assert.deepEqual(calls, ["shutdown", "revoke", "clear", "write"]);
});

test("team session DELETE blocks and cleans the old profile before returning Solo", async () => {
  const calls = [];
  let signedOut = false;
  const oldProfile = descriptor("server-1:user-a", "team");
  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: infrastructureStubs({
      readTeamContext: async () => ({ apiUrl: "http://team.test", token: "old" }),
      revokeTeamContext: async () => calls.push("revoke"),
      clearTeamContext: async () => { signedOut = true; calls.push("clear"); },
      fetchTeamStatus: async () => ({ status: "signed_out", signedIn: false, clients: [] }),
    }, {
      localProfile: localProfileStub(() => signedOut ? descriptor() : oldProfile),
      shutdownLocalProfile: async (_profile, options) => {
        calls.push("shutdown");
        await options.revokeRemote();
        return { version: 1, status: "complete_with_warnings", warnings: [{ code: "process_force_stopped", retry: "not_required" }] };
      },
    }),
  });
  const response = await route.DELETE();
  const body = await response.json();
  assert.deepEqual(calls, ["shutdown", "revoke", "clear"]);
  assert.equal(body.localProfile.profileKey, "solo");
  assert.equal(body.cleanup.status, "complete_with_warnings");
});

test("team session PATCH selects a validated team without rotating the profile", async () => {
  const calls = [];
  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: infrastructureStubs({
      TeamApiError,
      selectTeamContext: async (teamId) => calls.push(teamId),
      fetchTeamStatus: async () => ({ status: "connected", signedIn: true, selectedTeamId: "team-b", clients: [] }),
    }),
  });
  const response = await route.PATCH(request({ teamId: "team-b" }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["team-b"]);
  assert.equal((await response.json()).token, undefined);
});

test("team session PATCH preserves Team API selection errors", async () => {
  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: infrastructureStubs({
      TeamApiError,
      selectTeamContext: async () => { throw new TeamApiError("Active team membership is required", 403); },
    }),
  });
  const response = await route.PATCH(request({ teamId: "team-b" }));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /membership/i);
});
