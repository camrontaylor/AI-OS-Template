const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

// The recall dispatcher. decideAndRun is dependency-injected, so we
// drive the decision with a fake `runPrimary` (returns a chosen
// { code, stdout, stderr }) and no real store. The contract is:
//   0 -> valid answer (even empty)       -> print
//   3 -> backend unavailable             -> propagate with setup guidance
//   1 -> scope / usage / isolation error -> propagate
const { decideAndRun, parseArgs } = require("../../../scripts/memory-recall.cjs");

const noop = () => {};
const execFileAsync = promisify(execFile);
const COMMAND_CENTRE_ROOT = path.resolve(__dirname, "../../..");
const RECALL_SCRIPT = path.join(COMMAND_CENTRE_ROOT, "scripts", "memory-recall.cjs");

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

function writeTeamConfig(configDir, apiUrl) {
  fs.mkdirSync(configDir, { recursive: true });
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
}

async function runRecall(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [RECALL_SCRIPT, ...args], {
      cwd: COMMAND_CENTRE_ROOT,
      env: {
        ...process.env,
        MEMORY_DATABASE_URL: "",
        DATABASE_URL: "",
        MEMORY_STORE_BACKEND: "pglite",
        MEMORY_EMBEDDER: "",
        TEAM_OS_MEMORY_MODE: "auto",
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

test("recall: a working backend prints results", () => {
  let primaryCalls = 0;
  const code = decideAndRun({
    flags: { query: "scope", passthrough: ["scope", "--system"] },
    env: {},
    runPrimary: () => {
      primaryCalls += 1;
      return { code: 0, stdout: "1. context/MEMORY.md\n", stderr: "" };
    },
    out: noop,
    err: noop,
  });
  assert.equal(code, 0);
  assert.equal(primaryCalls, 1);
});

test("recall: an unavailable backend (exit 3) propagates with setup guidance", () => {
  let warning = "";
  const code = decideAndRun({
    flags: { query: "scope", passthrough: ["scope", "--system"] },
    env: {},
    runPrimary: () => ({ code: 3, stdout: "", stderr: "memory-search failed: cannot open store\n" }),
    out: noop,
    err: (s) => {
      warning += s;
    },
  });
  assert.equal(code, 3);
  assert.match(warning, /setup-memory/);
});

test("recall: MEMORY_BACKEND=memsearch warns that the legacy backend was removed", () => {
  let primaryCalls = 0;
  let warning = "";
  const code = decideAndRun({
    flags: { query: "scope", passthrough: ["scope", "--system"] },
    env: { MEMORY_BACKEND: "memsearch" },
    runPrimary: () => {
      primaryCalls += 1;
      return { code: 0, stdout: "", stderr: "" };
    },
    out: noop,
    err: (s) => {
      warning += s;
    },
  });
  assert.equal(primaryCalls, 0, "the backend must not open for the removed legacy selector");
  assert.equal(code, 2);
  assert.match(warning, /removed/);
});

test("recall: --backend memsearch wins over MEMORY_BACKEND=pglite and errors", () => {
  let primaryCalls = 0;
  const code = decideAndRun({
    flags: { backend: "memsearch", query: "scope", passthrough: ["scope", "--system"] },
    env: { MEMORY_BACKEND: "pglite" },
    runPrimary: () => {
      primaryCalls += 1;
      return { code: 0, stdout: "", stderr: "" };
    },
    out: noop,
    err: noop,
  });
  assert.equal(primaryCalls, 0);
  assert.equal(code, 2, "the explicit flag wins over the env default but is no longer supported");
});

test("recall: a scope/usage error (exit 1) propagates", () => {
  const code = decideAndRun({
    flags: { query: "", passthrough: [] },
    env: {},
    runPrimary: () => ({ code: 1, stdout: "", stderr: "explicit search scope required\n" }),
    out: noop,
    err: noop,
  });
  assert.equal(code, 1, "the error code must propagate unchanged");
});

test("recall: an empty result from a working backend is passed through", () => {
  let printed = "";
  const code = decideAndRun({
    flags: { query: "nothing here", passthrough: ["nothing here", "--system"] },
    env: {},
    runPrimary: () => ({ code: 0, stdout: "  (no matches in scope)\n", stderr: "" }),
    out: (s) => {
      printed += s;
    },
    err: noop,
  });
  assert.equal(code, 0);
  assert.ok(printed.includes("no matches"), "the empty result reaches stdout");
});

test("recall: an invalid --backend value errors and runs nothing", () => {
  let primaryCalls = 0;
  const code = decideAndRun({
    flags: { backend: "milvus", query: "scope", passthrough: ["scope", "--system"] },
    env: {},
    runPrimary: () => {
      primaryCalls += 1;
      return { code: 0 };
    },
    out: noop,
    err: noop,
  });
  assert.equal(code, 1);
  assert.equal(primaryCalls, 0);
});

// -- parseArgs: rung selection ------------------------------------------------

test("parseArgs: defaults to the search rung when neither --expand nor --transcript is given", () => {
  const flags = parseArgs(["query text", "--system"]);
  assert.equal(flags.rung, "search");
  assert.equal(flags.rungChunkId, undefined);
  assert.equal(flags.bothGiven, false);
});

test("parseArgs: --embedding-mode is passed through to the search rung", () => {
  const flags = parseArgs(["query text", "--embedding-mode", "server"]);
  assert.equal(flags.rung, "search");
  assert.deepEqual(flags.passthrough, ["query text", "--embedding-mode", "server"]);
});

test("parseArgs: --expand <chunk-id> sets rung to expand and captures the chunk id", () => {
  const flags = parseArgs(["--expand", "chunk-123", "--system"]);
  assert.equal(flags.rung, "expand");
  assert.equal(flags.rungChunkId, "chunk-123");
  assert.equal(flags.bothGiven, false);
  assert.ok(!flags.passthrough.includes("--expand"));
  assert.ok(!flags.passthrough.includes("chunk-123"));
});

test("parseArgs: --transcript <chunk-id> sets rung to transcript and captures the chunk id", () => {
  const flags = parseArgs(["--transcript", "chunk-456", "--client", "acme"]);
  assert.equal(flags.rung, "transcript");
  assert.equal(flags.rungChunkId, "chunk-456");
  assert.equal(flags.bothGiven, false);
  assert.ok(!flags.passthrough.includes("--transcript"));
  assert.ok(!flags.passthrough.includes("chunk-456"));
});

test("parseArgs: both --expand and --transcript given sets bothGiven", () => {
  const flags = parseArgs(["--expand", "chunk-1", "--transcript", "chunk-2", "--system"]);
  assert.equal(flags.bothGiven, true);
});

test("decideAndRun: --expand and --transcript together is rejected as mutually exclusive (exit 1)", () => {
  let primaryCalls = 0;
  let warning = "";
  const code = decideAndRun({
    flags: { bothGiven: true, query: "", passthrough: [] },
    env: {},
    runPrimary: () => {
      primaryCalls += 1;
      return { code: 0, stdout: "", stderr: "" };
    },
    out: noop,
    err: (s) => {
      warning += s;
    },
  });
  assert.equal(code, 1);
  assert.equal(primaryCalls, 0, "runPrimary must not be called when both flags are given");
  assert.match(warning, /mutually exclusive/);
});

// -- Team OS routing ----------------------------------------------------------

test("recall: signed-in Team OS uses server-side embedding search when health enables it", async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-recall-team-server-"));
  try {
    let searchBody = null;
    let healthCalls = 0;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        assert.equal(req.headers.authorization, "Bearer saved-token");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          team: { id: "team-api", slug: "demo" },
          user: { id: "user-api", email: "member@example.com" },
          membership: { role: "member", status: "active" },
        }));
        return;
      }
      if (req.url === "/v1/health" && req.method === "GET") {
        healthCalls += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          backend: "postgres",
          embedder: {
            mode: "client-provided",
            model: "bge-m3",
            dim: 1024,
            serverModeEnabled: true,
          },
        }));
        return;
      }
      if (req.url === "/v1/memory/search" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          searchBody = JSON.parse(raw);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            visibilitySet: ["system", "team", "private"],
            latencyMs: 12,
            eventId: "event-team",
            results: [{
              chunkId: "chunk-1",
              sourceId: "source-1",
              sourcePath: "context/memory/team.md",
              sourceType: "memory",
              content: "Team OS remote result",
              score: 0.91,
              finalScore: 0.92,
            }],
          }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeTeamConfig(configDir, apiUrl);
      const result = await runRecall(["pricing", "--json"], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        TEAM_OS_MEMORY_TEST_EMBEDDER: "hash",
      });
      assert.equal(result.status, 0, result.stderr);
      const rows = JSON.parse(result.stdout);
      assert.equal(rows[0].content, "Team OS remote result");
    });

    assert.equal(healthCalls, 1);
    assert.equal(searchBody.query, "pricing");
    assert.equal(searchBody.embeddingMode, "server");
    assert.equal(searchBody.queryEmbedding, undefined);
    assert.equal(searchBody.embeddingModel, undefined);
    assert.deepEqual(searchBody.scope, {
      teamId: null,
      clientId: null,
      userId: null,
      include: ["system", "team", "private"],
    });
  } finally {
    rmDir(configDir);
  }
});

