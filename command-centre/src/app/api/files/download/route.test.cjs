const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

class NextResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = new Map(Object.entries(init.headers ?? {}));
  }

  static json(body, init = {}) {
    return new NextResponse(body, init);
  }

  async json() {
    return this.body;
  }
}

class RequestPrincipalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function request(params) {
  return { nextUrl: { searchParams: new URLSearchParams(params) } };
}

test("download route serves a file from its validated Team skill plugin", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-download-"));
  const pluginDir = path.join(root, "plugin");
  const storagePath = "skills/viz-assets/reference.pdf";
  fs.mkdirSync(path.dirname(path.join(pluginDir, storagePath)), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, storagePath), Buffer.from("team-pdf"));

  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      "next/server": { NextRequest: class {}, NextResponse },
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: root }),
        getClientAiOsDir: () => root,
      },
      "@/lib/team-mode": {
        isHostedTeamMode: () => true,
        hostedModeForbiddenResponse: () => NextResponse.json({ error: "blocked" }, { status: 403 }),
      },
      "@/lib/materialized-file-ownership": {
        assertMaterializedPathAccessible: () => { throw new Error("materialized ownership should be bypassed"); },
        MaterializedFileAccessError: class MaterializedFileAccessError extends Error {},
      },
      "@/lib/identity/request-principal": { RequestPrincipalError },
      "@/lib/skill-catalog": {
        parseSkillOrigin: (value) => value === "team" ? value : null,
        resolveSkillFileTarget: async () => ({
          baseDir: pluginDir,
          storagePath,
          close: async () => {},
        }),
      },
    },
  });

  try {
    const response = await route.GET(request({
      path: ".claude/skills/viz-assets/reference.pdf",
      skillOrigin: "team",
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.toString("utf-8"), "team-pdf");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
