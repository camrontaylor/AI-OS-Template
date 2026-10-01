const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

const routePath = path.resolve(__dirname, "route.ts");
const syncStatePath = path.resolve(__dirname, "../../../../lib/sync-state.ts");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-shared-context-sync-"));
}

function request(body) {
  return {
    json: async () => body,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function loadRoute(rootDir, stubs = {}) {
  const remoteFiles = stubs.remoteFiles || {};
  const remoteDocs = Object.keys(remoteFiles).map((filePath) => ({
    id: `doc:${filePath}`,
    visibility: "team",
    path: filePath,
    kind: filePath.startsWith("brand_context/") ? "brand" : "other",
    content: remoteFiles[filePath],
    sha256: sha256(remoteFiles[filePath]),
    status: "active",
  }));
  const writes = [];
  const route = loadTsModule(routePath, {
    stubs: {
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: rootDir }),
      },
      "@/lib/local-profile": {
        getLocalProfileStatePath: (fileName) => path.join(rootDir, ".command-centre", fileName),
      },
      "@/lib/team-api-context": {
        readTeamContext: async () => "teamContext" in stubs
          ? stubs.teamContext
          : { apiUrl: "http://team.test", token: "test-token", expiresAt: null },
        fetchTeamContextDocuments: async (visibility) => {
          if (stubs.fetchDocumentsError) throw stubs.fetchDocumentsError;
          return visibility === "team" ? remoteDocs : [];
        },
        fetchTeamStatus: async () => stubs.status || ({
          status: "connected",
          signedIn: true,
          clients: [],
          membership: { role: "owner" },
        }),
        writeTeamContextDocument: async (input) => {
          writes.push(input);
          return { ok: true };
        },
      },
      "@/lib/sync-state": loadTsModule(syncStatePath),
      "@/lib/materialized-file-ownership": {
        assertMaterializedPathAccessible: () => {},
        assertMaterializedPathWritable: () => {},
        registerMaterializedFiles: () => {},
      },
    },
  });
  return { route, writes };
}

