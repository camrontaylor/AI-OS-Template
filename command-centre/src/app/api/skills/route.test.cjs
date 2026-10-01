const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

class RequestPrincipalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function loadRoute(skills) {
  return loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "@/lib/identity/request-principal": { RequestPrincipalError },
      "@/lib/skill-catalog": {
        resolveSkillCatalogForRequest: async () => ({
          skills,
          principalContext: { close: async () => {} },
        }),
      },
    },
  });
}

test("skills route returns the centrally resolved catalog", async () => {
  const skills = [{
    folderName: "mkt-copywriting",
    name: "Team Copywriting",
    effectiveOrigin: "team",
    availableOrigins: [{ origin: "local" }, { origin: "team" }],
  }];
  const route = loadRoute(skills);
  const response = await route.GET({});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), skills);
});
