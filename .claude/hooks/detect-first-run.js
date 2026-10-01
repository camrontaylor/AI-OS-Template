#!/usr/bin/env node
// SessionStart hook — auto-detects a first-run client whose brand voice is not
// yet set up, and offers optional /start-here onboarding. A stated user task
// always takes precedence. Mirrors the shared startup guard in
// CLAUDE.md and the Guard in .claude/commands/start-here.md: "not set up" means
// brand_context/ is absent OR contains no populated .md files. A root used as a
// personal hub is treated as set up once any clients/*/brand_context/ is
// populated, and context/.onboarding-skipped records a user who declined.
//
// Emits context the same way load-memory-snapshot.js does:
//   hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext }
//
// Fire-and-forget — never throws, never blocks session start. If brand voice is
// already configured it emits nothing (no nag, no false trigger).

const fs = require('fs');
const os = require('os');
const path = require('path');

function hasSavedTeamContext() {
  try {
    const dir = process.env.AI_OS_TEAM_CONFIG_DIR
      ? path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR)
      : path.join(os.homedir(), '.AI-OS');
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'team-context.json'), 'utf8'));
    return (
      parsed &&
      typeof parsed === 'object' &&
      /^https?:\/\//i.test(typeof parsed.apiUrl === 'string' ? parsed.apiUrl.trim() : '') &&
      typeof parsed.token === 'string' &&
      parsed.token.trim() !== ''
    );
  } catch {
    return false;
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    if (
      process.env.AI_OS_WORK_MODE === 'team' ||
      process.env.AI_OS_TEAM_ENRICHMENT === 'conversation_only' ||
      process.env.AI_OS_CONTEXT_OVERLAY_DIR ||
      hasSavedTeamContext()
    ) {
      process.exit(0);
    }

    let data = {};
    try {
      data = JSON.parse(input);
    } catch {
      // No JSON input — fall back to env / cwd
    }

    const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // A brand_context/ is "populated" if it exists and holds at least one .md
    // file with real (non-whitespace) content. Templates with only headers are
    // still considered set up if they carry text — matching the start-here Guard
    // which checks for populated .md files (ls, not deep parse).
    function isFirstRun(dir) {
      const brandDir = path.join(dir, 'brand_context');
      if (!fs.existsSync(brandDir)) return true;
      let entries = [];
      try {
        entries = fs.readdirSync(brandDir);
      } catch {
        return true;
      }
      const mdFiles = entries.filter((f) => f.toLowerCase().endsWith('.md'));
      if (mdFiles.length === 0) return true;
      for (const f of mdFiles) {
        try {
          const content = fs.readFileSync(path.join(brandDir, f), 'utf8').trim();
          if (content.length > 0) return false; // populated → already set up
        } catch {
          // unreadable file — ignore, keep checking
        }
      }
      return true; // .md files exist but all empty → still first-run
    }

    // Personal-hub roots keep their businesses under clients/; one configured
    // client means the workspace is in use, so don't re-onboard the root.
    function hasConfiguredClient(dir) {
      let clients = [];
      try {
        clients = fs.readdirSync(path.join(dir, 'clients'), { withFileTypes: true });
      } catch {
        return false;
      }
      return clients.some(
        (entry) => entry.isDirectory() && !isFirstRun(path.join(dir, 'clients', entry.name))
      );
    }

    if (
      !isFirstRun(cwd) ||
      fs.existsSync(path.join(cwd, 'context', '.onboarding-skipped')) ||
      hasConfiguredClient(cwd)
    ) {
      process.exit(0); // already configured or skipped — emit nothing
    }

    const message =
      `# First use — optional AI-OS setup\n\n` +
      `No populated brand context was found. Follow docs/agent-startup.md. ` +
      `If the user states a task, begin it immediately using the selected skill; ` +
      `missing brand context never blocks work. If they ask for setup, run ` +
      `/start-here using .claude/commands/start-here.md. If they only greet, ` +
      `briefly offer setup or immediate work. Honor the skip path and ` +
      `context/.onboarding-skipped marker. GitHub backup is optional.`;

    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: message,
      },
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    // Fire-and-forget — never corrupt the JSON contract, never block startup.
    process.exit(0);
  }
});

// Safety net — if stdin never delivers, exit silently after a few seconds
setTimeout(() => process.exit(0), 4000);
