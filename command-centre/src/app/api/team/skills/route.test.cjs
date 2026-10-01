const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

const routePath = path.resolve(__dirname, "route.ts");

class TeamApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function loadRoute(stubs = {}) {
  return loadTsModule(routePath, {
    stubs: {
      "@/lib/team-api-context": {
        TeamApiError,
        fetchTeamSkills: async () => stubs.skills || [],
        fetchTeamSkillFile: async (filePath) => {
          const file = stubs.files?.[filePath];
          if (!file) throw new TeamApiError("not found", 404, "not_found");
          return typeof file === "string" ? { path: filePath, encoding: "utf-8", content: file } : file;
        },
      },
    },
  });
}

test("team skills repairs folded YAML descriptions returned as a bare greater-than marker", async () => {
  const route = loadRoute({
    skills: [{ slug: "viz-ugc-heygen", name: "viz-ugc-heygen", description: ">", userPermission: "skill.admin" }],
    files: {
      ".claude/skills/viz-ugc-heygen/SKILL.md": [
        "---",
        "name: viz-ugc-heygen",
        "description: >",
        "  Create UGC videos",
        "  with HeyGen avatars.",
        "---",
        "",
        "# Skill",
      ].join("\n"),
    },
  });

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.skills[0].description, "Create UGC videos with HeyGen avatars.");
});

test("team skills strips an unrepairable bare greater-than description", async () => {
  const route = loadRoute({
    skills: [{ slug: "missing-skill", name: "missing-skill", description: ">", userPermission: "skill.admin" }],
    files: {},
  });

  const response = await route.GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.skills[0].description, null);
});
