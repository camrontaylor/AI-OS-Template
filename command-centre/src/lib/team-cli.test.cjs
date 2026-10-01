const assert = require("node:assert/strict");
const { execFile, spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const COMMAND_CENTRE_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(COMMAND_CENTRE_ROOT, "..");
const TEAM_SCRIPT = path.join(COMMAND_CENTRE_ROOT, "scripts", "team.cjs");
const TEAM_JOIN_SCRIPT = path.join(COMMAND_CENTRE_ROOT, "scripts", "team-join.cjs");
const OWNER_RESET_SCRIPT = path.join(COMMAND_CENTRE_ROOT, "scripts", "team-owner-reset.cjs");
const STATUSLINE_SCRIPT = path.join(REPO_ROOT, ".claude", "hooks", "ai-statusline.js");
const TEAM_TERMINAL_UI = path.join(COMMAND_CENTRE_ROOT, "scripts", "lib", "team-terminal-ui.cjs");
const TEAM_PROMPTS = path.join(COMMAND_CENTRE_ROOT, "scripts", "lib", "team-prompts.cjs");
const ownerReset = require(OWNER_RESET_SCRIPT);
const terminalUi = require(TEAM_TERMINAL_UI);
const teamPrompts = require(TEAM_PROMPTS);

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-cli-"));
}

async function withHttpServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleTerminalText(value) {
  const rows = [""];
  let row = 0;
  let col = 0;
  const text = String(value);

  const ensureRow = () => {
    while (rows.length <= row) rows.push("");
  };
  const clearLine = () => {
    ensureRow();
    rows[row] = "";
    col = 0;
  };
  const writeChar = (char) => {
    ensureRow();
    const line = rows[row];
    rows[row] = `${line.slice(0, col)}${char}${line.slice(col + 1)}`;
    col += 1;
  };

  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === "\x1b") {
      const match = /^\x1b\[((?:\?|\d|;)*)?([A-Za-z])/.exec(text.slice(index));
      if (match) {
        const rawCount = match[1] || "";
        const code = match[2];
        const count = Number(rawCount.replace("?", "").split(";")[0] || "1");
        if (code === "A") row = Math.max(0, row - count);
        else if (code === "B") row += count;
        else if (code === "K") clearLine();
        index += match[0].length;
        ensureRow();
        continue;
      }
      index += 1;
      continue;
    }
    if (char === "\r") {
      col = 0;
      index += 1;
      continue;
    }
    if (char === "\n") {
      row += 1;
      ensureRow();
      index += 1;
      continue;
    }
    writeChar(char);
    index += 1;
  }

  return stripAnsi(rows.join("\n")).replace(/[ \t]+$/gm, "").trim();
}

class FakeTtyInput extends EventEmitter {
  constructor(script = []) {
    super();
    this.isTTY = true;
    this.rawModes = [];
    this.script = [...script];
  }

  setRawMode(value) {
    this.rawModes.push(value);
    this.rawMode = value;
  }

  resume() {}

  on(event, listener) {
    const result = super.on(event, listener);
    if (event === "data" && this.script.length > 0) {
      const chunk = this.script.shift();
      process.nextTick(() => this.emitData(chunk));
    }
    return result;
  }

  emitData(value) {
    this.emit("data", Buffer.from(value, "utf-8"));
  }
}

class FakeTtyOutput {
  constructor() {
    this.isTTY = true;
    this.chunks = [];
  }

  write(value) {
    this.chunks.push(String(value));
    return true;
  }

  text() {
    return this.chunks.join("");
  }
}

async function withMutedConsole(fn) {
  const originalClear = console.clear;
  const originalLog = console.log;
  console.clear = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.clear = originalClear;
    console.log = originalLog;
  }
}

