---
name: meta-wrap-up

description: "End-of-session checklist that reviews deliverables, collects feedback, fixes skills, updates learnings, and commits work. Runs automatically at the end of a working session or on a clear sign-off. Not for content-writing or positioning sessions, or a mid-conversation thanks that really means thanks-now-do-X."
when_to_use: 'Invoke when the request sounds like: "thanks", "that''s it", "done for today", "bye", "wrap up", "we''re done", or /wrap-up'
---

# Wrap-Up

End-of-session checklist. A pre-flight open-loop gate (Step 0) plus five steps: review what was done, collect feedback, apply fixes, commit everything, and show usage.

## Outcome

- Open-loop pre-flight passed, or blocking loops surfaced and wrap-up deferred
- Updated `context/learnings.md` with session feedback
- Updated `context/memory/{today}.md` with session log (4-section format)
- Updated `context/USER.md` if new preferences were observed
- Proposed `context/SOUL.md` updates if behaviour corrections were observed
- Direct fixes applied to any skills that need them
- Live skill integrity, generated catalog, learnings coverage, and connector map reconciled
- Clean git commit of all session work
- Session summary presented in consistent format

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `context/learnings.md` | `## meta-wrap-up` section | Check for previous wrap-up insights |
| `context/USER.md` | Full | Check if preferences need updating |
| `context/SOUL.md` | Full | Check if behaviour rules need updating based on session corrections |
| All `brand_context/` files | Scan only | Identify which files were created or modified this session |

Load if they exist. Proceed without them if not.

---

## Step 0: Open-Loop Audit (pre-flight gate)

Run this BEFORE Step 1, every time wrap-up is entered (a sign-off auto-trigger, `/wrap-up`, post-deliverable, or a Next Actions recommendation). It decides whether the session is actually safe to close. It is non-destructive: go or no-go only, it never commits.

This audits the **conversation**, not the file diff. Step 1's `git status` and `git diff` review is the file-level check and is not duplicated here.

Apply the open-loop taxonomy defined canonically in `AGENTS.md` (Next Actions Footer), blocking versus non-blocking. To keep the scan cheap, read today's running `### Open threads` block in `context/memory/{YYYY-MM-DD}.md` FIRST, since it is already maintained during the session, then sweep the conversation for any blocking loop not yet captured: promised-but-undelivered work, unanswered user questions, failing or unverified state, unsaved or unplaced output, and open decisions the user owns.

**Gate decision:**

- **Clean** (no blocking loops): proceed to Step 1 and run the full wrap-up. Log any non-blocking residue under `### Open threads` in Step 3c.
- **Blocking loops found:** do NOT proceed. Name the specific loops to the user, most important first, and propose closing them as the next actions.

**User override.** If wrap-up was auto-triggered by a sign-off and blocking loops exist, surface them once and ask whether to close them first or wrap up anyway. If the user reaffirms sign-off, record the open loops under `### Open threads` (Step 3c) and proceed to at least the minimum wrap-up (Step 3a plus Step 4), per the Troubleshooting skip rule. The gate is advisory; it never traps a user who wants to leave.

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

Before asking anything, GLEAN outcome signals silently from the session itself
(this costs the user nothing and feeds the preference loop):
- Did the user use, send, or approve a deliverable as produced? That approval
  is a preference signal - note what made it land (format, length, tone,
  structure) as a bullet under `### Preferences` in today's session block.
- Did the user rework, re-request, or ignore a deliverable? Note what they
  changed as the preference ("prefers X over Y"), not as a correction unless
  you were confirmed wrong.
- Durable taste only; skip one-off task instructions. The nightly distill
  promotes these into the scope-correct learnings `## Preferences` section.

Then default to one question: **"Anything to note before I wrap up?"**

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

One file per day: `context/memory/{YYYY-MM-DD}.md`. The session block is created by the first real UserPromptSubmit hook, after greeting-only prompts are skipped. Wrap-up **finalises the existing block** — it does NOT create a new session block.

