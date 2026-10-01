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
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-sync-skill-"));
}

function request(body) {
  return {
    json: async () => body,
  };
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeTextForSync(content) {
  const text = Buffer.isBuffer(content) ? content.toString("utf-8") : String(content);
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const withLf = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return withLf.endsWith("\n") ? withLf.slice(0, -1) : withLf;
}

function normalizedTextSha256(content) {
  return sha256(normalizeTextForSync(content));
}

class TeamApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function manifestEntry(filePath, content, options = {}) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  const text = !buffer.includes(0);
  return {
    path: filePath,
    size: buffer.length,
    sha256: sha256(buffer),
    ...(text && options.normalized !== false ? { normalizedSha256: normalizedTextSha256(buffer) } : {}),
    encoding: text ? "utf-8" : "base64",
  };
}

function loadRoute(rootDir, stubs = {}) {
  const remoteFiles = stubs.remoteFiles || {};
  const throwOnRemoteFetch = new Set(stubs.throwOnRemoteFetch || []);
  const writes = [];
  const deletes = [];
  const route = loadTsModule(routePath, {
    stubs: {
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: rootDir }),
      },
      "@/lib/team-skill-cache": {
        readSelectedTeamId: () => "team-a",
        rebuildTeamSkillPlugin: () => [],
        resolveTeamSkillCachePaths: () => ({
          sourceRoot: rootDir,
          metadataPath: path.join(rootDir, ".command-centre", "team-skill-sync.json"),
        }),
      },
      "@/lib/team-api-context": {
        TeamApiError,
        fetchTeamSkills: async () => stubs.serverSkills || [{ slug: "mkt-copywriting", name: "Copywriting" }],
        fetchTeamSkillManifest: async (skill) => ({
          skill,
          files: Object.entries(remoteFiles)
            .filter(([filePath]) => filePath.startsWith(`.claude/skills/${skill}/`))
            .map(([filePath, content]) => manifestEntry(filePath, content, { normalized: stubs.manifestNormalized !== false })),
          unsupportedFiles: 0,
        }),
        fetchTeamSkillFile: async (filePath) => {
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
              sha256: sha256(buffer),
            };
          }
          return {
            path: filePath,
            encoding: "utf-8",
            content: buffer.toString("utf-8"),
            sha256: sha256(buffer),
            ...(stubs.fileNormalized !== false ? { normalizedSha256: normalizedTextSha256(buffer) } : {}),
          };
        },
        writeTeamSkillFile: async (filePath, payload) => {
          writes.push({ filePath, payload });
          return { ok: true };
        },
        deleteTeamSkillFile: async (filePath, expectedSha256) => {
          deletes.push({ filePath, expectedSha256 });
          return { ok: true };
        },
      },
      "@/lib/sync-state": loadTsModule(syncStatePath),
    },
  });
  return { route, writes, deletes };
}

