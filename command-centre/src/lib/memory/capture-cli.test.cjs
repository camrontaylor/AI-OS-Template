const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const { loadIdentityModules } = require("../../../scripts/load-identity-modules.cjs");
const { loadMemoryModules } = require("../../../scripts/load-memory-modules.cjs");

const execFileAsync = promisify(execFile);
const COMMAND_CENTRE_ROOT = path.resolve(__dirname, "../../..");
const CAPTURE_SCRIPT = path.join(COMMAND_CENTRE_ROOT, "scripts", "memory-capture.cjs");
const REINDEX_SCRIPT = path.join(COMMAND_CENTRE_ROOT, "scripts", "memory-reindex.cjs");
const EMBED_DIM = 1024;

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-cli-"));
  fs.mkdirSync(path.join(root, "context", "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "context", "memory", "2026-06-01.md"),
    "# Capture\n\nPrivate hosted capture safety note.",
    "utf-8",
  );
  return root;
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeTranscript(dir, entries) {
  const file = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf-8");
  return file;
}

async function withHttpServer(handler, fn) {
  const server = http.createServer(handler);
  server.keepAliveTimeout = 0;
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runCapture(root, args = [], env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [CAPTURE_SCRIPT, ...args], {
      cwd: COMMAND_CENTRE_ROOT,
      env: {
        ...process.env,
        AI_OS_DIR: root,
        AI_OS_TEAM_CONFIG_DIR: path.join(root, ".AI-OS-test-team"),
        MEMORY_DATABASE_URL: "",
        DATABASE_URL: "",
        MEMORY_STORE_BACKEND: "pglite",
        MEMORY_EMBEDDER: "hash",
        TEAM_OS_MEMORY_TEST_EMBEDDER: "hash",
        MEMORY_CONSOLIDATE_AFTER_CAPTURE: "0",
        ...env,
      },
      windowsHide: true,
      timeout: 120000,
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

async function runLocalReindex(root, args = []) {
  try {
    const result = await execFileAsync(process.execPath, [REINDEX_SCRIPT, "--allow-local", ...args], {
      cwd: COMMAND_CENTRE_ROOT,
      env: {
        ...process.env,
        AI_OS_DIR: root,
        MEMORY_DATABASE_URL: "",
        DATABASE_URL: "",
        MEMORY_STORE_BACKEND: "pglite",
        MEMORY_EMBEDDER: "hash",
      },
      windowsHide: true,
      timeout: 120000,
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

async function seedIdentity(root, { clientAccess = null } = {}) {
  const dataDir = path.join(root, ".command-centre", "memory");
  fs.mkdirSync(dataDir, { recursive: true });
  const identityModules = loadIdentityModules();
  const identityStore = await identityModules.store.openIdentityStore({
    backend: "pglite",
    dataDir,
  });
  try {
    const team = await identityStore.createTeam({ slug: "demo", name: "Demo Team" });
    const user = await identityStore.upsertUser({ email: "member@example.com" });
    await identityStore.upsertMembership({
      teamId: team.id,
      userId: user.id,
      role: "member",
      status: "active",
    });
    let client = null;
    if (clientAccess) {
      client = await identityStore.upsertClient({
        teamId: team.id,
        slug: "acme",
        name: "Acme",
      });
      await identityStore.grantClientAccess({
        teamId: team.id,
        clientId: client.id,
        userId: user.id,
        access: clientAccess,
      });
    }
    return { team, user, client };
  } finally {
    await identityStore.close();
  }
}

async function readMemorySources(root) {
  const dataDir = path.join(root, ".command-centre", "memory");
  const memoryModules = loadMemoryModules({ withCapture: false });
  const memoryStore = await memoryModules.store.openMemoryStore({
    dataDir,
    embedDim: EMBED_DIM,
  });
  try {
    const result = await memoryStore.client.query(
      `SELECT source_path, team_id, client_id, user_id, visibility
         FROM memory_sources
        WHERE source_path = $1`,
      ["context/memory/2026-06-01.md"],
    );
    return result.rows;
  } finally {
    await memoryStore.close();
  }
}

async function readClientIndexState(root, clientId) {
  const dataDir = path.join(root, ".command-centre", "memory");
  const memoryModules = loadMemoryModules({ withCapture: false });
  const memoryStore = await memoryModules.store.openMemoryStore({
    dataDir,
    embedDim: EMBED_DIM,
  });
  try {
    const result = await memoryStore.client.query(
      `SELECT s.id, s.source_path, s.team_id, s.client_id, s.user_id, s.visibility,
              COUNT(c.id)::int AS chunk_count
         FROM memory_sources s
         LEFT JOIN memory_chunks c ON c.source_id = s.id
        WHERE s.visibility = 'client' AND s.client_id = $1
        GROUP BY s.id, s.source_path, s.team_id, s.client_id, s.user_id, s.visibility
        ORDER BY s.source_path ASC`,
      [clientId],
    );
    return result.rows;
  } finally {
    await memoryStore.close();
  }
}

async function readCaptureEvents(root) {
  const dataDir = path.join(root, ".command-centre", "memory");
  const memoryModules = loadMemoryModules({ withCapture: false });
  const memoryStore = await memoryModules.store.openMemoryStore({
    dataDir,
    embedDim: EMBED_DIM,
  });
  try {
    const result = await memoryStore.client.query(
      `SELECT team_id, client_id, actor_user_id, visibility, session_id,
              source_hash, sync_status, status
         FROM memory_capture_events
        ORDER BY created_at ASC`,
    );
    return result.rows;
  } finally {
    await memoryStore.close();
  }
}

async function readOutboxRows(root) {
  const dataDir = path.join(root, ".command-centre", "memory");
  const memoryModules = loadMemoryModules({ withCapture: false });
  const memoryStore = await memoryModules.store.openMemoryStore({
    dataDir,
    embedDim: EMBED_DIM,
  });
  try {
    const result = await memoryStore.client.query(
      `SELECT operation, team_id, client_id, actor_user_id, visibility,
              source_path, source_hash, content_sha256, request_path, request_body,
              status, attempts, last_error
         FROM memory_sync_outbox
        ORDER BY created_at ASC`,
    );
    return result.rows;
  } finally {
    await memoryStore.close();
  }
}

async function insertLegacyPendingCapture(root, overrides = {}) {
  const dataDir = path.join(root, ".command-centre", "memory");
  const memoryModules = loadMemoryModules({ withCapture: false });
  const memoryStore = await memoryModules.store.openMemoryStore({
    dataDir,
    embedDim: EMBED_DIM,
  });
  const content = overrides.content || "LEGACY_OFFLINE_CAPTURE_TOKEN";
  try {
    await memoryStore.client.query(
      `INSERT INTO memory_capture_events
         (team_id, client_id, actor_user_id, visibility, session_id, source_hash,
          source_path, source_type, title, content_date, content, content_sha256,
          byte_size, status, sync_status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'session', $8, $9::date, $10, $11,
               $12, 'pending', $13, '{}'::jsonb)`,
      [
        overrides.teamId || "team-api",
        overrides.clientId || null,
        overrides.actorUserId || "user-api",
        overrides.visibility || "team",
        overrides.sessionId || "legacy-session",
        overrides.sourceHash || "legacy-source-hash",
        overrides.sourcePath || "context/memory/2026-06-01.aos.md#session-legacy",
        overrides.title || "Legacy capture",
        overrides.contentDate || "2026-06-01",
        content,
        require("node:crypto").createHash("sha256").update(content).digest("hex"),
        Buffer.byteLength(content),
        overrides.syncStatus || "local_pending",
      ],
    );
  } finally {
    await memoryStore.close();
  }
}

function asJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

test("hosted memory capture fails closed without user context and blocks system scope", async () => {
  const root = tempRoot();
  try {
    const missing = await runCapture(root, ["--embedder", "hash", "--force"], {
      TEAM_OS_HOSTED_MODE: "1",
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /requires team and user context/);

    const system = await runCapture(root, ["--embedder", "hash", "--force", "--visibility", "system"], {
      TEAM_OS_HOSTED_MODE: "1",
      MEMORY_CAPTURE_TEAM_ID: "team-1",
      MEMORY_CAPTURE_USER_ID: "user-1",
    });
    assert.equal(system.status, 1);
    assert.match(system.stderr, /refuses shared system scope by default/);
  } finally {
    rmDir(root);
  }
});

test("hosted private capture indexes under the authenticated team and user", async () => {
  const root = tempRoot();
  try {
    const { team, user } = await seedIdentity(root);
    const result = await runCapture(root, ["--embedder", "hash", "--force", "--debounce", "0"], {
      TEAM_OS_HOSTED_MODE: "1",
      MEMORY_CAPTURE_TEAM_ID: "demo",
      MEMORY_CAPTURE_USER_ID: "member@example.com",
    });
    assert.equal(result.status, 0, result.stderr);

    const rows = await readMemorySources(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].team_id, team.id);
    assert.equal(rows[0].user_id, user.id);
    assert.equal(rows[0].client_id, null);
    assert.equal(rows[0].visibility, "private");
  } finally {
    rmDir(root);
  }
});

test("hosted client capture requires write access", async () => {
  const root = tempRoot();
  try {
    fs.mkdirSync(path.join(root, "clients", "acme"), { recursive: true });
    await seedIdentity(root, { clientAccess: "read" });
    const result = await runCapture(root, [
      "--embedder",
      "hash",
      "--force",
      "--cwd",
      path.join(root, "clients", "acme"),
    ], {
      TEAM_OS_HOSTED_MODE: "1",
      MEMORY_CAPTURE_TEAM_ID: "demo",
      MEMORY_CAPTURE_USER_ID: "member@example.com",
      MEMORY_CAPTURE_VISIBILITY: "client",
      MEMORY_CAPTURE_CLIENT_ID: "acme",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires write access to the client/);
  } finally {
    rmDir(root);
  }
});

test("hosted client capture requires cwd under the matching client folder", async () => {
  const root = tempRoot();
  try {
    fs.mkdirSync(path.join(root, "clients", "acme"), { recursive: true });
    fs.mkdirSync(path.join(root, "clients", "globex"), { recursive: true });
    await seedIdentity(root, { clientAccess: "write" });

    const missingCwd = await runCapture(root, ["--embedder", "hash", "--force"], {
      TEAM_OS_HOSTED_MODE: "1",
      MEMORY_CAPTURE_TEAM_ID: "demo",
      MEMORY_CAPTURE_USER_ID: "member@example.com",
      MEMORY_CAPTURE_VISIBILITY: "client",
      MEMORY_CAPTURE_CLIENT_ID: "acme",
    });
    assert.equal(missingCwd.status, 1);
    assert.match(missingCwd.stderr, /requires --cwd under clients\/\{slug\}/);

    const mismatchedCwd = await runCapture(root, [
      "--embedder",
      "hash",
      "--force",
      "--cwd",
      path.join(root, "clients", "globex"),
    ], {
      TEAM_OS_HOSTED_MODE: "1",
      MEMORY_CAPTURE_TEAM_ID: "demo",
      MEMORY_CAPTURE_USER_ID: "member@example.com",
      MEMORY_CAPTURE_VISIBILITY: "client",
      MEMORY_CAPTURE_CLIENT_ID: "acme",
    });
    assert.equal(mismatchedCwd.status, 1);
    assert.match(mismatchedCwd.stderr, /cwd client must match the requested client/);
  } finally {
    rmDir(root);
  }
});

test("setup client capture arguments create one idempotent local client index", async () => {
  const root = tempRoot();
  const clientDir = path.join(root, "clients", "acme");
  try {
    fs.mkdirSync(path.join(clientDir, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(clientDir, "context", "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(clientDir, "context", "memory", "2026-06-02.md"),
      "# Acme\n\nClient-only setup memory.",
      "utf-8",
    );

    const setupArgs = [
      "--reason",
      "refresh",
      "--force",
      "--cwd",
      clientDir,
      "--workspace",
      clientDir,
      "--visibility",
      "client",
      "--client",
      "acme",
    ];
    const first = await runCapture(root, setupArgs);
    assert.equal(first.status, 0, first.stderr);

    const firstRows = await readClientIndexState(root, "acme");
    assert.equal(firstRows.length, 1);
    assert.equal(firstRows[0].source_path, "context/memory/2026-06-02.md");
    assert.equal(firstRows[0].team_id, null);
    assert.equal(firstRows[0].client_id, "acme");
    assert.equal(firstRows[0].user_id, null);
    assert.equal(firstRows[0].visibility, "client");
    assert.ok(Number(firstRows[0].chunk_count) > 0);

    const second = await runCapture(root, setupArgs);
    assert.equal(second.status, 0, second.stderr);

    const secondRows = await readClientIndexState(root, "acme");
    assert.equal(secondRows.length, 1);
    assert.equal(secondRows[0].id, firstRows[0].id);
    assert.equal(Number(secondRows[0].chunk_count), Number(firstRows[0].chunk_count));
  } finally {
    rmDir(root);
  }
});

test("saved Team OS login stages the captured session block in the Team OS API automatically", async () => {
  const root = tempRoot();
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-transcript-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-config-"));
  try {
    fs.writeFileSync(
      path.join(root, "context", "memory-config.json"),
      JSON.stringify({ capture: { summarize: { enabled: false, provider: "none" } } }),
      "utf-8",
    );
    const transcript = writeTranscript(transcriptDir, [
      {
        type: "user",
        uuid: "u-api",
        message: { role: "user", content: "remember API_INGEST_CAPTURE_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-api",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "API_INGEST_CAPTURE_TOKEN" }],
        },
      },
    ]);

    const captures = [];
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        if (req.headers.authorization !== "Bearer saved-token") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "unauthorized" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          team: { id: "team-api", slug: "demo" },
          user: { id: "user-api", email: "member@example.com" },
          membership: { role: "member", status: "active" },
        }));
        return;
      }
      if (req.url === "/v1/memory/captures" && req.method === "POST") {
        if (req.headers.authorization !== "Bearer saved-token") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "unauthorized" } }));
          return;
        }
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          captures.push(JSON.parse(raw));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ capture: { id: "capture-api", status: "pending" } }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      fs.writeFileSync(
        path.join(configDir, "team-context.json"),
        JSON.stringify({
          version: 2,
          apiUrl,
          token: "saved-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      const result = await runCapture(root, [
        "--session",
        "--session-id",
        "api-session",
        "--transcript",
        transcript,
        "--team-context-auto",
      ], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        MEMORY_STORE_BACKEND: "",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /staged Team OS capture/);
    });

    assert.equal(captures.length, 1);
    assert.equal(captures[0].scope.visibility, "team");
    assert.equal(captures[0].scope.teamId, "team-api");
    assert.equal(captures[0].scope.userId, null);
    assert.equal(captures[0].sourceType, "session");
    assert.match(captures[0].sourcePath, /^context\/memory\/\d{4}-\d{2}-\d{2}\.aos\.md#session-api-session-/);
    assert.match(captures[0].content, /API_INGEST_CAPTURE_TOKEN/);
    assert.equal(captures[0].embeddingModel, undefined);
    assert.equal(captures[0].chunks, undefined);
  } finally {
    rmDir(root);
    rmDir(transcriptDir);
    rmDir(configDir);
  }
});