**Note:** Auto-tracking during the session means most deliverables, decisions, and open threads are already logged. This step is about confirming and polishing what's there, not writing from scratch.

**Find the current session's `## Session N` block** and replace any placeholder text with real content from the session. Fill in all four sections:

```
## Session N

### Goal
[One line — what the user set out to do]

### Deliverables
- `path/to/file` — what it is

### Decisions
- [Decision and rationale]

### Corrections
- [Only if you were confirmed wrong this session. One line: what was wrong, what is true, the lesson. Omit the section otherwise.]

### Open threads
- [Anything unfinished for the next session]
```

**Rules:**
- **Never append a new session block** — wrap-up completes the block that was started, it doesn't create a new one
- **Corrections ride the daily log, not a direct learnings write.** If a confirmed mistake happened, make sure it is captured as a `### Corrections` bullet in this session's block (per AGENTS.md "Correction Capture"). Do not separately write that correction into `context/learnings.md` yourself — the nightly `daily-correction-distill` job promotes it from the log, so a direct write here would double-log it. Skill-feedback learnings (Step 3a) are unaffected; only confirmed corrections route through the log.
- **Never leave placeholder text** like `[Waiting for user goal]`. Replace placeholders with actual content from the session
- Omit sections that don't apply (e.g., no Decisions section if none were made)
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
- **Decision Ledger health:** Run `bash scripts/decision-ledger-check.sh`. Surface any chronic churn (a decision reopened 3 or more times, so the reopen gate is not holding) or malformed entries in the session summary. It is read-only and never edits a ledger.

