const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { setTimeout: delay } = require("node:timers/promises");
const test = require("node:test");
const Database = require("better-sqlite3");

const bridgeScriptPath = path.resolve(__dirname, "..", "..", "scripts", "permission-prompt-mcp.cjs");

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "command-centre-permission-bridge-"));
}

function cleanupTempWorkspace(workspaceDir) {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
}

function createTestDb(workspaceDir, taskId) {
  const dbPath = path.join(workspaceDir, "data.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      needsInput INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT,
      activityLabel TEXT,
      cancelRequestedAt TEXT
    );

    CREATE TABLE task_permission_rules (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      sourceApprovalRequestId TEXT NOT NULL,
      toolName TEXT NOT NULL,
      matcherType TEXT NOT NULL,
      matcherValue TEXT NOT NULL,
      workspacePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      revokedAt TEXT
    );

    CREATE TABLE approval_requests (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      toolName TEXT NOT NULL,
      inputJson TEXT NOT NULL,
      decision TEXT,
      decisionMessage TEXT,
      createdAt TEXT NOT NULL,
      resolvedAt TEXT
    );
  `);
  db.prepare("INSERT INTO tasks (id, needsInput, updatedAt, activityLabel) VALUES (?, 0, NULL, NULL)").run(taskId);
  return { db, dbPath };
}

function spawnBridge(taskId, dbPath) {
  const child = spawn(process.execPath, [bridgeScriptPath, "--task-id", taskId, "--db-path", dbPath, "--workspace-path", path.dirname(dbPath)], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  return {
    child,
    getStderr: () => stderr,
  };
}

async function stopBridge(child) {
  if (child.exitCode !== null) return;
  child.stdin.end();
  child.kill();
  await once(child, "exit").catch(() => {});
}

function createJsonLineReader(stream) {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const queue = [];
  const waiters = [];

  rl.on("line", (line) => {
    if (!line.trim()) return;
    if (waiters.length) {
      waiters.shift()(line);
      return;
    }
    queue.push(line);
  });

  return {
    async next() {
      if (queue.length) {
        return JSON.parse(queue.shift());
      }
      const line = await new Promise((resolve) => waiters.push(resolve));
      return JSON.parse(line);
    },
    close() {
      rl.close();
    },
  };
}

function createContentLengthReader(stream) {
  let buffer = Buffer.alloc(0);
  const queue = [];
  const waiters = [];

  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        throw new Error(`Invalid MCP header: ${header}`);
      }

      const contentLength = Number(lengthMatch[1]);
      const totalLength = headerEnd + 4 + contentLength;
      if (buffer.length < totalLength) return;

      const body = buffer.slice(headerEnd + 4, totalLength).toString("utf8");
      buffer = buffer.slice(totalLength);

      const message = JSON.parse(body);
      if (waiters.length) {
        waiters.shift()(message);
      } else {
        queue.push(message);
      }
    }
  });

  return {
    async next() {
      if (queue.length) return queue.shift();
      return await new Promise((resolve) => waiters.push(resolve));
    },
  };
}

function sendJsonLine(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function sendContentLengthMessage(child, message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
  child.stdin.write(payload);
}

async function waitForPendingRequest(db, taskId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = db.prepare(
      "SELECT * FROM approval_requests WHERE taskId = ? AND status = 'pending' ORDER BY createdAt DESC LIMIT 1"
    ).get(taskId);

    if (row) {
      return row;
    }

    await delay(20);
  }

  throw new Error("Timed out waiting for a pending approval request.");
}

function resolveRequest(db, requestId, decision, decisionMessage = null) {
  const status = decision === "deny" ? "denied" : "approved";
  db.prepare(
    "UPDATE approval_requests SET status = ?, decision = ?, decisionMessage = ?, resolvedAt = ? WHERE id = ?"
  ).run(status, decision, decisionMessage, new Date().toISOString(), requestId);
}

function insertRule(db, workspaceDir, taskId, matcherType, matcherValue, toolName) {
  db.prepare(
    `INSERT INTO task_permission_rules
      (id, taskId, sourceApprovalRequestId, toolName, matcherType, matcherValue, workspacePath, createdAt, revokedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    `rule-${matcherType}-${matcherValue}`,
    taskId,
    `approval-${matcherType}`,
    toolName,
    matcherType,
    matcherValue,
    process.platform === "win32"
      ? path.resolve(workspaceDir).toLocaleLowerCase("en-US")
      : path.resolve(workspaceDir),
    new Date().toISOString(),
  );
}

