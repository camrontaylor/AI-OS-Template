#!/usr/bin/env node
// SessionStart hook — first-run auto-index of the LOCAL memory store.
//
// A freshly cloned workspace has an empty local PGLite store, so Tier 1 semantic
// recall is dark until the Stop-hook capture or the nightly cron eventually
// indexes it. On SessionStart this spawns memory-bootstrap.cjs detached: if the
// local store is empty it backfills it from on-disk memory ONCE, so recall works
// from within the first session. The script self-guards (local-only, run-once,
// if-empty, best-effort) — see scripts/memory-bootstrap.cjs.
//
// Fire-and-forget: parses stdin, spawns a detached+unref child, and returns
// immediately so it never blocks session start. Silent and exit-0 on anything
// missing (headless runs, no root) so the SessionStart chain is never broken.

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

  const cwd = require('./lib/workspace-context').contextCwd(
    data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!cwd) return;
  const root = findRoot(cwd);
  if (!root) return;

  const script = path.join(root, "command-centre", "scripts", "memory-bootstrap.cjs");
  if (!fs.existsSync(script)) return;

  const child = spawn(process.execPath, [script], {
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