test("recall: signed-in Team OS falls back to client-provided embedding search", async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-recall-team-"));
  try {
    let searchBody = null;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        assert.equal(req.headers.authorization, "Bearer saved-token");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          team: { id: "team-api", slug: "demo" },
          user: { id: "user-api", email: "member@example.com" },
          membership: { role: "member", status: "active" },
        }));
        return;
      }
      if (req.url === "/v1/memory/search" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          searchBody = JSON.parse(raw);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            visibilitySet: ["system", "team", "private"],
            latencyMs: 12,
            eventId: "event-team",
            results: [{
              chunkId: "chunk-1",
              sourceId: "source-1",
              sourcePath: "context/memory/team.md",
              sourceType: "memory",
              content: "Team OS remote result",
              score: 0.91,
              finalScore: 0.92,
            }],
          }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeTeamConfig(configDir, apiUrl);
      const result = await runRecall(["pricing", "--json"], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        TEAM_OS_MEMORY_TEST_EMBEDDER: "hash",
      });
      assert.equal(result.status, 0, result.stderr);
      const rows = JSON.parse(result.stdout);
      assert.equal(rows[0].content, "Team OS remote result");
    });

    assert.equal(searchBody.query, "pricing");
    assert.equal(searchBody.embeddingMode, undefined);
    assert.equal(searchBody.embeddingModel, "bge-m3");
    assert.equal(searchBody.embeddingDim, 1024);
    assert.equal(searchBody.queryEmbedding.length, 1024);
    assert.deepEqual(searchBody.scope, {
      teamId: null,
      clientId: null,
      userId: null,
      include: ["system", "team", "private"],
    });
  } finally {
    rmDir(configDir);
  }
});

