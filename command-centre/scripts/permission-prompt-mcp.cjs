#!/usr/bin/env node

const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const TRANSPORT_CONTENT_LENGTH = "content-length";
const TRANSPORT_JSONL = "jsonl";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--task-id") out.taskId = argv[i + 1];
    if (arg === "--db-path") out.dbPath = argv[i + 1];
    if (arg === "--workspace-path") out.workspacePath = argv[i + 1];
  }
  return out;
}

const { taskId, dbPath, workspacePath = process.cwd() } = parseArgs(process.argv);
if (!taskId || !dbPath) {
  process.stderr.write("permission-prompt-mcp: missing --task-id or --db-path\n");
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
const normalizedWorkspacePath = process.platform === "win32"
  ? path.resolve(workspacePath).toLocaleLowerCase("en-US")
  : path.resolve(workspacePath);

let transportMode = null;
let detectionBuffer = Buffer.alloc(0);
let contentLengthBuffer = Buffer.alloc(0);
let jsonLineBuffer = "";

function logBridge(message) {
  process.stderr.write(`permission-prompt-mcp: ${message}\n`);
}

function setTransportMode(mode) {
  if (!transportMode) {
    transportMode = mode;
    logBridge(`transport=${mode}`);
  }
  return transportMode;
}

function detectTransportMode(buffer) {
  const preview = buffer.toString("utf8").trimStart();
  if (!preview) return null;
  if (/^Content-Length:/i.test(preview)) return TRANSPORT_CONTENT_LENGTH;
  if (preview.startsWith("{") || preview.startsWith("[")) return TRANSPORT_JSONL;
  return null;
}

function summarizeInput(toolName, input) {
  const raw = JSON.stringify(input ?? {});
  const pathLike = typeof input === "object" && input
    ? String(input.file_path || input.path || "")
    : "";

  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    return {
      title: "Needs permission",
      description: pathLike ? `Claude wants to edit ${pathLike}.` : "Claude wants to edit files.",
    };
  }

  if (toolName.startsWith("Bash")) {
    const short = raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
    return {
      title: "Needs permission",
      description: `Claude wants to run a command: ${short}`,
    };
  }

  return {
    title: "Needs permission",
    description: `Claude wants to use ${toolName}.`,
  };
}

function normalizeTaskPermission(toolName, input) {
  const value = input && typeof input === "object" ? input : {};
  if (toolName === "Bash" || toolName.startsWith("Bash(")) {
    return {
      matcherType: "bash_exact",
      matcherValue: typeof value.command === "string" ? value.command.trim() : "",
    };
  }
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    return { matcherType: "edit_session", matcherValue: "file_edits" };
  }
  if (toolName === "WebFetch") {
    try {
      return {
        matcherType: "web_domain",
        matcherValue: new URL(typeof value.url === "string" ? value.url : "")
          .hostname.toLocaleLowerCase("en-US"),
      };
    } catch {
      return { matcherType: "exact_tool", matcherValue: toolName };
    }
  }
  return { matcherType: "exact_tool", matcherValue: toolName };
}

function findMatchingTaskRule(toolName, input) {
  const normalized = normalizeTaskPermission(toolName, input);
  return db.prepare(
    `SELECT * FROM task_permission_rules
     WHERE taskId = ? AND matcherType = ? AND matcherValue = ?
       AND workspacePath = ? AND revokedAt IS NULL
     ORDER BY createdAt DESC LIMIT 1`,
  ).get(
    taskId,
    normalized.matcherType,
    normalized.matcherValue,
    normalizedWorkspacePath,
  );
}

function isCancellationRequested() {
  const row = db.prepare(
    "SELECT cancelRequestedAt FROM tasks WHERE id = ?",
  ).get(taskId);
  return Boolean(row?.cancelRequestedAt);
}