function writeSkillFile(rootDir, skill, relativePath, content) {
  const fullPath = path.join(rootDir, ".claude", "skills", skill, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

test("sync-skill auto-adopts exact local server skill from status without overwriting", async () => {
  const rootDir = tempRoot();
  try {
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "# Same\n");
    const { route } = loadRoute(rootDir, {
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "# Same\n",
      },
    });

    const statusResponse = await route.GET();
    const statusBody = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.skills[0].hasLocal, true);
    assert.equal(statusBody.skills[0].adoptable, true);
    assert.equal(statusBody.skills[0].localStatus, "ready");
    assert.equal(statusBody.skills[0].managed, true);
    assert.equal(fs.readFileSync(path.join(rootDir, ".claude", "skills", "mkt-copywriting", "SKILL.md"), "utf-8"), "# Same\n");
    assert.equal(fs.existsSync(path.join(rootDir, ".command-centre", "team-skill-sync.json")), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-skill treats CRLF LF BOM and final newline differences as equivalent", async () => {
  const rootDir = tempRoot();
  try {
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "\ufeff# Same\r\nLine\r\n");
    const { route, writes } = loadRoute(rootDir, {
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "# Same\nLine",
      },
    });

    const statusResponse = await route.GET();
    const statusBody = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.skills[0].localStatus, "ready");
    assert.equal(statusBody.skills[0].managed, true);

    const pushResponse = await route.POST(request({ skill: "mkt-copywriting", action: "push" }));
    const pushBody = await pushResponse.json();
    assert.equal(pushResponse.status, 200);
    assert.equal(pushBody.filesPushed, 0);
    assert.equal(writes.length, 0);
    assert.equal(fs.readFileSync(path.join(rootDir, ".claude", "skills", "mkt-copywriting", "SKILL.md"), "utf-8"), "\ufeff# Same\r\nLine\r\n");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-skill auto-adopts legacy server manifests without normalized hashes", async () => {
  const rootDir = tempRoot();
  try {
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "\ufeff# Same\r\nLine\r\n");
    const { route } = loadRoute(rootDir, {
      manifestNormalized: false,
      fileNormalized: false,
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "# Same\nLine",
      },
    });

    const statusResponse = await route.GET();
    const statusBody = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.skills[0].localStatus, "ready");
    assert.equal(statusBody.skills[0].managed, true);
    assert.equal(statusBody.skills[0].adoptable, true);
    assert.equal(fs.readFileSync(path.join(rootDir, ".claude", "skills", "mkt-copywriting", "SKILL.md"), "utf-8"), "\ufeff# Same\r\nLine\r\n");

    const metadata = JSON.parse(fs.readFileSync(path.join(rootDir, ".command-centre", "team-skill-sync.json"), "utf-8"));
    assert.equal(
      metadata.skills["mkt-copywriting"].files[".claude/skills/mkt-copywriting/SKILL.md"].normalizedSha256,
      normalizedTextSha256("# Same\nLine"),
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-skill pull returns text conflict details for different local server files", async () => {
  const rootDir = tempRoot();
  try {
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "local\n");
    const { route } = loadRoute(rootDir, {
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "remote\n",
      },
    });

    const response = await route.POST(request({ skill: "mkt-copywriting", action: "pull" }));
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.direction, "pull");
    assert.equal(body.conflicts[0].path, ".claude/skills/mkt-copywriting/SKILL.md");
    assert.equal(body.conflicts[0].localContent, "local\n");
    assert.equal(body.conflicts[0].remoteContent, "remote\n");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-skill ignores SKILL.local.md and generated cache files", async () => {
  const rootDir = tempRoot();
  try {
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "# Same\n");
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.local.md", "private override\n");
    writeSkillFile(rootDir, "mkt-copywriting", "scripts/lib/__pycache__/cache.pyc", Buffer.from([0, 1, 2]));
    const { route } = loadRoute(rootDir, {
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "# Same\n",
        ".claude/skills/mkt-copywriting/SKILL.local.md": "server override should be ignored\n",
      },
    });

    const response = await route.POST(request({ skill: "mkt-copywriting", action: "pull" }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.adopted, true);
    assert.equal(fs.readFileSync(path.join(rootDir, ".claude", "skills", "mkt-copywriting", "SKILL.local.md"), "utf-8"), "private override\n");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-skill push returns a diff preview before writing", async () => {
  const rootDir = tempRoot();
  try {
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "local\n");
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.local.md", "private override\n");
    const { route, writes } = loadRoute(rootDir, {
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "remote\n",
      },
    });

    const response = await route.POST(request({ skill: "mkt-copywriting", action: "push" }));
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.direction, "push");
    assert.deepEqual(body.conflicts.map((conflict) => conflict.path), [".claude/skills/mkt-copywriting/SKILL.md"]);
    assert.equal(body.conflicts[0].localContent, "local\n");
    assert.equal(body.conflicts[0].remoteContent, "remote\n");
    assert.equal(writes.length, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-skill push surfaces an error instead of a false diff when reading remote content fails", async () => {
  const rootDir = tempRoot();
  try {
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "local\n");
    const { route, writes } = loadRoute(rootDir, {
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "remote\n",
      },
      throwOnRemoteFetch: [".claude/skills/mkt-copywriting/SKILL.md"],
    });

    const response = await route.POST(request({ skill: "mkt-copywriting", action: "push" }));
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.match(body.error, /hosted read failed/);
    assert.equal(writes.length, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sync-skill status reports local, server, and diverged changes", async () => {
  const rootDir = tempRoot();
  try {
    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "base\n");
    let loaded = loadRoute(rootDir, {
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "base\n",
      },
    });
    const pullResponse = await loaded.route.POST(request({ skill: "mkt-copywriting", action: "pull" }));
    assert.equal(pullResponse.status, 200);

    let statusResponse = await loaded.route.GET();
    let body = await statusResponse.json();
    assert.equal(body.skills[0].syncState.status, "synced");

    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "local\n");
    statusResponse = await loaded.route.GET();
    body = await statusResponse.json();
    assert.equal(body.skills[0].syncState.status, "local_changes");

    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "base\n");
    loaded = loadRoute(rootDir, {
      remoteFiles: {
        ".claude/skills/mkt-copywriting/SKILL.md": "server\n",
      },
    });
    statusResponse = await loaded.route.GET();
    body = await statusResponse.json();
    assert.equal(body.skills[0].syncState.status, "server_changes");

    writeSkillFile(rootDir, "mkt-copywriting", "SKILL.md", "local\n");
    statusResponse = await loaded.route.GET();
    body = await statusResponse.json();
    assert.equal(body.skills[0].syncState.status, "diverged");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