test("explicit private capture while signed in ingests directly and never stages", async () => {
  const root = tempRoot();
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-private-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-private-config-"));
  try {
    fs.writeFileSync(
      path.join(root, "context", "memory-config.json"),
      JSON.stringify({ capture: { summarize: { enabled: false, provider: "none" } } }),
      "utf-8",
    );
    const transcript = writeTranscript(transcriptDir, [
      {
        type: "user",
        uuid: "u-private",
        message: { role: "user", content: "remember PRIVATE_EXPLICIT_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-private",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "PRIVATE_EXPLICIT_TOKEN" }],
        },
      },
    ]);

    const captures = [];
    const ingests = [];
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          team: { id: "team-api", slug: "demo" },
          user: { id: "user-api", email: "member@example.com" },
          membership: { role: "member", status: "active" },
        }));
        return;
      }
      if (req.url === "/v1/memory/captures" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          captures.push(JSON.parse(raw));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ capture: { id: "capture-should-not-happen", status: "pending" } }));
        });
        return;
      }
      if (req.url === "/v1/memory/ingest" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          ingests.push(JSON.parse(raw));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sourceId: "source-private", chunksInserted: 1 }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      fs.writeFileSync(
        path.join(configDir, "team-context.json"),
        JSON.stringify({
          version: 2,
          apiUrl,
          token: "saved-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      const result = await runCapture(root, [
        "--session",
        "--session-id",
        "private-session",
        "--transcript",
        transcript,
        "--team-context-auto",
        "--visibility",
        "private",
      ], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        MEMORY_STORE_BACKEND: "",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Team OS API ingested \d+ chunks/);
      assert.doesNotMatch(result.stdout, /staged Team OS capture/);
    });

    assert.equal(captures.length, 0);
    assert.equal(ingests.length, 1);
    assert.equal(ingests[0].scope.visibility, "private");
    assert.equal(ingests[0].scope.teamId, "team-api");
    assert.equal(ingests[0].scope.userId, "user-api");
    assert.equal(ingests[0].scope.clientId, null);
    assert.match(ingests[0].content, /PRIVATE_EXPLICIT_TOKEN/);
  } finally {
    rmDir(root);
    rmDir(transcriptDir);
    rmDir(configDir);
  }
});