function ensureApprovalRequest(toolName, input) {
  const inputJson = JSON.stringify(input ?? {});
  const existing = db.prepare(
    `SELECT * FROM approval_requests
     WHERE taskId = ? AND kind = 'permission' AND status = 'pending' AND toolName = ? AND inputJson = ?
     ORDER BY createdAt DESC LIMIT 1`
  ).get(taskId, toolName, inputJson);

  if (existing) return existing;

  const summary = summarizeInput(toolName, input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO approval_requests
      (id, taskId, kind, status, title, description, toolName, inputJson, decision, decisionMessage, createdAt, resolvedAt)
     VALUES (?, ?, 'permission', 'pending', ?, ?, ?, ?, NULL, NULL, ?, NULL)`
  ).run(id, taskId, summary.title, summary.description, toolName, inputJson, now);

  db.prepare(
    "UPDATE tasks SET needsInput = 1, updatedAt = ?, activityLabel = ? WHERE id = ?"
  ).run(now, "Needs permission", taskId);

  return db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id);
}

async function waitForDecision(requestId) {
  for (;;) {
    const row = db.prepare(
      "SELECT status, decision, decisionMessage FROM approval_requests WHERE id = ?"
    ).get(requestId);

    if (row && row.status !== "pending") {
      return row;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function writeMessage(message) {
  const payload = JSON.stringify(message);

  if (transportMode === TRANSPORT_CONTENT_LENGTH) {
    const framed = Buffer.from(payload, "utf8");
    process.stdout.write(`Content-Length: ${framed.length}\r\n\r\n`);
    process.stdout.write(framed);
    return;
  }

  process.stdout.write(`${payload}\n`);
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "AI-OS-permissions",
          version: "0.0.1",
        },
      },
    });
    return;
  }

  if (method === "tools/list") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "approval_prompt",
            description: "Wait for a UI permission decision before allowing a Claude tool call.",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: { type: "string" },
                input: { type: "object", additionalProperties: true },
              },
              required: ["tool_name", "input"],
              additionalProperties: false,
            },
          },
        ],
      },
    });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.arguments?.tool_name || "";
    const input = params?.arguments?.input || {};
    if (isCancellationRequested()) {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({ behavior: "deny", message: "This subchat is stopping." }),
          }],
        },
      });
      return;
    }

    const matchingRule = findMatchingTaskRule(toolName, input);
    if (matchingRule) {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({ behavior: "allow", updatedInput: input }),
          }],
        },
      });
      return;
    }
    const request = ensureApprovalRequest(toolName, input);
    const decision = await waitForDecision(request.id);

    const payload = decision.decision === "deny"
      ? {
          behavior: "deny",
          message: decision.decisionMessage || "Permission denied in the UI.",
        }
      : {
          behavior: "allow",
          updatedInput: input,
        };

    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload),
          },
        ],
      },
    });
    return;
  }

  if (method === "ping") {
    writeMessage({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (id !== undefined) {
    writeMessage({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    });
  }
}

function handleParsedMessage(message) {
  if (message?.method === "notifications/initialized") {
    return;
  }

  handleRequest(message).catch((error) => {
    if (message?.id !== undefined) {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}

function parseMessageBody(body, sourceLabel) {
  let message;
  try {
    message = JSON.parse(body);
  } catch (error) {
    logBridge(`invalid ${sourceLabel} JSON ${String(error)}`);
    return false;
  }

  handleParsedMessage(message);
  return true;
}

function drainContentLengthBuffer() {
  while (true) {
    const headerEnd = contentLengthBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = contentLengthBuffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      logBridge("invalid content-length header");
      contentLengthBuffer = Buffer.alloc(0);
      return;
    }

    const contentLength = Number(lengthMatch[1]);
    const totalLength = headerEnd + 4 + contentLength;
    if (contentLengthBuffer.length < totalLength) return;

    const body = contentLengthBuffer.slice(headerEnd + 4, totalLength).toString("utf8");
    contentLengthBuffer = contentLengthBuffer.slice(totalLength);
    parseMessageBody(body, "content-length");
  }
}

function drainJsonLineBuffer(force = false) {
  while (true) {
    const newlineIndex = jsonLineBuffer.indexOf("\n");

    if (newlineIndex === -1) {
      const trimmed = jsonLineBuffer.trim();
      if (!trimmed) {
        jsonLineBuffer = "";
        return;
      }

      const looksComplete =
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"));

      if (!force && !looksComplete) {
        return;
      }

      if (parseMessageBody(trimmed, "json-line")) {
        jsonLineBuffer = "";
        continue;
      }

      if (force) {
        jsonLineBuffer = "";
      }
      return;
    }

    const line = jsonLineBuffer.slice(0, newlineIndex).trim();
    jsonLineBuffer = jsonLineBuffer.slice(newlineIndex + 1);
    if (!line) continue;
    parseMessageBody(line, "json-line");
  }
}

process.stdin.on("data", (chunk) => {
  if (!transportMode) {
    detectionBuffer = Buffer.concat([detectionBuffer, chunk]);
    const detectedMode = detectTransportMode(detectionBuffer);
    if (!detectedMode) return;

    setTransportMode(detectedMode);

    if (detectedMode === TRANSPORT_CONTENT_LENGTH) {
      contentLengthBuffer = detectionBuffer;
      detectionBuffer = Buffer.alloc(0);
      drainContentLengthBuffer();
      return;
    }

    jsonLineBuffer = detectionBuffer.toString("utf8");
    detectionBuffer = Buffer.alloc(0);
    drainJsonLineBuffer();
    return;
  }

  if (transportMode === TRANSPORT_CONTENT_LENGTH) {
    contentLengthBuffer = Buffer.concat([contentLengthBuffer, chunk]);
    drainContentLengthBuffer();
    return;
  }

  jsonLineBuffer += chunk.toString("utf8");
  drainJsonLineBuffer();
});

process.stdin.on("end", () => {
  if (transportMode === TRANSPORT_JSONL) {
    drainJsonLineBuffer(true);
  }
});
