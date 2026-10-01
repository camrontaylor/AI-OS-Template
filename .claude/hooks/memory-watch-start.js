#!/usr/bin/env node
// SessionStart hook — start the live memory-sync watcher if it isn't already running.
//
// Spawns command-centre/scripts/memory-watch.cjs detached so files edited outside
// a Claude session become searchable without waiting for the next capture. The
// watcher self-guards with a PID lock, so firing this on every SessionStart is
// safe. Fire-and-forget: spawns a detached+unref child and returns immediately;
// silent and exit-0 on anything missing so the SessionStart chain is never broken.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // No JSON input — fall back to env / cwd.
  }

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findRoot(cwd);
  if (!root) return;

  const script = path.join(root, "command-centre", "scripts", "memory-watch.cjs");
  if (!fs.existsSync(script)) return;

  // Automatic watching is intentionally local-only. A hosted watcher needs
  // authenticated API writes and permission checks; that work is AIOS-436.
  const child = spawn(process.execPath, [script, "--auto-local"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  });
  child.unref();

  // The detached child is on its own now — exit immediately so the SessionStart
  // chain is never delayed (the safety-net timer below must NOT keep us alive).
  process.exit(0);
});

// Walk up to find the AI-OS root (AGENTS.md/CLAUDE.md + .claude present),
// so the hook works from client subfolders or projects/briefs/ subfolders.
function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const hasAgents = fs.existsSync(path.join(dir, "AGENTS.md"));
    const hasClaude = fs.existsSync(path.join(dir, "CLAUDE.md"));
    const hasClaudeDir = fs.existsSync(path.join(dir, ".claude"));
    if ((hasAgents || hasClaude) && hasClaudeDir) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Safety net — if stdin never delivers an `end`, exit anyway. unref()'d so it
// never holds the event loop open on the normal path (where the `end` handler
// already exits): stdin keeps the loop alive until then, and this still fires
// if `end` never comes.
setTimeout(() => process.exit(0), 4000).unref();
