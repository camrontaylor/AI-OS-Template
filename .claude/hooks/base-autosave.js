#!/usr/bin/env node
// SessionEnd hook - thin wrapper around scripts/base-autosave.sh.
//
// The real logic lives in scripts/base-autosave.sh so it is tool-neutral.
// This wrapper just locates the
// primary checkout and runs it. Runs on SessionEnd only - keeping the primary clean
// when a session ends is enough for the next session to open unblocked; per-turn
// committing was removed because it flooded history and grew the local/origin gap.
//
// Fire-and-forget: never blocks session end. The script itself is a no-op in
// worktrees, on a clean tree, or mid merge/rebase.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => { try { run(); } catch { /* never block */ } process.exit(0); });
// Outer backstop must stay above the script timeout below (was 15000/12000, too
// tight for a local commit plus an HTTPS backup push, which silently killed the
// push mid-flight for days; 2026-07-20).
setTimeout(() => process.exit(0), 21000);

function run() {
  let data = {};
  try { data = JSON.parse(input); } catch { /* fall back to env/cwd */ }
  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let common = '';
  try { common = execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd, encoding: 'utf8', timeout: 4000 }).trim(); }
  catch { return; }
  if (!common) return;

  const base = path.dirname(common);
  const script = path.join(base, 'scripts', 'base-autosave.sh');
  if (!fs.existsSync(script)) return;

  try { execSync(`bash "${script}"`, { cwd, timeout: 18000, stdio: 'ignore' }); }
  catch { /* fire-and-forget */ }
}
