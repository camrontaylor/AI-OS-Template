---
name: meta-wrap-up

description: >
  End-of-session checklist that reviews deliverables, collects feedback,
  fixes skills, updates learnings, and commits work. Triggers
  AUTOMATICALLY when the user signals the session is ending (sign-offs
  like "that's all", "done for today", "bye", or an explicit "wrap up"
  or /wrap-up). Also offered (not run) after a major deliverable, by
  asking whether the user wants to wrap up.
  Does NOT trigger for content writing, voice extraction, positioning,
  or audience research. Does NOT trigger for mid-conversation "thanks"
  that clearly mean "thanks, now do X" rather than session end.
---

# Wrap-Up

End-of-session checklist. Four steps: review what was done, collect feedback, apply fixes, commit everything.

## Outcome

- Updated `context/learnings.md` with session feedback
- Updated `context/memory/{today}.md` with its existing session log and confirmed corrections
- Updated `context/USER.md` if new preferences were observed
- Proposed `context/SOUL.md` updates if behaviour corrections were observed
- Direct fixes applied to any skills that need them
- `docs/skill-registry.md`, `docs/context-matrix.md`, and README.md synced with any new or removed skills/MCPs
- Clean git commit of all session work
- Session summary presented in consistent format

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `context/learnings.md` | `## meta-wrap-up` section | Check for previous wrap-up insights |
| `context/USER.md` | Full | Check if preferences need updating |
| `context/SOUL.md` | Full | Check if behaviour rules need updating based on session corrections |
| All `brand_context/` files | Scan only | Identify which files were created or modified this session |

Load if they exist. Proceed without them if not. In Team mode, use only the
authorized injected context and connected storage; skip local context reads,
memory writes and Solo maintenance. Report a missing authorized storage path
instead of using local files as a fallback.

---

## Step 1: Review Deliverables

Scan what happened this session:

1. Run `git status` and `git diff --stat` to see all changes
2. List every file created or modified, grouped by location:
   - `brand_context/` — foundation files written or updated
   - `projects/` — deliverables produced
   - `.claude/skills/` — skills created or modified
   - Other locations — flag for file placement check
3. **File placement check:** Verify outputs follow naming conventions:
   - Projects in `projects/{category}-{output-type}/` with correct prefix
   - Filenames use `{YYYY-MM-DD}_{descriptive-name}.md` format
   - If anything is misplaced or misnamed, fix it now

---

## Step 2: Collect Feedback

Default to one question: **"Anything to note before I wrap up?"**

Only expand to the full three questions below if multiple skills were used in the session or the user explicitly wants to give detailed feedback:

1. **What worked well?** — Anything the skills produced that hit the mark
2. **What didn't work?** — Anything that missed, needed heavy editing, or frustrated you
3. **Any specific skill issues?** — Did a skill take the wrong approach, miss context, or produce the wrong format?

---

## Step 3: Apply Changes

Two types of updates based on the feedback:

### 3a: Update Learnings

Log feedback to `context/learnings.md`:
- Skill-specific feedback → `# Individual Skills` → `## {skill-folder-name}` section
- Cross-skill patterns → `# General` → `## What works well` or `## What doesn't work well`
- **Dedup guard:** Before appending, scan the skill's section for duplicate entries. If the same lesson already exists, skip or update the date.

Each entry format:
```
- {YYYY-MM-DD}: {What happened and what was learned}
```

### 3b: Fix Skills Directly

If feedback points to a specific skill issue — wrong approach, missing step, bad default, missing context — **edit the SKILL.md or reference file directly**. Don't just log it; fix it.

Examples of direct fixes:
- Skill missed a step → add the step to SKILL.md
- Wrong output format → update the format instructions
- Skill should have loaded context it didn't → update Context Needs table
- A reference file has outdated guidance → edit the reference

After applying fixes, log what was changed in the skill's learnings section so there's a record.

### 3c: Finalise Daily Memory

