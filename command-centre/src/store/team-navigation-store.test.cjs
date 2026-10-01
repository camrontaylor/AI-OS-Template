const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../lib/test-utils/load-ts-module.cjs");

function loadStore(stubs = {}) {
  return loadTsModule(path.resolve(__dirname, "team-navigation-store.ts"), { stubs });
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function connected(teamId, name = teamId) {
  return {
    status: "connected",
    signedIn: true,
    clients: [],
    serverId: "server-1",
    selectedTeamId: teamId,
    team: { id: teamId, name },
    membership: { role: "member", status: "active" },
    teams: [{ id: teamId, name, membership: { role: "member", status: "active" } }],
  };
}

test("Team navigation is available only for a healthy connected profile", () => {
  const { isTeamNavigationAvailable, normalizeTeamNavigationStatus } = loadStore();
  const normalize = (value) => normalizeTeamNavigationStatus(value);

  assert.equal(isTeamNavigationAvailable(normalize({ status: "signed_out", signedIn: false })), false);
  assert.equal(isTeamNavigationAvailable(normalize({ status: "connected", signedIn: true })), true);
  assert.equal(isTeamNavigationAvailable(normalize({ status: "unavailable", signedIn: true })), false);
  assert.equal(isTeamNavigationAvailable(normalize({
    status: "connected",
    signedIn: true,
    localProfile: { version: 1, mode: "team", profileKey: "locked", sessionId: "locked" },
  })), false);
});

test("latest status refresh wins when responses finish out of order", async () => {
  const previousFetch = global.fetch;
  const pending = [];
  try {
    global.fetch = (_url, options = {}) => new Promise((resolve) => pending.push({ resolve, signal: options.signal }));
    const { useTeamNavigationStore } = loadStore();

    const first = useTeamNavigationStore.getState().refresh();
    const second = useTeamNavigationStore.getState().refresh();
    pending[1].resolve(response(connected("team-b", "Beta")));
    await second;
    pending[0].resolve(response(connected("team-a", "Alpha")));
    await first;

    assert.equal(useTeamNavigationStore.getState().status.selectedTeamId, "team-b");
  } finally {
    global.fetch = previousFetch;
  }
});

test("rapid team selections are serialized and the newest intent is committed", async () => {
  const previousFetch = global.fetch;
  const previousWindow = global.window;
  const calls = [];
  try {
    global.window = { dispatchEvent() {} };
    global.fetch = async (_url, options = {}) => {
      const teamId = JSON.parse(options.body).teamId;
      calls.push(teamId);
      return response(connected(teamId));
    };
    const { useTeamNavigationStore } = loadStore();

    const a = useTeamNavigationStore.getState().selectTeam("team-a");
    const b = useTeamNavigationStore.getState().selectTeam("team-b");
    const finalA = useTeamNavigationStore.getState().selectTeam("team-a");
    assert.deepEqual(await Promise.all([a, b, finalA]), [true, true, true]);

    assert.deepEqual(calls, ["team-a", "team-b", "team-a"]);
    assert.equal(useTeamNavigationStore.getState().status.selectedTeamId, "team-a");
  } finally {
    global.fetch = previousFetch;
    global.window = previousWindow;
  }
});

test("failed selection preserves the last confirmed team", async () => {
  const previousFetch = global.fetch;
  try {
    let call = 0;
    global.fetch = async (_url, options = {}) => {
      call += 1;
      if (options.method === "PATCH") {
        return response({ error: "Active team membership is required" }, 403);
      }
      return response(connected("team-a", "Alpha"));
    };
    const { useTeamNavigationStore } = loadStore();
    await useTeamNavigationStore.getState().refresh();
    const result = await useTeamNavigationStore.getState().selectTeam("team-b");

    assert.equal(call, 2);
    assert.equal(result, false);
    assert.equal(useTeamNavigationStore.getState().status.selectedTeamId, "team-a");
    assert.match(useTeamNavigationStore.getState().error, /membership/i);
  } finally {
    global.fetch = previousFetch;
  }
});

test("a failed latest selection restores the confirmed team after a stale success", async () => {
  const previousFetch = global.fetch;
  const calls = [];
  try {
    global.fetch = async (_url, options = {}) => {
      if (options.method !== "PATCH") return response(connected("team-a", "Alpha"));
      const teamId = JSON.parse(options.body).teamId;
      calls.push(teamId);
      if (teamId === "team-c") {
        return response({ error: "Active team membership is required" }, 403);
      }
      return response(connected(teamId));
    };
    const { useTeamNavigationStore } = loadStore();
    await useTeamNavigationStore.getState().refresh();

    const staleSuccess = useTeamNavigationStore.getState().selectTeam("team-b");
    const latestFailure = useTeamNavigationStore.getState().selectTeam("team-c");

    assert.deepEqual(await Promise.all([staleSuccess, latestFailure]), [true, false]);
    assert.deepEqual(calls, ["team-b", "team-c", "team-a"]);
    assert.equal(useTeamNavigationStore.getState().status.selectedTeamId, "team-a");
    assert.match(useTeamNavigationStore.getState().error, /membership/i);
  } finally {
    global.fetch = previousFetch;
  }
});

test("normalization retains profile lock details and exposes the correct recovery action", () => {
  const {
    canReconnectLocalProfile,
    isLocalProfileLocked,
    normalizeTeamNavigationStatus,
  } = loadStore();
  const locked = normalizeTeamNavigationStatus({
    status: "connected",
    signedIn: true,
    localProfile: { version: 1, mode: "team", profileKey: "locked", sessionId: "locked" },
    localProfileError: {
      code: "profile_locked",
      reason: "identity_incomplete",
      message: "Reconnect Team OS.",
    },
  });
  assert.equal(isLocalProfileLocked(locked), true);
  assert.equal(canReconnectLocalProfile(locked), true);
  assert.equal(locked.localProfileError.message, "Reconnect Team OS.");

  for (const reason of ["profile_missing", "profile_migration_failed"]) {
    const repairOnly = normalizeTeamNavigationStatus({
      ...locked,
      localProfileError: { code: "profile_locked", reason, message: "Repair required." },
    });
    assert.equal(isLocalProfileLocked(repairOnly), true);
    assert.equal(canReconnectLocalProfile(repairOnly), false);
  }
});

test("normalization retains company role, effective access, and pending requests", () => {
  const { normalizeTeamNavigationStatus } = loadStore();
  const normalized = normalizeTeamNavigationStatus({
    status: "connected",
    signedIn: true,
    selectedTeamId: "team-1",
    companyMembership: { id: "company-1", userId: "user-1", role: "admin", status: "active" },
    pendingAccessRequestCount: 4,
    teams: [{
      id: "team-1",
      name: "Alpha",
      membership: { role: null, status: null },
      access: {
        companyRole: "admin",
        source: "company_grant",
        effectiveRole: "admin",
        fullAccess: true,
        protected: true,
      },
      pendingRequest: true,
    }],
  });

  assert.equal(normalized.companyMembership.role, "admin");
  assert.equal(normalized.pendingAccessRequestCount, 4);
  assert.equal(normalized.effectiveAccess.source, "company_grant");
  assert.equal(normalized.effectiveAccess.protected, true);
  assert.equal(normalized.teams[0].pendingRequest, true);
});

test("status refresh reloads for a repaired profile but not for the locked sentinel", async () => {
  const previousFetch = global.fetch;
  const notifications = [];
  const responses = [
    {
      status: "connected",
      signedIn: true,
      localProfile: { version: 1, mode: "team", profileKey: "locked", sessionId: "locked" },
      localProfileError: {
        code: "profile_locked",
        reason: "identity_incomplete",
        message: "Reconnect Team OS.",
      },
    },
    {
      status: "connected",
      signedIn: true,
      localProfile: { version: 1, mode: "team", profileKey: "profile-1", sessionId: "session-2" },
    },
  ];

  try {
    global.fetch = async () => response(responses.shift());
    const { useTeamNavigationStore } = loadStore({
      "../lib/profile-storage": {
        notifyLocalProfileChange: (profile) => {
          notifications.push(profile);
          return true;
        },
      },
    });

    await useTeamNavigationStore.getState().refresh();
    assert.deepEqual(notifications, []);
    assert.equal(useTeamNavigationStore.getState().status.localProfile.profileKey, "locked");

    await useTeamNavigationStore.getState().refresh();
    assert.deepEqual(notifications.map((profile) => profile.profileKey), ["profile-1"]);
  } finally {
    global.fetch = previousFetch;
  }
});
