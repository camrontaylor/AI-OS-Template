#!/usr/bin/env node
// SessionStart hook — loads the curated memory snapshot per AIOS-75 (Phase 1).
// Reads the solo memory snapshot, or only solo-safe identity context when
// Team OS is connected. Team/private/client context comes from the server
// snapshot injected by team-context-snapshot.js.
//
// Fire-and-forget — never blocks session start. Silent on missing files.

const fs = require('fs');
const os = require('os');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // No JSON input — fall back to env / cwd
  }

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findRoot(cwd);

  // Walk up to find an AI-OS root (AGENTS.md + .claude/ present)
  // so the hook works from client subfolders or projects/briefs/ subfolders.
  function findRoot(start) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      const hasAgents = fs.existsSync(path.join(dir, 'AGENTS.md'));
      const hasClaude = fs.existsSync(path.join(dir, 'CLAUDE.md'));
      const hasClaudeDir = fs.existsSync(path.join(dir, '.claude'));
      if ((hasAgents || hasClaude) && hasClaudeDir) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  function teamConfigPath() {
    const dir = process.env.AI_OS_TEAM_CONFIG_DIR
      ? path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR)
      : path.join(os.homedir(), '.AI-OS');
    return path.join(dir, 'team-context.json');
  }

  function hasSavedTeamContext() {
    try {
      const parsed = JSON.parse(fs.readFileSync(teamConfigPath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object') return false;
      const apiUrl = typeof parsed.apiUrl === 'string' ? parsed.apiUrl.trim() : '';
      const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
      return /^https?:\/\//i.test(apiUrl) && token !== '';
    } catch {
      return false;
    }
  }

  // Prefer the local context (e.g., a client subfolder) over the root,
  // matching the fallback chain documented in CLAUDE.md.
  function resolveContext(relFile) {
    const local = path.join(cwd, relFile);
    if (fs.existsSync(local)) return { abs: local, source: 'local' };
      if (root && root !== cwd) {
        const rooted = path.join(root, relFile);
        if (fs.existsSync(rooted)) return { abs: rooted, source: 'root' };
    }
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

  const conversationOnly = process.env.AI_OS_TEAM_ENRICHMENT === 'conversation_only';
  const teamMode =
    conversationOnly ||
    process.env.AI_OS_WORK_MODE === 'team' ||
    Boolean(process.env.AI_OS_CONTEXT_OVERLAY_DIR) ||
    hasSavedTeamContext();
  const targets = [
    { rel: 'context/SOUL.md', label: 'SOUL - agent identity' },
  ];

  if (!teamMode) {
    targets.push(
      { rel: 'context/USER.md', label: 'USER - profile and preferences' },
      {
        rel: 'context/MEMORY.md',
        label: 'MEMORY - curated working scratchpad (frozen snapshot; mid-session writes only take effect next session)',
      },
    );

    // Daily log: today first, yesterday as fallback if today has no session yet
    const todayLog = resolveContext(`context/memory/${today}.md`);
    if (todayLog) {
      targets.push({ rel: `context/memory/${today}.md`, label: `Today's daily log (${today})` });
    } else {
      const yLog = resolveContext(`context/memory/${yesterday}.md`);
      if (yLog) {
        targets.push({
          rel: `context/memory/${yesterday}.md`,
          label: `Yesterday's daily log (${yesterday}) - today has no session yet`,
        });
      }
    }
  }

  const sections = [];
  for (const t of targets) {
    const resolved = resolveContext(t.rel);
    if (!resolved) continue;
    try {
      const content = fs.readFileSync(resolved.abs, 'utf8').trim();
      if (content.length === 0) continue;
      sections.push(`### ${t.label}\n\nFile: \`${t.rel}\`\n\n${content}`);
    } catch {
      // Silent — fire and forget
    }
  }

  if (sections.length === 0) {
    process.exit(0);
  }

  const message =
    `# Silent startup - memory snapshot loaded (per CLAUDE.md Returning Mode)\n\n` +
    (conversationOnly
      ? `This existing Team chat is continuing in conversation-only mode. Use only context already present in the saved conversation. Do not load Team context, memory, skills, secrets, or shared files, and do not capture or consolidate Team memory.\n\n`
      : teamMode
      ? `Team OS mode is active, so local USER.md, MEMORY.md, and daily logs were not loaded here. Use only the Team OS server-resolved snapshot for team, client, and private user context.\n\n`
      : `These files have been auto-loaded so the silent startup is genuinely silent - you already have the frozen snapshot for this session. Do not greet, do not recap, do not list capabilities. Mid-session writes to \`context/MEMORY.md\` persist to disk but only take effect on the next session.\n\n`) +
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

// Safety net — if stdin never delivers, exit silently after a few seconds
setTimeout(() => process.exit(0), 4000);
