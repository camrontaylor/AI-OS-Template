const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

const routePath = path.resolve(__dirname, "route.ts");
const syncStatePath = path.resolve(__dirname, "../../../../lib/sync-state.ts");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-sync-client-"));
}

function request(body) {
  return {
    json: async () => body,
  };
}

function getRequest(query = "client=acme") {
  return {
    url: `http://localhost/api/team/sync-client?${query}`,
  };
}

class TeamApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function loadRoute(rootDir, stubs = {}) {
  const remoteFiles = stubs.remoteFiles || {};
  const throwOnRemoteFetch = new Set(stubs.throwOnRemoteFetch || []);
  const manifest = stubs.manifest || {
    clients: [{ slug: "acme", name: "Acme", access: "write" }],
    files: Object.keys(remoteFiles).map((filePath) => {
      const content = Buffer.isBuffer(remoteFiles[filePath])
        ? remoteFiles[filePath]
        : Buffer.from(String(remoteFiles[filePath]));
      return {
        path: filePath,
        size: content.length,
        sha256: require("node:crypto").createHash("sha256").update(content).digest("hex"),
        secret: path.posix.basename(filePath) === ".env",
        encoding: content.includes(0) ? "base64" : "utf-8",
      };
    }),
    unsupportedFiles: 0,
    secretFilesHidden: 0,
  };
  const writes = [];
  const deletes = [];
  const route = loadTsModule(routePath, {
    stubs: {
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: rootDir }),
      },
      "@/lib/local-profile": {
        getLocalProfileStatePath: (fileName) => path.join(rootDir, ".command-centre", fileName),
      },
      "@/lib/materialized-file-ownership": {
        assertMaterializedPathAccessible: stubs.assertMaterializedPathAccessible || (() => {}),
        assertMaterializedPathWritable: stubs.assertMaterializedPathWritable || stubs.assertMaterializedPathAccessible || (() => {}),
        registerMaterializedFiles: () => {},
        removeMaterializedOwnership: () => {},
      },
      "@/lib/team-api-context": {
        TeamApiError,
        fetchTeamStatus: async () => ({
          status: "connected",
          signedIn: true,
          clients: [{ slug: "acme", name: "Acme", access: manifest.clients[0]?.access || "write" }],
        }),
        fetchTeamWorkspaceManifest: async () => manifest,
        fetchTeamWorkspaceFile: async (filePath) => {
          if (throwOnRemoteFetch.has(filePath)) {
            throw new TeamApiError("hosted read failed", 502, "upstream_error");
          }
          const content = remoteFiles[filePath];
          const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ""));
          if (buffer.includes(0)) {
            return {
              path: filePath,
              encoding: "base64",
              contentBase64: buffer.toString("base64"),
              sha256: require("node:crypto").createHash("sha256").update(buffer).digest("hex"),
            };
          }
          return {
            path: filePath,
            encoding: "utf-8",
            content: buffer.toString("utf-8"),
            sha256: require("node:crypto").createHash("sha256").update(buffer).digest("hex"),
          };
        },
        writeTeamWorkspaceFile: async (filePath, payload) => {
          writes.push({ filePath, payload });
          return { ok: true };
        },
        deleteTeamWorkspaceFile: async (filePath, expectedSha256) => {
          deletes.push({ filePath, expectedSha256 });
          return { ok: true };
        },
      },
      "@/lib/sync-state": loadTsModule(syncStatePath),
    },
  });
  return { route, writes, deletes };
}

