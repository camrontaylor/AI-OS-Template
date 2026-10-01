const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

function createTempWorkspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "file-preview-route-"));
  const rootDir = path.join(base, "root-workspace");
  const clientDir = path.join(rootDir, "clients", "client-1");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(clientDir, { recursive: true });
  return {
    rootDir,
    clientDir,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function createHeaders(headers = {}) {
  const values = new Map();
  for (const [key, value] of Object.entries(headers)) {
    values.set(key.toLowerCase(), value);
  }
  return {
    get(name) {
      return values.get(String(name).toLowerCase()) ?? null;
    },
  };
}

function createNextServerStub() {
  class NextResponse {
    constructor(body, init = {}) {
      this.status = init.status ?? 200;
      this.body = body;
      this.headers = createHeaders(init.headers);
    }

    static json(body, init = {}) {
      return new NextResponse(body, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          "content-type": "application/json",
        },
      });
    }

    async json() {
      return this.body;
    }
  }

  return {
    NextRequest: class {},
    NextResponse,
  };
}

class MaterializedFileAccessError extends Error {
  constructor() {
    super("File not found");
    this.status = 404;
    this.code = "file_not_found";
  }
}

function createDbStub() {
  return {
    prepare(sql) {
      return {
        get(scopeId) {
          if (sql.includes("FROM conversations")) {
            return scopeId === "conv-client"
              ? { clientId: "client-1", workScope: JSON.stringify({ mode: "solo", version: 1, clientId: "client-1" }) }
              : { clientId: null, workScope: JSON.stringify({ mode: "solo", version: 1, clientId: null }) };
          }
          if (sql.includes("FROM tasks")) {
            return { clientId: null, workScope: JSON.stringify({ mode: "solo", version: 1, clientId: null }) };
          }
          if (sql.includes("SELECT c.clientId")) {
            return { clientId: null, workScope: JSON.stringify({ mode: "solo", version: 1, clientId: null }) };
          }
          throw new Error(`Unhandled SQL in preview route test stub: ${sql}`);
        },
      };
    },
  };
}

function loadRoute(workspace, skillTarget = null) {
  const modulePath = path.resolve(__dirname, "route.ts");
  return loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: workspace.rootDir }),
        getClientAiOsDir: (clientId) => {
          if (!clientId) return workspace.rootDir;
          assert.equal(clientId, "client-1");
          return workspace.clientDir;
        },
      },
      "@/lib/db": {
        getDb: () => createDbStub(),
        getActiveLocalProfileDescriptor: () => ({ mode: "solo" }),
      },
      "@/lib/identity/work-scope": {
        isWorkScopeError: () => false,
        readWorkScopeFromRow: (row) => JSON.parse(row.workScope),
        workScopeErrorBody: () => ({ error: "Invalid work scope" }),
      },
      "@/lib/materialized-file-ownership": {
        assertMaterializedPathAccessible: () => {},
        MaterializedFileAccessError,
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
      "@/lib/team-mode": {
        isHostedTeamMode: () => false,
        hostedModeForbiddenResponse: () => ({ status: 403 }),
      },
      "@/types/chat-composer": {},
      "@/types/file": {},
    },
  });
}

function createRequest(params) {
  return {
    nextUrl: {
      searchParams: new URLSearchParams(params),
    },
  };
}

test("files preview route still serves image previews from the root workspace", async () => {
  const workspace = createTempWorkspace();
  const route = loadRoute(workspace);

  try {
    const relativePath = path.join("projects", "preview.png");
    const absolutePath = path.join(workspace.rootDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.from("png-bytes"));

    const response = await route.GET(createRequest({ path: relativePath.replace(/\\/g, "/") }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(Buffer.isBuffer(response.body), true);
    assert.equal(response.body.toString("utf-8"), "png-bytes");
  } finally {
    workspace.cleanup();
  }
});

test("files preview route serves PDF previews for chat attachments in a client workspace", async () => {
  const workspace = createTempWorkspace();
  const route = loadRoute(workspace);

  try {
    const relativePath = ".tmp/chat-drafts/sent/conversation/conv-client/message-1/brief.pdf";
    const absolutePath = path.join(workspace.clientDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.from("%PDF-preview"));

    const response = await route.GET(createRequest({
      path: relativePath,
      surface: "conversation",
      scopeId: "conv-client",
    }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.isBuffer(response.body), true);
    assert.equal(response.body.toString("utf-8"), "%PDF-preview");
  } finally {
    workspace.cleanup();
  }
});

test("files preview route serves goal draft attachments from the selected client workspace", async () => {
  const workspace = createTempWorkspace();
  const route = loadRoute(workspace);

  try {
    const relativePath = ".tmp/goal-drafts/draft-1/brief.pdf";
    const absolutePath = path.join(workspace.clientDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.from("%PDF-goal-draft"));

    const response = await route.GET(createRequest({
      path: relativePath,
      clientId: "client-1",
    }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.isBuffer(response.body), true);
    assert.equal(response.body.toString("utf-8"), "%PDF-goal-draft");
  } finally {
    workspace.cleanup();
  }
});

test("files preview route rejects path traversal attempts", async () => {
  const workspace = createTempWorkspace();
  const route = loadRoute(workspace);

  try {
    const response = await route.GET(createRequest({ path: "../secret.txt" }));

    assert.equal(response.status, 403);
    assert.equal(response.body.error, "Path traversal not allowed");
  } finally {
    workspace.cleanup();
  }
});

test("files preview route serves assets from a validated skill origin", async () => {
  const workspace = createTempWorkspace();
  const pluginDir = path.join(workspace.rootDir, ".team-plugin");
  const storagePath = "skills/viz-assets/logo.png";
  const absolutePath = path.join(pluginDir, storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, Buffer.from("team-logo"));
  const route = loadRoute(workspace, {
    baseDir: pluginDir,
    storagePath,
    close: async () => {},
  });

  try {
    const response = await route.GET(createRequest({
      path: ".claude/skills/viz-assets/logo.png",
      skillOrigin: "team",
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.toString("utf-8"), "team-logo");
  } finally {
    workspace.cleanup();
  }
});
