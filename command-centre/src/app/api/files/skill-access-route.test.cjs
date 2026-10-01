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

function request(url, body = {}) {
  const parsed = new URL(url);
  return {
    url,
    nextUrl: { searchParams: parsed.searchParams },
    json: async () => body,
  };
}

function loadRoute({ denied = {}, onWrite = () => {}, onRead = () => {}, onDenied = () => {}, skillTarget = null } = {}) {
  return loadTsModule(path.resolve(__dirname, "[...path]/route.ts"), {
    stubs: {
      "@/lib/config": {
        getClientAiOsDir: () => "/tmp/AI-OS",
      },
      "@/lib/file-service": {
        normalizeRelativePath: (value) => String(value).replace(/\\/g, "/"),
        readFile: (filePath, baseDir, options) => {
          onRead({ filePath, baseDir, options });
          return { path: filePath, content: "ok" };
        },
        writeFile: (filePath, content) => {
          onWrite({ filePath, content });
          return { path: filePath, content };
        },
        deleteFile: () => ({ deleted: true }),
        moveFile: () => ({ moved: true }),
      },
      "@/lib/team-mode": {
        isHostedTeamMode: () => false,
        isTeamScopedRequest: () => true,
        hostedModeForbiddenResponse: () => Response.json({ error: "hosted blocked" }, { status: 403 }),
      },
      "@/lib/identity/request-principal": {
        RequestPrincipalError,
        skillNameFromPath: (filePath) => {
          const parts = String(filePath).replace(/\\/g, "/").split("/");
          const index = parts.findIndex((part, i) => part === ".claude" && parts[i + 1] === "skills");
          return index === -1 ? null : parts[index + 2] || null;
        },
        requireSkillPermissionForRequest: async (_request, skillName, permission) => {
          const status = denied[`${skillName}:${permission}`];
          if (status) {
            throw new RequestPrincipalError(status, status === 404 ? "not_found" : "forbidden", "denied");
          }
          return { close: async () => {}, store: {}, principal: {} };
        },
        recordDeniedSkillPermission: async (_ctx, skillName, permission, reason) => {
          onDenied({ skillName, permission, reason });
        },
      },
      "@/lib/materialized-file-ownership": {
        assertMaterializedPathAccessible: () => {},
        assertMaterializedPathWritable: () => {},
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

test("local skill files stay readable without a Team grant", async () => {
  const route = loadRoute({ denied: { "mkt-copywriting:skill.read": 404 } });
  const response = await route.GET(
    request("http://localhost/api/files/.claude/skills/mkt-copywriting/SKILL.md?teamId=team"),
    { params: Promise.resolve({ path: [".claude", "skills", "mkt-copywriting", "SKILL.md"] }) },
  );
  assert.equal(response.status, 200);
});

test("Docs surface can read team_context files", async () => {
  const route = loadRoute();
  const response = await route.GET(
    request("http://localhost/api/files/team_context/AGENTS.md?surface=docs"),
    { params: Promise.resolve({ path: ["team_context", "AGENTS.md"] }) },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.path, "team_context/AGENTS.md");
});

test("SKILL.local.md stays editable independently of Team grants", async () => {
  const route = loadRoute({ denied: { "mkt-copywriting:skill.edit": 403 } });
  const response = await route.PUT(
    request("http://localhost/api/files/.claude/skills/mkt-copywriting/SKILL.local.md?teamId=team", {
      content: "override",
    }),
    { params: Promise.resolve({ path: [".claude", "skills", "mkt-copywriting", "SKILL.local.md"] }) },
  );
  assert.equal(response.status, 200);
});

test("skill.edit cannot modify shared base skill files", async () => {
  const denied = [];
  const writes = [];
  const route = loadRoute({
    onDenied: (event) => denied.push(event),
    onWrite: (event) => writes.push(event),
  });
  const response = await route.PUT(
    request("http://localhost/api/files/.claude/skills/mkt-copywriting/SKILL.md?teamId=team", {
      content: "base edit",
    }),
    { params: Promise.resolve({ path: [".claude", "skills", "mkt-copywriting", "SKILL.md"] }) },
  );
  assert.equal(response.status, 403);
  assert.equal(writes.length, 0);
  assert.equal(denied.length, 0);
});

test("skill.edit can modify SKILL.local.md overrides", async () => {
  const writes = [];
  const route = loadRoute({ onWrite: (event) => writes.push(event) });
  const response = await route.PUT(
    request("http://localhost/api/files/.claude/skills/mkt-copywriting/SKILL.local.md?teamId=team", {
      content: "override",
    }),
    { params: Promise.resolve({ path: [".claude", "skills", "mkt-copywriting", "SKILL.local.md"] }) },
  );
  assert.equal(response.status, 200);
  assert.equal(writes[0].filePath, ".claude/skills/mkt-copywriting/SKILL.local.md");
});

test("skillOrigin reads the validated storage target instead of materialized workspace state", async () => {
  const reads = [];
  const route = loadRoute({
    onRead: (event) => reads.push(event),
    skillTarget: {
      baseDir: "/profiles/team/plugin",
      storagePath: "skills/mkt-copywriting/SKILL.md",
      writable: false,
      close: async () => {},
    },
  });
  const response = await route.GET(
    request("http://localhost/api/files/.claude/skills/mkt-copywriting/SKILL.md?skillOrigin=team"),
    { params: Promise.resolve({ path: [".claude", "skills", "mkt-copywriting", "SKILL.md"] }) },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(reads[0].filePath, "skills/mkt-copywriting/SKILL.md");
  assert.equal(reads[0].options.skipOwnershipCheck, true);
  assert.equal(body.path, ".claude/skills/mkt-copywriting/SKILL.md");
});

test("Team skill targets remain read-only on the generic Skills page", async () => {
  const writes = [];
  const route = loadRoute({
    onWrite: (event) => writes.push(event),
    skillTarget: {
      baseDir: "/profiles/team/plugin",
      storagePath: "skills/mkt-copywriting/SKILL.md",
      writable: false,
      close: async () => {},
    },
  });
  const response = await route.PUT(
    request("http://localhost/api/files/.claude/skills/mkt-copywriting/SKILL.md?skillOrigin=team", { content: "no" }),
    { params: Promise.resolve({ path: [".claude", "skills", "mkt-copywriting", "SKILL.md"] }) },
  );

  assert.equal(response.status, 403);
  assert.equal(writes.length, 0);
});
