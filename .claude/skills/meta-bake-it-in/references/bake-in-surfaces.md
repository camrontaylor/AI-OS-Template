# Bake-in Surfaces (Step 5 map)

The core of the skill: given a keeper, choose the surface by what KIND of change it is. Pick the
lightest surface that actually delivers the behavior. Personality and doctrine shape judgment;
hooks and cron are the only surfaces that enforce automatically without the agent choosing to.

Order the decision this way: does it need to fire even when the agent forgets? -> hook/cron.
Does it change how the agent thinks/decides? -> SOUL/AGENTS. Is it a fact? -> MEMORY. Is it the
user's taste? -> propose for CLAUDE.local.md.

| Surface | Bake in when the keeper is... | Enforced by | Blast radius | Reversible / verify |
|---|---|---|---|---|
| `context/SOUL.md` | a change to WHO the agent is - a new core truth, a posture shift | Loaded at every session start; shapes judgment, not enforced | Every session, all clients | Edit is a tagged block; revert = remove it. Loads next session. |
| `AGENTS.md` | always-loaded operating DOCTRINE - a standing rule, a gate, a discipline | Loaded every session; the agent follows it | Every session, all clients | Dated line under the right `###` section, tagged. Revert = delete the line. |
| `.claude/hooks/*.js` + `settings.json` | REAL-TIME automated enforcement (block a commit, scan ingested content, guard an action) | The harness fires the hook on the matched event | Every tool call of the matched type | New hook file (AI-OS-owned, not GSD's). Wiring is USER-PLACED (settings.json is deny-locked) - hand the snippet. Dry-fire to verify. |
| `cron/jobs/*.md` | SCHEDULED behavior - a weekly sweep, a health check, a digest | The cron runtime / Command Centre | Runs on schedule, no session needed | New job file. `bash scripts/status-crons.sh` to verify. Revert = remove the file. |
| `context/MEMORY.md` | a durable FACT or preference the agent should always know | Loaded at session start (snapshot) | Every session | Via `meta-memory-write`; respects the 2500-char budget. Takes effect next session. |
| `context/learnings.md` | a lesson scoped to one skill's behavior | Read by that skill before it runs | That skill only | Under the skill's `## {name}` section. |
| existing `SKILL.md` | a change to how one EXISTING skill behaves | Read when that skill triggers | That skill only | Edit the skill's `## Rules`. Not core, but a valid absorb target. |
| `CLAUDE.local.md` `## Rules` | the user's own VOICE or DECISION rule | Loaded every session, overrides AGENTS.md | Every session | **PROPOSE ONLY.** User-owned; never auto-write (AGENTS.md line 142). Hand a paste-ready dated bullet. |

## Precedents already in the system
- **thinking-partner** and **karpathy-coding-discipline** were absorbed as posture into `AGENTS.md`
  + `context/`, not as skills. That is the model this skill generalizes. Cite them.
- **ponytail** (2026-07-21) is the MERGE precedent: instead of dropping it as "already covered" by
  the karpathy Coding Discipline, it was diffed piece by piece and its reuse ladder, root-cause
  rule, and sharper wording were merged INTO that same `AGENTS.md` section (some existing rules
  sharpened in place, both sources cited). Overlap with existing doctrine means compare-and-merge,
  never drop-on-similarity.
- The `SYNERGY -> AI-OS system` disposition in `meta-skill-intake` is the front door; this file is
  how that disposition actually gets executed.

## The tag convention (traceability + revert)
Every core edit must be findable and undoable without git archaeology:
- **Markdown files** (SOUL, AGENTS, cron, MEMORY): a dated line that cites the source, e.g.
  `- 2026-07-21: {rule}. (absorbed from {source})`. For a multi-line block, wrap it:
  `<!-- absorbed:meta-bake-it-in | {source} | 2026-07-21 -->` ... `<!-- /absorbed -->`.
- **Hook / script files**: a header comment `// absorbed:meta-bake-it-in from {source} 2026-07-21`.
- The bake-in record lists every edit: file, location, what it does, and the one-line revert.

## Reversibility model
Absorption is a set of edits + a record, never a rewrite. Git (autosaved + pushed each session)
is the backstop, but the record makes a TARGETED revert possible - undo one absorption without
touching everything else committed since. If a bake-in later proves wrong, the record tells you
exactly which lines in which files to pull, and the evolution-log entry says why it went in.

## Anti-patterns
- Don't put a fact in AGENTS.md (bloats always-loaded doctrine) - facts go to MEMORY.
- Don't put enforcement in AGENTS.md and call it automated - doctrine relies on the agent
  choosing to follow it. If it must fire regardless, it's a hook or a cron.
- Don't bake a whole imported framework in wholesale. Extract the one rule or pattern that fits;
  the rest is DROP. A baked-in change is read by the agent on every session - keep the core lean.
- Don't auto-write user-owned files to "save a step." The snippet-and-place flow is the design.
