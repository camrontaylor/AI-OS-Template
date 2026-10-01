#!/usr/bin/env node
// SessionStart hook — local Team OS memory consolidation tick.
//
// This only starts a local background process. The hosted API remains a
// coordination layer; Claude/embedding work happens on the user's machine.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function runHook() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const config = buildTickSpawn(input);
    if (!config) return;

    const child = spawn(process.execPath, config.args, {
      cwd: config.cwd,
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    child.unref();
  });

  setTimeout(() => process.exit(0), 4000);
}

function buildTickSpawn(input) {
  if (process.env.AI_OS_SKIP_MEMORY_CAPTURE === "1") return null;

  let data = {};
  try {
    data = input ? JSON.parse(input) : {};
  } catch {
    data = {};
  }

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findCommandCentreRoot(cwd);
  if (!root) return null;

  const script = path.join(root, "command-centre", "scripts", "memory-consolidation-tick.cjs");
  if (!fs.existsSync(script)) return null;

  const args = [script, "--quiet", "--reason", "session-start"];
  const client = clientSlugForCwd(root, cwd);
  if (client) args.push("--client", client);

  return { cwd: root, args };
}

function findCommandCentreRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, "command-centre", "scripts", "memory-consolidation-tick.cjs"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function clientSlugForCwd(root, cwd) {
  const rel = path.relative(root, path.resolve(cwd));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length < 2 || parts[0] !== "clients" || !parts[1]) return null;
  const clientDir = path.join(root, "clients", parts[1]);
  return fs.existsSync(path.join(clientDir, ".claude")) ? parts[1] : null;
}

if (require.main === module) {
  runHook();
} else {
  module.exports = {
    buildTickSpawn,
    clientSlugForCwd,
    findCommandCentreRoot,
  };
}
