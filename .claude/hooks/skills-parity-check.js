#!/usr/bin/env node
// SessionStart hook - checks .claude/skills/ and .agents/skills/ are in sync.
// If they drift apart (one agent gains a skill the other can't see), surfaces
// a plain-English warning as additionalContext so it's visible at session open.
// Fire-and-forget: never blocks session start. Silent on success.

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try {
    let data = {};
    try { data = JSON.parse(input); } catch { /* fall through */ }

    const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const script = path.join(cwd, 'scripts/lib/skills-parity-check.sh');

    if (!fs.existsSync(script)) { process.exit(0); }

    try {
      execSync(`bash "${script}" "${cwd}"`, { stdio: 'pipe' });
      process.exit(0);
    } catch (err) {
      const msg = (err.stdout || Buffer.from('')).toString().trim();
      if (!msg) { process.exit(0); }
      process.stdout.write(JSON.stringify({
        additionalContext: `WARNING: ${msg}`,
      }));
    }
  } catch {
    // Never block session start
  }
  process.exit(0);
});
