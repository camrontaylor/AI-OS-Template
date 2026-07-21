#!/usr/bin/env node
// overwrite-guard.js
// PreToolUse hook: hard warning before a full Write replaces an existing,
// populated file in a protected zone (curated identity, brand, context, and
// live skills).
// Leaves Edit alone (surgical, requires a prior Read). New or empty files pass.
// New files, project outputs, and non-protected paths are never blocked.

const fs = require('fs');
const path = require('path');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

let input;
try { input = JSON.parse(readStdin() || '{}'); } catch (e) { process.exit(0); }

const tool = input.tool_name || '';
const ti = input.tool_input || {};
const filePath = ti.file_path || ti.path || '';

// Only guard full-content Writes.
if (tool !== 'Write' || !filePath) process.exit(0);

let exists = false, size = 0;
try { const st = fs.statSync(filePath); exists = st.isFile(); size = st.size; } catch (e) {}

// A new file or an empty file is always fine to write.
if (!exists || size === 0) process.exit(0);

const norm = String(filePath).replace(/\\/g, '/');
const base = path.basename(norm);
const protectedNames = new Set([
  'SOUL.md', 'USER.md', 'MEMORY.md', 'learnings.md', 'AGENTS.md', 'CLAUDE.md',
]);

const isProtected =
  norm.includes('/brand_context/') ||
  norm.includes('/.claude/skills/') ||
  /\/clients\/[^/]+\/context\//.test(norm) ||
  protectedNames.has(base);

if (!isProtected) process.exit(0);

const reason =
  'OVERWRITE GUARD: "' + base + '" already exists and is not empty in a protected ' +
  'location (' + norm + '). A full Write would replace all of its contents. ' +
  'For a curated identity, brand, context, live skill, or tool adapter file, prefer Edit for a ' +
  'surgical change, or confirm with the user that a full overwrite is intended ' +
  'before proceeding.';

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: reason,
  },
}));
process.exit(0);
