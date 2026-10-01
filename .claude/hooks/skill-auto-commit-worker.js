#!/usr/bin/env node
// Worker spawned by skill-auto-commit.js — runs git add + commit for a SKILL.md change.
// Called with args: <repoRoot> <skillFile> <commitMsg>

const { spawnSync } = require("child_process");

const [,, repoRoot, skillFile, commitMsg] = process.argv;
if (!repoRoot || !skillFile || !commitMsg) process.exit(0);

const opts = { cwd: repoRoot, stdio: "ignore" };

spawnSync("git", ["add", skillFile], opts);

const staged = spawnSync("git", ["diff", "--cached", "--name-only"], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (!staged.stdout || !staged.stdout.trim()) process.exit(0);

spawnSync("git", ["commit", "-m", commitMsg], opts);
