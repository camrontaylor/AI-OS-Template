#!/usr/bin/env node
// SessionStart hook - surface the daily health rollup into the first
// interactive session of the day.
//
// Why: the 2026-07-16 audit found detect-and-report loops that never close -
// health reports pile up in folders nothing reads. scripts/health-rollup.py
// (cron: daily-health-rollup) condenses them into ONE compact file with a
// findings ledger. This hook is the consumption side: it injects the rollup's
// "Needs attention" items as additionalContext, once per day, so a broken
// loop reaches the user within 24 hours without being asked.
//
// It also watches the watcher: if the rollup file itself is stale (>48h),
// the rollup job is dead and THAT gets surfaced instead.
//
// Safe: read-only apart from the once-per-day marker. Swallows every error.

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => { try { run(); } catch { /* never block */ } process.exit(0); });
setTimeout(() => process.exit(0), 4000);

function run() {
  // Headless cron sessions also fire SessionStart; without this guard a
  // morning catch-up job would consume the once-per-day marker and the
  // findings would land in a cron transcript instead of the user's session.
  if (process.env.AI_OS_AUTONOMOUS === '1') return;

  let data = {};
  try { data = JSON.parse(input); } catch { /* fall back to env/cwd */ }
  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Resolve the AI-OS root: walk up from cwd looking for AGENTS.md + .command-centre.
  let root = cwd;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(root, 'AGENTS.md')) && fs.existsSync(path.join(root, '.command-centre'))) break;
    const parent = path.dirname(root);
    if (parent === root) return;
    root = parent;
  }
  const stateDir = path.join(root, '.command-centre');
  const rollupPath = path.join(stateDir, 'health-rollup.md');
  const markerPath = path.join(stateDir, 'health-rollup-surfaced');

  const today = new Date().toISOString().slice(0, 10);
  try {
    if (fs.readFileSync(markerPath, 'utf8').trim() === today) return; // already surfaced today
  } catch { /* no marker yet */ }

  let message = null;
  if (!fs.existsSync(rollupPath)) return; // rollup never ran yet; systems-check covers setup
  const ageHours = (Date.now() - fs.statSync(rollupPath).mtimeMs) / 3600000;
  const content = fs.readFileSync(rollupPath, 'utf8');

  if (ageHours > 48) {
    message =
      '# Daily health rollup\n\n' +
      `The health rollup itself is stale (last written ${(ageHours / 24).toFixed(1)} days ago), ` +
      'which means the daily-health-rollup cron job has stopped running. Tell the user in one ' +
      'plain sentence and suggest running: python3 scripts/health-rollup.py and a cron status check.';
  } else if (content.includes('## Needs attention')) {
    const section = content.split('## Needs attention')[1] || '';
    const items = section.split('\n').filter((l) => l.trim().startsWith('-')).slice(0, 8);
    if (items.length > 0) {
      message =
        '# Daily health rollup (surface once, briefly)\n\n' +
        'These findings come from the AI-OS self-monitoring loops. In your first reply, pass them ' +
        'to the user in 1-3 plain-English lines (lead with anything marked "[open N days]"), then ' +
        'continue with their actual request. Do not dump the raw list; summarize it.\n\n' +
        items.join('\n');
    }
  }

  if (!message) {
    // Healthy day: still stamp the marker so we do not re-read every session.
    try { fs.writeFileSync(markerPath, today); } catch { /* ignore */ }
    return;
  }

  try { fs.writeFileSync(markerPath, today); } catch { /* ignore */ }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message },
  }));
}
