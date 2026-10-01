#!/usr/bin/env node
// Branch Guard — PreToolUse hook
// Zone-based branch protection: nudges users toward the right branch
// for the type of files they're changing.
//
// Zones:
//   Content (projects/, brand_context/, context/, cron/jobs/, clients/) — commit freely to dev
//   Config  (SKILL.md, AGENTS.md, CLAUDE.md, .env.example, scripts/) — advisory: use feature branch
//   Code    (command-centre/, .claude/hooks/, runtime JS/TS) — strong nudge: use feature branch
//
// On main: always warns (GitHub branch protection is the hard gate).
// On feature/* or worktree-*: always allows.

const { execSync } = require('child_process');

// Zone classification patterns
const CODE_PATTERNS = [
  /^command-centre\//,
  /\.claude\/hooks\/.*\.(js|ts)$/,
];

const CONFIG_PATTERNS = [
  /\.claude\/skills\/.*\/SKILL\.md$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^\.env\.example$/,
  /^scripts\/.*\.sh$/,
];

const CONTENT_PATTERNS = [
  /^projects\//,
  /^brand_context\//,
  /^context\//,
  /^cron\/jobs\//,
  /^clients\//,
];

function classifyFile(filePath) {
  // Normalize to repo-relative path
  const rel = filePath.replace(/^.*?(?=projects\/|brand_context\/|context\/|cron\/|clients\/|\.claude\/|AGENTS\.md|CLAUDE\.md|\.env\.example|scripts\/)/, '');

  for (const p of CODE_PATTERNS) {
    if (p.test(rel)) return 'code';
  }
  for (const p of CONFIG_PATTERNS) {
    if (p.test(rel)) return 'config';
  }
  for (const p of CONTENT_PATTERNS) {
    if (p.test(rel)) return 'content';
  }
  return 'unknown';
}

function classifyFiles(files) {
  let highest = 'content';
  for (const f of files) {
    const zone = classifyFile(f);
    if (zone === 'code') return 'code';
    if (zone === 'config') highest = 'config';
  }
  return highest;
}

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return 'unknown';
  }
}

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only', { encoding: 'utf8', timeout: 3000 }).trim();
    return output ? output.split('\n') : [];
  } catch {
    return [];
  }
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 4000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;
    const toolInput = data.tool_input || {};

    const branch = getCurrentBranch();

    // feature/* and worktree-* branches: always allow
    if (branch.startsWith('feature/') || branch.startsWith('worktree-')) {
      process.exit(0);
    }

    let zone = 'unknown';
    let filePath = '';

    if (toolName === 'Write' || toolName === 'Edit') {
      filePath = toolInput.file_path || '';
      zone = classifyFile(filePath);
    } else if (toolName === 'Bash') {
      const cmd = toolInput.command || '';

      // Only inspect git commit and git push commands
      if (!/git\s+(commit|push)/.test(cmd)) {
        process.exit(0);
      }

      if (/git\s+commit/.test(cmd)) {
        const staged = getStagedFiles();
        if (staged.length === 0) {
          process.exit(0);
        }
        zone = classifyFiles(staged);
      } else if (/git\s+push/.test(cmd)) {
        // For push, warn if on main regardless
        zone = 'code';
      }
    } else {
      process.exit(0);
    }

    // Build advisory message based on branch + zone
    let message = null;

    if (branch === 'main') {
      message = `You're on main — switch to dev or a feature branch before committing. ` +
        `Direct pushes to main are blocked by GitHub branch protection. ` +
        `Use \`git checkout dev\` or start a feature with \`/new-feature\`.`;
    } else if (branch === 'dev') {
      if (zone === 'code') {
        message = `This change touches code (Zone 3). Consider using \`/new-feature\` to create a feature branch ` +
          `for code changes — it keeps dev stable and gives you a clean merge path.`;
      } else if (zone === 'config') {
        message = `This change touches config files (Zone 2). Consider using \`/new-feature\` for config changes ` +
          `— especially if they affect agent behaviour or CI.`;
      }
      // content on dev: no message needed
    }
    // Other branches (not feature/*, not worktree-*, not main, not dev): no message

    if (!message) {
      process.exit(0);
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: message,
      },
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    // Silent fail — never block tool execution
    process.exit(0);
  }
});
