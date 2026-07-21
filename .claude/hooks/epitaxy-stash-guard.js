#!/usr/bin/env node
// SessionStart hook — Epitaxy Stash Guard.
//
// Problem it solves: when a concurrent session or tool switches branches in a
// SHARED git checkout, it runs `git stash push --include-untracked` (the stash is
// labelled "epitaxy:"). If that session ends before popping, the stash is orphaned
// and the files look deleted. This has stranded real work more than once.
//
// What it does: at session start it lists any orphaned `epitaxy:` stashes and
// surfaces them with one-line recovery instructions, so stranded work is ALWAYS
// visible and never silently lost.
//
// Safety: READ-ONLY. It only runs `git stash list` / `git stash show`. It never
// applies, pops, or drops a stash. Fire-and-forget — never blocks session start.
// Silent when there are no epitaxy stashes.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // No JSON — fall back to env / cwd
  }

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Walk up to the git root so this works from client subfolders too.
  function findRoot(start) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return start;
  }
  const root = findRoot(cwd);

  function git(args) {
    try {
      return execSync(`git ${args}`, { cwd: root, encoding: 'utf8', timeout: 4000 }).trim();
    } catch {
      return '';
    }
  }

  const list = git('stash list');
  if (!list) process.exit(0);

  const lines = list.split('\n').filter((l) => /epitaxy:/i.test(l));
  if (lines.length === 0) process.exit(0);

  const details = lines.map((line) => {
    const ref = (line.match(/^(stash@\{\d+\})/) || [])[1] || '';
    const branch = (line.match(/On ([^:]+):/) || [])[1] || 'unknown';
    let count = '?';
    if (ref) {
      const files = git(`stash show ${ref} --include-untracked --name-only`);
      count = files ? files.split('\n').filter(Boolean).length : 0;
    }
    return { ref, branch: branch.trim(), count };
  });

  const bullets = details
    .map(
      (d) =>
        `- \`${d.ref}\` from branch \`${d.branch}\` holds ${d.count} file(s). ` +
        `See: \`git stash show ${d.ref} --include-untracked --name-only\``
    )
    .join('\n');

  const message =
    `# Stranded work detected (epitaxy stash guard)\n\n` +
    `A concurrent session or tool stashed uncommitted work when it switched ` +
    `branches in this shared checkout. ${details.length} orphaned \`epitaxy:\` ` +
    `stash(es) are present. Nothing is lost — each can be recovered.\n\n` +
    `${bullets}\n\n` +
    `To recover one onto its branch: \`git checkout <branch> && git stash apply <ref>\` ` +
    `(use \`apply\`, not \`pop\`, so the stash stays as a backup until verified). ` +
    `Never drop a stash until its contents are confirmed committed somewhere. ` +
    `Surface this to the user; do not silently apply or drop stashes.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: message,
      },
    })
  );
});

// Safety net — exit if stdin never delivers.
setTimeout(() => process.exit(0), 5000);
