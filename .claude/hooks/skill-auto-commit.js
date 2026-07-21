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
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "../..");
  const today = new Date().toISOString().slice(0, 10);

  // AI-OS plan A7: never auto-commit while on main. main is protected and its
  // commits get reviewed via PR, so silent auto-commits do not belong there.
  try {
    const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout.trim();
    if (branch === "main") return;
  } catch {
    /* if git is unavailable, fall through to the original behaviour */
  }

  let skillFile, commitMsg;
  const skillMatch = normalized.match(/\.claude\/skills\/([^/]+)\/SKILL\.local\.md$/);
  const claudeMatch = normalized.match(/(?:^|\/)CLAUDE\.local\.md$/);

  if (skillMatch) {
    const skillName = skillMatch[1];
    if (skillName === "_catalog") return;
    commitMsg = `chore: update local skill rules -- ${skillName} [${today}]`;
    skillFile = `.claude/skills/${skillName}/SKILL.local.md`;
  } else if (claudeMatch) {
    // AI-OS plan A7: stop auto-committing CLAUDE.local.md on every edit. It is
    // user-owned, changes often, and was flooding history with noise commits.
    return;
  } else {
    // Content-zone auto-save: keep deliverable work durable so a branch-switch
    // stash (epitaxy) can never strand it. Scoped to project output folders only;
    // config and code stay manual so they get reviewed before landing.
    let rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) return; // outside the repo
    const isProjectWork =
      /^projects\//.test(rel) || /^clients\/[^/]+\/projects\//.test(rel);
    if (!isProjectWork) return;
    commitMsg = `chore: auto-save work in progress -- ${rel} [${today}]`;
    skillFile = rel;
  }

  const workerPath = path.join(__dirname, "skill-auto-commit-worker.js");

  const child = spawn(process.execPath, [workerPath, repoRoot, skillFile, commitMsg], {
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  });

  child.unref();
});