test("offline explicit private capture queues an ingest outbox item and drains on the next online capture", async () => {
  const root = tempRoot();
  const offlineTranscriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-private-offline-"));
  const onlineTranscriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-private-online-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-private-sync-config-"));
  try {
    fs.writeFileSync(
      path.join(root, "context", "memory-config.json"),
      JSON.stringify({ capture: { summarize: { enabled: false, provider: "none" } } }),
      "utf-8",
    );
    const offlineTranscript = writeTranscript(offlineTranscriptDir, [
      {
        type: "user",
        uuid: "u-private-offline",
        message: { role: "user", content: "remember PRIVATE_OFFLINE_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-private-offline",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "PRIVATE_OFFLINE_TOKEN" }],
        },
      },
    ]);
    const onlineTranscript = writeTranscript(onlineTranscriptDir, [
      {
        type: "user",
        uuid: "u-private-online",
        message: { role: "user", content: "remember PRIVATE_ONLINE_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-private-online",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "PRIVATE_ONLINE_TOKEN" }],
        },
      },
    ]);

    const configPath = path.join(configDir, "team-context.json");
    const baseConfig = {
      version: 2,
      apiUrl: "http://127.0.0.1:1",
      token: "saved-token",
      savedAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      team: { id: "team-api", slug: "demo" },
      user: { id: "user-api", email: "member@example.com" },
      membership: { role: "member", status: "active" },
    };
    fs.writeFileSync(configPath, JSON.stringify(baseConfig), "utf-8");

    const offline = await runCapture(root, [
      "--session",
      "--session-id",
      "private-offline-session",
      "--transcript",
      offlineTranscript,
      "--team-context-auto",
      "--visibility",
      "private",
    ], {
      AI_OS_TEAM_CONFIG_DIR: configDir,
      MEMORY_STORE_BACKEND: "",
    });
    assert.equal(offline.status, 0, offline.stderr);
    assert.match(offline.stdout, /queued Team OS capture locally/);

    let outboxRows = await readOutboxRows(root);
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0].operation, "ingest");
    assert.equal(outboxRows[0].visibility, "private");
    assert.equal(outboxRows[0].client_id, null);
    assert.equal(outboxRows[0].request_path, "/v1/memory/ingest");
    const queuedBody = asJson(outboxRows[0].request_body);
    assert.equal(queuedBody.scope.visibility, "private");
    assert.match(queuedBody.content, /PRIVATE_OFFLINE_TOKEN/);

    const captures = [];
    const ingests = [];
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          team: baseConfig.team,
          user: baseConfig.user,
          membership: baseConfig.membership,
        }));
        return;
      }
      if (req.url === "/v1/memory/captures" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          captures.push(JSON.parse(raw));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ capture: { id: "capture-should-not-happen", status: "pending" } }));
        });
        return;
      }
      if (req.url === "/v1/memory/ingest" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          ingests.push(JSON.parse(raw));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sourceId: `source-${ingests.length}`, chunksInserted: 1 }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, apiUrl }), "utf-8");

      const online = await runCapture(root, [
        "--session",
        "--session-id",
        "private-online-session",
        "--transcript",
        onlineTranscript,
        "--team-context-auto",
        "--visibility",
        "private",
      ], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        MEMORY_STORE_BACKEND: "",
      });
      assert.equal(online.status, 0, online.stderr);
      assert.match(online.stdout, /offline queue sync 1 synced \/ 0 failed \/ 0 retrying/);
      assert.match(online.stdout, /Team OS API ingested \d+ chunks/);
    });

    assert.equal(captures.length, 0);
    assert.equal(ingests.length, 2);
    assert.match(ingests[0].content, /PRIVATE_OFFLINE_TOKEN/);
    assert.match(ingests[1].content, /PRIVATE_ONLINE_TOKEN/);
    assert.equal(ingests[0].scope.visibility, "private");
    assert.equal(ingests[1].scope.visibility, "private");

    outboxRows = await readOutboxRows(root);
    assert.equal(outboxRows.length, 0);
  } finally {
    rmDir(root);
    rmDir(offlineTranscriptDir);
    rmDir(onlineTranscriptDir);
    rmDir(configDir);
  }
});