One file per day: `context/memory/{YYYY-MM-DD}.md`. The session block is created at startup. Wrap-up **finalises the existing block** — it does NOT create a new session block.

**Note:** Auto-tracking during the session means most deliverables, decisions, and open threads are already logged. This step is about confirming and polishing what's there, not writing from scratch.

**Find the current session's `## Session N` block** and replace any placeholder text with real content. Preserve recorded decisions and corrections:

```
## Session N

### Goal
[One line — what the user set out to do]

### Deliverables
- `path/to/file` — what it is

### Decisions
- [Decision and rationale]

### Corrections
- [general] [Confirmed lesson, or use the relevant installed skill name]

### Open threads
- [Anything unfinished for the next session]
```

**Rules:**
- **Never append a new session block**, because a second block for the same session splits the day's record and breaks the one-file-per-day contract; wrap-up completes the block that was started
- **Never leave placeholder text** like `[Waiting for user goal]`. Replace placeholders with actual content from the session
- Omit sections that don't apply (e.g., no Decisions section if none were made)

In Solo mode, promote recorded corrections with the shared root's
`scripts/workspace-maintenance.py corrections --scope <active-workspace> --date <today>`
using Python 3. Follow with `--check` and read back the changed learnings section.
Do not invent corrections or repeat a rejected Team-mode command with an override.
Full contract: `docs/agent-reliability.md`.
- If no session block exists yet (e.g., heartbeat was skipped), create one — but this is the fallback, not the norm

### 3d: Evolve SOUL.md (agent-suggested, user-approved)

Review the session for behaviour corrections — moments where the user pushed back, corrected your approach, or expressed frustration with how you handled something. If a correction points to a missing or wrong rule in `context/SOUL.md`, **propose the change to the user**:

- Tell them what you observed: "You corrected me twice about X"
- Show the proposed SOUL.md edit (the specific line to add/change)
- Only apply it if they approve

Most sessions won't trigger this. Only propose changes for patterns, not one-off corrections. This keeps SOUL.md sharp over time without silent rewrites.

### 3e: Update User Preferences

If you noticed new patterns about how the user works — communication style, preferred formats, feedback cadence, working hours — update `context/USER.md`. Don't ask permission for small additions to the Notes section; do ask before changing core preferences.

### 3f: Skill & MCP Sync + Deferred Startup Checks

This step absorbs the checks deferred from startup to keep session start fast. Run all of the following:

**Deferred checks:**
- **Stale brand_context flagging:** Scan `brand_context/` for files older than 30 days. Flag any that are stale.
- **Active project scan:** Scan `projects/briefs/*/brief.md` for active projects. Report any that exist.
- **Cron dispatcher status:** Check whether the cron dispatcher is installed. If so, read `cron/status/` and report anything relevant.

**Reconciliation** (per-case steps in `docs/building-skills.md`). This catches anything that changed during the session:

1. **Skills**: compare `.claude/skills/` folders against `docs/skill-registry.md` and `docs/context-matrix.md`:
   - New skill folder not yet registered → add to `docs/skill-registry.md`, `docs/context-matrix.md`, README.md skill tables, and `context/learnings.md`
   - Registered skill whose folder was deleted → ask user: "Remove `{skill-name}` from `docs/skill-registry.md`, `docs/context-matrix.md`, README.md, and context/learnings.md?"

2. **External services** — for any new or modified skills, scan for API key dependencies (see AGENTS.md § External Services & API Keys). Auto-add any new services to:
   - `.env.example` (the canonical service registry: key, what it does, and `# Used by:` skills)
   - README.md External Services table

3. **MCPs** — compare `.claude/settings.json` MCP entries against README.md:
   - New MCP not documented → add to README.md Connected Tools section
   - Documented MCP removed from settings → ask user: "Remove `{mcp-name}` from README.md?"

Log any sync actions in the session summary under a **Registry sync** line.

### 3g: Update Working Memory

Promote durable facts from the session into `context/MEMORY.md` (the curated scratchpad read at session start).