async function withTeamServer(fn) {
  const seen = [];
  let remoteMcp = null;
  const readBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf-8");
  };
  const server = http.createServer(async (req, res) => {
    seen.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });

    const authorized = req.headers.authorization === "Bearer valid-token";
    if (!authorized) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "unauthorized", message: "token expired" } }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/team/whoami") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        user: { id: "user-1", email: "member@example.com" },
        team: { id: "team-1", slug: "demo", name: "Demo Team" },
        membership: { role: "member", status: "active" },
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/team/clients") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        clients: [
          { id: "client-1", slug: "acme", name: "Acme", access: "read" },
          { id: "client-2", slug: "globex", name: "Globex", access: "write" },
        ],
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/memory/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        storeReady: true,
        scope: { mode: "team", teamId: "team-1", userId: "user-1" },
        sources: 3,
        chunks: 9,
        jobs: 1,
        manualImports: 1,
        byVisibility: { team: 2, client: 1 },
        jobsByStatus: { queued: 1 },
        lastIndexedAt: "2026-06-28T10:00:00.000Z",
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/team/admin") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(adminState()));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/team/admin") {
      const raw = await readBody(req);
      seen[seen.length - 1].body = raw;
      const body = JSON.parse(raw || "{}");
      const state = adminState();
      if (body.action === "create-invite-link" || body.action === "invite-member") {
        state.invite = {
          email: body.email || body.user,
          role: body.role || "member",
          expiresAt: "2026-06-29T12:00:00.000Z",
          url: "https://team.example.test/team/join?token=invite-token",
        };
      }
      if (body.action === "create-password-reset-link") {
        state.reset = {
          email: body.user,
          expiresAt: "2026-06-29T12:00:00.000Z",
          url: "https://team.example.test/team/reset-password?token=reset-token",
        };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(state));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/v1/team/secrets")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(secretsState()));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/team/secrets") {
      const raw = await readBody(req);
      seen[seen.length - 1].body = raw;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(secretsState()));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/team/secrets/sync") {
      const raw = await readBody(req);
      seen[seen.length - 1].body = raw;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        team: {
          secrets: [{ id: "secret-1", name: "API", envKey: "API_KEY", value: "abc 123" }],
        },
        clients: [
          {
            id: "client-1",
            slug: "acme",
            name: "Acme",
            secrets: [{ id: "secret-2", name: "Client", envKey: "CLIENT_KEY", value: "client-value" }],
          },
        ],
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/team/skills") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        skills: [
          { slug: "mkt-email", name: "Marketing Email", userPermission: "skill.use", files: 2 },
          { slug: "ops-report", name: "Ops Report", userPermission: "skill.admin", files: 1 },
        ],
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/team/brand-context/manifest") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        writable: true,
        files: [{ path: "brand_context/voice.md", size: 17, sha256: sha256Text("remote voice\n") }],
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/team/brand-context/file?path=brand_context%2Fvoice.md") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        path: "brand_context/voice.md",
        content: "remote voice\n",
        sha256: sha256Text("remote voice\n"),
      }));
      return;
    }

    if (req.method === "PUT" && req.url === "/v1/team/brand-context/file?path=brand_context%2Fvoice.md") {
      const raw = await readBody(req);
      seen[seen.length - 1].body = raw;
      const body = JSON.parse(raw || "{}");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        path: "brand_context/voice.md",
        sha256: sha256Text(body.content || ""),
        updatedAt: "2026-06-28T10:00:00.000Z",
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/user/config-file?path=.mcp.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ file: remoteMcp }));
      return;
    }

    if (req.method === "PUT" && req.url === "/v1/user/config-file") {
      const raw = await readBody(req);
      seen[seen.length - 1].body = raw;
      const body = JSON.parse(raw || "{}");
      remoteMcp = {
        path: body.path,
        content: body.content,
        sha256: sha256Text(body.content || ""),
        updatedAt: "2026-06-28T10:00:00.000Z",
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ file: remoteMcp }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/memory/imports") {
      const raw = await readBody(req);
      seen[seen.length - 1].body = raw;
      const body = JSON.parse(raw);
      assert.equal(body.embeddingDim, 1024);
      assert.ok(Array.isArray(body.chunks));
      assert.ok(body.chunks[0].embedding.length === 1024);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        import: {
          id: "import-1",
          status: "indexed",
          sourcePath: body.sourcePath,
        },
        sourceId: "source-1",
        chunksInserted: 2,
        chunksPruned: 0,
      }));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/v1/memory/imports")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        imports: [
          {
            id: "import-2",
            status: "failed",
            attempts: 1,
            sourcePath: "manual/bad.md",
            errorMessage: "embedder unavailable",
          },
        ],
      }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/memory/imports/retry") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        import: {
          id: "import-2",
          status: "indexed",
          sourcePath: "manual/bad.md",
        },
        chunksInserted: 1,
      }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`, seen);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function sha256Text(value) {
  return require("node:crypto").createHash("sha256").update(value).digest("hex");
}

function adminState() {
  return {
    team: { id: "team-1", slug: "demo", name: "Demo Team" },
    members: [
      {
        id: "membership-1",
        userId: "user-1",
        email: "member@example.com",
        role: "member",
        status: "active",
        clients: [{ id: "client-1", slug: "acme", name: "Acme", access: "read" }],
      },
    ],
    clients: [{ id: "client-1", slug: "acme", name: "Acme", status: "active" }],
    clientGrants: [],
    skillGrants: [],
    serverSkills: [{ slug: "mkt-email", name: "Marketing Email" }],
    storage: { workspaceRoot: "/workspace", writable: true, warning: null, backup: { configured: true } },
  };
}

function secretsState() {
  return {
    admin: true,
    secrets: [
      {
        id: "secret-1",
        name: "API",
        envKey: "API_KEY",
        scope: "team",
        status: "active",
        grants: [{ id: "grant-1", userId: "user-1", email: "member@example.com", status: "active" }],
      },
    ],
  };
}

async function runTeam(args, configDir, extraEnv = {}) {
  try {
    const result = await execFileAsync(process.execPath, [TEAM_SCRIPT, ...args], {
      cwd: COMMAND_CENTRE_ROOT,
      env: {
        ...process.env,
        AI_OS_TEAM_CONFIG_DIR: configDir,
        MEMORY_DATABASE_URL: "",
        DATABASE_URL: "",
        TEAM_OS_MEMORY_TEST_EMBEDDER: "hash",
        ...extraEnv,
      },
      windowsHide: true,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

async function runTeamJoin(args, workspaceDir, extraEnv = {}) {
  try {
    const result = await execFileAsync(process.execPath, [TEAM_JOIN_SCRIPT, ...args], {
      cwd: COMMAND_CENTRE_ROOT,
      env: {
        ...process.env,
        AI_OS_DIR: workspaceDir,
        MEMORY_DATABASE_URL: "",
        DATABASE_URL: "",
        ...extraEnv,
      },
      windowsHide: true,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

function runStatusline(input, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [STATUSLINE_SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test("team CLI login, whoami, clients, and logout use the Team API token context", async () => {
  const configDir = tempDir();
  try {
    await withTeamServer(async (baseUrl, seen) => {
      const login = await runTeam(["login", "--api-url", baseUrl, "--token", "valid-token"], configDir);
      assert.equal(login.status, 0, login.stderr);
      assert.match(login.stdout, /Signed in as member@example\.com/);
      assert.match(login.stdout, /Team: Demo Team/);

      const configPath = path.join(configDir, "team-context.json");
      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      assert.equal(saved.apiUrl, baseUrl);
      assert.equal(saved.token, "valid-token");

      const whoami = await runTeam(["whoami"], configDir);
      assert.equal(whoami.status, 0, whoami.stderr);
      assert.match(whoami.stdout, /Signed in as: member@example\.com/);
      assert.match(whoami.stdout, /Team: Demo Team/);
      assert.match(whoami.stdout, /Role: member/);

      const clients = await runTeam(["clients"], configDir);
      assert.equal(clients.status, 0, clients.stderr);
      assert.match(clients.stdout, /acme\s+read\s+Acme/);
      assert.match(clients.stdout, /globex\s+write\s+Globex/);

      const importFile = path.join(configDir, "shared.md");
      fs.writeFileSync(importFile, "# Shared\n\nCLI import content.\n", "utf-8");
      const imported = await runTeam(
        ["memory", "import", "--file", importFile, "--visibility", "client", "--client", "acme"],
        configDir,
      );
      assert.equal(imported.status, 0, imported.stderr);
      assert.match(imported.stdout, /Import indexed: manual\/shared\.md/);
      assert.match(imported.stdout, /Chunks inserted: 2/);

      const privateImport = await runTeam(
        ["memory", "import", "--file", importFile, "--visibility", "private"],
        configDir,
      );
      assert.equal(privateImport.status, 1);
      assert.match(privateImport.stderr, /--visibility must be team or client/);

      const imports = await runTeam(["memory", "imports", "--status", "failed"], configDir);
      assert.equal(imports.status, 0, imports.stderr);
      assert.match(imports.stdout, /failed\s+1\s+import-2\s+manual\/bad\.md/);

      const retried = await runTeam(["memory", "retry", "--id", "import-2"], configDir);
      assert.equal(retried.status, 0, retried.stderr);
      assert.match(retried.stdout, /Retry indexed: manual\/bad\.md/);

      assert.ok(seen.every((request) => request.authorization === "Bearer valid-token"));
      assert.ok(seen.some((request) => request.url === "/v1/team/whoami"));
      assert.ok(seen.some((request) => request.url === "/v1/team/clients"));
      assert.ok(seen.some((request) => request.url === "/v1/memory/imports"));
      assert.ok(seen.some((request) => request.url === "/v1/memory/imports?status=failed"));
      assert.ok(seen.some((request) => request.url === "/v1/memory/imports/retry"));

      const logout = await runTeam(["logout"], configDir);
      assert.equal(logout.status, 0, logout.stderr);
      assert.match(logout.stdout, /Signed out/);
      assert.equal(fs.existsSync(configPath), false);
    });
  } finally {
    rmDir(configDir);
  }
});

test("team CLI queues offline manual memory import and syncs it later", async () => {
  const configDir = tempDir();
  const root = tempDir();
  try {
    const configPath = path.join(configDir, "team-context.json");
    const baseConfig = {
      version: 2,
      apiUrl: "http://127.0.0.1:1",
      token: "valid-token",
      savedAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      team: { id: "team-1", slug: "demo", name: "Demo Team" },
      user: { id: "user-1", email: "member@example.com" },
      membership: { role: "member", status: "active" },
    };
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(baseConfig, null, 2)}\n`, "utf-8");

    const importFile = path.join(root, "queued-import.md");
    fs.writeFileSync(importFile, "# Queued\n\nOffline manual import content.\n", "utf-8");

    const queued = await runTeam(
      ["memory", "import", "--file", importFile, "--visibility", "team"],
      configDir,
      { AI_OS_ROOT: root, MEMORY_STORE_BACKEND: "pglite" },
    );
    assert.equal(queued.status, 0, queued.stderr);
    assert.match(queued.stdout, /Import queued locally for later sync: manual\/queued-import\.md/);

    await withTeamServer(async (baseUrl, seen) => {
      fs.writeFileSync(configPath, `${JSON.stringify({ ...baseConfig, apiUrl: baseUrl }, null, 2)}\n`, "utf-8");

      const status = await runTeam(["memory", "status"], configDir, {
        AI_OS_ROOT: root,
        MEMORY_STORE_BACKEND: "pglite",
      });
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, /Sources: 3/);
      assert.match(status.stdout, /Offline sync: 1 waiting, 0 syncing, 0 failed/);

      const synced = await runTeam(["memory", "sync"], configDir, {
        AI_OS_ROOT: root,
        MEMORY_STORE_BACKEND: "pglite",
      });
      assert.equal(synced.status, 0, synced.stderr);
      assert.match(synced.stdout, /Offline sync: 1 synced, 0 waiting to retry, 0 failed/);

      const importPosts = seen.filter((request) => request.method === "POST" && request.url === "/v1/memory/imports");
      assert.equal(importPosts.length, 1);
      const body = JSON.parse(importPosts[0].body);
      assert.equal(body.sourcePath, "manual/queued-import.md");
      assert.equal(body.sourceType, "other");
      assert.equal(body.scope.visibility, "team");
      assert.equal(body.embeddingModel, "bge-m3");
      assert.equal(body.embeddingDim, 1024);
      assert.ok(Array.isArray(body.chunks));
      assert.match(body.content, /Offline manual import content/);

      const ready = await runTeam(["memory", "status"], configDir, {
        AI_OS_ROOT: root,
        MEMORY_STORE_BACKEND: "pglite",
      });
      assert.equal(ready.status, 0, ready.stderr);
      assert.match(ready.stdout, /Offline sync: ready/);
    });
  } finally {
    rmDir(configDir);
    rmDir(root);
  }
});

