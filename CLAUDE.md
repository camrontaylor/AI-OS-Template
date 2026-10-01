# CLAUDE.md

Keeps Claude Code compatible with the shared `AGENTS.md` and adds Claude-only
runtime behavior.

@AGENTS.md

---

## Local Overrides

Local override loading follows the canonical rule in AGENTS.md ("Local Agent
Overrides"). Claude-only addition: also read `CLAUDE.local.md` before this file
when present. Both files are user-owned, never updated.

---

## Claude Runtime

### Shared Startup

Follow `docs/agent-startup.md` from the shared AGENTS.md. The
`detect-first-run.js` hook supplies an optional setup hint; it does not override
a user task. Use `/start-here` only when the user chooses guided setup.
Do not duplicate a daily session block already opened during startup.
Scheduled cron runs (`AI_OS_CRON_JOB_SLUG` is set) follow the job prompt only.
Team mode uses the injected snapshot exclusively and skips local startup.

### Greeting & Checkpoint

- Don't greet proactively. If the user greets casually and open threads exist,
  mention them in one line. If they state a task, begin immediately.
- After a major deliverable (file saved to `projects/`, skill built/modified),
  run the post-deliverable question from AGENTS.md ("How did this land? Any
  adjustments?") and log feedback per that rule. Skip this for quick answers or
  small edits.

### Daily Memory

Each session appends a numbered `## Session N` block to
`context/memory/{YYYY-MM-DD}.md`, tracking goal, deliverables, decisions and open
threads silently as they happen (never announce). A `### Project` reference means
load that brief. On sign-off, run `meta-wrap-up`, finalising the current block.
Template + tracked events: `docs/daily-memory.md`.
