#!/usr/bin/env node
// Notification hook — updates activity label + logs Claude's output to task history
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
  const message = data.message;
  if (!sessionId || !message) return;

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

  // Truncate long messages for the activity label
  const label = message.length > 100 ? message.slice(0, 97) + "..." : message;

  const safePort = JSON.stringify(String(port || "3000"));

  // Spawn background process for API calls
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const http = require("http");

    // 1. Update activity label (do NOT set status — avoids race with Stop hook)
    const statusPayload = JSON.stringify({
      activityLabel: ${JSON.stringify(label)},
    });

    const statusReq = http.request({
      hostname: "localhost",
      port: ${safePort},
      path: "/api/tasks/${taskId}/status",
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(statusPayload) },
      timeout: 5000,
    }, () => {});
    statusReq.on("error", () => {});
    statusReq.on("timeout", () => statusReq.destroy());
    statusReq.write(statusPayload);
    statusReq.end();

    // 2. Log as a system entry in task history
    const logPayload = JSON.stringify({
      type: "system",
      content: ${JSON.stringify(message.length > 2000 ? message.slice(0, 1997) + "..." : message)},
    });

    const logReq = http.request({
      hostname: "localhost",
      port: ${safePort},
      path: "/api/tasks/${taskId}/logs",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(logPayload) },
      timeout: 5000,
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