test("offline Team OS capture queues locally and syncs on the next online capture", async () => {
  const root = tempRoot();
  const offlineTranscriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-offline-"));
  const onlineTranscriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-online-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-sync-config-"));
  try {
    fs.writeFileSync(
      path.join(root, "context", "memory-config.json"),
      JSON.stringify({ capture: { summarize: { enabled: false, provider: "none" } } }),
      "utf-8",
    );
    const offlineTranscript = writeTranscript(offlineTranscriptDir, [
      {
        type: "user",
        uuid: "u-offline",
        message: { role: "user", content: "remember OFFLINE_CAPTURE_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-offline",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "OFFLINE_CAPTURE_TOKEN" }],
        },
      },
    ]);
    const onlineTranscript = writeTranscript(onlineTranscriptDir, [
      {
        type: "user",
        uuid: "u-online",
        message: { role: "user", content: "remember ONLINE_CAPTURE_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-online",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ONLINE_CAPTURE_TOKEN" }],
        },
      },
    ]);

    const configPath = path.join(configDir, "team-context.json");
    const baseConfig = {
      version: 2,
      apiUrl: "http://127.0.0.1:1",
      token: "saved-token",
      savedAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      team: { id: "team-api", slug: "demo" },
      user: { id: "user-api", email: "member@example.com" },
      membership: { role: "member", status: "active" },
    };
    fs.writeFileSync(configPath, JSON.stringify(baseConfig), "utf-8");

    const offline = await runCapture(root, [
      "--session",
      "--session-id",
      "offline-session",
      "--transcript",
      offlineTranscript,
      "--team-context-auto",
    ], {
      AI_OS_TEAM_CONFIG_DIR: configDir,
      MEMORY_STORE_BACKEND: "",
    });
    assert.equal(offline.status, 0, offline.stderr);
    assert.match(offline.stdout, /queued Team OS capture locally/);

    let rows = await readCaptureEvents(root);
    assert.equal(rows.length, 0);
    let outboxRows = await readOutboxRows(root);
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0].operation, "capture_create");
    assert.equal(outboxRows[0].team_id, "team-api");
    assert.equal(outboxRows[0].actor_user_id, "user-api");
    assert.equal(outboxRows[0].visibility, "team");
    assert.equal(outboxRows[0].request_path, "/v1/memory/captures");
    assert.equal(outboxRows[0].status, "queued");
    assert.match(asJson(outboxRows[0].request_body).content, /OFFLINE_CAPTURE_TOKEN/);

    const captures = [];
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        if (req.headers.authorization !== "Bearer saved-token") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "unauthorized" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          team: baseConfig.team,
          user: baseConfig.user,
          membership: baseConfig.membership,
        }));
        return;
      }
      if (req.url === "/v1/memory/captures" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          captures.push(JSON.parse(raw));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ capture: { id: `capture-${captures.length}`, status: "pending" } }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, apiUrl }), "utf-8");

      const online = await runCapture(root, [
        "--session",
        "--session-id",
        "online-session",
        "--transcript",
        onlineTranscript,
        "--team-context-auto",
      ], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        MEMORY_STORE_BACKEND: "",
      });
      assert.equal(online.status, 0, online.stderr);
      assert.match(online.stdout, /offline queue sync 1 synced \/ 0 failed \/ 0 retrying/);
      assert.match(online.stdout, /staged Team OS capture/);
    });

    assert.equal(captures.length, 2);
    assert.match(captures[0].content, /OFFLINE_CAPTURE_TOKEN/);
    assert.match(captures[1].content, /ONLINE_CAPTURE_TOKEN/);

    rows = await readCaptureEvents(root);
    assert.equal(rows.length, 0);
    outboxRows = await readOutboxRows(root);
    assert.equal(outboxRows.length, 0);
  } finally {
    rmDir(root);
    rmDir(offlineTranscriptDir);
    rmDir(onlineTranscriptDir);
    rmDir(configDir);
  }
});

