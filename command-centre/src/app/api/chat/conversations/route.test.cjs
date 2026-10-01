const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

function createNextServerStub() {
  return {
    NextRequest: class {},
    NextResponse: {
      json(body, init = {}) {
        return {
          status: init.status ?? 200,
          body,
          async json() {
            return body;
          },
        };
      },
    },
  };
}

test("chat conversations GET treats clientId=root as root-only scope", async () => {
  let executedQuery = null;
  let executedParams = null;
  const modulePath = path.resolve(__dirname, "route.ts");
  const route = loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/db": {
        getDb() {
          return {
            prepare(sql) {
              return {
                all(...params) {
                  executedQuery = sql;
                  executedParams = params;
                  return [];
                },
              };
            },
          };
        },
      },
      "@/lib/clients": {
        assertValidClientId(value) {
          return value === "root" || value == null ? null : value;
        },
      },
      "@/lib/identity/work-scope": {
        assertNoWorkScopeInput() {},
        async captureNewWorkScope() {
          throw new Error("captureNewWorkScope should not be called");
        },
        isWorkScopeError() {
          return false;
        },
        normalizeWorkScopedRow(row) {
          return row;
        },
        workScopeErrorBody(error) {
          return { code: error.code, error: error.message };
        },
      },
      "@/types/chat": {},
    },
  });

  const response = await route.GET({
    url: "http://example.test/api/chat/conversations?status=active&clientId=root",
  });

  assert.equal(response.status, 200);
  assert.match(executedQuery, /clientId IS NULL/);
  assert.deepEqual(executedParams, ["active"]);
});
