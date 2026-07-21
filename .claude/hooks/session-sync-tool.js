#!/usr/bin/env node
// PostToolUse hook — logs each tool use to the board task in real-time
// Fire-and-forget: spawns background process so it doesn't block Claude

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    return;
  }

  const sessionId = data.session_id;
  if (!sessionId) return;

  const tmpFile = path.join(os.tmpdir(), "cc-session-" + sessionId + ".json");
  let mapping;
  try {
    mapping = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
  } catch {
    return;
  }

  const { taskId, port, syncMode = "managed" } = mapping;
  if (!taskId) return;
  if (syncMode === "managed") return;

  const toolName = data.tool_name || "unknown";
  const toolInput = data.tool_input || {};
  const toolResult = data.tool_result;

  // Build a concise summary for the activity label
  let summary = toolName;
  if (toolName === "Bash" && toolInput.command) {
    const cmd = toolInput.command.length > 60 ? toolInput.command.slice(0, 57) + "..." : toolInput.command;
    summary = `$ ${cmd}`;
  } else if (toolName === "Read" && toolInput.file_path) {
    summary = `Reading ${path.basename(toolInput.file_path)}`;
  } else if (toolName === "Write" && toolInput.file_path) {
    summary = `Writing ${path.basename(toolInput.file_path)}`;
  } else if (toolName === "Edit" && toolInput.file_path) {
    summary = `Editing ${path.basename(toolInput.file_path)}`;
  } else if (toolName === "Grep" && toolInput.pattern) {
    summary = `Searching for "${toolInput.pattern}"`;
  } else if (toolName === "Glob" && toolInput.pattern) {
    summary = `Finding files: ${toolInput.pattern}`;
  } else if (toolName === "Agent") {
    summary = `Spawned agent${toolInput.description ? ": " + toolInput.description : ""}`;
  }

  // Truncate tool input/result for log storage
  const inputStr = JSON.stringify(toolInput);
  const safeInput = inputStr.length > 1000 ? inputStr.slice(0, 997) + "..." : inputStr;
  const safeResult = toolResult
    ? (typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult))
    : "";
  const truncResult = safeResult.length > 2000 ? safeResult.slice(0, 1997) + "..." : safeResult;

  const safePort = JSON.stringify(String(port || "3000"));

  // Spawn background process
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const http = require("http");

    // 1. Update activity label
    const statusPayload = JSON.stringify({
      status: "running",
      activityLabel: ${JSON.stringify(summary.length > 100 ? summary.slice(0, 97) + "..." : summary)},
    });

    const statusReq = http.request({
      hostname: "localhost",
      port: ${safePort},
      path: "/api/tasks/${taskId}/status",
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(statusPayload) },
      timeout: 3000,
    }, () => {});
    statusReq.on("error", () => {});
    statusReq.on("timeout", () => statusReq.destroy());
    statusReq.write(statusPayload);
    statusReq.end();

    // 2. Log tool use entry
    const logPayload = JSON.stringify({
      type: "tool_use",
      content: ${JSON.stringify(summary)},
      toolName: ${JSON.stringify(toolName)},
      toolArgs: ${JSON.stringify(safeInput)},
      toolResult: ${JSON.stringify(truncResult)},
    });

    const logReq = http.request({
      hostname: "localhost",
      port: ${safePort},
      path: "/api/tasks/${taskId}/logs",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(logPayload) },
      timeout: 3000,
    }, () => {});
    logReq.on("error", () => {});
    logReq.on("timeout", () => logReq.destroy());
    logReq.write(logPayload);
    logReq.end();
  `,
    ],
    {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    }
  );

  child.unref();
});