test("legacy local pending capture rows sync once and are deleted", async () => {
  const root = tempRoot();
  const onlineTranscriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-legacy-online-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-legacy-config-"));
  try {
    fs.writeFileSync(
      path.join(root, "context", "memory-config.json"),
      JSON.stringify({ capture: { summarize: { enabled: false, provider: "none" } } }),
      "utf-8",
    );
    const onlineTranscript = writeTranscript(onlineTranscriptDir, [
      {
        type: "user",
        uuid: "u-legacy-online",
        message: { role: "user", content: "remember LEGACY_ONLINE_CAPTURE_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-legacy-online",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "LEGACY_ONLINE_CAPTURE_TOKEN" }],
        },
      },
    ]);

    const configPath = path.join(configDir, "team-context.json");
    const baseConfig = {
      version: 2,
      apiUrl: "http://127.0.0.1:1",
      token: "saved-token",
      savedAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      team: { id: "team-api", slug: "demo" },
      user: { id: "user-api", email: "member@example.com" },
      membership: { role: "member", status: "active" },
    };
    fs.writeFileSync(configPath, JSON.stringify(baseConfig), "utf-8");
    await insertLegacyPendingCapture(root);

    let rows = await readCaptureEvents(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sync_status, "local_pending");

    const captures = [];
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          team: baseConfig.team,
          user: baseConfig.user,
          membership: baseConfig.membership,
        }));
        return;
      }
      if (req.url === "/v1/memory/captures" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          captures.push(JSON.parse(raw));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ capture: { id: `capture-${captures.length}`, status: "pending" } }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, apiUrl }), "utf-8");

      const online = await runCapture(root, [
        "--session",
        "--session-id",
        "legacy-online-session",
        "--transcript",
        onlineTranscript,
        "--team-context-auto",
      ], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        MEMORY_STORE_BACKEND: "",
      });
      assert.equal(online.status, 0, online.stderr);
      assert.match(online.stdout, /offline queue sync 1 synced \/ 0 failed \/ 0 retrying/);
      assert.match(online.stdout, /staged Team OS capture/);
    });

    assert.equal(captures.length, 2);
    assert.match(captures[0].content, /LEGACY_OFFLINE_CAPTURE_TOKEN/);
    assert.match(captures[1].content, /LEGACY_ONLINE_CAPTURE_TOKEN/);

    rows = await readCaptureEvents(root);
    assert.equal(rows.length, 0);
  } finally {
    rmDir(root);
    rmDir(onlineTranscriptDir);
    rmDir(configDir);
  }
});

