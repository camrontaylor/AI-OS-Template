#!/usr/bin/env node
// SessionStart hook - loads the curated memory snapshot per AIOS-75 (Phase 1).
// Reads context/SOUL.md, context/USER.md, context/MEMORY.md, an active client
// current-state brief when present, and today's daily log (or yesterday's as fallback).
// Injects them as additionalContext
// so Claude has them available at session start without needing the user
// to prompt "what did you read?". This is the runtime implementation of
// the "Returning Mode" silent startup steps documented in CLAUDE.md.
//
// Fire-and-forget - never blocks session start. Silent on missing files.

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
    // No JSON input - fall back to env / cwd
  }

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  function findWorkspaceRoot(start) {
    let dir = start;
    for (let i = 0; i < 12; i++) {
      if (
        fs.existsSync(path.join(dir, 'AGENTS.md')) &&
        fs.existsSync(path.join(dir, '.claude')) &&
        fs.existsSync(path.join(dir, 'clients'))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  // Walk up to find the active context root. In client folders this should be
  // the client workspace, while shared SOUL/USER still come from the top root.
  function findContextRoot(start) {
    let dir = start;
    for (let i = 0; i < 12; i++) {
      const hasContext = fs.existsSync(path.join(dir, 'context'));
      const hasInstructions =
        fs.existsSync(path.join(dir, 'AGENTS.md')) ||
        fs.existsSync(path.join(dir, 'CLAUDE.md'));
      if (hasContext && hasInstructions) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  const workspaceRoot = findWorkspaceRoot(cwd) || findContextRoot(cwd);
  const activeRoot = findContextRoot(cwd) || workspaceRoot;
  if (!workspaceRoot || !activeRoot) process.exit(0);

  function resolveFrom(root, relFile, source) {
    if (!root) return null;
    const abs = path.join(root, relFile);
    if (fs.existsSync(abs)) return { abs, source, rel: relFile };
    return null;
  }

  function dateStr(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const now = new Date();
  const today = dateStr(now);
  const yesterday = dateStr(new Date(now.getTime() - 86400000));

  const targets = [
    {
      resolved: resolveFrom(workspaceRoot, 'context/SOUL.md', 'root'),
      label: 'SOUL - agent identity',
    },
    {
      resolved: resolveFrom(workspaceRoot, 'context/USER.md', 'root'),
      label: 'USER - profile and preferences',
    },
  ];

  if (activeRoot !== workspaceRoot) {
    const localSoul = resolveFrom(activeRoot, 'context/SOUL.md', 'client');
    if (localSoul) targets.push({ resolved: localSoul, label: 'Client SOUL override' });
    const localUser = resolveFrom(activeRoot, 'context/USER.md', 'client');
    if (localUser) targets.push({ resolved: localUser, label: 'Client USER override' });
  }

  targets.push({
    resolved: resolveFrom(activeRoot, 'context/MEMORY.md', 'active'),
    label: 'MEMORY - curated working scratchpad (frozen snapshot; mid-session writes only take effect next session)',
  });

  if (activeRoot !== workspaceRoot) {
    targets.push({
      resolved: resolveFrom(activeRoot, 'context/current-state.md', 'client'),
      label: 'Client current-state brief - generated active work context',
    });
    // Root working memory too: the nightly distill routes cross-cutting and
    // root-session facts into root MEMORY.md, and client sessions were the one
    // place that never saw it (2026-07-28 memory diagnosis: client facts landed
    // in root MEMORY.md, unreachable from that client session). It is capped at
    // 2,500 chars, so the cost is negligible.
    targets.push({
      resolved: resolveFrom(workspaceRoot, 'context/MEMORY.md', 'root'),
      label: 'Root MEMORY - cross-workspace working memory (root scratchpad; client MEMORY above wins on conflict)',
    });
  }

  // Daily log: today first, yesterday as fallback if today has no session yet
  const todayLog = resolveFrom(activeRoot, `context/memory/${today}.md`, 'active');
  if (todayLog) {
    targets.push({ resolved: todayLog, label: `Today's daily log (${today})` });
  } else {
    const yLog = resolveFrom(activeRoot, `context/memory/${yesterday}.md`, 'active');
    if (yLog) {
      targets.push({
        resolved: yLog,
        label: `Yesterday's daily log (${yesterday}) - today has no session yet`,
      });
    }
  }

  const sections = [];
  for (const t of targets) {
    const resolved = t.resolved;
    if (!resolved) continue;
    try {
      const content = fs.readFileSync(resolved.abs, 'utf8').trim();
      if (content.length === 0) continue;
      sections.push(`### ${t.label}\n\nFile: \`${resolved.rel}\`\n\n${content}`);
    } catch {
      // Silent - fire and forget
    }
  }

  if (sections.length === 0) {
    process.exit(0);
  }

  const message =
    `# Silent startup - memory snapshot loaded (per CLAUDE.md Returning Mode)\n\n` +
    `These files have been auto-loaded so the silent startup is genuinely silent. ` +
    `you already have the frozen snapshot for this session. Do not greet, do not ` +
    `recap, do not list capabilities. Mid-session writes to \`context/MEMORY.md\` ` +
    `persist to disk but only take effect on the next session.\n\n` +
    `---\n\n` +
    sections.join('\n\n---\n\n');

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: message,
    },
  };

  process.stdout.write(JSON.stringify(output));
});

// Safety net - if stdin never delivers, exit silently after a few seconds
setTimeout(() => process.exit(0), 4000);
