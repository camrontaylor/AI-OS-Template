#!/usr/bin/env node
// SessionStart hook — injects the server-resolved Team OS context snapshot.
// Silent when Team OS is not connected. Fail-closed when the server is offline.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

if (
  process.env.AI_OS_TEAM_ENRICHMENT === "conversation_only" ||
  process.env.AI_OS_CONTEXT_OVERLAY_DIR
) {
  process.exit(0);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // Fall back to env/cwd below.
  }

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionId = typeof data.session_id === "string" ? data.session_id.trim() : "";
  if (!sessionId) process.exit(0);
  const root = findRoot(cwd);
  if (!root) process.exit(0);

  const script = path.join(root, "command-centre", "scripts", "context-snapshot.cjs");
  if (!fs.existsSync(script)) process.exit(0);

  const result = spawnSync(process.execPath, [
    script,
    "--cwd",
    cwd,
    "--session-id",
    sessionId,
    "--task-type",
    "claude-session",
    "--format",
    "hook",
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
  });

  if (result.status === 0 && result.stdout.trim()) {
    process.stdout.write(result.stdout.trim());
  }
});

function findRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i += 1) {
    if (
      fs.existsSync(path.join(dir, "AGENTS.md")) &&
      fs.existsSync(path.join(dir, "CLAUDE.md")) &&
      fs.existsSync(path.join(dir, "command-centre", "scripts", "context-snapshot.cjs"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

setTimeout(() => process.exit(0), 9000);
