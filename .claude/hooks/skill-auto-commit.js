#!/usr/bin/env node
// PostToolUse hook — auto-commits SKILL.md changes immediately after Claude writes them.
// Ensures skill customisations are durable without depending on the user running wrap-up.
// Fire-and-forget: spawns a background process so it never blocks Claude.

const path = require("path");
const { spawn, spawnSync } = require("child_process");

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

  const toolName = data.tool_name || "";
  const filePath = (data.tool_input || {}).file_path || "";

  // Only fire for Write or Edit tools targeting a SKILL.md
  if (!["Write", "Edit", "MultiEdit"].includes(toolName)) return;
  if (!filePath) return;

  const normalized = filePath.replace(/\\/g, "/");

  let commitMsg;
  const skillMatch = normalized.match(/\.claude\/skills\/([^/]+)\/SKILL\.local\.md$/);
  const claudeMatch = normalized.match(/(?:^|\/)CLAUDE\.local\.md$/);

  if (skillMatch) {
    const skillName = skillMatch[1];
    if (skillName === "_catalog") return;
    const today = new Date().toISOString().slice(0, 10);
    commitMsg = `chore: update local skill rules -- ${skillName} [${today}]`;
  } else if (claudeMatch) {
    const today = new Date().toISOString().slice(0, 10);
    commitMsg = `chore: update CLAUDE.local.md [${today}]`;
  } else {
    return;
  }

  const repoRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "../..");

  // Derive the path from the file that was ACTUALLY edited, expressed relative to
  // repoRoot. Rebuilding it from the captured skill name drops any prefix (e.g.
  // `clients/<slug>/`) and would commit a different file at the repo root.
  let skillFile;
  if (path.isAbsolute(filePath)) {
    const rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    // Outside repoRoot: hand git the absolute path and let it decide.
    skillFile = rel && !rel.startsWith("../") ? rel : normalized;
  } else {
    skillFile = normalized.replace(/^\.\//, "");
  }
  if (!skillFile) return;
  const workerPath = path.join(__dirname, "skill-auto-commit-worker.js");

  const child = spawn(process.execPath, [workerPath, repoRoot, skillFile, commitMsg], {
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  });

  child.unref();
});
