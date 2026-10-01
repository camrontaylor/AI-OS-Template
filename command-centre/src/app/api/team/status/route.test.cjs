const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

class LocalProfileLockedError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
    this.code = "profile_locked";
  }
}

let localProfileFailure = null;

const teamApiContext = loadTsModule(path.resolve(__dirname, "../../../../lib/team-api-context.ts"), {
  stubs: {
    "@/lib/memory/embedder": {
      createEmbedder: async () => ({
        model: "bge-m3",
        dim: 1024,
        embed: async () => [Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0))],
      }),
    },
  },
});
const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
  stubs: {
    "../../../../lib/team-api-context": teamApiContext,
    "@/lib/local-profile": {
      LocalProfileLockedError,
      localProfileErrorBody: (error) => ({
        error: { code: error.code, reason: error.reason, message: error.message },
      }),
      toBrowserLocalProfile: () => {
        if (localProfileFailure) throw localProfileFailure;
        return { version: 1, mode: "solo", profileKey: "solo", sessionId: "session-1" };
      },
    },
  },
});
const originalConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
const originalFetch = global.fetch;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-status-"));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalConfigDir == null) delete process.env.AI_OS_TEAM_CONFIG_DIR;
  else process.env.AI_OS_TEAM_CONFIG_DIR = originalConfigDir;
  global.fetch = originalFetch;
}

function writeContext(dir, overrides = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "team-context.json"),
    `${JSON.stringify({
      apiUrl: "http://127.0.0.1:8787",
      token: "status-token",
      savedAt: "2026-06-24T00:00:00.000Z",
      ...overrides,
    })}\n`,
  );
}

test("team status returns signed_out when no terminal context is saved", async () => {
  const dir = tempDir();
  process.env.AI_OS_TEAM_CONFIG_DIR = dir;
  try {
    const response = await route.GET();
    const body = await response.json();
    assert.equal(body.status, "signed_out");
    assert.equal(body.signedIn, false);
    assert.deepEqual(body.clients, []);
  } finally {
    cleanup(dir);
  }
});

test("team status returns whoami, health, and grant-filtered clients", async () => {
  const dir = tempDir();
  process.env.AI_OS_TEAM_CONFIG_DIR = dir;
  writeContext(dir);
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/v1/health")) {
      return Response.json({
        ok: true,
        backend: "pglite",
        embedder: { model: "hash", dim: 8 },
      });
    }
    assert.equal(options.headers.authorization, "Bearer status-token");
    if (href.endsWith("/v1/auth/teams")) {
      return Response.json({
        server: { id: "server-1" },
        teams: [{
          id: "team-1",
          slug: "demo",
          name: "Demo Team",
          membership: { id: "membership-1", role: "member", status: "active" },
        }],
        defaultTeamId: "team-1",
      });
    }
    if (href.endsWith("/v1/team/whoami")) {
      return Response.json({
        user: { id: "user-1", email: "member@example.com", displayName: "Member" },
        team: { id: "team-1", slug: "demo", name: "Demo Team" },
        membership: { id: "membership-1", role: "member", status: "active" },
      });
    }
    if (href.endsWith("/v1/team/clients")) {
      return Response.json({
        clients: [{ id: "client-1", slug: "acme", name: "Acme", access: "read" }],
      });
    }
    return Response.json({ error: { message: "not found" } }, { status: 404 });
  };

  try {
    const response = await route.GET();
    const body = await response.json();
    assert.equal(body.status, "connected");
    assert.equal(body.signedIn, true);
    assert.equal(body.user.email, "member@example.com");
    assert.equal(body.team.slug, "demo");
    assert.equal(body.health.backend, "pglite");
    assert.deepEqual(body.clients.map((client) => client.slug), ["acme"]);
  } finally {
    cleanup(dir);
  }
});

test("team status returns unavailable without exposing the saved token", async () => {
  const dir = tempDir();
  process.env.AI_OS_TEAM_CONFIG_DIR = dir;
  writeContext(dir);
  global.fetch = async (url) => {
    if (String(url).endsWith("/v1/health")) return Response.json({ ok: true });
    return Response.json(
      { error: { message: "missing or invalid bearer token" } },
      { status: 401 },
    );
  };

  try {
    const response = await route.GET();
    const body = await response.json();
    assert.equal(body.status, "unavailable");
    assert.equal(body.signedIn, false);
    assert.equal(body.token, undefined);
    assert.match(body.error, /bearer token/);
  } finally {
    cleanup(dir);
  }
});

test("team status keeps a valid saved login signed in when the server is unavailable", async () => {
  const dir = tempDir();
  process.env.AI_OS_TEAM_CONFIG_DIR = dir;
  writeContext(dir);
  global.fetch = async () => {
    throw new Error("network unavailable");
  };

  try {
    const response = await route.GET();
    const body = await response.json();
    assert.equal(body.status, "unavailable");
    assert.equal(body.signedIn, true);
    assert.equal(body.token, undefined);
    assert.match(body.error, /network unavailable/);
  } finally {
    cleanup(dir);
  }
});

test("Company Admin without Team access remains connected", async () => {
  const dir = tempDir();
  process.env.AI_OS_TEAM_CONFIG_DIR = dir;
  writeContext(dir, { user: { id: "user-1", email: "admin@example.com" } });
  const calls = [];
  global.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.endsWith("/v1/health")) return Response.json({ ok: true, backend: "pglite" });
    if (href.endsWith("/v1/auth/teams")) {
      return Response.json({
        server: { id: "server-1" },
        teams: [],
        defaultTeamId: null,
        companyMembership: { id: "company-1", userId: "user-1", role: "admin", status: "active" },
        pendingAccessRequestCount: 2,
      });
    }
    return Response.json({ error: { message: "Team-scoped endpoint must not be called" } }, { status: 500 });
  };

  try {
    const response = await route.GET();
    const body = await response.json();
    assert.equal(body.status, "connected");
    assert.equal(body.signedIn, true);
    assert.equal(body.selectedTeamId, null);
    assert.equal(body.team, null);
    assert.equal(body.companyMembership.role, "admin");
    assert.equal(body.pendingAccessRequestCount, 2);
    assert.deepEqual(body.clients, []);
    assert.equal(calls.some((href) => href.endsWith("/v1/team/whoami")), false);
    assert.equal(calls.some((href) => href.endsWith("/v1/team/clients")), false);
  } finally {
    cleanup(dir);
  }
});

test("team status returns safe profile lock details for browser recovery", async () => {
  const dir = tempDir();
  process.env.AI_OS_TEAM_CONFIG_DIR = dir;
  localProfileFailure = new LocalProfileLockedError(
    "identity_incomplete",
    "Reconnect after upgrading the server.",
  );

  try {
    const response = await route.GET();
    const body = await response.json();
    assert.deepEqual(body.localProfile, {
      version: 1,
      mode: "team",
      profileKey: "locked",
      sessionId: "locked",
    });
    assert.deepEqual(body.localProfileError, {
      code: "profile_locked",
      reason: "identity_incomplete",
      message: "Reconnect after upgrading the server.",
    });
  } finally {
    localProfileFailure = null;
    cleanup(dir);
  }
});

test("team status does not hide unexpected local profile errors", async () => {
  const dir = tempDir();
  process.env.AI_OS_TEAM_CONFIG_DIR = dir;
  localProfileFailure = new Error("unexpected profile failure");

  try {
    await assert.rejects(() => route.GET(), /unexpected profile failure/);
  } finally {
    localProfileFailure = null;
    cleanup(dir);
  }
});