test("recall: --embedding-mode client keeps client-provided embeddings even when server mode is available", async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-recall-team-client-"));
  try {
    let searchBody = null;
    let healthCalls = 0;
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
      if (req.url === "/v1/health" && req.method === "GET") {
        healthCalls += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          embedder: { serverModeEnabled: true },
        }));
        return;
      }
      if (req.url === "/v1/memory/search" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          searchBody = JSON.parse(raw);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ results: [], visibilitySet: [], latencyMs: 1 }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeTeamConfig(configDir, apiUrl);
      const result = await runRecall(["pricing", "--json", "--embedding-mode", "client"], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        TEAM_OS_MEMORY_TEST_EMBEDDER: "hash",
      });
      assert.equal(result.status, 0, result.stderr);
    });

    assert.equal(healthCalls, 0);
    assert.equal(searchBody.embeddingMode, undefined);
    assert.equal(searchBody.embeddingModel, "bge-m3");
    assert.equal(searchBody.embeddingDim, 1024);
    assert.equal(searchBody.queryEmbedding.length, 1024);
  } finally {
    rmDir(configDir);
  }
});

test("recall: --embedding-mode server fails clearly when the server does not support it", async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-recall-team-server-disabled-"));
  try {
    let searchCalls = 0;
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
      if (req.url === "/v1/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          embedder: { serverModeEnabled: false },
        }));
        return;
      }
      if (req.url === "/v1/memory/search") searchCalls += 1;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeTeamConfig(configDir, apiUrl);
      const result = await runRecall(["pricing", "--embedding-mode", "server"], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        TEAM_OS_MEMORY_TEST_EMBEDDER: "hash",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Server-side search embeddings are not enabled/);
      assert.match(result.stderr, /MEMORY_API_SERVER_EMBEDDINGS=1/);
    });

    assert.equal(searchCalls, 0);
  } finally {
    rmDir(configDir);
  }
});

