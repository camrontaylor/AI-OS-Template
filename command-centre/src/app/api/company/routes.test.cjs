const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

class TeamApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const calls = [];
const teamApiContext = {
  TeamApiError,
  fetchCompanyState: async (endpoint, teamId) => {
    calls.push({ method: "GET", endpoint, teamId });
    return { endpoint, teamId };
  },
  postCompanyAction: async (endpoint, body) => {
    calls.push({ method: "POST", endpoint, body });
    return { endpoint, body };
  },
};
const nextServer = {
  NextResponse: { json: (body, init) => Response.json(body, init) },
};
const routeUtils = loadTsModule(path.resolve(__dirname, "route-utils.ts"), {
  stubs: {
    "next/server": nextServer,
    "@/lib/team-api-context": teamApiContext,
  },
});

function loadRoute(endpoint) {
  return loadTsModule(path.resolve(__dirname, endpoint, "route.ts"), {
    stubs: {
      "next/server": nextServer,
      "@/lib/team-api-context": teamApiContext,
      "../route-utils": routeUtils,
    },
  });
}

test("company routes forward GET and POST without inventing Team scope", async () => {
  calls.length = 0;
  for (const endpoint of ["teams", "memberships", "access"]) {
    const route = loadRoute(endpoint);
    const getRequest = { nextUrl: new URL(`http://localhost/api/company/${endpoint}?teamId=team-1`) };
    const getResponse = await route.GET(getRequest);
    assert.equal(getResponse.status, 200);
    const getBody = await getResponse.json();
    assert.equal(getBody.endpoint, endpoint);
    assert.equal(getBody.teamId, endpoint === "teams" ? "team-1" : undefined);

    const postResponse = await route.POST({ json: async () => ({ action: `${endpoint}-action` }) });
    assert.equal(postResponse.status, 200);
    assert.deepEqual((await postResponse.json()).body, { action: `${endpoint}-action` });
  }

  assert.deepEqual(calls.map((call) => `${call.method}:${call.endpoint}`), [
    "GET:teams", "POST:teams",
    "GET:memberships", "POST:memberships",
    "GET:access", "POST:access",
  ]);
});

test("company routes preserve hosted API error status and code", async () => {
  const original = teamApiContext.fetchCompanyState;
  teamApiContext.fetchCompanyState = async () => {
    throw new TeamApiError("Company access is required", 403, "company_access_required");
  };
  try {
    const response = await loadRoute("access").GET();
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Company access is required",
      code: "company_access_required",
    });
  } finally {
    teamApiContext.fetchCompanyState = original;
  }
});