test("permission prompt bridge handles JSON-line MCP traffic", async () => {
  const workspaceDir = makeTempWorkspace();
  const taskId = "task-jsonl";
  const { db, dbPath } = createTestDb(workspaceDir, taskId);
  const { child, getStderr } = spawnBridge(taskId, dbPath);
  const reader = createJsonLineReader(child.stdout);

  try {
    sendJsonLine(child, {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { roots: {}, elicitation: {} },
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    const initResponse = await reader.next();
    assert.equal(initResponse.id, 0);
    assert.equal(initResponse.result.serverInfo.name, "AI-OS-permissions");

    sendJsonLine(child, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    sendJsonLine(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const listResponse = await reader.next();
    assert.equal(listResponse.id, 1);
    assert.deepEqual(
      listResponse.result.tools.map((tool) => tool.name),
      ["approval_prompt"]
    );

    sendJsonLine(child, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "approval_prompt",
        arguments: {
          tool_name: "Read",
          input: { file_path: "docs/brief.md" },
        },
      },
    });

    const request = await waitForPendingRequest(db, taskId);
    assert.equal(request.toolName, "Read");
    assert.equal(request.description, "Claude wants to use Read.");

    const taskRow = db.prepare("SELECT needsInput, activityLabel FROM tasks WHERE id = ?").get(taskId);
    assert.equal(taskRow.needsInput, 1);
    assert.equal(taskRow.activityLabel, "Needs permission");

    resolveRequest(db, request.id, "allow_once");

    const callResponse = await reader.next();
    assert.equal(callResponse.id, 2);
    assert.deepEqual(
      JSON.parse(callResponse.result.content[0].text),
      {
        behavior: "allow",
        updatedInput: { file_path: "docs/brief.md" },
      }
    );
    assert.match(getStderr(), /transport=jsonl/);
  } finally {
    reader.close();
    await stopBridge(child);
    db.close();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("permission prompt bridge handles Content-Length MCP traffic", async () => {
  const workspaceDir = makeTempWorkspace();
  const taskId = "task-content-length";
  const { db, dbPath } = createTestDb(workspaceDir, taskId);
  const { child, getStderr } = spawnBridge(taskId, dbPath);
  const reader = createContentLengthReader(child.stdout);

  try {
    sendContentLengthMessage(child, {
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { roots: {}, elicitation: {} },
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    const initResponse = await reader.next();
    assert.equal(initResponse.id, 10);
    assert.equal(initResponse.result.serverInfo.name, "AI-OS-permissions");

    sendContentLengthMessage(child, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    sendContentLengthMessage(child, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/list",
    });

    const listResponse = await reader.next();
    assert.equal(listResponse.id, 11);
    assert.deepEqual(
      listResponse.result.tools.map((tool) => tool.name),
      ["approval_prompt"]
    );

    sendContentLengthMessage(child, {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "approval_prompt",
        arguments: {
          tool_name: "Bash",
          input: { command: "dir", description: "List files" },
        },
      },
    });

    const request = await waitForPendingRequest(db, taskId);
    assert.equal(request.toolName, "Bash");
    assert.match(request.description, /Claude wants to run a command:/);

    resolveRequest(db, request.id, "deny", "Blocked in test.");

    const callResponse = await reader.next();
    assert.equal(callResponse.id, 12);
    assert.deepEqual(
      JSON.parse(callResponse.result.content[0].text),
      {
        behavior: "deny",
        message: "Blocked in test.",
      }
    );
    assert.match(getStderr(), /transport=content-length/);
  } finally {
    await stopBridge(child);
    db.close();
    cleanupTempWorkspace(workspaceDir);
  }
});

test("permission prompt bridge reuses only matching subchat rules", async () => {
  const workspaceDir = makeTempWorkspace();
  const taskId = "task-rules";
  const { db, dbPath } = createTestDb(workspaceDir, taskId);
  insertRule(db, workspaceDir, taskId, "bash_exact", "npm run test", "Bash");
  insertRule(db, workspaceDir, taskId, "edit_session", "file_edits", "Write");
  insertRule(db, workspaceDir, taskId, "web_domain", "example.com", "WebFetch");
  insertRule(db, workspaceDir, taskId, "exact_tool", "mcp__demo__lookup", "mcp__demo__lookup");
  const { child } = spawnBridge(taskId, dbPath);
  const reader = createJsonLineReader(child.stdout);

  try {
    sendJsonLine(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    await reader.next();

    const allowedCalls = [
      ["Bash", { command: "  npm run test  " }],
      ["Edit", { file_path: "src/app.ts" }],
      ["WebFetch", { url: "https://example.com/docs/page" }],
      ["mcp__demo__lookup", { query: "safe" }],
    ];
    let id = 2;
    for (const [toolName, input] of allowedCalls) {
      sendJsonLine(child, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { arguments: { tool_name: toolName, input } },
      });
      const response = await reader.next();
      assert.equal(response.id, id);
      assert.equal(JSON.parse(response.result.content[0].text).behavior, "allow");
      id += 1;
    }

    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM approval_requests").get().count,
      0,
    );

    sendJsonLine(child, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { arguments: { tool_name: "Bash", input: { command: "npm run build" } } },
    });
    const request = await waitForPendingRequest(db, taskId);
    assert.equal(request.toolName, "Bash");
    resolveRequest(db, request.id, "deny", "Different command.");
    const denied = await reader.next();
    assert.equal(JSON.parse(denied.result.content[0].text).behavior, "deny");
  } finally {
    reader.close();
    await stopBridge(child);
    db.close();
    cleanupTempWorkspace(workspaceDir);
  }
});
