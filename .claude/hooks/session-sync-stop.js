#!/usr/bin/env node
// Stop hook — logs Claude's response and marks task as "review" (waiting for user input).
// Status is NOT auto-advanced to "done" — user marks done explicitly via the UI.
//
// Stop fires after EVERY turn with `last_assistant_message`.
// The UserPromptSubmit hook flips status back to "running" when the user replies.
// Fire-and-forget: spawns background process so it doesn't block.

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

  const { taskId, port, syncMode = "managed", claudePid = null } = mapping;
  if (!taskId) return;

  const safePort = JSON.stringify(String(port || "3000"));
  const response = data.last_assistant_message || "";
  const logContent = response.length > 4000 ? response.slice(0, 3997) + "..." : response;

  // Extract a meaningful activity label from Claude's response:
  // Prefer the last question, otherwise the last sentence, otherwise truncate
  function extractLabel(text) {
    if (!text) return "Waiting for input";
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    // Find last line ending with ?
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].endsWith("?")) {
        const q = lines[i].replace(/^\*+|\*+$/g, "").trim();
        return q.length > 100 ? q.slice(0, 97) + "..." : q;
      }
    }
    // Fall back to last non-empty line
    const last = lines[lines.length - 1] || "";
    const clean = last.replace(/^\*+|\*+$/g, "").trim();
    return clean.length > 100 ? clean.slice(0, 97) + "..." : clean || "Waiting for input";
  }
  const activityLabel = extractLabel(response);

  // Spawn background process for API calls
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const http = require("http");
    const fs = require("fs");

    function makeRequest(method, urlPath, body) {
      return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const req = http.request({
          hostname: "localhost",
          port: ${safePort},
          path: urlPath,
          method,
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
          timeout: 5000,
        }, (res) => {
          let data = "";
          res.on("data", (c) => data += c);
          res.on("end", () => resolve(data));
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(payload);
        req.end();
      });
    }

    async function run() {
      const responseText = ${JSON.stringify(logContent)};
      if (${JSON.stringify(syncMode)} !== "managed") {
        // 1. Set status to review with meaningful label
        await makeRequest("PATCH", "/api/tasks/${taskId}/status",
          { status: "review", activityLabel: ${JSON.stringify(activityLabel)} });

        if (responseText) {
          await makeRequest("POST", "/api/tasks/${taskId}/logs",
            { type: "text", content: responseText });
        }
      }

      // Wait 3s then clean up the tmp session file if Claude has exited.
      // Status is NOT patched to done — the UI or backend reaper handles that.
      const storedPid = ${claudePid === null ? "null" : claudePid};
      if (storedPid !== null) {
        await new Promise((r) => setTimeout(r, 3000));
        let alive = false;
        try { process.kill(storedPid, 0); alive = true; } catch {}
        if (!alive) {
          try { fs.unlinkSync(${JSON.stringify(tmpFile)}); } catch {}
        }
      }
    }

    run();
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
