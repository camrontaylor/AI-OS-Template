#!/usr/bin/env node
// Thin Claude adapter; the same guarded commands are available to Codex/manual runs.
const { spawnSync } = require('child_process');
const path = require('path');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch { /* cwd fallback */ }
  const command = process.argv[2] === 'end' ? 'save' : 'start';
  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const script = path.resolve(__dirname, '../../scripts/lib/workspace-git.sh');
  const result = spawnSync('bash', [script, command, '--cwd', cwd], {
    cwd, encoding: 'utf8', timeout: 45000, windowsHide: true,
  });
  const message = (result.stdout || '') + (result.stderr || '');
  if (command === 'start' && message.trim()) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'SessionStart', additionalContext: message.trim(),
    } }));
  } else if (message.trim()) {
    process.stderr.write(message.trim() + '\n');
  }
});
setTimeout(() => process.exit(0), 50000).unref();