1. Read the `## Session N` block finalised in step 3c
2. Identify durable facts worth keeping beyond today:
   - New URLs, configs, tool versions, project structure → `## Environment Notes`
   - Threads still warm or unfinished → `## Active Threads`
   - Decisions waiting on user input → `## Pending Decisions`
3. Read `context/MEMORY.md` and apply changes:
   - Add new durable facts to the appropriate section (dedup check first — substring match)
   - Remove threads that were resolved this session
   - Replace stale entries with current values
4. Check character count:
   - Bash: `wc -c < context/MEMORY.md`
   - PowerShell: `(Get-Item context/MEMORY.md).Length`
5. If over **2,500 chars**, consolidate (merge similar lines, tighten verbose entries) before saving
6. Skip silently if nothing durable surfaced this session — most planning/discussion sessions won't have anything to promote

Report usage in the session summary under the **Memory** block: `MEMORY.md: {N}/2,500 chars ({pct}%)`.

### 3h: Memory Coverage Stats

Run: `bash scripts/lib/memory-meta.sh`

Add the output to the session summary under a **Memory coverage** block:
- MEMORY.md: {N}/2,500 chars ({pct}%)
- Session logs: {first_date} to {last_date} ({N} days)
- Gaps: {any gaps >2 days, or "No gaps detected"}

Skip silently if the script is not found.

---

## Step 4: Commit & Push

1. Stage only files this session created or modified (`git add <paths>`), never `git add -A`. Skip files with no unstaged changes, since the PostToolUse hook may already have committed SKILL.md edits.
2. If the current branch is `main`, stop and ask; otherwise follow the zone routing in AGENTS.md's Branching Policy.
3. Commit with a descriptive message summarising the session's work, following any attribution rules in the user's instructions.
4. Push only if `origin` is the user's own repo, not the upstream template; otherwise report that the commit is local.

---

## Session Summary

After all steps, present a summary in this exact format:

```
--- Session Summary ---

Deliverables:
- {file path} — {what it is}
- {file path} — {what it is}

Learnings logged:
- {skill-name}: {one-line summary of what was logged}
- General: {one-line summary if cross-skill insight was added}

Skills modified:
- {skill-name}: {what was changed and why}
  (or "None" if no skills were modified)

Registry sync:
- {what was added/removed from the registry docs, README.md, context/learnings.md}
  (or "No drift detected")

Memory:
- Daily log: context/memory/{YYYY-MM-DD}.md
- MEMORY.md: {N}/2,500 chars ({pct}%){, plus any promotions made — or "No durable facts promoted"}
- SOUL.md: {proposed change, or "No evolution needed"}
- User prefs: {what was updated in context/USER.md, or "No changes"}

Committed: {commit hash} — {commit message}
---
```

If no deliverables were produced (e.g., session was planning or discussion only), note that instead.

---

## Step 5: Show Usage

After the session summary, tell the user to run `/usage` to check their plan usage, limits, and remaining capacity. This is a built-in CLI command that must be typed by the user — it cannot be invoked programmatically by the agent.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

- 2026-03-10: Daily memory file must contain real content, never placeholders. One file per day with `## Session N` blocks. Always fill in the goal and what happened — don't leave heartbeat scaffolding as-is.
- 2026-05-01: Before committing, check `projects/briefs/` for any active projects and include them in the session summary under Deliverables if relevant work was done.

---

## Self-Update

If the user flags an issue with the wrap-up process — wrong commit scope, missed files, bad summary format — update the `## Rules` section in this SKILL.md immediately with the correction and today's date. Don't just log it to learnings; fix the skill so it doesn't repeat the mistake.

---

## Troubleshooting

**User has no feedback:** Log "No feedback — routine session" with date to the relevant skill section. Still do the file placement check and commit.
**Multiple skills used in one session:** Collect feedback per skill. Log to each skill's section separately.
**User wants to skip steps:** That's fine — the minimum useful wrap-up is Step 3a (update learnings) + Step 4 (commit). Always do at least those two.