test("team CLI memory sync retries transient errors and fails validation errors", async () => {
  const configDir = tempDir();
  const root = tempDir();
  try {
    const configPath = path.join(configDir, "team-context.json");
    const baseConfig = {
      version: 2,
      apiUrl: "http://127.0.0.1:1",
      token: "valid-token",
      savedAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      team: { id: "team-1", slug: "demo", name: "Demo Team" },
      user: { id: "user-1", email: "member@example.com" },
      membership: { role: "member", status: "active" },
    };
    const writeConfig = (apiUrl = "http://127.0.0.1:1") => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, `${JSON.stringify({ ...baseConfig, apiUrl }, null, 2)}\n`, "utf-8");
    };
    const queueImport = async (name, content) => {
      writeConfig();
      const file = path.join(root, name);
      fs.writeFileSync(file, content, "utf-8");
      const result = await runTeam(
        ["memory", "import", "--file", file, "--visibility", "team"],
        configDir,
        { AI_OS_ROOT: root, MEMORY_STORE_BACKEND: "pglite" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Import queued locally for later sync/);
    };

    await queueImport("retry-import.md", "# Retry\n\nTransient sync content.\n");

    await withHttpServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/v1/memory/imports") {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "server busy" } }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeConfig(apiUrl);
      const synced = await runTeam(["memory", "sync"], configDir, {
        AI_OS_ROOT: root,
        MEMORY_STORE_BACKEND: "pglite",
      });
      assert.equal(synced.status, 0, synced.stderr);
      assert.match(synced.stdout, /Offline sync: 0 synced, 1 waiting to retry, 0 failed/);
    });

    await queueImport("bad-import.md", "# Bad\n\nValidation sync content.\n");

    await withHttpServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/v1/memory/status") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ storeReady: true, scope: { mode: "team" }, sources: 0, chunks: 0, jobs: 0, manualImports: 0 }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/memory/imports") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "invalid memory payload" } }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeConfig(apiUrl);
      const synced = await runTeam(["memory", "sync"], configDir, {
        AI_OS_ROOT: root,
        MEMORY_STORE_BACKEND: "pglite",
      });
      assert.equal(synced.status, 0, synced.stderr);
      assert.match(synced.stdout, /Offline sync: 0 synced, 0 waiting to retry, 1 failed/);

      const status = await runTeam(["memory", "status"], configDir, {
        AI_OS_ROOT: root,
        MEMORY_STORE_BACKEND: "pglite",
      });
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, /Offline sync: 1 waiting, 0 syncing, 1 failed/);
    });
  } finally {
    rmDir(configDir);
    rmDir(root);
  }
});

test("team CLI opens the guided menu only for an interactive no-args session", async () => {
  const configDir = tempDir();
  try {
    const teamCli = require(TEAM_SCRIPT);
    assert.equal(teamCli.shouldOpenMenu({ command: undefined, help: false }, { isTTY: true }), true);
    assert.equal(teamCli.shouldOpenMenu({ command: undefined, help: false }, { isTTY: false }), false);
    assert.equal(teamCli.shouldOpenMenu({ command: "whoami", help: false }, { isTTY: true }), false);

    const noArgs = await runTeam([], configDir);
    assert.equal(noArgs.status, 0, noArgs.stderr);
    assert.match(noArgs.stdout, /No arguments in an interactive terminal opens the guided Team OS menu/);
  } finally {
    rmDir(configDir);
  }
});

test("team terminal UI formats status panels and role-aware menu options", () => {
  const connected = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo", name: "Demo Team" },
    user: { email: "member@example.com" },
    membership: { role: "member", status: "active" },
    counts: { clients: 2, skills: 3, secrets: 1, memorySources: 4, memoryChunks: 8, memoryPending: 1 },
  };
  const connectedPanel = stripAnsi(terminalUi.statusPanel(connected).body);
  assert.match(connectedPanel, /Status: connected/);
  assert.match(connectedPanel, /Team: demo \(Demo Team\)/);
  assert.match(connectedPanel, /User: member@example\.com/);
  assert.match(connectedPanel, /Role: member/);
  assert.match(connectedPanel, /Server: https:\/\/team\.example\.test/);
  assert.match(connectedPanel, /clients 2/);
  assert.match(connectedPanel, /memory 4\/8/);

  const offlinePanel = stripAnsi(terminalUi.statusPanel({
    status: "unavailable",
    hasLogin: true,
    apiUrl: "https://team.example.test",
    team: { slug: "demo" },
    user: { email: "member@example.com" },
    membership: { role: "admin" },
    error: "network down",
  }).body);
  assert.match(offlinePanel, /Status: offline/);
  assert.match(offlinePanel, /Last error: network down/);

  const signedOutPanel = stripAnsi(terminalUi.statusPanel({ status: "signed_out" }).body);
  assert.match(signedOutPanel, /Status: signed out/);

  const signedOutOptions = terminalUi.buildMainMenuOptions({ status: "signed_out" }).map((option) => option.value);
  assert.deepEqual(signedOutOptions, ["Connection", terminalUi.EXIT]);

  const connectionOptions = terminalUi.buildSectionOptions("Connection", connected).map((option) => option.value);
  assert.ok(connectionOptions.includes("status-information"));
  assert.equal(connectionOptions.includes("refresh"), false);
  assert.equal(connectionOptions.includes(terminalUi.BACK), false);
  assert.equal(connectionOptions.includes("Exit Team OS"), false);

  const memberOptions = terminalUi.buildMainMenuOptions(connected).map((option) => option.value);
  assert.ok(memberOptions.includes("Dashboard"));
  assert.equal(memberOptions.includes("Members"), false);

  const adminOptions = terminalUi.buildMainMenuOptions({
    ...connected,
    membership: { role: "admin", status: "active" },
  }).map((option) => option.value);
  assert.ok(adminOptions.includes("Members"));

  const adminSecretOptions = terminalUi.buildSectionOptions("Secrets", {
    ...connected,
    membership: { role: "owner", status: "active" },
  }).map((option) => option.value);
  assert.ok(adminSecretOptions.includes("grant"));
  assert.ok(adminSecretOptions.includes("archive"));
  assert.equal(adminSecretOptions.includes(terminalUi.BACK), false);
  assert.equal(adminSecretOptions.includes("Exit Team OS"), false);
});