test("offline direct Team OS ingest queues locally and drains to ingest API", async () => {
  const root = tempRoot();
  const offlineTranscriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-ingest-offline-"));
  const onlineTranscriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-ingest-online-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-ingest-config-"));
  try {
    fs.writeFileSync(
      path.join(root, "context", "memory-config.json"),
      JSON.stringify({ capture: { summarize: { enabled: false, provider: "none" } } }),
      "utf-8",
    );
    const offlineTranscript = writeTranscript(offlineTranscriptDir, [
      {
        type: "user",
        uuid: "u-ingest-offline",
        message: { role: "user", content: "remember OFFLINE_DIRECT_INGEST_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-ingest-offline",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "OFFLINE_DIRECT_INGEST_TOKEN" }],
        },
      },
    ]);
    const onlineTranscript = writeTranscript(onlineTranscriptDir, [
      {
        type: "user",
        uuid: "u-ingest-online",
        message: { role: "user", content: "remember ONLINE_DIRECT_INGEST_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-ingest-online",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ONLINE_DIRECT_INGEST_TOKEN" }],
        },
      },
    ]);

    const configPath = path.join(configDir, "team-context.json");
    const baseConfig = {
      version: 2,
      apiUrl: "http://127.0.0.1:1",
      token: "saved-token",
      savedAt: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      team: { id: "team-api", slug: "demo" },
      user: { id: "user-api", email: "owner@example.com" },
      membership: { role: "owner", status: "active" },
    };
    fs.writeFileSync(configPath, JSON.stringify(baseConfig), "utf-8");

    const offline = await runCapture(root, [
      "--session",
      "--session-id",
      "offline-ingest-session",
      "--transcript",
      offlineTranscript,
      "--team-context-auto",
      "--api-ingest",
    ], {
      AI_OS_TEAM_CONFIG_DIR: configDir,
      MEMORY_STORE_BACKEND: "",
    });
    assert.equal(offline.status, 0, offline.stderr);
    assert.match(offline.stdout, /queued Team OS capture locally/);

    let outboxRows = await readOutboxRows(root);
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0].operation, "ingest");
    assert.equal(outboxRows[0].request_path, "/v1/memory/ingest");
    const queuedBody = asJson(outboxRows[0].request_body);
    assert.equal(queuedBody.embeddingModel, "bge-m3");
    assert.equal(queuedBody.embeddingDim, 1024);
    assert.ok(Array.isArray(queuedBody.chunks));
    assert.match(queuedBody.content, /OFFLINE_DIRECT_INGEST_TOKEN/);

    const ingests = [];
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          team: baseConfig.team,
          user: baseConfig.user,
          membership: baseConfig.membership,
        }));
        return;
      }
      if (req.url === "/v1/memory/ingest" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          const body = JSON.parse(raw);
          assert.equal(body.embeddingDim, 1024);
          assert.ok(Array.isArray(body.chunks));
          ingests.push(body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sourceId: `source-${ingests.length}`, chunksInserted: 1 }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, apiUrl }), "utf-8");

      const online = await runCapture(root, [
        "--session",
        "--session-id",
        "online-ingest-session",
        "--transcript",
        onlineTranscript,
        "--team-context-auto",
        "--api-ingest",
      ], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        MEMORY_STORE_BACKEND: "",
      });
      assert.equal(online.status, 0, online.stderr);
      assert.match(online.stdout, /offline queue sync 1 synced \/ 0 failed \/ 0 retrying/);
      assert.match(online.stdout, /Team OS API ingested 1 chunks/);
    });

    assert.equal(ingests.length, 2);
    assert.match(ingests[0].content, /OFFLINE_DIRECT_INGEST_TOKEN/);
    assert.match(ingests[1].content, /ONLINE_DIRECT_INGEST_TOKEN/);

    outboxRows = await readOutboxRows(root);
    assert.equal(outboxRows.length, 0);
  } finally {
    rmDir(root);
    rmDir(offlineTranscriptDir);
    rmDir(onlineTranscriptDir);
    rmDir(configDir);
  }
});

