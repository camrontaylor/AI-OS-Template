const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const teamMode = loadTsModule(path.resolve(__dirname, "team-mode.ts"));

function request({ teamHeader = null, teamParam = null } = {}) {
  return {
    headers: {
      get(name) {
        return name.toLowerCase() === "x-ai-team-id" ? teamHeader : null;
      },
    },
    nextUrl: {
      searchParams: new URLSearchParams(teamParam ? { teamId: teamParam } : {}),
    },
  };
}

test("isHostedTeamMode recognizes explicit hosted env flags", () => {
  assert.equal(teamMode.isHostedTeamMode({}), false);
  assert.equal(teamMode.isHostedTeamMode({ AI_OS_HOSTED_MODE: "1" }), true);
  assert.equal(teamMode.isHostedTeamMode({ TEAM_OS_HOSTED_MODE: "true" }), true);
  assert.equal(teamMode.isHostedTeamMode({ AI_OS_MODE: "hosted" }), true);
});

test("isHostedTeamMode recognizes a saved Team API login", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-mode-"));
  try {
    assert.equal(teamMode.isHostedTeamMode({ AI_OS_TEAM_CONFIG_DIR: dir }), false);

    fs.writeFileSync(
      path.join(dir, "team-context.json"),
      JSON.stringify({ apiUrl: "http://127.0.0.1:8787", token: "dev-token" }),
    );
    assert.equal(teamMode.isHostedTeamMode({ AI_OS_TEAM_CONFIG_DIR: dir }), true);

    fs.writeFileSync(path.join(dir, "team-context.json"), JSON.stringify({ apiUrl: "nope", token: "" }));
    assert.equal(teamMode.isHostedTeamMode({ AI_OS_TEAM_CONFIG_DIR: dir }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("isTeamScopedRequest detects hosted mode or explicit team scope", () => {
  const previous = process.env.AI_OS_HOSTED_MODE;
  try {
    delete process.env.AI_OS_HOSTED_MODE;
    assert.equal(teamMode.isTeamScopedRequest(request()), false);
    assert.equal(teamMode.isTeamScopedRequest(request({ teamHeader: "team-1" })), true);
    assert.equal(teamMode.isTeamScopedRequest(request({ teamParam: "team-1" })), true);

    process.env.AI_OS_HOSTED_MODE = "1";
    assert.equal(teamMode.isTeamScopedRequest(request()), true);
  } finally {
    if (previous == null) delete process.env.AI_OS_HOSTED_MODE;
    else process.env.AI_OS_HOSTED_MODE = previous;
  }
});
