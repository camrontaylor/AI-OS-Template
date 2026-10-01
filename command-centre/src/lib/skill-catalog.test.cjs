const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

class RequestPrincipalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class PermissionError extends Error {}

function writeSkill(root, slug, description = slug) {
  const dir = path.join(root, ".claude", "skills", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n`);
}

function request({ clientId = null, teamId = "team-a" } = {}) {
  const query = new URLSearchParams();
  if (clientId) query.set("clientId", clientId);
  if (teamId) query.set("teamId", teamId);
  return {
    headers: { get: () => null },
    nextUrl: { searchParams: query },
  };
}

function loadCatalog(root, options = {}) {
  const pluginDir = path.join(root, ".team-plugin");
  return loadTsModule(path.resolve(__dirname, "skill-catalog.ts"), {
    stubs: {
      "@/types/file": {},
      "./config": {
        getConfig: () => ({ aiOsDir: root }),
        getClientAiOsDir: (clientId) => clientId && clientId !== "root" ? path.join(root, "clients", clientId) : root,
      },
      "./file-service": { parseDependencies: () => [] },
      "./identity/request-principal": {
        RequestPrincipalError,
        resolveRequestPrincipalContext: async () => ({
          principal: { teamId: "team-a", userId: "user-a", access: { fullAccess: false } },
          store: {
            getClientBySlug: async (_teamId, slug) => options.missingClient ? null : { id: `id-${slug}`, slug },
          },
          close: async () => {},
        }),
      },
      "./identity/permissions": {
        PermissionError,
        requireClientAccess: async () => {
          if (options.denyClient) throw new PermissionError("denied");
        },
      },
      "./team-mode": { isTeamScopedRequest: () => options.teamScoped !== false },
      "./team-api-context": {
        fetchTeamSkills: async () => options.teamSkills ?? [{
          slug: "mkt-copywriting",
          name: "Team Copywriting",
          description: "Team version",
          userPermission: "skill.use",
        }],
      },
      "./team-skill-cache": {
        resolveTeamSkillRuntime: () => ({
          pluginDir,
          teamSkills: options.runtimeTeamSkills ?? ["mkt-copywriting"],
          incompatibleTeamSkills: options.incompatibleTeamSkills ?? [],
        }),
      },
    },
  });
}

test("catalog keeps local skills visible and makes a granted Team collision effective", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
  try {
    writeSkill(root, "mkt-copywriting", "Local version");
    const catalog = loadCatalog(root);
    const result = await catalog.resolveSkillCatalogForRequest(request());
    assert.equal(result.skills[0].effectiveOrigin, "team");
    assert.deepEqual(result.skills[0].availableOrigins.map((item) => item.origin), ["local", "team"]);
    await result.principalContext.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local skill files resolve from the installation in Team mode without materialized ownership", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
  try {
    writeSkill(root, "meta-memory-recall");
    const catalog = loadCatalog(root, { teamSkills: [], runtimeTeamSkills: [] });
    const target = await catalog.resolveSkillFileTarget(
      request(),
      ".claude/skills/meta-memory-recall/SKILL.md",
      "local",
    );
    assert.equal(target.baseDir, root);
    assert.equal(target.storagePath, ".claude/skills/meta-memory-recall/SKILL.md");
    assert.equal(target.writable, false);
    await target.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Team skill files resolve only from the protected session plugin", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
  try {
    writeSkill(root, "mkt-copywriting");
    const catalog = loadCatalog(root);
    const target = await catalog.resolveSkillFileTarget(
      request(),
      ".claude/skills/mkt-copywriting/references/guide.md",
      "team",
    );
    assert.equal(target.baseDir, path.join(root, ".team-plugin"));
    assert.equal(target.storagePath, "skills/mkt-copywriting/references/guide.md");
    assert.equal(target.writable, false);
    await target.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("client skills are not exposed when the member lacks that client grant", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
  try {
    writeSkill(path.join(root, "clients", "private-client"), "ops-client-only");
    const catalog = loadCatalog(root, { denyClient: true });
    await assert.rejects(
      catalog.resolveSkillCatalogForRequest(request({ clientId: "private-client" })),
      (error) => error instanceof RequestPrincipalError && error.status === 403,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an inherited skill customised by the client gains the override flag and a client origin", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
  try {
    writeSkill(root, "mkt-copywriting", "Root version");
    const overrideDir = path.join(root, "clients", "acme", ".claude", "skills", "mkt-copywriting");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(path.join(overrideDir, "SKILL.local.md"), "## Rules\n- client rule\n");

    const catalog = loadCatalog(root, { teamScoped: false });
    const result = await catalog.resolveSkillCatalogForRequest(request({ clientId: "acme" }));
    const entry = result.skills.find((skill) => skill.folderName === "mkt-copywriting");
    assert.equal(entry.clientOverride, true);
    assert.equal(entry.effectiveOrigin, "local");
    assert.deepEqual(entry.availableOrigins.map((item) => item.origin), ["local", "client"]);

    const target = await catalog.resolveSkillFileTarget(
      request({ clientId: "acme" }),
      ".claude/skills/mkt-copywriting/SKILL.local.md",
      "client",
    );
    assert.equal(target.baseDir, path.join(root, "clients", "acme"));
    assert.equal(target.writable, true);
    await target.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("skills the client turned off are flagged hidden; broken settings mean no overrides", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
  try {
    writeSkill(root, "str-trending-research");
    writeSkill(root, "str-ai-seo");
    const clientClaude = path.join(root, "clients", "acme", ".claude");
    fs.mkdirSync(clientClaude, { recursive: true });
    fs.writeFileSync(
      path.join(clientClaude, "settings.local.json"),
      JSON.stringify({ skillOverrides: { "str-trending-research": "off", "str-ai-seo": "on" } }),
    );

    const catalog = loadCatalog(root, { teamScoped: false });
    const result = await catalog.resolveSkillCatalogForRequest(request({ clientId: "acme" }));
    assert.equal(result.skills.find((skill) => skill.folderName === "str-trending-research").hiddenByClient, true);
    assert.ok(!result.skills.find((skill) => skill.folderName === "str-ai-seo").hiddenByClient);

    const rootView = await catalog.resolveSkillCatalogForRequest(request({}));
    assert.ok(rootView.skills.every((skill) => !skill.hiddenByClient && !skill.clientOverride));

    fs.writeFileSync(path.join(clientClaude, "settings.local.json"), "not json at all");
    const broken = await catalog.resolveSkillCatalogForRequest(request({ clientId: "acme" }));
    assert.ok(broken.skills.every((skill) => !skill.hiddenByClient));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
