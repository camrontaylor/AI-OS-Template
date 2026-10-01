#!/usr/bin/env node
// AI-OS status line.
// Shows: model | current task | directory | Team OS status | optional GSD state | context usage

const fs = require("fs");
const os = require("os");
const path = require("path");

let input = "";
const stdinTimeout = setTimeout(() => process.exit(0), 3000);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input || "{}");
    const model = data.model?.display_name || "Claude";
    const dir = data.workspace?.current_dir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const session = data.session_id || "";
    const task = currentTask(session);
    const team = teamSegment();
    const gsd = gsdSegment(dir);
    const ctx = contextSegment(data, session);
    const dirname = path.basename(dir);

    const segments = [
      dim(model),
      task ? bold(task) : null,
      dim(dirname),
      team,
      gsd,
    ].filter(Boolean);

    process.stdout.write(`${segments.join(" | ")}${ctx}`);
  } catch {
    // Silent fail: a status line should never break Claude Code.
  }
});

function dim(value) {
  return `\x1b[2m${value}\x1b[0m`;
}

function bold(value) {
  return `\x1b[1m${value}\x1b[0m`;
}

function currentTask(session) {
  if (!session) return "";
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const todosDir = path.join(claudeDir, "todos");
  if (!fs.existsSync(todosDir)) return "";
  try {
    const files = fs.readdirSync(todosDir)
      .filter((file) => file.startsWith(session) && file.includes("-agent-") && file.endsWith(".json"))
      .map((file) => ({ name: file, mtime: fs.statSync(path.join(todosDir, file)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return "";
    const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), "utf8"));
    const inProgress = Array.isArray(todos) ? todos.find((todo) => todo.status === "in_progress") : null;
    return inProgress?.activeForm || "";
  } catch {
    return "";
  }
}

function contextSegment(data, session) {
  const remaining = data.context_window?.remaining_percentage;
  if (remaining == null) return "";

  const autoCompactBufferPct = 16.5;
  const usableRemaining = Math.max(0, ((remaining - autoCompactBufferPct) / (100 - autoCompactBufferPct)) * 100);
  const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

  if (session) {
    try {
      const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
      fs.writeFileSync(bridgePath, JSON.stringify({
        session_id: session,
        profileKey: process.env.AI_OS_PROFILE_KEY || "solo",
        remaining_percentage: remaining,
        used_pct: used,
        timestamp: Math.floor(Date.now() / 1000),
      }));
    } catch {
      // Best effort only.
    }
  }

  const filled = Math.floor(used / 10);
  const bar = `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`;
  if (used < 50) return ` \x1b[32m${bar} ${used}%\x1b[0m`;
  if (used < 65) return ` \x1b[33m${bar} ${used}%\x1b[0m`;
  if (used < 80) return ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
  return ` \x1b[5;31m${bar} ${used}%\x1b[0m`;
}

function teamConfigDir() {
  return process.env.AI_OS_TEAM_CONFIG_DIR
    ? path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR)
    : path.join(os.homedir(), ".AI-OS");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function teamLabel(team) {
  if (!team || typeof team !== "object") return "";
  return team.slug || team.name || team.id || "";
}

function teamSegment() {
  const dir = teamConfigDir();
  const config = readJson(path.join(dir, "team-context.json"));
  if (!config || typeof config !== "object" || typeof config.token !== "string") {
    return "Team: signed out";
  }

  const cache = readJson(path.join(dir, "team-status.json"));
  const label = cache?.label || teamLabel(cache?.team) || teamLabel(config.team);
  if (cache?.status === "connected") {
    return `Team: ${label || "connected"}`;
  }
  if (cache?.status === "signed_out") {
    return "Team: signed out";
  }
  return `Team: offline${label ? ` ${label}` : ""}`;
}

function gsdSegment(currentDir) {
  const statePath = path.join(currentDir, ".planning", "STATE.md");
  if (!fs.existsSync(statePath)) return "";
  try {
    const text = fs.readFileSync(statePath, "utf8");
    const project = matchLine(text, /^project:\s*(.+)$/im)
      || matchLine(text, /^#\s+(.+)$/m)
      || "project";
    const phase = matchLine(text, /^(?:current[_ -]?phase|phase):\s*(.+)$/im);
    const value = phase ? `${project} ${phase}` : project;
    return `GSD: ${truncate(value, 48)}`;
  } catch {
    return "";
  }
}

function matchLine(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim() || "";
}

function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}