test("team prompt fallback menu still exposes numeric Back", () => {
  const fallback = teamPrompts.formatFallbackMenu("Clients", [
    { label: "List clients", value: "list" },
    { label: "Pull workspace", value: "pull", detail: "download client files" },
  ]);
  assert.match(fallback, /Clients/);
  assert.match(fallback, /1\. List clients/);
  assert.match(fallback, /2\. Pull workspace - download client files/);
  assert.match(fallback, /0\. Back/);
});

test("team prompt select handles Escape immediately and restores raw mode", async () => {
  const input = new FakeTtyInput(["\x1b"]);
  const output = new FakeTtyOutput();

  await assert.rejects(
    teamPrompts.select("Clients", [{ label: "List clients", value: "list" }], { input, output }),
    (error) => teamPrompts.isPromptBack(error),
  );

  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(visibleTerminalText(output.text()), "");
});

test("team prompt select supports repeated section back flow and Ctrl+C exit", async () => {
  const input = new FakeTtyInput();
  const output = new FakeTtyOutput();
  const mainOptions = [
    { label: "Members", value: "Members" },
    { label: "Clients", value: "Clients" },
  ];

  const first = teamPrompts.select("Main Menu", mainOptions, { input, output });
  input.emitData("\r");
  assert.equal((await first).value, "Members");

  await assert.rejects(
    (() => {
      const prompt = teamPrompts.select("Members", [{ label: "List members", value: "list" }], { input, output });
      input.emitData("\x1b");
      return prompt;
    })(),
    (error) => teamPrompts.isPromptBack(error),
  );

  const second = teamPrompts.select("Main Menu", mainOptions, { input, output });
  input.emitData("\x1b[B\r");
  assert.equal((await second).value, "Clients");

  await assert.rejects(
    (() => {
      const prompt = teamPrompts.select("Clients", [{ label: "List clients", value: "list" }], { input, output });
      input.emitData("\x03");
      return prompt;
    })(),
    (error) => teamPrompts.isPromptExit(error),
  );

  assert.equal(input.listenerCount("data"), 0);
  assert.deepEqual(input.rawModes, [true, false, true, false, true, false, true, false]);
  assert.equal(visibleTerminalText(output.text()), "");
});

test("team prompt multi-select supports arrows, space, enter, and Escape cancel", async () => {
  const input = new FakeTtyInput(["\x1b[B \x1b[B \r"]);
  const output = new FakeTtyOutput();

  const picked = await teamPrompts.multiSelect(
    "Choose skills",
    [
      { label: "Marketing", value: "mkt" },
      { label: "Ops", value: "ops" },
      { label: "Sales", value: "sales" },
    ],
    [],
    { input, output },
  );

  assert.deepEqual(picked, ["ops", "sales"]);
  assert.match(stripAnsi(output.text()), /\[x\] Ops/);
  assert.match(output.text(), /\x1b\[\d+A/);
  assert.equal(visibleTerminalText(output.text()), "");
  assert.equal(input.listenerCount("data"), 0);

  const cancelInput = new FakeTtyInput(["\x1b"]);
  const cancelOutput = new FakeTtyOutput();
  await assert.rejects(
    teamPrompts.multiSelect("Choose skills", [{ label: "Marketing", value: "mkt" }], [], {
      input: cancelInput,
      output: cancelOutput,
    }),
    (error) => teamPrompts.isPromptBack(error),
  );
  assert.equal(visibleTerminalText(cancelOutput.text()), "");
});

test("team prompt Ctrl+C exits from text input, password input, confirm, and multi-select", async () => {
  const cases = [
    () => teamPrompts.promptFor("Search: ", { input: new FakeTtyInput(["\x03"]), output: new FakeTtyOutput() }),
    () => teamPrompts.promptFor("Password: ", {
      input: new FakeTtyInput(["\x03"]),
      output: new FakeTtyOutput(),
      password: true,
    }),
    () => teamPrompts.confirm("Continue?", false, { input: new FakeTtyInput(["\x03"]), output: new FakeTtyOutput() }),
    () => teamPrompts.multiSelect("Choose", [{ label: "One", value: "one" }], [], {
      input: new FakeTtyInput(["\x03"]),
      output: new FakeTtyOutput(),
    }),
  ];

  for (const run of cases) {
    await assert.rejects(run(), (error) => teamPrompts.isPromptExit(error));
  }
});

test("team prompt helpers do not leak data listeners after repeated prompts", async () => {
  const input = new FakeTtyInput(["\r", "\x1b", "\x1b[B \r", "y"]);
  const output = new FakeTtyOutput();

  await teamPrompts.select("Main Menu", [{ label: "Connection", value: "Connection" }], { input, output });
  await assert.rejects(
    teamPrompts.select("Connection", [{ label: "Status information", value: "status-information" }], {
      input,
      output,
    }),
    (error) => teamPrompts.isPromptBack(error),
  );
  await teamPrompts.multiSelect(
    "Choose",
    [{ label: "One", value: "one" }, { label: "Two", value: "two" }],
    [],
    { input, output },
  );
  assert.equal(await teamPrompts.confirm("Continue?", false, { input, output }), true);

  assert.equal(input.listenerCount("data"), 0);
  assert.equal(visibleTerminalText(output.text()), "");
});

test("team prompt clears navigation UI but preserves action output", async () => {
  const input = new FakeTtyInput(["\x1b[B\r"]);
  const output = new FakeTtyOutput();

  const picked = await teamPrompts.select("Main Menu", [
    { label: "Connection", value: "Connection" },
    { label: "Clients", value: "Clients" },
  ], { input, output });
  output.write("Action complete\n");

  assert.equal(picked.value, "Clients");
  assert.equal(visibleTerminalText(output.text()), "Action complete");
  assert.doesNotMatch(visibleTerminalText(output.text()), /Main Menu|Connection|Clients/);
});

test("team interactive menu shows the status panel only once after normal actions", async () => {
  const teamCli = require(TEAM_SCRIPT);
  const selections = [
    { value: "Connection" },
    { value: "whoami" },
    { cancel: "back" },
    { value: terminalUi.EXIT },
  ];
  const notes = [];
  const actions = [];
  let statusLoads = 0;
  const status = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo", name: "Demo Team" },
    user: { email: "member@example.com" },
    membership: { role: "member", status: "active" },
    counts: { clients: 2 },
  };

  await withMutedConsole(() => teamCli.openMenu({
    fetchMenuStatus: async () => {
      statusLoads += 1;
      return { ...status, checkedAt: `check-${statusLoads}` };
    },
    runMenuAction: async (section, action) => {
      actions.push({ section, action });
    },
    prompts: {
      intro: async () => {},
      isInteractive: () => true,
      isPromptAvailable: () => true,
      note: async (body, title) => notes.push({ title, body: stripAnsi(body) }),
      outro: async () => {},
      promptFor: async () => "",
      select: async (title, options) => {
        const next = selections.shift();
        assert.ok(next, `Unexpected prompt: ${title}`);
        if (next.cancel === "back") throw new teamPrompts.PromptBackError();
        if (next.cancel === "exit") throw new teamPrompts.PromptExitError();
        const option = options.find((item) => item.value === next.value);
        assert.ok(option, `Missing option ${next.value} in ${title}`);
        return option;
      },
      withSpinner: async (_message, fn) => fn(),
    },
  }));

  assert.deepEqual(actions, [{ section: "Connection", action: "whoami" }]);
  assert.equal(statusLoads, 2);
  assert.equal(notes.filter((entry) => entry.title === "Team OS status").length, 1);
});

