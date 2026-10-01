const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

function request(url = "http://localhost/api/context") {
  const parsed = new URL(url);
  return {
    url,
    nextUrl: {
      searchParams: parsed.searchParams,
    },
  };
}

function forbiddenResponse() {
  return Response.json({ error: "hosted blocked" }, { status: 403 });
}

function loadRoute(routePath, { hosted, rootDir }) {
  let localConfigCalls = 0;
  const route = loadTsModule(routePath, {
    stubs: {
      "@/lib/config": {
        getConfig: () => {
          localConfigCalls += 1;
          return { aiOsDir: rootDir };
        },
        getClientAiOsDir: (clientId) => {
          localConfigCalls += 1;
          return clientId ? path.join(rootDir, "clients", clientId) : rootDir;
        },
      },
      "@/lib/team-mode": {
        isHostedTeamMode: () => hosted,
        hostedModeForbiddenResponse: forbiddenResponse,
      },
      "@/lib/file-service": {
        normalizeRelativePath: (value) => String(value).replace(/\\/g, "/").replace(/^\/+/, ""),
        listDirectory: (dir, options = {}) => {
          localConfigCalls += 1;
          const fullDir = path.join(options.baseDir || rootDir, dir);
          return fs.readdirSync(fullDir).map((name) => ({ name, path: `${dir}/${name}`, type: "file" }));
        },
      },
      "@/lib/materialized-file-ownership": {
        isMaterializedPathAccessible: () => true,
        assertMaterializedPathAccessible: () => {},
        MaterializedFileAccessError: class MaterializedFileAccessError extends Error {},
      },
      "@/lib/identity/request-principal": {
        RequestPrincipalError: class RequestPrincipalError extends Error {},
      },
      "@/lib/skill-catalog": {
        parseSkillOrigin: () => null,
        resolveSkillFileTarget: async () => { throw new Error("unexpected skill target"); },
      },
    },
  });
  return { route, localConfigCalls: () => localConfigCalls };
}

test("context route blocks local context listing in hosted Team mode", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-"));
  try {
    const { route, localConfigCalls } = loadRoute(path.resolve(__dirname, "route.ts"), {
      hosted: true,
      rootDir,
    });
    const response = await route.GET(request());
    assert.equal(response.status, 403);
    assert.equal(localConfigCalls(), 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("brand route allows local brand listing in hosted Team mode", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-brand-"));
  try {
    fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "brand_context", "voice-profile.md"), "# Voice\n");
    const { route, localConfigCalls } = loadRoute(path.resolve(__dirname, "../brand/route.ts"), {
      hosted: true,
      rootDir,
    });
    const response = await route.GET(request("http://localhost/api/brand"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.map((file) => file.name), ["voice-profile.md"]);
    assert.equal(localConfigCalls(), 1);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("context brand status route allows local brand checks in hosted Team mode", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-brand-"));
  try {
    fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "brand_context", "voice-profile.md"), "# Voice\n");
    const { route, localConfigCalls } = loadRoute(path.resolve(__dirname, "brand/route.ts"), {
      hosted: true,
      rootDir,
    });
    const response = await route.GET(request("http://localhost/api/context/brand"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.hasBrandContext, true);
    assert.equal(localConfigCalls(), 1);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("files route allows brand_context listing in hosted Team mode", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-files-brand-"));
  try {
    fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "brand_context", "voice-profile.md"), "# Voice\n");
    const { route, localConfigCalls } = loadRoute(path.resolve(__dirname, "../files/route.ts"), {
      hosted: true,
      rootDir,
    });
    const response = await route.GET(request("http://localhost/api/files?dir=brand_context"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.map((file) => file.name), ["voice-profile.md"]);
    assert.equal(localConfigCalls(), 2);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("files route allows team_context listing in hosted Team mode", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-files-team-"));
  try {
    fs.mkdirSync(path.join(rootDir, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "team_context", "AGENTS.md"), "# Team\n");
    const { route, localConfigCalls } = loadRoute(path.resolve(__dirname, "../files/route.ts"), {
      hosted: true,
      rootDir,
    });
    const response = await route.GET(request("http://localhost/api/files?dir=team_context"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.map((file) => file.name), ["AGENTS.md"]);
    assert.equal(localConfigCalls(), 2);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("files route allows selected client files in hosted Team mode", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-files-client-"));
  try {
    fs.mkdirSync(path.join(rootDir, "clients", "acme", "context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "clients", "acme", "context", "USER.md"), "- Client\n");
    const { route } = loadRoute(path.resolve(__dirname, "../files/route.ts"), {
      hosted: true,
      rootDir,
    });
    const response = await route.GET(request("http://localhost/api/files?dir=context&clientId=acme"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.map((file) => file.name), ["USER.md"]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("context route keeps local single-user behavior when not in hosted Team mode", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-local-"));
  try {
    fs.mkdirSync(path.join(rootDir, "context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "context", "USER.md"), "- Name: Local User\n");
    const { route } = loadRoute(path.resolve(__dirname, "route.ts"), {
      hosted: false,
      rootDir,
    });
    const response = await route.GET(request());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.map((file) => file.name), ["USER.md"]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
