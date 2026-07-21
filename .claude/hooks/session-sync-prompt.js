#!/usr/bin/env node
// UserPromptSubmit hook — updates task title from first prompt, logs user messages,
// and sets status back to "running" (user is actively engaging)
// Fire-and-forget: spawns background process so it doesn't block input

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
  // User prompt can be in 'prompt' or 'message' depending on hook version
  const prompt = data.prompt || data.message || "";
  if (!sessionId || !prompt) return;

  const tmpFile = path.join(os.tmpdir(), "cc-session-" + sessionId + ".json");
  let mapping;
  try {
    mapping = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
  } catch {
    return; // No mapping file — command centre wasn't running at session start
  }

  const { taskId, port, titleSet, syncMode = "managed" } = mapping;
  if (!taskId) return;
  if (syncMode === "managed") return;

  // Truncate prompt for title (first line, max 80 chars)
  const firstLine = prompt.split("\n")[0].trim();
  const title = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;

  const safePort = JSON.stringify(String(port || "3000"));

  // Update mapping to track that title has been set
  if (!titleSet) {
    try {
      mapping.titleSet = true;
      fs.writeFileSync(tmpFile, JSON.stringify(mapping));
    } catch {}
  }

  // Spawn background process for API calls
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const http = require("http");

    // 1. Update status back to running (+ title on first prompt)
    const statusPayload = JSON.stringify(${titleSet
      ? '{ status: "running" }'
      : `{ status: "running", title: ${JSON.stringify(title)} }`
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

    // 2. Add user message as a log entry
    const logPayload = JSON.stringify({
      type: "user_reply",
      content: ${JSON.stringify(prompt.length > 2000 ? prompt.slice(0, 1997) + "..." : prompt)},
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
