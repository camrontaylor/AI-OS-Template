#!/usr/bin/env node
// Stop hook — AI-OS-owned session capture + memory refresh.
//
// Replaces the legacy user-level memsearch plugin Stop hook. On every Stop it
// spawns memory-capture.cjs detached: that captures the transcript's last turn
// as a summarized block in context/memory/{date}.aos.md, archives the raw
// transcript, and then lets memory-capture route automatically. With Team OS
// signed in, it sends the captured block to the hosted Memory API; otherwise it
// refreshes the local PGLite index. No Memsearch.
//
// Fire-and-forget: parses stdin, spawns a detached+unref child, and returns
// immediately so it never blocks the session. Silent and exit-0 on anything
// missing (no transcript path, headless runs) so the Stop chain is never broken.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function runHook() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const config = buildCaptureSpawn(input);
    if (!config) return;

    const child = spawn(process.execPath, config.args, {
      cwd: config.cwd,
      env: config.env,
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    child.unref();
  });

  // Safety net — if stdin never delivers, exit silently.
  setTimeout(() => process.exit(0), 4000);
}

function buildCaptureSpawn(input) {
  if (process.env.AI_OS_SKIP_MEMORY_CAPTURE === "1") return null;

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    return null;
  }

  const sessionId = data.session_id;
  const transcript = data.transcript_path;
  // Without a transcript there is nothing to capture; the agent wrap-up + nightly
  // cron cover those sessions. No-op cleanly.
  if (!sessionId || !transcript) return null;

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findCommandCentreRoot(cwd);
  if (!root) return null;

  const script = path.join(root, "command-centre", "scripts", "memory-capture.cjs");
  if (!fs.existsSync(script)) return null;

  const args = [
    script,
    "--session",
    ...clientScopeArgs(root, cwd),
    "--session-id",
    String(sessionId),
    "--transcript",
    String(transcript),
    "--cwd",
    String(cwd),
    "--team-context-auto",
  ];
  const visibility = process.env.MEMORY_CAPTURE_VISIBILITY;
  const teamId = process.env.MEMORY_CAPTURE_TEAM_ID;
  const clientId = process.env.MEMORY_CAPTURE_CLIENT_ID;
  const userId = process.env.MEMORY_CAPTURE_USER_ID;
  if (visibility) args.push("--visibility", visibility);
  if (teamId) args.push("--team", teamId);
  if (clientId) args.push("--client", clientId);
  if (userId) args.push("--user", userId);
  if (process.env.MEMORY_CAPTURE_ALLOW_SYSTEM === "1") args.push("--allow-system");
  if (process.env.MEMORY_CAPTURE_VIA_API === "1") args.push("--api-ingest");

  // The capture summarizes with `claude -p`; it must not inherit the task id of
  // the session being captured or it registers itself on that task.
  const env = { ...process.env };
  delete env.AI_OS_TASK_ID;

  return {
    cwd: root,
    args,
    env,
  };
}

// Walk up to the AI-OS root that owns command-centre. Client folders also
// have AGENTS.md and .claude, so marker-based root detection stops too early.
function findCommandCentreRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, "command-centre", "scripts", "memory-capture.cjs"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function clientScopeArgs(root, cwd) {
  const rel = path.relative(root, path.resolve(cwd));
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const parts = rel.split(path.sep);
    if (parts.length >= 2 && parts[0] === "clients" && parts[1]) {
      const clientDir = path.join(root, "clients", parts[1]);
      if (fs.existsSync(path.join(clientDir, ".claude"))) {
        return ["--workspace", clientDir, "--visibility", "client", "--client", parts[1]];
      }
    }
  }
  return [];
}

if (require.main === module) {
  runHook();
} else {
  module.exports = {
    buildCaptureSpawn,
    clientScopeArgs,
    findCommandCentreRoot,
  };
}