test("sync-client pull writes text, binary, and secret files locally", async () => {
  const rootDir = tempRoot();
  try {
    const { route } = loadRoute(rootDir, {
      remoteFiles: {
        "clients/acme/notes.md": "# Notes\n",
        "clients/acme/.env": "API_KEY=secret\n",
        "clients/acme/logo.bin": Buffer.from([0, 1, 2]),
      },
    });

    const response = await route.POST(request({ client: "acme", action: "pull" }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.filesChanged, 3);
    assert.equal(fs.readFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "utf-8"), "# Notes\n");
    assert.equal(fs.readFileSync(path.join(rootDir, "clients", "acme", ".env"), "utf-8"), "API_KEY=secret\n");
    assert.deepEqual(fs.readFileSync(path.join(rootDir, "clients", "acme", "logo.bin")), Buffer.from([0, 1, 2]));
    assert.equal(fs.existsSync(path.join(rootDir, ".command-centre", "team-sync.json")), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-client pull cannot overwrite a file owned by another local profile", async () => {
  const rootDir = tempRoot();
  const filePath = path.join(rootDir, "clients", "acme", "notes.md");
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "profile-a\n");
    const denied = new Error("File not found");
    denied.status = 404;
    const { route } = loadRoute(rootDir, {
      remoteFiles: { "clients/acme/notes.md": "profile-b\n" },
      assertMaterializedPathAccessible: () => { throw denied; },
    });
    const response = await route.POST(request({ action: "pull", client: "acme", overwrite: true }));
    assert.equal(response.status, 404);
    assert.equal(fs.readFileSync(filePath, "utf8"), "profile-a\n");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-client pull returns text conflict details before overwrite", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "clients", "acme"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "local\n");
    const { route } = loadRoute(rootDir, {
      remoteFiles: {
        "clients/acme/notes.md": "remote\n",
      },
    });

    const response = await route.POST(request({ client: "acme", action: "pull" }));
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.direction, "pull");
    assert.equal(body.conflicts[0].path, "clients/acme/notes.md");
    assert.equal(body.conflicts[0].localContent, "local\n");
    assert.equal(body.conflicts[0].remoteContent, "remote\n");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-client push reports permission error for viewer access", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "clients", "acme"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "local\n");
    const { route } = loadRoute(rootDir, {
      manifest: {
        clients: [{ slug: "acme", name: "Acme", access: "read" }],
        files: [],
        unsupportedFiles: 0,
        secretFilesHidden: 0,
      },
    });

    const response = await route.POST(request({ client: "acme", action: "push" }));
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.match(body.error, /Client Editor/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-client push returns a diff preview before writing", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "clients", "acme"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "local\n");
    const { route, writes } = loadRoute(rootDir, {
      remoteFiles: {
        "clients/acme/notes.md": "remote\n",
      },
    });

    const response = await route.POST(request({ client: "acme", action: "push" }));
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.direction, "push");
    assert.equal(body.conflicts[0].path, "clients/acme/notes.md");
    assert.equal(body.conflicts[0].localContent, "local\n");
    assert.equal(body.conflicts[0].remoteContent, "remote\n");
    assert.equal(writes.length, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-client push surfaces an error instead of a false diff when reading remote content fails", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "clients", "acme"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "local\n");
    const { route, writes } = loadRoute(rootDir, {
      remoteFiles: {
        "clients/acme/notes.md": "remote\n",
      },
      throwOnRemoteFetch: ["clients/acme/notes.md"],
    });

    const response = await route.POST(request({ client: "acme", action: "push" }));
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.match(body.error, /hosted read failed/);
    assert.equal(writes.length, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-client single-file push writes only the selected file after confirmation", async () => {
  const rootDir = tempRoot();
  try {
    fs.mkdirSync(path.join(rootDir, "clients", "acme"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "notes\n");
    fs.writeFileSync(path.join(rootDir, "clients", "acme", "other.md"), "other\n");
    const { route, writes } = loadRoute(rootDir);

    const response = await route.POST(request({
      client: "acme",
      action: "push",
      path: "notes.md",
      overwrite: true,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.filesPushed, 1);
    assert.deepEqual(writes.map((write) => write.filePath), ["clients/acme/notes.md"]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-client status reports local, server, and diverged changes", async () => {
  const rootDir = tempRoot();
  try {
    let loaded = loadRoute(rootDir, {
      remoteFiles: {
        "clients/acme/notes.md": "base\n",
      },
    });
    const pullResponse = await loaded.route.POST(request({ client: "acme", action: "pull" }));
    assert.equal(pullResponse.status, 200);

    let getResponse = await loaded.route.GET(getRequest());
    let body = await getResponse.json();
    assert.equal(body.syncState.status, "synced");

    fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "local\n");
    getResponse = await loaded.route.GET(getRequest());
    body = await getResponse.json();
    assert.equal(body.syncState.status, "local_changes");

    fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "base\n");
    loaded = loadRoute(rootDir, {
      remoteFiles: {
        "clients/acme/notes.md": "server\n",
      },
    });
    getResponse = await loaded.route.GET(getRequest());
    body = await getResponse.json();
    assert.equal(body.syncState.status, "server_changes");

    fs.writeFileSync(path.join(rootDir, "clients", "acme", "notes.md"), "local\n");
    getResponse = await loaded.route.GET(getRequest());
    body = await getResponse.json();
    assert.equal(body.syncState.status, "diverged");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