test("team interactive menu shows status panel when Status information is selected", async () => {
  const teamCli = require(TEAM_SCRIPT);
  const selections = [
    { value: "Connection" },
    { value: "status-information" },
    { cancel: "back" },
    { value: terminalUi.EXIT },
  ];
  const notes = [];
  const actions = [];
  let statusLoads = 0;
  const status = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo", name: "Demo Team" },
    user: { email: "member@example.com" },
    membership: { role: "member", status: "active" },
    counts: { clients: 2 },
  };

  await withMutedConsole(() => teamCli.openMenu({
    fetchMenuStatus: async () => {
      statusLoads += 1;
      return { ...status, checkedAt: `check-${statusLoads}` };
    },
    runMenuAction: async (section, action) => {
      actions.push({ section, action });
    },
    prompts: {
      intro: async () => {},
      isInteractive: () => true,
      isPromptAvailable: () => true,
      note: async (body, title) => notes.push({ title, body: stripAnsi(body) }),
      outro: async () => {},
      promptFor: async () => "",
      select: async (title, options) => {
        const next = selections.shift();
        assert.ok(next, `Unexpected prompt: ${title}`);
        if (next.cancel === "back") throw new teamPrompts.PromptBackError();
        if (next.cancel === "exit") throw new teamPrompts.PromptExitError();
        const option = options.find((item) => item.value === next.value);
        assert.ok(option, `Missing option ${next.value} in ${title}`);
        return option;
      },
      withSpinner: async (_message, fn) => fn(),
    },
  }));

  assert.deepEqual(actions, []);
  assert.equal(statusLoads, 2);
  assert.equal(notes.filter((entry) => entry.title === "Team OS status").length, 2);
});

test("team interactive menu exits cleanly when Escape is pressed on the main menu", async () => {
  const teamCli = require(TEAM_SCRIPT);
  const notes = [];
  const outros = [];
  const status = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo" },
    user: { email: "member@example.com" },
    membership: { role: "member", status: "active" },
    counts: {},
  };

  const result = await withMutedConsole(() => teamCli.openMenu({
    fetchMenuStatus: async () => status,
    prompts: {
      intro: async () => {},
      isInteractive: () => true,
      isPromptAvailable: () => true,
      note: async (body, title) => notes.push({ title, body: stripAnsi(body) }),
      outro: async (message) => outros.push(stripAnsi(message)),
      promptFor: async () => "",
      select: async () => {
        throw new teamPrompts.PromptBackError();
      },
      withSpinner: async (_message, fn) => fn(),
    },
  }));

  assert.equal(result, 0);
  assert.equal(notes.filter((entry) => entry.title === "Team OS status").length, 1);
  assert.deepEqual(outros, ["Closed Team OS."]);
});

test("team interactive menu handles repeated Escape from sections without freezing", async () => {
  const teamCli = require(TEAM_SCRIPT);
  const selections = [
    { value: "Secrets" },
    { cancel: "back" },
    { value: "Clients" },
    { cancel: "back" },
    { value: terminalUi.EXIT },
  ];
  const outros = [];
  const status = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo" },
    user: { email: "owner@example.com" },
    membership: { role: "owner", status: "active" },
    counts: {},
  };

  const result = await withMutedConsole(() => teamCli.openMenu({
    fetchMenuStatus: async () => status,
    prompts: {
      intro: async () => {},
      isInteractive: () => true,
      isPromptAvailable: () => true,
      note: async () => {},
      outro: async (message) => outros.push(stripAnsi(message)),
      promptFor: async () => "",
      select: async (title, options) => {
        const next = selections.shift();
        assert.ok(next, `Unexpected prompt: ${title}`);
        if (next.cancel === "back") throw new teamPrompts.PromptBackError();
        const option = options.find((item) => item.value === next.value);
        assert.ok(option, `Missing option ${next.value} in ${title}`);
        return option;
      },
      withSpinner: async (_message, fn) => fn(),
    },
    forceExit: false,
  }));

  assert.equal(result, 0);
  assert.deepEqual(outros, ["Closed Team OS."]);
});

test("team interactive menu real prompt input handles Members Escape then Clients Ctrl+C", async () => {
  const teamCli = require(TEAM_SCRIPT);
  const input = new FakeTtyInput([
    "\x1b[B\x1b[B\r",
    "\x1b",
    "\x1b[B\x1b[B\x1b[B\r",
    "\x03",
  ]);
  const output = new FakeTtyOutput();
  const outros = [];
  const status = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo" },
    user: { email: "owner@example.com" },
    membership: { role: "owner", status: "active" },
    counts: {},
  };

  const result = await withMutedConsole(() => teamCli.openMenu({
    fetchMenuStatus: async () => status,
    prompts: {
      intro: async () => {},
      isInteractive: () => true,
      isPromptAvailable: () => true,
      note: async () => {},
      outro: async (message) => outros.push(stripAnsi(message)),
      promptFor: (message, options = {}) => teamPrompts.promptFor(message, { ...options, input, output }),
      select: (title, options, promptOptions = {}) => teamPrompts.select(title, options, {
        ...promptOptions,
        input,
        output,
      }),
      withSpinner: async (_message, fn) => fn(),
    },
    forceExit: false,
  }));

  assert.equal(result, 0);
  assert.deepEqual(outros, ["Closed Team OS."]);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(input.rawMode, false);
  assert.equal(visibleTerminalText(output.text()), "");
});

