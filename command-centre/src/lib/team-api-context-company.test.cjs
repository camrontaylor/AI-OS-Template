const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const context = loadTsModule(path.resolve(__dirname, "team-api-context.ts"), {
  stubs: {
    "@/lib/memory/embedder": {
      createEmbedder: async () => ({ model: "bge-m3", dim: 1024, embed: async () => [[]] }),
    },
  },
});

const originalConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
const originalFetch = global.fetch;

function setupContext(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-company-context-"));
  process.env.AI_OS_TEAM_CONFIG_DIR = dir;
  fs.writeFileSync(path.join(dir, "team-context.json"), `${JSON.stringify({
    apiUrl: "http://127.0.0.1:8787",
    token: "company-token",
    selectedTeamId: "team-current",
    savedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  })}\n`);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalConfigDir == null) delete process.env.AI_OS_TEAM_CONFIG_DIR;
  else process.env.AI_OS_TEAM_CONFIG_DIR = originalConfigDir;
  global.fetch = originalFetch;
}

test("company proxy context uses company endpoints without a Team scope header", async () => {
  const dir = setupContext();
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json({ ok: true });
  };

  try {
    await context.fetchCompanyState("teams", "team/a");
    await context.postCompanyAction("access", { action: "request-access", teamId: "team/a" });

    assert.equal(calls[0].url, "http://127.0.0.1:8787/v1/company/teams?teamId=team%2Fa");
    assert.equal(calls[0].options.headers.authorization, "Bearer company-token");
    assert.equal(calls[0].options.headers["x-ai-team-id"], undefined);
    assert.equal(calls[1].url, "http://127.0.0.1:8787/v1/company/access");
    assert.equal(calls[1].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].options.body), { action: "request-access", teamId: "team/a" });
    assert.equal(calls[1].options.headers["x-ai-team-id"], undefined);
  } finally {
    cleanup(dir);
  }
});

test("company proxy context preserves API status and error code", async () => {
  const dir = setupContext();
  global.fetch = async () => Response.json(
    { error: { code: "company_access_required", message: "Company access is required" } },
    { status: 403 },
  );

  try {
    await assert.rejects(
      () => context.fetchCompanyState("memberships"),
      (error) => error instanceof context.TeamApiError
        && error.status === 403
        && error.code === "company_access_required",
    );
  } finally {
    cleanup(dir);
  }
});

test("an invited Company Admin without a Team is not treated as connected", async () => {
  const dir = setupContext({ selectedTeamId: null, teams: [] });
  global.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/health") return Response.json({ ok: true });
    if (pathname === "/v1/auth/teams") {
      return Response.json({
        server: { id: "server-1" },
        user: { id: "user-1", email: "pending@example.com" },
        teams: [],
        companyMembership: { role: "admin", status: "invited" },
      });
    }
    throw new Error(`unexpected request: ${pathname}`);
  };

  try {
    const status = await context.fetchTeamStatus();
    assert.equal(status.status, "blocked");
    assert.equal(status.signedIn, true);
    assert.match(status.error, /No active team memberships/i);
  } finally {
    cleanup(dir);
  }
});