test("shared context pull writes team_context and brand_context files", async () => {
  const rootDir = tempRoot();
  try {
    const { route } = loadRoute(rootDir, {
      remoteFiles: {
        "team_context/AGENTS.md": "# Team agents\n",
        "team_context/operating-rules.md": "# Rules\n",
        "brand_context/voice.md": "# Voice\n",
        "context/USER.md": "SHOULD_NOT_PULL\n",
      },
    });

    const response = await route.POST(request({ action: "pull" }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.filesPulled, 3);
    assert.equal(fs.readFileSync(path.join(rootDir, "team_context", "AGENTS.md"), "utf-8"), "# Team agents\n");
    assert.equal(fs.readFileSync(path.join(rootDir, "team_context", "operating-rules.md"), "utf-8"), "# Rules\n");
    assert.equal(fs.readFileSync(path.join(rootDir, "brand_context", "voice.md"), "utf-8"), "# Voice\n");
    assert.equal(fs.existsSync(path.join(rootDir, "context", "USER.md")), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("shared context push returns a diff preview before writing", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "brand_context", "voice.md"), "local brand\n");
    fs.writeFileSync(path.join(rootDir, "team_context", "operating-rules.md"), "local team\n");
    const { route, writes } = loadRoute(rootDir, {
      remoteFiles: {
        "brand_context/voice.md": "remote brand\n",
        "team_context/operating-rules.md": "remote team\n",
      },
    });

    const response = await route.POST(request({ action: "push" }));
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.direction, "push");
    assert.deepEqual(body.conflicts.map((conflict) => conflict.path).sort(), [
      "brand_context/voice.md",
      "team_context/operating-rules.md",
    ]);
    const teamConflict = body.conflicts.find((conflict) => conflict.path === "team_context/operating-rules.md");
    assert.equal(teamConflict.localContent, "local team\n");
    assert.equal(teamConflict.remoteContent, "remote team\n");
    assert.equal(writes.length, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("shared context single-file push writes after confirmation", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "team_context", "operating-rules.md"), "local\n");
    fs.writeFileSync(path.join(rootDir, "team_context", "shared-preferences.md"), "other\n");
    const { route, writes } = loadRoute(rootDir);

    const response = await route.POST(request({
      action: "push",
      path: "team_context/operating-rules.md",
      overwrite: true,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.filesPushed, 1);
    assert.deepEqual(writes.map((write) => write.path), ["team_context/operating-rules.md"]);
    assert.equal(writes[0].kind, "other");
    assert.equal(writes[0].visibility, "team");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("shared context push skips secret files", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "brand_context", "voice.md"), "voice\n");
    fs.writeFileSync(path.join(rootDir, "brand_context", ".mcp.json"), "{}\n");
    fs.writeFileSync(path.join(rootDir, "team_context", "AGENTS.md"), "# Team\n");
    fs.writeFileSync(path.join(rootDir, "team_context", ".env"), "SECRET=1\n");
    const { route, writes } = loadRoute(rootDir);

    const response = await route.POST(request({ action: "push", overwrite: true }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.filesPushed, 2);
    assert.deepEqual(writes.map((write) => write.path).sort(), [
      "brand_context/voice.md",
      "team_context/AGENTS.md",
    ]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("shared context pull reports conflicts before writing", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "brand_context", "voice.md"), "local brand\n");
    fs.writeFileSync(path.join(rootDir, "team_context", "AGENTS.md"), "local team\n");
    const { route } = loadRoute(rootDir, {
      remoteFiles: {
        "brand_context/voice.md": "remote brand\n",
        "team_context/AGENTS.md": "remote team\n",
      },
    });

    const response = await route.POST(request({ action: "pull" }));
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.deepEqual(body.conflicts.map((conflict) => conflict.path).sort(), [
      "brand_context/voice.md",
      "team_context/AGENTS.md",
    ]);
    assert.equal(fs.readFileSync(path.join(rootDir, "team_context", "AGENTS.md"), "utf-8"), "local team\n");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("shared context status reports local, server, and diverged changes", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "brand_context"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "brand_context", "voice.md"), "base\n");
    let loaded = loadRoute(rootDir, {
      remoteFiles: {
        "brand_context/voice.md": "base\n",
      },
    });

    const pullResponse = await loaded.route.POST(request({ action: "pull" }));
    assert.equal(pullResponse.status, 200);

    let getResponse = await loaded.route.GET();
    let body = await getResponse.json();
    assert.equal(body.syncState.status, "synced");

    fs.writeFileSync(path.join(rootDir, "brand_context", "voice.md"), "local\n");
    getResponse = await loaded.route.GET();
    body = await getResponse.json();
    assert.equal(body.syncState.status, "local_changes");
    assert.equal(body.syncState.files.find((file) => file.path === "brand_context/voice.md").status, "local_changes");

    fs.writeFileSync(path.join(rootDir, "brand_context", "voice.md"), "base\n");
    loaded = loadRoute(rootDir, {
      remoteFiles: {
        "brand_context/voice.md": "server\n",
      },
    });
    getResponse = await loaded.route.GET();
    body = await getResponse.json();
    assert.equal(body.syncState.status, "server_changes");

    fs.writeFileSync(path.join(rootDir, "brand_context", "voice.md"), "local\n");
    getResponse = await loaded.route.GET();
    body = await getResponse.json();
    assert.equal(body.syncState.status, "diverged");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("shared context status reports signed out when no Team OS login is saved", async () => {
  const rootDir = tempRoot();
  try {
    const { route } = loadRoute(rootDir, { teamContext: null });

    const response = await route.GET();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.signedIn, false);
    assert.equal(body.unavailable, undefined);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("shared context status stays signed in and reports unavailable on a server error", async () => {
  const rootDir = tempRoot();
  try {
    const { route } = loadRoute(rootDir, {
      fetchDocumentsError: new Error("hosted API unreachable"),
    });

    const response = await route.GET();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.signedIn, true);
    assert.equal(body.unavailable, true);
    assert.match(body.error, /hosted API unreachable/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
