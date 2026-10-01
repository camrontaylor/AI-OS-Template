const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function loadTeamApiContext() {
  return loadTsModule(path.resolve(__dirname, "team-api-context.ts"), {
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
}

function tempTeamConfig(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-config-"));
  fs.writeFileSync(
    path.join(dir, "team-context.json"),
    JSON.stringify({ apiUrl: "http://team.test", token: "test-token", ...overrides }),
  );
  return dir;
}

test("searchTeamMemory sends selected client scope to the Team API", async () => {
  const configDir = tempTeamConfig();
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  let captured = null;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url, options = {}) => {
      captured = { url: String(url), options };
      return Response.json({
        visibilitySet: ["system", "team", "private", "client"],
        eventId: "event-1",
        results: [{
          sourcePath: "clients/acme/context/memory/shared.md",
          sourceType: "memory",
          content: "Acme scoped memory",
          score: 0.8,
          finalScore: 0.9,
        }],
      });
    };

    const teamApi = loadTeamApiContext();
    const result = await teamApi.searchTeamMemory("pricing plan", "acme", 7);

    assert.equal(captured.url, "http://team.test/v1/memory/search");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.authorization, "Bearer test-token");
    const body = JSON.parse(captured.options.body);
    assert.equal(body.query, "pricing plan");
    assert.equal(body.embeddingModel, "bge-m3");
    assert.equal(body.embeddingDim, 1024);
    assert.equal(body.queryEmbedding.length, 1024);
    assert.equal(body.topK, 7);
    assert.deepEqual(body.scope, {
      teamId: null,
      clientId: "acme",
      userId: null,
      include: ["system", "team", "private", "client"],
    });
    assert.equal(result.requestedClientId, "acme");
    assert.equal(result.results[0].content, "Acme scoped memory");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("parallel memory requests keep their explicit Team headers without changing the default", async () => {
  const teamA = "11111111-1111-4111-8111-111111111111";
  const teamB = "22222222-2222-4222-8222-222222222222";
  const configDir = tempTeamConfig({ version: 3, selectedTeamId: teamB });
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  const captured = new Map();
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body);
      captured.set(body.query, options.headers["x-ai-team-id"]);
      return Response.json({ visibilitySet: [], eventId: null, results: [] });
    };

    const teamApi = loadTeamApiContext();
    await Promise.all([
      teamApi.searchTeamMemory("work-a", "acme", 5, { teamId: teamA }),
      teamApi.searchTeamMemory("work-b", "beta", 5, { teamId: teamB }),
    ]);

    assert.equal(captured.get("work-a"), teamA);
    assert.equal(captured.get("work-b"), teamB);
    const saved = JSON.parse(fs.readFileSync(path.join(configDir, "team-context.json"), "utf-8"));
    assert.equal(saved.selectedTeamId, teamB);
  } finally {
    if (previousConfigDir === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("version 2 config derives a selected team and version 3 requests allow a non-mutating override", async () => {
  const teamA = "11111111-1111-4111-8111-111111111111";
  const teamB = "33333333-3333-4333-8333-333333333333";
  const configDir = tempTeamConfig({
    version: 2,
    team: { id: teamA, slug: "alpha", name: "Alpha" },
    membership: { id: "membership-a", role: "owner", status: "active" },
  });
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  const captured = [];
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url, options = {}) => {
      captured.push({ url: String(url), headers: options.headers });
      return Response.json({ ok: true });
    };
    const teamApi = loadTeamApiContext();
    const config = await teamApi.readTeamContext();
    assert.equal(config.version, 2);
    assert.equal(config.selectedTeamId, teamA);

    await teamApi.teamFetch(config, "/v1/team/whoami");
    await teamApi.teamFetch(config, "/v1/team/whoami", { teamId: teamB });
    await teamApi.teamFetch(config, "/v1/auth/teams", { teamId: null });

    assert.equal(captured[0].headers["x-ai-team-id"], teamA);
    assert.equal(captured[1].headers["x-ai-team-id"], teamB);
    assert.equal(captured[2].headers["x-ai-team-id"], undefined);
    assert.equal(config.selectedTeamId, teamA);

    await teamApi.writeTeamContext({ ...config, serverId: "server-1", teams: [] });
    const saved = JSON.parse(fs.readFileSync(path.join(configDir, "team-context.json"), "utf-8"));
    assert.equal(saved.version, 3);
    assert.equal(saved.selectedTeamId, teamA);
    assert.equal(saved.serverId, "server-1");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("Solo process environment never falls back to the globally selected Team", async () => {
  const teamA = "11111111-1111-4111-8111-111111111111";
  const teamB = "22222222-2222-4222-8222-222222222222";
  const previousFetch = global.fetch;
  const previousMode = process.env.AI_OS_WORK_MODE;
  const previousTeam = process.env.AI_OS_TEAM_ID;
  const captured = [];
  try {
    process.env.AI_OS_WORK_MODE = "solo";
    process.env.AI_OS_TEAM_ID = teamB;
    global.fetch = async (_url, options = {}) => {
      captured.push(options.headers["x-ai-team-id"]);
      return Response.json({ ok: true });
    };
    const teamApi = loadTeamApiContext();
    const config = { apiUrl: "http://team.test", token: "token", selectedTeamId: teamA };
    await teamApi.teamFetch(config, "/v1/team/whoami");
    await teamApi.teamFetch(config, "/v1/team/whoami", { teamId: teamB });
    assert.deepEqual(captured, [undefined, teamB]);
  } finally {
    if (previousMode === undefined) delete process.env.AI_OS_WORK_MODE;
    else process.env.AI_OS_WORK_MODE = previousMode;
    if (previousTeam === undefined) delete process.env.AI_OS_TEAM_ID;
    else process.env.AI_OS_TEAM_ID = previousTeam;
    global.fetch = previousFetch;
  }
});

test("conversation-only process environment blocks every Team API request locally", async () => {
  const previousFetch = global.fetch;
  const previousEnrichment = process.env.AI_OS_TEAM_ENRICHMENT;
  let fetchCalls = 0;
  try {
    process.env.AI_OS_TEAM_ENRICHMENT = "conversation_only";
    global.fetch = async () => {
      fetchCalls += 1;
      return Response.json({ ok: true });
    };
    const teamApi = loadTeamApiContext();
    await assert.rejects(
      teamApi.teamFetch(
        { apiUrl: "http://team.test", token: "token", selectedTeamId: "team-a" },
        "/v1/context/snapshot",
      ),
      (error) => error.status === 403 && error.code === "team_enrichment_disabled",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousEnrichment === undefined) delete process.env.AI_OS_TEAM_ENRICHMENT;
    else process.env.AI_OS_TEAM_ENRICHMENT = previousEnrichment;
    global.fetch = previousFetch;
  }
});

test("conversation-only process environment also blocks Team CLI requests locally", async () => {
  const previousFetch = global.fetch;
  const previousEnrichment = process.env.AI_OS_TEAM_ENRICHMENT;
  let fetchCalls = 0;
  try {
    process.env.AI_OS_TEAM_ENRICHMENT = "conversation_only";
    global.fetch = async () => {
      fetchCalls += 1;
      return Response.json({ ok: true });
    };
    const { teamRequest } = require("../../scripts/lib/team-api.cjs");
    await assert.rejects(
      teamRequest({ apiUrl: "http://team.test", token: "token" }, "/v1/context/snapshot"),
      (error) => error.status === 403 && error.code === "team_enrichment_disabled",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousEnrichment === undefined) delete process.env.AI_OS_TEAM_ENRICHMENT;
    else process.env.AI_OS_TEAM_ENRICHMENT = previousEnrichment;
    global.fetch = previousFetch;
  }
});

test("fetchTeamStatus returns blocked (not unavailable) when the server returns 403", async () => {
  const configDir = tempTeamConfig();
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith("/v1/health")) {
        return Response.json({ ok: true, backend: "pglite" });
      }
      if (href.endsWith("/v1/auth/teams")) {
        return Response.json({
          server: { id: "server-1" },
          teams: [{ id: "team-1", slug: "demo", name: "Demo", membership: { status: "active" } }],
          defaultTeamId: "team-1",
        });
      }
      if (href.endsWith("/v1/team/whoami")) {
        return Response.json(
          { error: { message: "active team membership is required", code: "forbidden" } },
          { status: 403 },
        );
      }
      return Response.json({ clients: [] });
    };

    const teamApi = loadTeamApiContext();
    const status = await teamApi.fetchTeamStatus();

    assert.equal(status.status, "blocked");
    assert.equal(status.signedIn, true);
    assert.equal(status.error, "active team membership is required");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("fetchTeamStatus keeps a valid login visible when all memberships are revoked", async () => {
  const configDir = tempTeamConfig();
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url) => String(url).endsWith("/v1/health")
      ? Response.json({ ok: true })
      : Response.json({ server: { id: "server-1" }, teams: [], defaultTeamId: null });

    const teamApi = loadTeamApiContext();
    const status = await teamApi.fetchTeamStatus();

    assert.equal(status.status, "blocked");
    assert.equal(status.signedIn, true);
    assert.deepEqual(status.teams, []);
    assert.match(status.error, /no active team memberships/i);
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("fetchTeamStatus replaces a revoked saved selection with the active server default", async () => {
  const revokedTeam = "11111111-1111-4111-8111-111111111111";
  const activeTeam = "22222222-2222-4222-8222-222222222222";
  const configDir = tempTeamConfig({
    version: 3,
    selectedTeamId: revokedTeam,
    team: { id: revokedTeam, name: "Revoked" },
    teams: [{ id: revokedTeam, name: "Revoked", membership: { status: "active" } }],
  });
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  const scopedHeaders = [];
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      if (href.endsWith("/v1/health")) return Response.json({ ok: true });
      if (href.endsWith("/v1/auth/teams")) {
        return Response.json({
          server: { id: "server-1" },
          teams: [{
            id: activeTeam,
            slug: "active",
            name: "Active",
            membership: { role: "member", status: "active" },
          }],
          defaultTeamId: activeTeam,
        });
      }
      scopedHeaders.push(options.headers["x-ai-team-id"]);
      if (href.endsWith("/v1/team/whoami")) {
        return Response.json({
          user: { id: "user-1" },
          team: { id: activeTeam, slug: "active", name: "Active" },
          membership: { role: "member", status: "active" },
        });
      }
      return Response.json({ clients: [] });
    };

    const teamApi = loadTeamApiContext();
    const status = await teamApi.fetchTeamStatus();
    const saved = JSON.parse(fs.readFileSync(path.join(configDir, "team-context.json"), "utf-8"));

    assert.equal(status.status, "connected");
    assert.equal(status.selectedTeamId, activeTeam);
    assert.deepEqual(scopedHeaders, [activeTeam, activeTeam]);
    assert.equal(saved.selectedTeamId, activeTeam);
    assert.equal(saved.team.id, activeTeam);
    assert.equal(saved.membership.role, "member");
  } finally {
    if (previousConfigDir === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("fetchTeamStatus falls back to the first active team when the server default is invalid", async () => {
  const firstTeam = "11111111-1111-4111-8111-111111111111";
  const configDir = tempTeamConfig({ version: 3, selectedTeamId: "33333333-3333-4333-8333-333333333333" });
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith("/v1/health")) return Response.json({ ok: true });
      if (href.endsWith("/v1/auth/teams")) {
        return Response.json({
          server: { id: "server-1" },
          teams: [{ id: firstTeam, slug: "first", name: "First", membership: { status: "active" } }],
          defaultTeamId: "44444444-4444-4444-8444-444444444444",
        });
      }
      if (href.endsWith("/v1/team/whoami")) {
        return Response.json({ team: { id: firstTeam }, membership: { status: "active" } });
      }
      return Response.json({ clients: [] });
    };

    const status = await loadTeamApiContext().fetchTeamStatus();
    assert.equal(status.status, "connected");
    assert.equal(status.selectedTeamId, firstTeam);
  } finally {
    if (previousConfigDir === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("selectTeamContext validates active membership before persisting the selection", async () => {
  const teamA = "11111111-1111-4111-8111-111111111111";
  const teamB = "22222222-2222-4222-8222-222222222222";
  const configDir = tempTeamConfig({ version: 3, selectedTeamId: teamA });
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  let requestedHeader;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (_url, options = {}) => {
      requestedHeader = options.headers["x-ai-team-id"];
      return Response.json({
        server: { id: "server-1" },
        teams: [
          { id: teamA, name: "Alpha", membership: { role: "owner", status: "active" } },
          { id: teamB, name: "Beta", membership: { role: "member", status: "active" } },
        ],
        defaultTeamId: teamA,
      });
    };

    const selected = await loadTeamApiContext().selectTeamContext(teamB);
    const saved = JSON.parse(fs.readFileSync(path.join(configDir, "team-context.json"), "utf-8"));

    assert.equal(requestedHeader, undefined);
    assert.equal(selected.selectedTeamId, teamB);
    assert.equal(saved.selectedTeamId, teamB);
    assert.equal(saved.team.name, "Beta");
    assert.equal(saved.membership.role, "member");
  } finally {
    if (previousConfigDir === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("selectTeamContext rejects a missing membership without changing the prior selection", async () => {
  const teamA = "11111111-1111-4111-8111-111111111111";
  const teamB = "22222222-2222-4222-8222-222222222222";
  const configDir = tempTeamConfig({ version: 3, selectedTeamId: teamA });
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async () => Response.json({
      teams: [{ id: teamA, name: "Alpha", membership: { status: "active" } }],
      defaultTeamId: teamA,
    });

    await assert.rejects(
      loadTeamApiContext().selectTeamContext(teamB),
      (error) => error.status === 403 && /membership/i.test(error.message),
    );
    const saved = JSON.parse(fs.readFileSync(path.join(configDir, "team-context.json"), "utf-8"));
    assert.equal(saved.selectedTeamId, teamA);
  } finally {
    if (previousConfigDir === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("fetchTeamStatus stays signed in but unavailable on a network error", async () => {
  const configDir = tempTeamConfig();
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async () => {
      throw new Error("fetch failed");
    };

    const teamApi = loadTeamApiContext();
    const status = await teamApi.fetchTeamStatus();

    assert.equal(status.status, "unavailable");
    assert.equal(status.signedIn, true);
    assert.equal(status.error, "fetch failed");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("fetchTeamStatus stays signed in but unavailable on a server error", async () => {
  const configDir = tempTeamConfig();
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url) => {
      if (String(url).endsWith("/v1/health")) return Response.json({ ok: true });
      return Response.json(
        { error: { message: "hosted API failed", code: "internal" } },
        { status: 500 },
      );
    };

    const teamApi = loadTeamApiContext();
    const status = await teamApi.fetchTeamStatus();

    assert.equal(status.status, "unavailable");
    assert.equal(status.signedIn, true);
    assert.equal(status.error, "hosted API failed");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("fetchTeamStatus requires sign-in again when the server rejects the token", async () => {
  const configDir = tempTeamConfig();
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url) => {
      if (String(url).endsWith("/v1/health")) return Response.json({ ok: true });
      return Response.json(
        { error: { message: "token expired", code: "unauthorized" } },
        { status: 401 },
      );
    };

    const teamApi = loadTeamApiContext();
    const status = await teamApi.fetchTeamStatus();

    assert.equal(status.status, "unavailable");
    assert.equal(status.signedIn, false);
    assert.equal(status.error, "token expired");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("fetchTeamStatus requires sign-in again when the saved login has expired", async () => {
  const configDir = tempTeamConfig({ expiresAt: "2000-01-01T00:00:00.000Z" });
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async () => {
      fetchCalls += 1;
      throw new Error("expired login must not call the server");
    };

    const teamApi = loadTeamApiContext();
    const status = await teamApi.fetchTeamStatus();

    assert.equal(status.status, "unavailable");
    assert.equal(status.signedIn, false);
    assert.match(status.error, /expired/i);
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test("fetchTeamMemoryStatus reads hosted memory status", async () => {
  const configDir = tempTeamConfig();
  const previousConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousFetch = global.fetch;
  let captured = null;
  try {
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    global.fetch = async (url, options = {}) => {
      captured = { url: String(url), options };
      return Response.json({
        storeReady: true,
        scope: { mode: "team", teamId: "team-1", userId: "user-1" },
        sources: 4,
        chunks: 12,
        jobs: 5,
        captureEvents: 3,
        byVisibility: { system: 1, team: 1, client: 2 },
        jobsByStatus: { succeeded: 4, failed: 1 },
        captureEventsByStatus: { pending: 2, processed: 1 },
        captureEligibility: {
          pending: 2,
          eligiblePending: 1,
          waitingPending: 1,
          nextEligibleAt: "2026-06-24T01:20:00.000Z",
          volumeThreshold: 8,
        },
        lastIndexedAt: "2026-06-24T01:00:00.000Z",
        lastJob: {
          sourcePath: "clients/acme/context/memory/shared.md",
          reason: "manual",
          status: "failed",
          errorMessage: "bad file",
          finishedAt: "2026-06-24T01:00:00.000Z",
        },
      });
    };

    const teamApi = loadTeamApiContext();
    const result = await teamApi.fetchTeamMemoryStatus();

    assert.equal(captured.url, "http://team.test/v1/memory/status");
    assert.equal(captured.options.headers.authorization, "Bearer test-token");
    assert.equal(result.scope.teamId, "team-1");
    assert.equal(result.sources, 4);
    assert.equal(result.jobsByStatus.failed, 1);
    assert.equal(result.captureEvents, 3);
    assert.equal(result.captureEventsByStatus.pending, 2);
    assert.deepEqual(result.captureEligibility, {
      pending: 2,
      eligiblePending: 1,
      waitingPending: 1,
      nextEligibleAt: "2026-06-24T01:20:00.000Z",
      volumeThreshold: 8,
    });
    assert.equal(result.lastJob.errorMessage, "bad file");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.AI_OS_TEAM_CONFIG_DIR;
    } else {
      process.env.AI_OS_TEAM_CONFIG_DIR = previousConfigDir;
    }
    global.fetch = previousFetch;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
