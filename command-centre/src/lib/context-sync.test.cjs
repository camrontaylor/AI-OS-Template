const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const COMMAND_CENTRE_ROOT = path.resolve(__dirname, "../..");
const SYNC_SCRIPT = path.join(COMMAND_CENTRE_ROOT, "scripts", "context-sync.cjs");

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-sync-"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Agents\n");
  return root;
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function withHttpServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk.toString(); });
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A minimal /v1/context/documents + /v1/context/document server for context-sync.cjs. */
function contextServer({ teamDocs = [] } = {}) {
  const puts = [];
  const handler = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/v1/context/documents" && req.method === "GET") {
      const visibility = url.searchParams.get("visibility");
      const documents = visibility === "team" ? teamDocs : [];
      jsonResponse(res, 200, { documents });
      return;
    }
    if (url.pathname === "/v1/context/document" && req.method === "PUT") {
      const body = await readJsonBody(req);
      puts.push(body);
      jsonResponse(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/v1/user/config-file") {
      jsonResponse(res, 404, { error: { message: "not found" } });
      return;
    }
    jsonResponse(res, 404, { error: { message: "not found" } });
  };
  return { handler, puts };
}

async function runContextSync(root, configDir, args = []) {
  try {
    const result = await execFileAsync(process.execPath, [SYNC_SCRIPT, "--cwd", root, "--no-mcp", ...args], {
      cwd: COMMAND_CENTRE_ROOT,
      env: {
        ...process.env,
        AI_OS_TEAM_CONFIG_DIR: configDir,
      },
      windowsHide: true,
      timeout: 30000,
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

function writeTeamContext(configDir, apiUrl) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "team-context.json"),
    JSON.stringify({ apiUrl, token: "test-token", expiresAt: "2099-01-01T00:00:00.000Z" }),
    "utf-8",
  );
}

function readState(root) {
  const statePath = path.join(root, ".AI-OS", "context-sync", "state.json");
  return JSON.parse(fs.readFileSync(statePath, "utf-8"));
}

function listConflictCopies(root) {
  const dir = path.join(root, ".AI-OS", "context-sync", "conflicts");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

test("pullTeamDocs: no local file — pulls silently", async () => {
  const root = tempRoot();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-sync-cfg-"));
  try {
    const content = "# Team profile\n\nFrom server.\n";
    const { handler } = contextServer({
      teamDocs: [{ path: "team_context/team-profile.md", content, sha256: sha256(content) }],
    });

    await withHttpServer(handler, async (apiUrl) => {
      writeTeamContext(configDir, apiUrl);
      const result = await runContextSync(root, configDir);
      assert.equal(result.status, 0, result.stderr);
    });

    assert.equal(
      fs.readFileSync(path.join(root, "team_context", "team-profile.md"), "utf-8"),
      content,
    );
    assert.equal(listConflictCopies(root).length, 0);
  } finally {
    rmDir(root);
    rmDir(configDir);
  }
});

test("pullTeamDocs: local already matches server — refreshes state, no conflict", async () => {
  const root = tempRoot();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-sync-cfg-"));
  try {
    const content = "# Team profile\n\nSame everywhere.\n";
    fs.mkdirSync(path.join(root, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(root, "team_context", "team-profile.md"), content);
    const { handler } = contextServer({
      teamDocs: [{ path: "team_context/team-profile.md", content, sha256: sha256(content) }],
    });

    await withHttpServer(handler, async (apiUrl) => {
      writeTeamContext(configDir, apiUrl);
      const result = await runContextSync(root, configDir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /0 conflict\(s\)/);
    });

    const state = readState(root);
    assert.equal(state.files["team:team_context/team-profile.md"].sha256, sha256(content));
    assert.equal(listConflictCopies(root).length, 0);
  } finally {
    rmDir(root);
    rmDir(configDir);
  }
});

test("pullTeamDocs: server moved on, local untouched since last sync — pulls cleanly", async () => {
  const root = tempRoot();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-sync-cfg-"));
  try {
    const first = "# Team profile\n\nv1.\n";
    const second = "# Team profile\n\nv2 from server.\n";
    fs.mkdirSync(path.join(root, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(root, "team_context", "team-profile.md"), first);

    // First sync: local matches server v1, establishes the synced baseline.
    let server = contextServer({
      teamDocs: [{ path: "team_context/team-profile.md", content: first, sha256: sha256(first) }],
    });
    await withHttpServer(server.handler, async (apiUrl) => {
      writeTeamContext(configDir, apiUrl);
      const result = await runContextSync(root, configDir);
      assert.equal(result.status, 0, result.stderr);
    });

    // Second sync: server moved to v2, local file was never touched.
    server = contextServer({
      teamDocs: [{ path: "team_context/team-profile.md", content: second, sha256: sha256(second) }],
    });
    await withHttpServer(server.handler, async (apiUrl) => {
      writeTeamContext(configDir, apiUrl);
      const result = await runContextSync(root, configDir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /0 conflict\(s\)/);
    });

    assert.equal(
      fs.readFileSync(path.join(root, "team_context", "team-profile.md"), "utf-8"),
      second,
    );
    assert.equal(listConflictCopies(root).length, 0);
  } finally {
    rmDir(root);
    rmDir(configDir);
  }
});

test("pullTeamDocs: local edits never seen by a prior sync — preserved as a conflict copy, server still wins the main path", async () => {
  const root = tempRoot();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-sync-cfg-"));
  try {
    const localEdit = "# Team profile\n\nLocal edit, never pushed.\n";
    const serverContent = "# Team profile\n\nServer version.\n";
    fs.mkdirSync(path.join(root, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(root, "team_context", "team-profile.md"), localEdit);

    const { handler } = contextServer({
      teamDocs: [{ path: "team_context/team-profile.md", content: serverContent, sha256: sha256(serverContent) }],
    });

    await withHttpServer(handler, async (apiUrl) => {
      writeTeamContext(configDir, apiUrl);
      const result = await runContextSync(root, configDir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /conflict/i);
    });

    assert.equal(
      fs.readFileSync(path.join(root, "team_context", "team-profile.md"), "utf-8"),
      serverContent,
    );
    const conflictCopies = listConflictCopies(root);
    assert.equal(conflictCopies.length, 1);
    assert.equal(
      fs.readFileSync(path.join(root, ".AI-OS", "context-sync", "conflicts", conflictCopies[0]), "utf-8"),
      localEdit,
    );
  } finally {
    rmDir(root);
    rmDir(configDir);
  }
});

test("pullTeamDocs: local edit after a prior sync is detected as a conflict, not silently clobbered", async () => {
  const root = tempRoot();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-context-sync-cfg-"));
  try {
    const synced = "# Team profile\n\nBaseline.\n";
    const edited = "# Team profile\n\nEdited locally after sync.\n";
    const serverV2 = "# Team profile\n\nServer moved on too.\n";
    fs.mkdirSync(path.join(root, "team_context"), { recursive: true });
    fs.writeFileSync(path.join(root, "team_context", "team-profile.md"), synced);

    // Establish a synced baseline.
    let server = contextServer({
      teamDocs: [{ path: "team_context/team-profile.md", content: synced, sha256: sha256(synced) }],
    });
    await withHttpServer(server.handler, async (apiUrl) => {
      writeTeamContext(configDir, apiUrl);
      const result = await runContextSync(root, configDir);
      assert.equal(result.status, 0, result.stderr);
    });

    // Local edits after the sync, server also moves on independently.
    fs.writeFileSync(path.join(root, "team_context", "team-profile.md"), edited);
    server = contextServer({
      teamDocs: [{ path: "team_context/team-profile.md", content: serverV2, sha256: sha256(serverV2) }],
    });
    await withHttpServer(server.handler, async (apiUrl) => {
      writeTeamContext(configDir, apiUrl);
      const result = await runContextSync(root, configDir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /conflict/i);
    });

    assert.equal(
      fs.readFileSync(path.join(root, "team_context", "team-profile.md"), "utf-8"),
      serverV2,
    );
    const conflictCopies = listConflictCopies(root);
    assert.equal(conflictCopies.length, 1);
    assert.equal(
      fs.readFileSync(path.join(root, ".AI-OS", "context-sync", "conflicts", conflictCopies[0]), "utf-8"),
      edited,
    );
  } finally {
    rmDir(root);
    rmDir(configDir);
  }
});