test("recall: signed-in Team OS uses hosted memory expand", async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-recall-expand-"));
  try {
    let expandBody = null;
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
      if (req.url === "/v1/memory/expand" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk.toString(); });
        req.on("end", () => {
          expandBody = JSON.parse(raw);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            expansion: {
              anchorChunkId: "chunk-remote",
              sourceId: "source-remote",
              sourcePath: "context/memory/team.md",
              sourceType: "memory",
              heading: "Team",
              fromIndex: 0,
              toIndex: 1,
              startLine: 1,
              endLine: 8,
              hasLineProvenance: true,
              chunkIds: ["chunk-remote", "chunk-next"],
              content: "Remote expanded context",
              truncated: false,
            },
          }));
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeTeamConfig(configDir, apiUrl);
      const result = await runRecall(["--expand", "chunk-remote", "--radius", "1", "--json"], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
      });
      assert.equal(result.status, 0, result.stderr);
      const expansion = JSON.parse(result.stdout);
      assert.equal(expansion.content, "Remote expanded context");
    });

    assert.equal(expandBody.chunkId, "chunk-remote");
    assert.equal(expandBody.radius, 1);
    assert.deepEqual(expandBody.scope, {
      teamId: null,
      clientId: null,
      userId: null,
      include: ["system", "team", "private"],
    });
  } finally {
    rmDir(configDir);
  }
});

test("recall: signed-in Team OS unavailable does not fall back to local PGLite", async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-recall-down-"));
  try {
    let searchCalls = 0;
    await withHttpServer(async (req, res) => {
      if (req.url === "/v1/team/whoami" && req.method === "GET") {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "server unavailable" } }));
        return;
      }
      if (req.url === "/v1/memory/search") searchCalls += 1;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeTeamConfig(configDir, apiUrl);
      const result = await runRecall(["pricing", "--json"], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        TEAM_OS_MEMORY_TEST_EMBEDDER: "hash",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /refusing to use local PGLite silently/);
    });
    assert.equal(searchCalls, 0);
  } finally {
    rmDir(configDir);
  }
});

test("recall: --local forces local backend even when Team OS login exists", () => {
  let primaryCalls = 0;
  let warning = "";
  const code = decideAndRun({
    flags: { local: true, query: "scope", passthrough: ["scope", "--local"] },
    env: { MEMORY_BACKEND: "memsearch" },
    hasTeamLogin: () => true,
    runPrimary: () => {
      primaryCalls += 1;
      return { code: 0, stdout: "", stderr: "" };
    },
    out: noop,
    err: (s) => { warning += s; },
  });
  assert.equal(code, 2);
  assert.equal(primaryCalls, 0);
  assert.match(warning, /legacy memsearch backend has been removed/);
});