test("offline Team OS capture refuses saved login without a recent savedAt", async () => {
  const root = tempRoot();
  const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-stale-offline-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-stale-config-"));
  try {
    fs.writeFileSync(
      path.join(root, "context", "memory-config.json"),
      JSON.stringify({ capture: { summarize: { enabled: false, provider: "none" } } }),
      "utf-8",
    );
    const transcript = writeTranscript(transcriptDir, [
      {
        type: "user",
        uuid: "u-stale",
        message: { role: "user", content: "remember STALE_OFFLINE_TOKEN" },
      },
      {
        type: "assistant",
        uuid: "a-stale",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "STALE_OFFLINE_TOKEN" }],
        },
      },
    ]);
    fs.writeFileSync(
      path.join(configDir, "team-context.json"),
      JSON.stringify({
        version: 2,
        apiUrl: "http://127.0.0.1:1",
        token: "saved-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
        team: { id: "team-api", slug: "demo" },
        user: { id: "user-api", email: "member@example.com" },
        membership: { role: "member", status: "active" },
      }),
      "utf-8",
    );

    const result = await runCapture(root, [
      "--session",
      "--session-id",
      "stale-offline-session",
      "--transcript",
      transcript,
      "--team-context-auto",
    ], {
      AI_OS_TEAM_CONFIG_DIR: configDir,
      MEMORY_STORE_BACKEND: "",
    });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /queued Team OS capture locally/);

    const rows = await readCaptureEvents(root);
    assert.equal(rows.length, 0);
    const outboxRows = await readOutboxRows(root);
    assert.equal(outboxRows.length, 0);
  } finally {
    rmDir(root);
    rmDir(transcriptDir);
    rmDir(configDir);
  }
});

test("local capture can be forced even when Team OS login exists", async () => {
  const root = tempRoot();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cap-local-config-"));
  try {
    fs.writeFileSync(
      path.join(configDir, "team-context.json"),
      JSON.stringify({
        version: 2,
        apiUrl: "http://127.0.0.1:1",
        token: "saved-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
      "utf-8",
    );

    const result = await runCapture(root, [
      "--local",
      "--embedder",
      "hash",
      "--force",
      "--debounce",
      "0",
    ], {
      AI_OS_TEAM_CONFIG_DIR: configDir,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /memory-capture: indexed/);

    const rows = await readMemorySources(root);
    const identity = JSON.parse(
      fs.readFileSync(path.join(root, ".command-centre", "local-memory-user.json"), "utf8"),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].team_id, null);
    assert.equal(rows[0].user_id, identity.userId);
    assert.equal(rows[0].client_id, null);
    assert.equal(rows[0].visibility, "private");

    const rebuilt = await runLocalReindex(root, ["--force"]);
    assert.equal(rebuilt.status, 0, rebuilt.stderr);
    const rebuiltRows = await readMemorySources(root);
    assert.deepEqual(rebuiltRows, rows);
  } finally {
    rmDir(root);
    rmDir(configDir);
  }
});
