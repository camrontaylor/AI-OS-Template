const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

test("recordDeniedSkillPermission writes auditable denied skill events", async () => {
  const requestPrincipal = loadTsModule(path.resolve(__dirname, "request-principal.ts"), {
    stubs: {
      "@/lib/auth": { auth: { api: { getSession: async () => null } } },
      "@/lib/config": { getConfig: () => ({ aiOsDir: "/tmp/unused" }) },
      "./permissions": {
        PermissionError: class PermissionError extends Error {},
        requireSkillAccess: async () => {},
        resolvePrincipal: async () => ({}),
      },
      "./store": {
        openIdentityStore: async () => ({}),
      },
    },
  });

  const events = [];
  await requestPrincipal.recordDeniedSkillPermission(
    {
      principal: {
        teamId: "team-1",
        userId: "user-1",
        authSource: "test",
      },
      store: {
        recordAuditEvent: async (event) => {
          events.push(event);
          return event;
        },
      },
      close: async () => {},
    },
    "mkt-copywriting",
    "skill.use",
    "missing_or_insufficient_grant",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].action, "access.denied_use");
  assert.equal(events[0].targetType, "skill");
  assert.equal(events[0].metadata.skillName, "mkt-copywriting");
  assert.equal(events[0].metadata.required, "skill.use");
});
