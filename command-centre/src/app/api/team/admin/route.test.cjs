const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

class TeamApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function loadRoute(postTeamAdminAction) {
  return loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "next/server": {
        NextRequest: class {},
        NextResponse: { json: (body, init) => Response.json(body, init) },
      },
      "@/lib/team-api-context": {
        TeamApiError,
        fetchTeamAdminState: async () => ({}),
        postTeamAdminAction,
      },
    },
  });
}

test("team admin POST preserves a hosted client-slug conflict status", async () => {
  const route = loadRoute(async () => {
    throw new TeamApiError("client slug already exists: acme", 409, "conflict");
  });

  const response = await route.POST({ json: async () => ({
    action: "create-client",
    name: "Replacement",
    slug: "acme",
  }) });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "client slug already exists: acme");
});
