const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

class RequestPrincipalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function loadSkillAuth({ teamScoped = true, denied = new Set() } = {}) {
  const checks = [];
  const mod = loadTsModule(path.resolve(__dirname, "skill-authorization.ts"), {
    stubs: {
      "@/lib/team-mode": {
        isTeamScopedRequest: () => teamScoped,
      },
      "@/lib/slash-commands": {
        skillNameFromSlashCommand: (command) => {
          const name = String(command).replace(/^\//, "").replace(/^(team|local):/, "");
          if (name === "gsd-plan-phase") return null;
          if (name === "meta-skill-creator") return null;
          return name.startsWith("mkt-") || name.startsWith("tool-") ? name : null;
        },
      },
      "./request-principal": {
        RequestPrincipalError,
        requireSkillPermissionForRequest: async (_request, skillName, permission) => {
          checks.push({ skillName, permission });
          if (denied.has(skillName)) {
            throw new RequestPrincipalError(404, "not_found", "skill not found");
          }
          return { close: async () => {} };
        },
      },
    },
  });
  return { mod, checks };
}

test("extractSkillUseRequests ignores non-skill slash commands", () => {
  const { mod } = loadSkillAuth();
  assert.deepEqual(
    mod.extractSkillUseRequests("Run /mkt-copywriting, then /gsd-plan-phase."),
    ["mkt-copywriting"],
  );
});

test("requireSkillUseForRequest leaves the default alias to the effective session catalog", async () => {
  const { mod, checks } = loadSkillAuth();
  await mod.requireSkillUseForRequest({}, "Run /mkt-copywriting");
  assert.deepEqual(checks, []);
});

test("requireSkillUseForRequest enforces skill.use for an explicit Team alias", async () => {
  const { mod, checks } = loadSkillAuth();
  await mod.requireSkillUseForRequest({}, "Run /team:mkt-copywriting");
  assert.deepEqual(checks, [{ skillName: "mkt-copywriting", permission: "skill.use" }]);
});

test("requireSkillUseForRequest skips local single-user requests", async () => {
  const { mod, checks } = loadSkillAuth({ teamScoped: false });
  await mod.requireSkillUseForRequest({}, "Run /mkt-copywriting");
  assert.deepEqual(checks, []);
});

test("requireSkillUseForRequest returns private-resource 404 for an explicit Team alias", async () => {
  const { mod } = loadSkillAuth({ denied: new Set(["mkt-copywriting"]) });
  await assert.rejects(
    mod.requireSkillUseForRequest({}, "Run /team:mkt-copywriting"),
    (error) => error instanceof RequestPrincipalError && error.status === 404,
  );
});
