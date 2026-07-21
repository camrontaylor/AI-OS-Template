#!/usr/bin/env node
// SessionEnd hook - fire-and-forget template propagation.
//
// Thin wrapper around scripts/template-sync.sh --auto. Runs AFTER base-autosave
// (which commits the session's systemic edits first), so a systemic change made
// this session flows out to the AI-OS template automatically, without relying on
// the agent remembering to do it - the whole point being that prose rules get
// dodged and hooks do not.
//
// Safe by construction (all enforced inside template-sync.sh):
//   * DISARMED BY DEFAULT: --auto is a silent no-op unless this install ran
//     `template-sync.sh --arm`. This file ships in the template, so every install
//     gets it; without the arm flag no downstream install ever pushes.
//   * Only ai_os_owned files, minus user_owned, ever move; personalized files are
//     held back by the sanitizer; changes land on a branch + PR, never template main.
//   * No-op in worktrees and on a clean tree.
//
// Detached: the sync does network I/O (clone/fetch/push), so we spawn it detached
// and return immediately. Session end is never delayed or blocked.

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => { try { run(); } catch { /* never block */ } process.exit(0); });
setTimeout(() => process.exit(0), 5000);

function run() {
  let data = {};
  try { data = JSON.parse(input); } catch { /* fall back to env/cwd */ }
  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Resolve the primary checkout (git common dir's parent) - same as base-autosave.
  let common = '';
  try {
    common = execSync('git rev-parse --path-format=absolute --git-common-dir',
      { cwd, encoding: 'utf8', timeout: 4000 }).trim();
  } catch { return; }
  if (!common) return;

  const base = path.dirname(common);
  const script = path.join(base, 'scripts', 'template-sync.sh');
  if (!fs.existsSync(script)) return;

  // Cheap early exit: if not armed, do not even spawn.
  const armFlag = path.join(base, '.command-centre', 'template-sync-armed');
  if (!fs.existsSync(armFlag)) return;

  const logDir = path.join(base, '.backup', 'template-sync');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
  let out = 'ignore';
  try { out = fs.openSync(path.join(logDir, 'hook.log'), 'a'); } catch { /* ignore */ }

  const child = spawn('bash', [script, '--auto'], {
    cwd: base,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
}
