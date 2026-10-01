const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

function request(url) {
  return { url };
}

function loadRoute(onList, skillTarget = null) {
  return loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "@/lib/config": {
        getClientAiOsDir: (clientId) => (clientId ? `/workspace/clients/${clientId}` : "/workspace"),
      },
      "@/lib/file-service": {
        normalizeRelativePath: (value) => String(value).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
        listDirectory: (dir, options) => {
          onList({ dir, options });
          return [{ name: ".env", path: ".env", type: "file", lastModified: "2026-01-01T00:00:00.000Z", size: 10 }];
        },
      },
      "@/lib/team-mode": {
        isHostedTeamMode: () => false,
        hostedModeForbiddenResponse: () => Response.json({ error: "hosted blocked" }, { status: 403 }),
      },
      "@/lib/materialized-file-ownership": {
        isMaterializedPathAccessible: () => true,
      },
      "@/lib/identity/request-principal": {
        RequestPrincipalError: class RequestPrincipalError extends Error {},
      },
      "@/lib/skill-catalog": {
        parseSkillOrigin: (value) => value === "local" || value === "client" || value === "team" ? value : null,
        resolveSkillFileTarget: async () => {
          if (!skillTarget) throw new Error("unexpected skill target");
          return skillTarget;
        },
      },
    },
  });
}

test("files list route lets Docs browse the workspace root with hidden files", async () => {
  const calls = [];
  const route = loadRoute((call) => calls.push(call));

  const response = await route.GET(request("http://localhost/api/files?dir=&surface=docs"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body[0].path, ".env");
  assert.equal(calls[0].dir, "");
  assert.equal(calls[0].options.baseDir, "/workspace");
  assert.equal(calls[0].options.includeHidden, true);
});

test("files list route resolves root clients paths from root even when clientId is present", async () => {
  const calls = [];
  const route = loadRoute((call) => calls.push(call));

  const response = await route.GET(request("http://localhost/api/files?dir=clients/acme&surface=docs&clientId=other"));

  assert.equal(response.status, 200);
  assert.equal(calls[0].dir, "clients/acme");
  assert.equal(calls[0].options.baseDir, "/workspace");
});

test("files list route allows team_context as a documentation root", async () => {
  const calls = [];
  const route = loadRoute((call) => calls.push(call));

  const response = await route.GET(request("http://localhost/api/files?dir=team_context"));

  assert.equal(response.status, 200);
  assert.equal(calls[0].dir, "team_context");
  assert.equal(calls[0].options.baseDir, "/workspace");
});

test("files list route keeps non-Docs directory restrictions", async () => {
  const calls = [];
  const route = loadRoute((call) => calls.push(call));

  const response = await route.GET(request("http://localhost/api/files?dir=.git"));
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.match(body.error, /Access denied/);
  assert.equal(calls.length, 0);
});

test("files list route maps effective skill files back to canonical paths", async () => {
  const calls = [];
  const route = loadRoute((call) => calls.push(call), {
    baseDir: "/profile/team-plugin",
    storagePath: "skills/mkt-copywriting",
    close: async () => {},
  });
  const response = await route.GET(request("http://localhost/api/files?dir=.claude/skills/mkt-copywriting&skillOrigin=team"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls[0].dir, "skills/mkt-copywriting");
  assert.equal(calls[0].options.skipOwnershipCheck, true);
  assert.equal(body[0].path, ".claude/skills/mkt-copywriting/.env");
});
