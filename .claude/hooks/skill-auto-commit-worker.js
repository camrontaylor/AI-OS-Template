#!/usr/bin/env node
// Worker spawned by skill-auto-commit.js — runs git add + commit for a SKILL.md change.
// Called with args: <repoRoot> <skillFile> <commitMsg>

const { spawnSync } = require("child_process");

const [,, repoRoot, skillFile, commitMsg] = process.argv;
if (!repoRoot || !skillFile || !commitMsg) process.exit(0);

const opts = { cwd: repoRoot, stdio: "ignore" };

// Only act if this specific file actually has changes — avoids empty commits.
const status = spawnSync("git", ["status", "--porcelain", "--", skillFile], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (!status.stdout || !status.stdout.trim()) process.exit(0);

// Stage and commit ONLY this file, so unrelated staged work is never swept in.
spawnSync("git", ["add", "--", skillFile], opts);
spawnSync("git", ["commit", "-m", commitMsg, "--", skillFile], opts);