test("team interactive menu cancels nested actions without pausing or refreshing", async () => {
  const teamCli = require(TEAM_SCRIPT);
  const selections = [
    { value: "Skills" },
    { value: "adopt" },
    { cancel: "back" },
    { value: terminalUi.EXIT },
  ];
  const promptsSeen = [];
  const actions = [];
  let statusLoads = 0;
  const status = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo" },
    user: { email: "owner@example.com" },
    membership: { role: "owner", status: "active" },
    counts: { skills: 2 },
  };

  await withMutedConsole(() => teamCli.openMenu({
    fetchMenuStatus: async () => {
      statusLoads += 1;
      return status;
    },
    runMenuAction: async (section, action) => {
      actions.push({ section, action });
      throw new teamPrompts.PromptBackError();
    },
    prompts: {
      intro: async () => {},
      isInteractive: () => true,
      isPromptAvailable: () => true,
      note: async () => {},
      outro: async () => {},
      promptFor: async (message) => {
        promptsSeen.push(message);
        return "";
      },
      select: async (title, options) => {
        const next = selections.shift();
        assert.ok(next, `Unexpected prompt: ${title}`);
        if (next.cancel === "back") throw new teamPrompts.PromptBackError();
        const option = options.find((item) => item.value === next.value);
        assert.ok(option, `Missing option ${next.value} in ${title}`);
        return option;
      },
      withSpinner: async (_message, fn) => fn(),
    },
  }));

  assert.deepEqual(actions, [{ section: "Skills", action: "adopt" }]);
  assert.equal(statusLoads, 1);
  assert.deepEqual(promptsSeen, []);
});

test("team interactive menu exits cleanly when Ctrl+C cancels a section menu", async () => {
  const teamCli = require(TEAM_SCRIPT);
  const selections = [
    { value: "Clients" },
    { cancel: "exit" },
  ];
  const notes = [];
  const outros = [];
  const status = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo" },
    user: { email: "member@example.com" },
    membership: { role: "member", status: "active" },
    counts: {},
  };

  const result = await withMutedConsole(() => teamCli.openMenu({
    fetchMenuStatus: async () => status,
    prompts: {
      intro: async () => {},
      isInteractive: () => true,
      isPromptAvailable: () => true,
      note: async (body, title) => notes.push({ title, body: stripAnsi(body) }),
      outro: async (message) => outros.push(stripAnsi(message)),
      promptFor: async () => {
        throw new Error("pause should not run");
      },
      select: async (title, options) => {
        const next = selections.shift();
        assert.ok(next, `Unexpected prompt: ${title}`);
        if (next.cancel === "exit") throw new teamPrompts.PromptExitError();
        const option = options.find((item) => item.value === next.value);
        assert.ok(option, `Missing option ${next.value} in ${title}`);
        return option;
      },
      withSpinner: async (_message, fn) => fn(),
    },
    forceExit: false,
  }));

  assert.equal(result, 0);
  assert.equal(notes.filter((entry) => entry.title === "Team OS error").length, 0);
  assert.deepEqual(outros, ["Closed Team OS."]);
});

test("team interactive menu exits cleanly when Ctrl+C cancels an action prompt", async () => {
  const teamCli = require(TEAM_SCRIPT);
  const selections = [
    { value: "Skills" },
    { value: "search" },
  ];
  const notes = [];
  const outros = [];
  const status = {
    status: "connected",
    apiUrl: "https://team.example.test",
    team: { slug: "demo" },
    user: { email: "member@example.com" },
    membership: { role: "member", status: "active" },
    counts: { skills: 2 },
  };

  const result = await withMutedConsole(() => teamCli.openMenu({
    fetchMenuStatus: async () => status,
    runMenuAction: async () => {
      throw new teamPrompts.PromptExitError();
    },
    prompts: {
      intro: async () => {},
      isInteractive: () => true,
      isPromptAvailable: () => true,
      note: async (body, title) => notes.push({ title, body: stripAnsi(body) }),
      outro: async (message) => outros.push(stripAnsi(message)),
      promptFor: async () => {
        throw new Error("pause should not run");
      },
      select: async (title, options) => {
        const next = selections.shift();
        assert.ok(next, `Unexpected prompt: ${title}`);
        const option = options.find((item) => item.value === next.value);
        assert.ok(option, `Missing option ${next.value} in ${title}`);
        return option;
      },
      withSpinner: async (_message, fn) => fn(),
    },
  }));

  assert.equal(result, 0);
  assert.equal(notes.filter((entry) => entry.title === "Team OS error").length, 0);
  assert.deepEqual(outros, ["Closed Team OS."]);
});