test("recall: --embedder hash is rejected in Team OS mode", async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-recall-hash-"));
  try {
    let searchCalls = 0;
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
      if (req.url === "/v1/memory/search") searchCalls += 1;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }, async (apiUrl) => {
      writeTeamConfig(configDir, apiUrl);
      const result = await runRecall(["pricing", "--embedder", "hash"], {
        AI_OS_TEAM_CONFIG_DIR: configDir,
        TEAM_OS_MEMORY_TEST_EMBEDDER: "",
        MEMORY_EMBEDDER: "",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /requires client-provided BGE-M3\/1024/);
    });
    assert.equal(searchCalls, 0);
  } finally {
    rmDir(configDir);
  }
});

test("recall: remote transcript rung is rejected with local-only guidance", () => {
  let primaryCalls = 0;
  let warning = "";
  const code = decideAndRun({
    flags: {
      rung: "transcript",
      rungChunkId: "chunk-456",
      query: "",
      passthrough: ["--client", "acme"],
    },
    env: {},
    hasTeamLogin: () => true,
    runPrimary: () => {
      primaryCalls += 1;
      return { code: 0, stdout: "", stderr: "" };
    },
    out: noop,
    err: (s) => { warning += s; },
  });
  assert.equal(code, 1);
  assert.equal(primaryCalls, 0);
  assert.match(warning, /local transcript files only/);
});

// -- runPrimary: script selection per rung -----------------------------------

test("decideAndRun: rung 'expand' is passed through to runPrimary so it dispatches to memory-expand.cjs", () => {
  let seenRung;
  let seenArgs;
  const code = decideAndRun({
    flags: {
      rung: "expand",
      rungChunkId: "chunk-123",
      query: "",
      passthrough: ["--system"],
    },
    env: {},
    runPrimary: (args, rung) => {
      seenRung = rung;
      seenArgs = args;
      return { code: 0, stdout: "", stderr: "" };
    },
    out: noop,
    err: noop,
  });
  assert.equal(code, 0);
  assert.equal(seenRung, "expand");
  assert.deepEqual(seenArgs, ["chunk-123", "--system"]);
});

test("decideAndRun: rung 'transcript' is passed through locally to memory-transcript.cjs", () => {
  let seenRung;
  let seenArgs;
  const code = decideAndRun({
    flags: {
      local: true,
      rung: "transcript",
      rungChunkId: "chunk-456",
      query: "",
      passthrough: ["--local", "--client", "acme"],
    },
    env: {},
    hasTeamLogin: () => true,
    runPrimary: (args, rung) => {
      seenRung = rung;
      seenArgs = args;
      return { code: 0, stdout: "", stderr: "" };
    },
    out: noop,
    err: noop,
  });
  assert.equal(code, 0);
  assert.equal(seenRung, "transcript");
  assert.deepEqual(seenArgs, ["chunk-456", "--local", "--client", "acme"]);
});

test("runPrimary: dispatches to the script matching the rung (expand -> memory-expand.cjs, transcript -> memory-transcript.cjs, search -> memory-search.cjs)", () => {
  const { runPrimary } = require("../../../scripts/memory-recall.cjs");
  const scripts = {
    searchScript: "/nonexistent/memory-search.cjs",
    expandScript: "/nonexistent/memory-expand.cjs",
    transcriptScript: "/nonexistent/memory-transcript.cjs",
  };

  const searchResult = runPrimary(["--system"], "search", scripts);
  assert.match(searchResult.stderr, /memory-search\.cjs/);

  const expandResult = runPrimary(["chunk-1", "--system"], "expand", scripts);
  assert.match(expandResult.stderr, /memory-expand\.cjs/);

  const transcriptResult = runPrimary(["chunk-2", "--system"], "transcript", scripts);
  assert.match(transcriptResult.stderr, /memory-transcript\.cjs/);
});
