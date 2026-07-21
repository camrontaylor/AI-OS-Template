#!/usr/bin/env node
// SessionStart hook - surface branch-state and autosave skips into chat.
//
// Why: base-return-to-main and base-autosave write user-visible notes to
// .command-centre/branch-state.log and .command-centre/autosave-pending.log
// because stderr in a SessionStart hook is swallowed by Claude's hook surface.
// This hook reads those logs and emits them as additionalContext so the user
// actually SEES "you are on side branch X with 4 commits" or "a 7MB file was
// skipped". Without this, the messages exist on disk but never reach the chat.
//
// Wired AFTER worktree-data-link and AFTER base-return-to-main in SessionStart,
// so it sees the latest entries that those hooks just wrote.
//
// Safe: read-only. Only surfaces NEW lines since the last surface (tracks an
// offset per log) so the same message is not re-shown every session.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => { try { run(); } catch { /* never block */ } process.exit(0); });
setTimeout(() => process.exit(0), 4000);

function run() {
  let data = {};
  try { data = JSON.parse(input); } catch { /* fall back to env/cwd */ }
  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let common = '';
  try { common = execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd, encoding: 'utf8', timeout: 3000 }).trim(); }
  catch { return; }
  if (!common) return;

  const base = path.dirname(common);
  const dir = path.join(base, '.command-centre');
  const stateFile = path.join(dir, 'state-surface-offset.json');

  // Load per-log offsets so we never re-surface the same message twice.
  let offsets = {};
  try { offsets = JSON.parse(fs.readFileSync(stateFile, 'utf8') || '{}'); } catch { /* first run */ }

  const logs = [
    { file: 'branch-state.log',     label: 'Branch state' },
    { file: 'autosave-pending.log', label: 'Skipped large files' },
  ];

  const sections = [];
  for (const { file, label } of logs) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    let content = '';
    try { content = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const prev = offsets[file] || 0;
    if (content.length <= prev) continue;
    const fresh = content.slice(prev).trim();
    if (!fresh) continue;
    // Only show the last few lines so a long-running log does not spam.
    const lines = fresh.split('\n').filter(Boolean).slice(-5);
    sections.push(`**${label}** (since last session):\n${lines.map((l) => '- ' + l).join('\n')}`);
    offsets[file] = content.length;
  }

  if (sections.length === 0) return;

  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  try { fs.writeFileSync(stateFile, JSON.stringify(offsets)); } catch { /* ignore */ }

  const msg =
    `# Folder state notes\n\n` +
    `Saved while you were away. Read them and pass on anything relevant in plain words.\n\n` +
    sections.join('\n\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg },
  }));
}