test("team menu status loader returns live data and cached offline data", async () => {
  const configDir = tempDir();
  const originalConfigDir = process.env.AI_OS_TEAM_CONFIG_DIR;
  try {
    await withTeamServer(async (baseUrl) => {
      process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "team-context.json"),
        `${JSON.stringify({
          apiUrl: baseUrl,
          token: "valid-token",
          user: { email: "cached@example.com" },
          team: { slug: "cached" },
          membership: { role: "member" },
        }, null, 2)}\n`,
      );

      const teamCli = require(TEAM_SCRIPT);
      const live = await teamCli.fetchMenuStatus({ timeoutMs: 1000 });
      assert.equal(live.status, "connected");
      assert.equal(live.team.slug, "demo");
      assert.equal(live.user.email, "member@example.com");
      assert.equal(live.counts.clients, 2);
      assert.equal(live.counts.memorySources, 3);
    });

    fs.writeFileSync(
      path.join(configDir, "team-context.json"),
      `${JSON.stringify({
        apiUrl: "http://127.0.0.1:1",
        token: "valid-token",
        user: { email: "cached@example.com" },
        team: { slug: "cached" },
        membership: { role: "admin" },
      }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(configDir, "team-status.json"),
      `${JSON.stringify({
        status: "connected",
        checkedAt: "2026-06-29T10:00:00.000Z",
        apiUrl: "http://127.0.0.1:1",
        user: { email: "cached@example.com" },
        team: { slug: "cached" },
        membership: { role: "admin" },
      }, null, 2)}\n`,
    );
    process.env.AI_OS_TEAM_CONFIG_DIR = configDir;
    const teamCli = require(TEAM_SCRIPT);
    const offline = await teamCli.fetchMenuStatus({ timeoutMs: 100 });
    assert.equal(offline.status, "unavailable");
    assert.equal(offline.team.slug, "cached");
    assert.equal(offline.user.email, "cached@example.com");
    assert.equal(offline.membership.role, "admin");
  } finally {
    if (originalConfigDir == null) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = originalConfigDir;
    rmDir(configDir);
  }
});

test("team terminal UI summarizes partial batch failures", () => {
  const summary = terminalUi.summarizeBatch("Skill grants", [
    { ok: true, label: "mkt-email" },
    { ok: false, label: "ops-report", error: "forbidden" },
  ]);
  assert.equal(summary.ok, 1);
  assert.equal(summary.failed, 1);
  assert.match(summary.text, /Skill grants: 1\/2 done/);
  assert.match(summary.text, /ops-report: forbidden/);
});

test("team CLI exposes admin actions, secrets, skills, and memory status", async () => {
  const configDir = tempDir();
  const root = tempDir();
  try {
    await withTeamServer(async (baseUrl, seen) => {
      await runTeam(["login", "--api-url", baseUrl, "--token", "valid-token"], configDir);

      const dashboardResult = await runTeam(["dashboard"], configDir);
      assert.equal(dashboardResult.status, 0, dashboardResult.stderr);
      assert.match(dashboardResult.stdout, /Team: Demo Team/);
      assert.match(dashboardResult.stdout, /Memory: 3 sources, 9 chunks, 1 pending/);

      const invite = await runTeam(["member", "invite", "--email", "new@example.com", "--role", "admin"], configDir);
      assert.equal(invite.status, 0, invite.stderr);
      assert.match(invite.stdout, /Invite link for new@example\.com/);

      const clientCreate = await runTeam(["client", "create", "--name", "New Client"], configDir);
      assert.equal(clientCreate.status, 0, clientCreate.stderr);

      const skillGrant = await runTeam(
        ["skill", "grant", "--skill", "mkt-email", "--user", "member@example.com", "--permission", "skill.edit"],
        configDir,
      );
      assert.equal(skillGrant.status, 0, skillGrant.stderr);

      const skills = await runTeam(["skill", "list", "--query", "email"], configDir);
      assert.equal(skills.status, 0, skills.stderr);
      assert.match(skills.stdout, /mkt-email/);
      assert.doesNotMatch(skills.stdout, /ops-report/);

      const secretCreate = await runTeam(
        ["secret", "create", "--name", "API", "--env-key", "API_KEY", "--value", "secret-value"],
        configDir,
      );
      assert.equal(secretCreate.status, 0, secretCreate.stderr);
      assert.match(secretCreate.stdout, /API_KEY/);

      const secretSync = await runTeam(["secret", "sync", "--overwrite"], configDir, { AI_OS_ROOT: root });
      assert.equal(secretSync.status, 0, secretSync.stderr);
      assert.match(secretSync.stdout, /Synced secrets into 2 env files/);
      assert.match(fs.readFileSync(path.join(root, ".env"), "utf-8"), /API_KEY="abc 123"/);
      assert.match(fs.readFileSync(path.join(root, "clients", "acme", ".env"), "utf-8"), /CLIENT_KEY=client-value/);

      const memoryStatus = await runTeam(["memory", "status"], configDir);
      assert.equal(memoryStatus.status, 0, memoryStatus.stderr);
      assert.match(memoryStatus.stdout, /Sources: 3/);

      const adminActions = seen
        .filter((request) => request.method === "POST" && request.url === "/v1/team/admin")
        .map((request) => JSON.parse(request.body));
      assert.ok(adminActions.some((body) => body.action === "invite-member" && body.role === "admin"));
      assert.ok(adminActions.some((body) => body.action === "create-client" && body.name === "New Client"));
      assert.ok(adminActions.some((body) => body.action === "grant-skill" && body.permission === "skill.edit"));

      const secretActions = seen
        .filter((request) => request.method === "POST" && request.url === "/v1/team/secrets")
        .map((request) => JSON.parse(request.body));
      assert.ok(secretActions.some((body) => body.action === "create-secret" && body.envKey === "API_KEY"));
      assert.ok(seen.some((request) => request.method === "POST" && request.url === "/v1/team/secrets/sync"));
    });
  } finally {
    rmDir(configDir);
    rmDir(root);
  }
});

test("team CLI syncs brand context and encrypted MCP backup through Team API", async () => {
  const configDir = tempDir();
  const root = tempDir();
  try {
    await withTeamServer(async (baseUrl, seen) => {
      await runTeam(["login", "--api-url", baseUrl, "--token", "valid-token"], configDir);

      const pulled = await runTeam(["brand-context", "pull", "--overwrite"], configDir, { AI_OS_ROOT: root });
      assert.equal(pulled.status, 0, pulled.stderr);
      assert.equal(fs.readFileSync(path.join(root, "brand_context", "voice.md"), "utf-8"), "remote voice\n");

      fs.writeFileSync(path.join(root, "brand_context", "voice.md"), "local voice\n", "utf-8");
      const pushed = await runTeam(["brand-context", "push", "--overwrite"], configDir, { AI_OS_ROOT: root });
      assert.equal(pushed.status, 0, pushed.stderr);
      assert.match(pushed.stdout, /Pushed 1 brand context file/);

      const mcpContent = JSON.stringify({ mcpServers: { demo: { command: "node" } } }, null, 2);
      fs.writeFileSync(path.join(root, ".mcp.json"), mcpContent, "utf-8");
      const backup = await runTeam(["mcp", "backup"], configDir, { AI_OS_ROOT: root });
      assert.equal(backup.status, 0, backup.stderr);
      assert.match(backup.stdout, /Backed up \.mcp\.json/);

      fs.writeFileSync(path.join(root, ".mcp.json"), "{\"mcpServers\":{}}\n", "utf-8");
      const restore = await runTeam(["mcp", "restore", "--overwrite"], configDir, { AI_OS_ROOT: root });
      assert.equal(restore.status, 0, restore.stderr);
      assert.equal(fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"), mcpContent);

      assert.ok(seen.some((request) => request.method === "PUT" && request.url === "/v1/team/brand-context/file?path=brand_context%2Fvoice.md"));
      assert.ok(seen.some((request) => request.method === "PUT" && request.url === "/v1/user/config-file"));
    });
  } finally {
    rmDir(configDir);
    rmDir(root);
  }
});

test("ai status line renders Team OS state without the GSD statusline hook", async () => {
  const configDir = tempDir();
  const workspace = tempDir();
  const claudeDir = tempDir();
  const fakeProjectDir = tempDir();
  try {
    fs.writeFileSync(
      path.join(configDir, "team-context.json"),
      JSON.stringify({
        apiUrl: "https://team.example.test",
        token: "valid-token",
        team: { slug: "local-dev", name: "Local Dev" },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(configDir, "team-status.json"),
      JSON.stringify({
        status: "connected",
        label: "local-dev",
        team: { slug: "local-dev" },
      }),
      "utf-8",
    );

    const result = await runStatusline(
      {
        model: { display_name: "Claude Test" },
        workspace: { current_dir: workspace },
        session_id: "status-session",
        context_window: { remaining_percentage: 80 },
      },
      {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        CLAUDE_CONFIG_DIR: claudeDir,
        CLAUDE_PROJECT_DIR: fakeProjectDir,
      },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Claude Test/);
    assert.match(result.stdout, /Team: local-dev/);
    assert.doesNotMatch(result.stdout, /GSD:/);
  } finally {
    rmDir(configDir);
    rmDir(workspace);
    rmDir(claudeDir);
    rmDir(fakeProjectDir);
  }
});

test("ai status line renders offline and signed-out Team OS states", async () => {
  const configDir = tempDir();
  const workspace = tempDir();
  try {
    fs.writeFileSync(
      path.join(configDir, "team-context.json"),
      JSON.stringify({
        apiUrl: "https://team.example.test",
        token: "valid-token",
        team: { slug: "local-dev" },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(configDir, "team-status.json"),
      JSON.stringify({
        status: "unavailable",
        label: "local-dev",
        error: "network down",
      }),
      "utf-8",
    );

    const offline = await runStatusline(
      { model: { display_name: "Claude" }, workspace: { current_dir: workspace } },
      { AI_OS_TEAM_CONFIG_DIR: configDir },
    );
    assert.match(offline.stdout, /Team: offline local-dev/);

    fs.rmSync(path.join(configDir, "team-context.json"), { force: true });
    const signedOut = await runStatusline(
      { model: { display_name: "Claude" }, workspace: { current_dir: workspace } },
      { AI_OS_TEAM_CONFIG_DIR: configDir },
    );
    assert.match(signedOut.stdout, /Team: signed out/);
  } finally {
    rmDir(configDir);
    rmDir(workspace);
  }
});

test("team CLI signed-out and expired-token flows fail clearly", async () => {
  const configDir = tempDir();
  try {
    const signedOut = await runTeam(["whoami"], configDir);
    assert.equal(signedOut.status, 1);
    assert.match(signedOut.stderr, /You are not logged in/);
    assert.match(signedOut.stderr, /npm run team -- login/);

    await withTeamServer(async (baseUrl) => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "team-context.json"),
        `${JSON.stringify({ apiUrl: baseUrl, token: "expired-token" }, null, 2)}\n`,
      );

      const expired = await runTeam(["clients"], configDir);
      assert.equal(expired.status, 1);
      assert.match(expired.stderr, /token expired/);
    });
  } finally {
    rmDir(configDir);
  }
});

test("team owner reset helper creates a full hosted reset URL for the active owner", async () => {
  const team = { id: "team-1", slug: "local-dev", name: "Local Dev" };
  const owner = { id: "owner-non-uuid", email: "owner@example.test" };
  const store = {
    getUserByEmail: async (email) => (email === owner.email ? owner : null),
    getUserById: async (id) => (id === owner.id ? owner : null),
    getMembership: async (teamId, userId) => (
      teamId === team.id && userId === owner.id
        ? { teamId, userId, role: "owner", status: "active" }
        : null
    ),
    listMemberships: async () => [],
  };
  const teamAuth = {
    createPasswordResetTokenForUser: async (_store, user, options) => {
      assert.equal(user.email, owner.email);
      assert.deepEqual(options, {
        teamId: team.id,
        expiresInSeconds: 3600,
        allowProtectedAuthority: true,
      });
      return { token: "reset-token", expiresAt: "2026-06-25T12:00:00.000Z" };
    },
  };

  const result = await ownerReset.createOwnerResetLink({
    store,
    teamAuth,
    flags: { team: "local-dev", email: owner.email },
    env: { MEMORY_API_PUBLIC_URL: "https://team.example.test/" },
    resolveTeam: async (_store, teamRef) => {
      assert.equal(teamRef, "local-dev");
      return team;
    },
  });

  assert.equal(result.url, "https://team.example.test/team/reset-password?email=owner%40example.test&token=reset-token");
  assert.equal(result.reset.expiresAt, "2026-06-25T12:00:00.000Z");
});

test("team owner reset helper passes a bounded TTL to the reset token creator", async () => {
  const team = { id: "team-1", slug: "local-dev", name: "Local Dev" };
  const owner = { id: "owner-non-uuid", email: "owner@example.test" };
  let ttlSeconds = null;
  const store = {
    getUserByEmail: async () => owner,
    getMembership: async () => ({ teamId: team.id, userId: owner.id, role: "owner", status: "active" }),
    listMemberships: async () => [],
  };
  const teamAuth = {
    createPasswordResetTokenForUser: async (_store, _user, options) => {
      ttlSeconds = options.expiresInSeconds;
      assert.equal(options.teamId, team.id);
      assert.equal(options.allowProtectedAuthority, true);
      return { token: "reset-token", expiresAt: "2026-06-25T12:00:00.000Z" };
    },
  };

  await ownerReset.createOwnerResetLink({
    store,
    teamAuth,
    flags: { team: "local-dev", email: owner.email, baseUrl: "https://team.example.test", ttl: "4h" },
    env: {},
    resolveTeam: async () => team,
  });

  assert.equal(ttlSeconds, 4 * 3600);
  assert.equal(ownerReset.parseTtlSeconds(undefined), 3600);
  assert.throws(() => ownerReset.parseTtlSeconds("25h"), /24h or less/);
  assert.throws(() => ownerReset.parseTtlSeconds("slow"), /duration/);
});

test("team owner reset public URL lookup supports approved service env vars", () => {
  assert.equal(
    ownerReset.defaultPublicBaseUrl({}, { SERVICE_URL_MEMORY: "https://service.example.test/" }),
    "https://service.example.test",
  );
  assert.equal(
    ownerReset.defaultPublicBaseUrl({}, { SERVICE_FQDN_MEMORY: "team.example.test" }),
    "https://team.example.test",
  );
  assert.equal(
    ownerReset.defaultPublicBaseUrl(
      {},
      {
        COOLIFY_URL: "https://wrong.example.test",
        COOLIFY_FQDN: "wrong.example.test",
        BETTER_AUTH_URL: "https://auth.example.test",
      },
    ),
    "https://auth.example.test",
  );
});

test("team owner reset refuses localhost fallback in production", () => {
  assert.throws(
    () => ownerReset.defaultPublicBaseUrl({}, { NODE_ENV: "production", MEMORY_API_PORT: "8787" }),
    /public base URL is required/,
  );
  assert.equal(
    ownerReset.defaultPublicBaseUrl({ baseUrl: "http://localhost:8787" }, { NODE_ENV: "production" }),
    "http://localhost:8787",
  );
});

test("team-join explains local-store team lookup failures", async () => {
  const workspace = tempDir();
  try {
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "# Test\n");
    const result = await runTeamJoin([
      "--team",
      "hosted-team",
      "--email",
      "member@example.com",
      "--token",
      "invite-token",
    ], workspace);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /team not found: hosted-team/);
    assert.match(result.stderr, /reading the local AI-OS store/);
    assert.match(result.stderr, /MEMORY_DATABASE_URL\/DATABASE_URL/);
  } finally {
    rmDir(workspace);
  }
});

test("team CLI unknown commands still show usage guidance", async () => {
  const configDir = tempDir();
  try {
    const result = await runTeam(["not-a-command"], configDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command: not-a-command/);
    assert.match(result.stderr, /Usage:/);
  } finally {
    rmDir(configDir);
  }
});

test("sync push invalid --src error shows examples without full usage", async () => {
  const configDir = tempDir();
  const src = tempDir();
  try {
    fs.writeFileSync(
      path.join(configDir, "team-context.json"),
      JSON.stringify({ apiUrl: "https://team.example.test", token: "valid-token" }),
      "utf-8",
    );

    const result = await runTeam(["sync", "push", "--client", "acme", "--src", src], configDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a valid Team OS client sync folder/);
    assert.match(result.stderr, /contains clients\/acme/);
    assert.match(result.stderr, /team-os-local\/clients\/acme/);
    assert.match(result.stderr, /run sync pull first/);
    assert.doesNotMatch(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /request failed/);
  } finally {
    rmDir(configDir);
    rmDir(src);
  }
});

test("sync push missing base version error omits full usage", async () => {
  const configDir = tempDir();
  const src = tempDir();
  try {
    const clientDir = path.join(src, "clients", "acme");
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, "notes.md"), "local notes\n", "utf-8");

    await withHttpServer((req, res) => {
      if (req.headers.authorization !== "Bearer valid-token") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "unauthorized", message: "token expired" } }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/workspace/manifest?client=acme") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          files: [{
            path: "clients/acme/notes.md",
            sha256: sha256Text("remote notes\n"),
            size: "remote notes\n".length,
            writable: true,
          }],
        }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: "not found" } }));
    }, async (baseUrl) => {
      fs.writeFileSync(
        path.join(configDir, "team-context.json"),
        JSON.stringify({ apiUrl: baseUrl, token: "valid-token" }),
        "utf-8",
      );

      const result = await runTeam(["sync", "push", "--client", "acme", "--src", src], configDir);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /No base version for clients\/acme\/notes\.md/);
      assert.match(result.stderr, /Run sync pull before pushing existing files/);
      assert.doesNotMatch(result.stderr, /Usage:/);
    });
  } finally {
    rmDir(configDir);
    rmDir(src);
  }
});