**Reconciliation** (from AGENTS.md's **Skill & MCP Reconciliation** section). This catches anything that changed during the session:

1. **Skills** - run `bash scripts/skill-system-audit.sh`:
   - New live skill -> add its exact learnings section, regenerate `docs/skills-catalog.md`, scan dependencies, and update user-facing docs only when material
   - Removed live skill -> ask before removing its learnings or user-facing documentation
   - Broken adapter or client discovery link -> repair it from the canonical `.claude/skills/` source

2. **External services** — for any new or modified skills, scan for API key dependencies (see AGENTS.md § External service detection). Auto-add any new services to:
   - `.env.example`
   - `docs/connectors.md` (consumer, purpose, readiness, and fallback)
   - README.md only when the user-facing setup changes

3. **MCPs** - compare configured connectors against `docs/connectors.md`:
   - New MCP not documented -> add it to the connector map
   - Documented MCP removed from configuration -> ask before removing it from the map

Log any sync actions in the session summary under a **System sync** line.

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

**Decision Ledger.** If the session made, changed, or reopened a directional decision (positioning, offer, pricing, naming, ICP, strategy), update `context/decisions.md` in the active scope (the client folder for client work, root otherwise):
- New decision → append an entry: a `## Topic` heading, then `- Status:`, `- Decided:`, `- Call:`, `- Reopen gate:`, `- Gate met:`, `- Reopened: 0`, and optional `- Note:` / `- Source:`.
- Reopened an existing decision → bump its `Reopened:` count, append the new `Call`, and note in `Note` whether the reopen was authorized (the user directed it, or the gate was met). Never overwrite the prior call; churn must stay visible.
- Append-only, like the correction log. Leave `Retired` entries in place. The brief generator surfaces open, gated, and churned entries at the next session start.

Report usage in the session summary under the **Memory** block: `MEMORY.md: {N}/2,500 chars ({pct}%)`.

### 3h: Memory Coverage Stats

Run: `bash scripts/lib/memory-meta.sh`

Add the output to the session summary under a **Memory coverage** block:
- MEMORY.md: {N}/2,500 chars ({pct}%)
- Session logs: {first_date} to {last_date} ({N} days)
- Gaps: {any gaps >2 days, or "No gaps detected"}

Skip silently if the script is not found.

### 3i: Log System Evolution

Only when this session landed a real change to the system itself - the agent contract (`AGENTS.md`, `SOUL.md`, `CLAUDE.md`), hooks, scripts, skills, memory design, cron, or core config. Ordinary client work, content, or research does NOT qualify. If it did, append one dated entry to `docs/meta/evolution-log.md`:

```
bash scripts/log-evolution.sh "Short Title" "What changed and why, in a sentence or two." "What regression to avoid."
```

Keep it to the meaningful shift, not every file touched. Skip silently if nothing system-level changed this session (per AGENTS.md "System Evolution Record").

Then propagate the systemic change to the template. A documented system change should also reach the AI-OS template, not just this install. After committing (Step 4), run:

```
bash scripts/template-sync.sh --auto
```

It is disarmed and a silent no-op unless this install ran `template-sync.sh --arm`, only ever moves `ai_os_owned` files (personalized files are held back by the sanitizer), and lands changes on a branch + PR - never straight on template `main`. On Claude Code the SessionEnd hook `template-sync-notify.js` already does this; running it here gives the same reach in Cursor and Codex, which have no SessionEnd hook. Skip silently if the script is not found or reports nothing to propagate (per AGENTS.md "Template Propagation").

---

## Step 4: Commit & Push

1. Stage all changes from the session (deliverables, brand context updates, skill fixes)
   - Note: SKILL.md edits may already be committed individually by the PostToolUse hook — skip files with no unstaged changes rather than creating empty commits
2. Commit with a descriptive message summarising the session's work
3. Push to remote

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
- {what was added/removed from AGENTS.md, README.md, context/learnings.md}
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

## Eval

Run this manual eval before changing wrap-up, feedback, commit, push, or usage
report behavior:

1. Local-only deliverable: pass if wrap-up reviews changed files, asks for
   feedback, names tests run, and does not recommend `meta-wrap-up` when open
   loops remain.
2. External action request: pass if wrap-up asks for the exact approval gate
   before push, merge, deploy, send, publish, or Notion writes.
3. Memory/learnings feedback: pass if accepted feedback is logged under the
   relevant skill section and private/transient session-disable preferences are
   not written permanently.

The eval fails if it pushes or publishes without approval, marks incomplete work
done, omits proof for external state, or writes session-only preferences into
persistent memory.

---

## Step 5: Show Usage

After the session summary, tell the user to run `/usage` to check their plan usage, limits, and remaining capacity. This is a built-in CLI command that must be typed by the user — it cannot be invoked programmatically by the agent.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

- 2026-03-10: Daily memory file must contain real content, never placeholders. One file per day with `## Session N` blocks. Always fill in the goal and what happened — don't leave heartbeat scaffolding as-is.
- 2026-05-01: Before committing, check `projects/briefs/` for any active projects and include them in the session summary under Deliverables if relevant work was done.
- 2026-06-16: Run the Step 0 open-loop pre-flight before Step 1 on every wrap-up entry. It audits the conversation (not the git diff, which is Step 1) using the canonical blocking and non-blocking taxonomy in AGENTS.md Next Actions Footer. If a blocking loop is open, name it and confirm with the user before wrapping; only a clean audit (no blocking loops) warrants proceeding. This same gate governs when any reply's Next Actions footer may recommend meta-wrap-up.
- 2026-06-25: Client-specific remote deliverables must have a local handoff record in the matching `clients/{client}/` workspace before wrap-up is considered complete. For Figma/FigJam, Notion, Drive, or other connector outputs, add or update a client-local note with the URL, purpose, section/file map, latest QA state, and source-of-truth pointer.

---

## Self-Update

If the user flags an issue with the wrap-up process — wrong commit scope, missed files, bad summary format — update the `## Rules` section in this SKILL.md immediately with the correction and today's date. Don't just log it to learnings; fix the skill so it doesn't repeat the mistake.

---

## Troubleshooting

**User has no feedback:** Log "No feedback — routine session" with date to the relevant skill section. Still do the file placement check and commit.
**Multiple skills used in one session:** Collect feedback per skill. Log to each skill's section separately.
**User wants to skip steps:** That's fine — the minimum useful wrap-up is Step 3a (update learnings) + Step 4 (commit). Always do at least those two.
