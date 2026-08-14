# Evolution Log

This file records why AI-OS changed, not every commit. It is here so future
agents do not undo hard-won design decisions.

## 2026-03-10 to 2026-03-11 - Template Birth: Three-Layer Architecture

The first commit set up the shape AI-OS still uses. It split the system into three
layers: agent identity (the instruction files, SOUL, USER), a skills pack, and brand
context. Skills got category prefixes like mkt- and meta-, agent state went in
context/, and client brand data went in brand_context/. The next commit added the
full skill set and made every skill save its output to projects/ as a hard rule.

Regression to avoid: collapsing the three layers, or dropping the category prefixes
and the save-output rule.

## 2026-03-12 to 2026-04-06 - Distribution And Safe Update With Ownership

AI-OS became a shippable template with an installer, a skill catalog, and management
scripts. The update path learned to protect user-owned paths, show a per-file review,
and offer a three-way diff. Personal files like USER.md and learnings.md ship as
.template copies while the working versions are gitignored, so private data never
leaks to the public repo. This is the ownership contract: upstream system files can
update, user data cannot be overwritten.

Regression to avoid: letting update overwrite user-owned paths, or shipping real
personal data in tracked files.

## 2026-03-14 - Structured Daily Memory And SOUL Split

Daily memory got a fixed four-part shape: Goal, Deliverables, Decisions, Open threads,
so each session hands off cleanly to the next. SOUL.md was kept as its own file so
identity stays portable across tools, and a dedup guard was added so learnings do not
pile up duplicate lines.

Regression to avoid: dropping the structured session log, folding SOUL.md identity
into the main instruction file, or removing the learnings dedup guard.

## 2026-03-10 to 2026-03-16 - Self-Maintaining Reconciliation Loop

AI-OS learned to keep its own registries honest. A skill and MCP reconciliation step
compares what is on disk against what is registered in AGENTS.md, then fixes additions
on its own and asks before removals. A new skill folder gets a Skill Registry row, a
Context Matrix row, and a learnings section, and a new external service is detected from
the skill's env-var and API references and added to the service registry and
.env.example. This runs at startup and at wrap-up, so the system documents its own
growth instead of drifting out of sync with its own docs.

Regression to avoid: letting the registries, Context Matrix, or service list drift from
what is actually on disk, or auto-removing a skill without confirming with the user.

## 2026-03-16 to 2026-03-24 - Curated Skill Selection, Not Auto-Install

New skills stopped auto-installing on update. They sit in the catalog and only go
live when the user picks them, chosen in the first session through a picker that shows
each skill against the user's real business. Dependency install was made non-blocking
so one failure does not stop setup.

Regression to avoid: letting new or external skills auto-install and flood the live
skill surface; selection stays gated and curated.

## 2026-03-20 to 2026-04-11 - Cron Dispatcher Runtime

Loose watchdog scripts were replaced by one cron dispatcher with per-job
notifications, status tracking, a timeout watchdog, a retry loop, and catch-up for
jobs missed while the laptop slept. Default system jobs ship with every install while
personal jobs stay gitignored. Later the scheduling core was unified in-process inside
the Command Centre so the CLI and the UI run the same engine.

Regression to avoid: going back to ad-hoc watchdog scripts, or splitting cron
scheduling into two engines that can drift.

## 2026-03-24 - Multi-Client Architecture

One install can now serve many clients. The root holds shared methodology, skills, and
scripts, and each client gets a subfolder with its own brand context, memory, and
projects. add-client.sh scaffolds the folder, and skill sync was fixed to copy shared
skills without deleting client-only skills (the earlier sync did rm -rf on the whole
skills folder and destroyed per-client skills).

Regression to avoid: duplicating root rules into every client, or letting client sync
delete client-only skills.

## 2026-03-24 to 2026-03-25 - Project Levels And Containment

Project outputs got a clear home. Single tasks stay under projects/ by category, while
bigger Level 2 and Level 3 work lives under projects/briefs/{name}/. A containment rule
was added so a project never scaffolds its code, configs, or build files at the AI-OS
root.

Regression to avoid: letting project source, configs, or build artifacts land at the
AI-OS root; they stay inside the project folder.

## 2026-03-25 - GSD As Separate Global Install

Heavy Level 3 work was handed off to GSD instead of being copied into the repo. GSD
installs globally through npx during setup, so it is available across all projects
without cluttering each repo. AI-OS keeps the light Level 1 and Level 2 path itself and
only calls into GSD for the rare complex project.

Regression to avoid: vendoring GSD into AI-OS; it stays a separate global install that
AI-OS calls into.

## 2026-03-25 to 2026-04-01 - Command Centre Dashboard

An optional dashboard UI was built as its own project. It runs Claude through a process
manager that parses stream output for cost and activity, and it added a task board, a
review queue, client switching, autonomous mode, and a settings page. It reads and
drives AI-OS but sits on top of the OS layer rather than being part of it.

Regression to avoid: making the core OS layer depend on the Command Centre to
function; it stays an optional layer on top.

## 2026-04-07 - AGENTS.md As Canonical Tool-Agnostic Contract

The shared rules moved out of CLAUDE.md into a new AGENTS.md, which became the single
source of truth. CLAUDE.md shrank to a thin wrapper that imports AGENTS.md, and Codex
reads AGENTS.md directly, so different tools follow the same rules. This is the start
of the tool-agnostic runtime: one rule file, many tool adapters.

Regression to avoid: forking the rules back into per-tool files; AGENTS.md stays
canonical with thin tool wrappers.

## 2026-03-15 to 2026-04-14 - Windows And Codex Reach

AI-OS stopped being a one-OS, one-tool system. A run of Windows work fixed the
installer, the PowerShell launcher, the cron scheduler, notifications, and hidden
console popups, so the same workspace runs on Windows Task Scheduler, not just macOS.
In parallel, Codex joined Claude as a supported tool that reads AGENTS.md directly. This
is the reach half of the tool-agnostic runtime: the rules stay shared, and the runtime
meets the user on their own OS and their own tool.

Regression to avoid: assuming macOS-only paths or a single tool; the Windows and Codex
paths stay working alongside macOS and Claude.

## 2026-04-13 to 2026-04-14 - Cron Runtime Hardening And Ownership

The cron runtime was rebuilt so scheduled jobs stay inside their own workspace and
cannot leak into the wrong client folder. Each workspace runs one managed cron runtime
that schedules the root job plus every client job, and a shared leader lock stops two
runners from firing the same job twice. This made background jobs safe to run across
many client folders at once.

Regression to avoid: letting one cron runner fire a job outside its workspace, or
running two runners without the shared leader lock.

## 2026-04-13 to 2026-04-15 - Zone-Based Branch Protection And Release Flow

Repo changes were split into three zones, content, config, and code, each with its own
rule for reaching the shared branch. Content commits directly, config and code go
through a feature branch, and the release branch stays protected behind a passing CI
check with no direct push. A PreToolUse branch guard enforces this, and a CHANGELOG.md
and VERSION file started tracking releases.

Regression to avoid: pushing config or code straight to the protected branch, or
removing the branch guard hook or the CI gate.

## 2026-04-15 - Guided Install And Centre Bootstrap

The install path was rebuilt into a guided bootstrap so a new user gets set up without
hand-editing files. A Python launcher bootstrap and rewritten install and setup scripts
walk the person through first run on both Mac and Windows, instead of a pile of manual
steps.

Regression to avoid: dropping the guided bootstrap back to a raw manual install, or
letting the Mac and Windows install paths drift apart.

## 2026-04-22 to 2026-04-24 - Command Centre Moved To Repo Root

The Command Centre dashboard moved out of projects/briefs/ up to its own
command-centre/ folder at the repo root, so the app is no longer tangled with normal
project output. A workspace-root resolver lets it find the repo from its new home, and
the updater gained warnings for stale centre shortcuts. This set the Command Centre up
as a separate, replaceable layer on top of AI-OS.

Regression to avoid: moving the Command Centre back under projects/; it stays an
optional layer AI-OS never depends on to run.

## 2026-05-05 to 2026-05-07 - Update System With Safe Rollback

The update path became real and reversible. The single update.sh was broken into small
library scripts for backup, pull, merge, and catalog, so an update can preview, save a
backup, then apply. A rollback script lets the user undo an update and return to the
saved point. Beta feedback then removed the risky self-update step, made the upstream
branch a setting instead of a hardcoded main, and replaced a stash restore that could
overwrite files.

Regression to avoid: letting an update overwrite user work or self-mutate the updater
mid-run; back up first and keep rollback working.

## 2026-05-05 - User-Owned Local Override Files

A clear line was drawn between shipped files and user files. Every skill can have a
SKILL.local.md next to its SKILL.md, and the workspace can have a CLAUDE.local.md next
to CLAUDE.md. Base files ship from upstream and updates may replace them, but the local
files are user-owned and never touched. Skills read the local file alongside the base,
with local rules winning.

Regression to avoid: overwriting SKILL.local.md or CLAUDE.local.md on update, or
pushing user customization into a base SKILL.md.

## 2026-05-12 to 2026-05-15 - Session Exit Stops Auto-Completing Tasks

The Stop hook stopped marking a task done when the Claude process exits. It had checked
process liveness to decide, but hooks run through a short-lived shell that dies right
away, so the check always read false and wrongly closed sub-sessions (AIOS-73). The fix
removed the auto-done write and now resolves the real Claude process id for temp-file
cleanup. Completion is left to an explicit user action.

Regression to avoid: re-adding an auto-done update on process exit; a session ending
does not mean the task is complete.

## 2026-05-15 to 2026-05-19 - Per-Client GSD Planning Isolation

GSD's .planning/ folder moved to the root of each client workspace,
clients/{name}/.planning/, so each client runs its own project and many clients can run
in parallel. The AI-OS root must stay clear of .planning/, which is what makes the
isolation work. The GSD hooks were rewritten to find the active planning config by
walking up the folder tree instead of guessing a per-brief path.

Regression to avoid: putting .planning/ at the AI-OS root or bringing back the
per-brief path; both break per-client isolation.

## 2026-05-20 to 2026-05-21 - Layered Memory And MEMORY.md

AI-OS got a layered memory design under ticket AIOS-75. A curated scratchpad,
context/MEMORY.md, holds durable facts, active threads, and pending decisions with a
hard 2,500 character cap so the session-start read stays small and the prefix cache
stays stable. A SessionStart hook auto-loads this snapshot, Returning Mode reads it,
and the same snapshot is injected into every Command Centre task prompt. The new
meta-memory-write skill is the one path that edits it, and a mid-session write only
takes effect on the next session.

Regression to avoid: removing the 2,500 char cap or making mid-session writes take
effect live; both protect the prefix cache and startup cost.

## 2026-05-25 to 2026-06-02 - Semantic Memory Recall Added

AI-OS gained a second memory layer that searches by meaning, under ticket AIOS-76. A
tool called MemSearch indexes the memory files, learnings, and brand context into a
local vector store (Milvus Lite on Mac and Linux, Zilliz Cloud on Windows). Three cron
jobs keep it fresh: a nightly re-index, a daily distill, and a weekly curator. Results
pass through a reranker that boosts trusted sources and recent entries, and recall
cites the dates, files, and gaps it found. The plain markdown files stay the real
source of truth, so the index can always be rebuilt.

Regression to avoid: treating the semantic index as the source of truth, or dropping
tiered recall and gap citation; markdown memory is canonical and the index is
rebuildable.

## 2026-05-27 - Update From Canonical Upstream

The updater used to pull from a fixed remote named origin. But the install flow sets up
a fork where origin is the user's own backup and the real AI-OS lives at upstream, so
updates quietly pulled the fork and reported up to date while real updates sat
unmerged. The fix resolves the update remote by its URL, whichever remote points at the
canonical repo, instead of trusting a fixed name.

Regression to avoid: hardcoding origin as the update source; the user's fork is their
backup, so resolve the canonical remote by URL.

## 2026-05-27 to 2026-06-02 - GSD Moved To Redux

The Level 3 handoff tool GSD moved to its new version, OpenGSD Redux, with migration
helpers for Mac and Windows. A first pass kept misreading a healthy Redux install as
old GSD and reinstalling it, because Redux's files looked like the legacy markers the
detector watched for. Detection was made Redux-aware through the get-shit-done/VERSION
marker so a present runtime is left alone.

Regression to avoid: flagging a healthy Redux install as legacy and reinstalling it, or
reverting to the old GSD.

## 2026-06-14 to 2026-06-16 - Agent-First Shape

AI-OS moved toward `AGENTS.md` as the canonical runtime contract. Claude,
Cursor, and other tools should adapt to the same project rules instead of each
tool owning its own behavior.

Regression to avoid: duplicating conflicting rules into tool-specific files.

## 2026-06-16 - Skills Library Becomes Inert Intake

External skills moved into `skills-library/` as staged candidate material. The
live skill surface stays curated. Packs are not installed directly into Claude
just because they exist.

Regression to avoid: flooding `.claude/skills/` or the slash-command picker with
unassessed external packs.

## 2026-06-23 to 2026-06-25 - Memory Boundaries Harden

Memory recall split into:

- authoritative markdown memory,
- semantic MemSearch index,
- markdown fallback,
- root/client scoping,
- and explicit deep-search surfaces.

The collection name is resolved by `scripts/lib/memsearch-collection.sh` so the
AI-OS canonical index is separate from any plugin shadow index.

Regression to avoid: raw MemSearch calls, incomplete source-set indexing, or
root recall leaking client memory by default.

## 2026-06-24 - Complete-Source Reindex

`scripts/memsearch-reindex.sh` became the single owner of semantic indexing. It
lists the full source set in one pass because partial indexing can delete missing
sources from the collection.

Regression to avoid: separate root/client/nightly index jobs that each index only
part of the corpus.

## 2026-06-24 to 2026-06-25 - Memory Search Safety

AI-OS uses wrapper scripts for routine MemSearch recall and indexing. This keeps
collection resolution, fallback behavior, and lock handling inside AI-OS. Direct
MemSearch remains diagnostic only.

Regression to avoid: treating a Milvus Lite lock error as missing memory.

## 2026-06-26 - Worktree And Autosave Safety

The primary checkout became the default home base. Worktrees are explicit
isolation. The brain stays shared through linked memory surfaces, and autosave
protects the primary from stash prompts.

Regression to avoid: creating hidden worktrees, mutating from an unexpected
worktree without opt-in, or treating autosave commits as reviewed/backed-up work.

## 2026-06-29 - Self-Sustaining Health Loops

The systems check showed AI-OS was technically healthy while memory/workspace
drift still needed attention. The fix was not a one-time cleanup. New loops were
added:

- `client-memory-evaluator`,
- `workspace-health-steward`,
- `semantic-memory-health`,
- `notion-resource-health`,
- `projects/system-health/self-sustaining-health-plan.md`,
- and these meta docs.

Client memory overages now trigger an organization report. Semantic memory health
now has to prove semantic results, not just prove MemSearch is installed.

Regression to avoid: clearing warnings without adding a loop that notices the
same failure next time.

## 2026-06-29 - Clean-History Extractor And Codex Guard Settled

Two smaller system changes landed. `scripts/extract-clean-history.sh` gives a way
to produce a 100%-owned history with old upstream commits removed. Separately, the
Codex authority guard was removed, then restored, then hardened after the churn
showed the guard was load-bearing for keeping tool-level defaults from outranking
AI-OS rules.

Regression to avoid: removing the Codex authority guard without a replacement that
keeps `AGENTS.md` authoritative over a tool's own defaults.

## 2026-07-06 - Out Of iCloud, And The Blocker Research Gate

The install moved off iCloud to `~/AI-OS` so file watchers, locks, and git stopped
fighting a sync client, and the primary checkout location became stable. The same
window added the Blocker Research Gate (`AGENTS.md` plus
`.claude/hooks/blocker-research-gate.js`): before giving a "no" or "not possible"
answer, route through research and return options, not a dead end.

Regression to avoid: running AI-OS from a sync-managed folder again, or letting an
agent give a bare "can't" answer without the research gate.

## 2026-07-08 - Skills Single Source, And The Web Data Ladder

Two contract-level rules. Skills now live in exactly one place, `.claude/skills/`,
and reach every tool by symlink via `scripts/link-skills.sh`, never by copy, so an
edit from any tool lands in the real file. And the Web Data & Scraping Routing
ladder in `AGENTS.md` made web reads climb from the cheapest rung (built-in tools)
up through Firecrawl and Apify only when the task earns it, with Apify registered in
Composio.

Regression to avoid: copying skills per tool (copies drift), or reaching for a heavy
scraper when a built-in fetch would do.

## 2026-07-08 - Agency Discipline (High-Agency Ownership Posture)

AI-OS gained a second always-on posture beside Thinking Discipline, defined in
`AGENTS.md` "Agency Discipline" and in `SOUL.md` (the truths "Take ownership of
the whole problem" and "Guard the user's decisions"). It exists because the user
hands over rough pieces and the old behavior did the one literal slice, made
narrow assumptions, and handed decisions back. The posture makes every turn read
the whole job, self-source its own context (mode-aware: client folder or system
surfaces, via `scripts/agency-gather.sh`, a manifest not a dump), cover all
parts, check its own work with a fresh fed subagent critic, and surface the user
only at genuine irreversible or taste forks. The headline rule is decision-budget
protection: decide and act on anything reversible, show it as a one-line
reversible move, and ration questions hard, because the user's daily decision
capacity is the scarce resource. Deep machinery lazy-loads from `context/agency/`.
The Client Routing Guard was changed from a blocking scope question to a
one-line scope declaration to match this. Design of record:
`projects/briefs/agency-discipline/brief.md`.

Regression to avoid: turning this into a spec-approve-run gate, a pre-work
approval the user cannot yet judge, a whole-folder context dump, a same-context
"are you sure" self-check, or a stream of small decisions handed back to the
user. All four were red-teamed out on purpose.

## 2026-07-08 - Evolution Record Made Sustainable

The evolution log gained a capture path so it stays current instead of decaying:
a helper `scripts/log-evolution.sh`, a standing rule in `AGENTS.md` "System
Evolution Record", and a `meta-wrap-up` Step 3i that logs a genuine system change
at session end. This rides the same capture-then-durable pattern as the memory
and correction loops rather than inventing a new mechanism.

Regression to avoid: building a heavy changelog engine, or logging every commit
instead of the meaningful design shifts. The log records why AI-OS changed, kept
plain and short.

## 2026-07-08 - Template Propagation (Install To Template)

AI-OS gained the missing reverse update direction: a documented systemic change now flows OUT to the public template automatically, not just template-to-install. scripts/template-sync.sh copies only ai_os_owned files (minus user_owned), holds back any file carrying a client name or the home path via scripts/lib/sanitize-strings.sh (client slugs derived live from clients/*), and lands changes on a rolling template-sync/main branch and PR, never straight on template main. Disarmed by default so downstream installs never push; enforced by the SessionEnd hook template-sync-notify.js on Claude and by meta-wrap-up Step 3i everywhere else. Design of record: docs/meta/template-propagation.md.

Regression to avoid: Do not turn it into a silent in-flight rewriter of client names (one miss leaks), push straight to template main, widen scope past ai_os_owned, or arm it by default for downstream installs.

## 2026-07-08 - Coding Discipline posture

Absorbed the viral multica-ai/andrej-karpathy-skills CLAUDE.md as a scoped Coding Discipline section in AGENTS.md (four rules: think before coding, simplicity first, surgical changes, goal-driven execution), firing only on code and system-file turns, mirroring how thinking-partner was absorbed. Source vendored for provenance in skills-library/backlog/karpathy-coding-discipline/.

Regression to avoid: Do not promote it to a fourth always-on posture or a / skill; keep it scoped to code turns and cross-linked to Thinking/Agency Discipline so it builds on the contract instead of duplicating it.

## 2026-07-09 - Token-Saving Tooling Added

Installed codeburn (global local CLI, token/cost dashboard) and caveman (Claude Code plugin, project-scoped, defaultMode off via .caveman.json) after verifying both against a TikTok video's claims; documented in docs/connectors.md Layer 5/6 and CLAUDE.local.md.

Regression to avoid: Do not remove .caveman.json or flip defaultMode away from off without explicit user request - that is the only thing preventing caveman's terse-fragment style from overriding SOUL.md voice rules by default.

## 2026-07-15 - Daily Memory Budget Self-Healing

Client and root MEMORY.md were growing daily via distill jobs but only trimmed weekly, and the client curator was a mechanical regex pass that could not consolidate a full file - so budgets silently drifted over cap (one client hit 3,218/2,500) and only surfaced via a manual systems check. Made both curators daily LLM jobs that intelligently consolidate only when over the 2,300 threshold, preserving all active work and relocating bloated procedures to reference files; moved them before the nightly memsearch reindex.

Regression to avoid: Do not let the curator delete ambiguous active work to hit the cap, and do not make it rewrite files already under threshold (gratuitous churn); if a file cannot get under cap without dropping live work, leave it and let the weekly evaluator health report flag it for a human.

## 2026-07-16 - Audit Emergency Fixes

A 56-agent audit confirmed 44 critical/high findings. Same-day fixes: notion-resource-health.py no longer echoes Notion row content after it leaked a plaintext password into reports; base-autosave.sh and base-return-to-main.sh now heal stale locks older than 10 minutes after a Jul 1 stale lock silently killed autosave and the GitHub backup for 15 days, plus the unbound AIOS_AUTOSAVE_NO_PUSH bug fix that made the push code die; both cron scheduler hosts now check matchesDays on the live tick, and the three days:monthly jobs moved to days:mon, ending weeks of weekly jobs running daily. Full report: projects/briefs/ai-os-audit/.

Regression to avoid: Do not let any mkdir-style lock ship without a stale-age takeover, do not let cron reports echo external row content, and do not add a scheduler tick that checks time without days.

## 2026-07-16 - Single-Source Runtime And Measured Memory

Replaced copied client runtimes and hand-written skill registries with one live skill source, client and tool discovery links, generated catalogs, and deterministic audits. Removed routine cron prompts from human memory, repaired known log pollution, and made one complete-source MemSearch sync the scheduled index owner.

Regression to avoid: Do not restore copied client runtime trees, treat installer metadata as live skill authority, write routine automation into human session memory, or run partial semantic indexes against the canonical collection.

## 2026-07-16 - Audit Remediation Phases 2-7

Executed the 2026-07-16 system audit plan: macOS cron notifications with failure-streak escalation and [SILENT] honoring; daily health rollup with a findings ledger surfaced into the first session (health-rollup.py + SessionStart hook); systems-check liveness checks for autosave, hooks, index freshness, streaks, template-sync, and brain durability; template-sync stale-lease fix (1053 backlogged files propagated); memory finalizer made strictly additive with derived titles and a regression test; recall fusion rebalanced (markdown 1.05, overlap keys) with a 20-case golden eval; 358MB of dead memsearch collections GCed; first learnings audit run and curated; clients migrated to the symlink model with a daily sync-audit cron, overrides-only .env files, and tgv archived; catalog.json/installed.json/README regenerated from disk with trigger-collision linting and 5 zero-use skills parked; Telegram fails closed without an allowlist; autosave gained a credential gate; key rotation runbook added; weekly test-suite cron added.

Regression to avoid: Do not revert the finalizer to refresh-on-every-Stop, do not raise the markdown fusion weight without rerunning the golden eval, do not reintroduce copy-based client sync, and do not let AGENTS.md regrow past 50KB (the doc-drift size check enforces it).

## 2026-07-16 - GitHub Brain Backup

The gitignored memory layer now autosyncs off-machine: the snapshot store at ~/.ai-os-memory-backup is a git repo pushing to the private camrontaylor/AI-OS-Brain GitHub repo on every backup run (SessionStart hook + nightly cron), via push_to_github in scripts/backup-memory.sh. The systems check treats a fresh push stamp as off-machine durability. Also resolved the MYOB credential per the user's direction: moved blind from Notion into the macOS Keychain (service MYOB), Notion page archived, all nag surfaces cleared.

Regression to avoid: Do not make the GitHub push fatal to the backup run (an offline laptop must still snapshot locally), never point the brain repo at a public remote, and never re-add rotation nags for credentials the user has explicitly settled.

## 2026-07-16 - Optimization Round 2

Layers 1-3 executed: instruction-diet merged (AGENTS.md 50KB, CLAUDE.local.md 20KB to 4.7KB, rules kept); night cron batch moved to a 07:15-07:45 morning window with yesterday-targeting for cross-midnight jobs; web-fed cron jobs run scoped (dontAsk) instead of full bypass; writing/blocker gates fire once per session; memory curator gated behind a free shell size check; cron logs rotate at 1MB; notify.sh gives one sender (macOS now, Pushover when keys land); a date-gated shakedown job audits the new nets on 2026-07-19 and retires itself; the preference loop rides the correction pipeline (### Preferences capture, distill to learnings ## Preferences, wrap-up outcome gleaning, digest-gated USER.md promotion, health arm) - proven live; weekly topic wiki job maintains context/wiki/ (indexed); learnings-health can propose skill revisions for sign-off.

Regression to avoid: Do not re-point morning memory jobs back at today's log (they close YESTERDAY), do not un-gate the curator, and never let the preference loop write USER.md without the user's yes.

## 2026-07-16 - Skills-Library Pipeline Closed

Promoted meta-skill-intake (the pipeline owner) and eng-implement (six mattpocock workflows bundled into one router) to live; parked planner, personal-cfo, marketing-loops, and the superseded viz-ad-creative-nano with reasons in INDEX.md; staged slide-deck in review with a one-word sign-off path; registered claude-video, karpathy-coding-discipline, and the provenance-flagged community-claude-md-rules in sources.json and LICENSES.md; added the eng category.

Regression to avoid: Do not let review/ items sit unactioned for weeks again - the review-watcher cron is still disabled and needs a rewrite to the ASSESSMENT.md flow; and do not promote backlog candidates without demonstrated or clearly imminent use (26 of 39 live skills once had zero use).

## 2026-07-20 - Auto-Recall Hook And Trustworthy Index Status

Made the semantic memory layer actually used and its status trustworthy, after a 2026-07-20 audit found recall firing in only a handful of sessions and the nightly index reporting FAILURE on a healthy 90 percent index. Three changes: (1) built .claude/hooks/auto-recall.js, a UserPromptSubmit hook that runs one relevance-gated memsearch on the first real prompt of a session and injects the top hits as context, flipping semantic recall from on-demand to automatic. It fires once per session, injects nothing below a 0.75 relevance floor, skips sources already loaded at startup, never blocks the prompt, and skips cron runs. Registered in the tracked .claude/settings.json as the 8th UserPromptSubmit hook, so it ships as an AI-OS default and propagates via template-sync. (2) Split the golden-recall gate into a hard floor (real collapse fails the job and notifies) and an aspirational target (healthy dip warns and exits 0), via a shared scripts/lib/recall_gate.py with a fast regression test scripts/test-recall-golden-gate.sh. (3) Archived the deprecated .memsearch/memory plugin shadow folder to .backup/exports and added .memsearch/README.md.

Regression to avoid: Do not restore a single hard 95 percent golden gate: it cried FAILURE on a genuinely healthy 90 percent index and trained the operator to ignore job status. Do not let auto-recall block the prompt, inject below the relevance floor, or re-inject already-loaded files (noise is worse than nothing). Do not re-add .memsearch/memory to the canonical index: it is the plugin shadow folder, deliberately separate so it cannot clobber the real _aios collection.

## 2026-07-21 - Transcript-based memory capture

Memory capture no longer depends on the model tracking live or the user running meta-wrap-up. session-memory-finalizer.js now mines the raw session transcript (transcript_path) for real Write/Edit/MultiEdit file writes and additively fills Deliverables every Stop. A new nightly cron (cron/jobs/session-backfill.md, 06:50, before the distills) reads each unwrapped session's transcript via scripts/session-digest.js and reconstructs Goal/Decisions/Corrections/Preferences/Open threads for auto-finalized blocks only.

Regression to avoid: Never let the backfill or the finalizer touch a block lacking the aios-auto-finalized marker or overwrite non-placeholder content - that is the 2026-07-16 curated-content-destroy regression. Keep both strictly additive and relative-path-only (no absolute home paths leaked into committed memory).

## 2026-07-21 - Added meta-bake-it-in skill

New meta skill that dissolves external repos/resources into AI-OS core (SOUL/AGENTS/hooks/cron) instead of adding a skill; executes meta-skill-intake's SYNERGY->AI-OS-system disposition with a mandatory prompt-injection+secrets security gate, intent reconstruction, per-piece relevance triage, a bake-in surface map, and reversible tagged edits with an absorption record.

Regression to avoid: Never auto-write user-owned files (CLAUDE.local.md, settings.json) and never bake in without passing the Step 2 security scan - the source loads into every session.

## 2026-07-21 - Promote q-unstuck (roadblock antidote)

Promoted the maker 'unstuck' skill (coreyhaines31/makerskills, MIT) live as q-unstuck: wall-type taxonomy, 10-technique lateral-thinking inventory, min-10-angles gate, and an agent fast-path that runs the routine on itself before reporting any dead end. De-tailored archive from a dotfolder to projects/q-unstuck/, rewired compose hooks to q-question/deep-research/AI-OS memory, stripped em/en dashes. Added a one-line agent fast-path pointer to the AGENTS.md Blocker Research Gate so returning-options-not-a-dead-end is standing behavior. Linked into all 3 clients; audit clean.

Regression to avoid: Do not let the fast-path become a bare posture line without the skill behind it, or a dead-end report without the tried-angles receipts the gate now requires; keep q-unstuck symlinked into clients when shared-skill topology changes (run update-clients.sh).

## 2026-07-21 - Standards Refresh Loop

Added a scheduled skill-methodology self-improvement loop: cron/jobs/monthly-standards-refresh.md (agent-driven, first-Monday gate) researches current best-in-class standards for a target skill, diffs them against that skill's own references, and writes a reviewable change proposal to projects/meta-standards-refresh/ without editing the skill. Borrows the autoresearch (Karpathy) shape (research, diff, keep-if-better, log) but keeps the keep-or-discard call with a human because skill methodology has no measurable objective the way LLM training loss does. Pilot target: mkt-copywriting; first proposal produced 2026-07-21.

Regression to avoid: Never let this loop auto-write methodology into a skill. Its autonomy is bought by the human review gate, not by a metric. An unattended research-and-edit loop with no objective function is a slop pump that bloats skills with unvetted, unfalsifiable 'best practices'. Propose only; apply is a separate human-gated step.

## 2026-07-21 - Skill Description Format Standard

Rewrote all 38 long skill descriptions into a tight 3-part format (summary, Triggers, Not for) so the / picker popup is scannable, then baked the standard into AGENTS.md (Building New Skills + checklist), docs/skill-building.md (pattern + before/after), meta-skill-creator (reconciled its 'make descriptions pushy' guidance to mean comprehensive triggers, not verbose prose), and skill-system-audit.sh (warns when a description exceeds a 500-char target).

Regression to avoid: Do not let skill descriptions drift back to 900+ char walls of restated mechanics; keep every trigger phrase (that fights under-triggering) but move prose into the SKILL.md body. The description is both the routing signal and the picker popup.

## 2026-07-21 - Remove Morph MCP connector

Removed the filesystem-with-morph MCP (Morph Fast Apply) from .mcp.json and .codex/config.toml after a fit assessment (projects/str-research-findings/2026-07-21_morph-morphllm-fit-assessment.md) found it redundant with Claude Code's native editing, wrong for AI-OS's markdown-heavy work, and unused by any skill or hook. This also closed a plaintext MORPH_API_KEY exposure with nothing left to rotate. Earlier same session the key file .codex/config.toml was untracked and gitignored.

Regression to avoid: Do not re-add an MCP server with a hardcoded API key into a tracked config. New connectors go through docs/connectors.md plus .env.example, with keys only in the gitignored .env. Morph is a Cursor/SDK tool to revisit only if heavy code work on a real repo begins.

## 2026-07-21 - Notion catalog front page

Extended the credit-free notion-sync (Stack/Resources/Notes into context/notion/) with build_catalog.py, which generates context/notion/CATALOG.md: a categorised, browsable front page grouping apps/tools by function, plus resources and notes. Wired into run-notion-sync.sh so it rebuilds on every daily sync. Unmatched items land in an 'Uncategorised (needs a home)' bucket rather than being mislabelled. USER.md now points here as the 'apps/tools I like' source.

Regression to avoid: Do not turn the categoriser into a headless LLM/cron step (fragile, costs credits) - keep it deterministic and credit-free. Do not hand-edit CATALOG.md (overwritten each sync). Add categories by editing CATEGORY_RULES, specific rules before general ones.

## 2026-07-21 - Absorbed ponytail into Coding Discipline

Merged DietrichGebert/ponytail's code-discipline into the karpathy Coding Discipline in AGENTS.md: added the reuse ladder (rule 5), root-cause-not-symptom (rule 6), and the ceiling: corner-cut comment; sharpened rules 1/2/4 with ponytail wording (trace-the-flow, boring-over-clever, size-the-test). Dropped the intensity dial, output-length rules, and hardware caveat. Security scan clean; no code executed.

Regression to avoid: Do not re-import ponytail's intensity dial or output-length rules (they fight always-on doctrine and the voice rules), and do not let 'deletion over addition' be read as license to hard-delete files - it is code-scoped only.

## 2026-07-21 - meta-bake-it-in: overlap is compare-not-drop

Step 4 triage disposition ALREADY-HAVE became MERGE: when an absorbed piece overlaps existing AI-OS doctrine/hook/skill, diff both versions line by line and take the better wording or merge both, sharpening existing baked-in lines in place; DROP-on-overlap only when AI-OS already says it as well or better. Prompted by the ponytail run where good formulations were nearly lost to a lazy drop.

Regression to avoid: Do not let triage drop a piece on similarity alone - overlap is a comparison trigger, not a verdict.

## 2026-07-21 - Infra audit remediation batch

From the 2026-07-21 six-agent infrastructure audit: rewrote add-client.sh to symlink shared scripts/skills/hooks/commands instead of cp -R (kills per-client copy drift), fixed base-autosave.sh to fall back to the origin remote for off-machine backup, and reconciled the skill registry (registered viz-ad-creative-codex, de-registered the removed meta-goal-breakdown).

Regression to avoid: Never copy shared scripts/skills/hooks into client folders - symlink to the single root copy (AGENTS.md Skill Publishing). Keep the Skill Registry reconciled with disk so a removed skill is never left wired into Task Routing.

## 2026-07-21 - template-sync: self-heal push race + open-PR detection

A --force-with-lease rejection from a concurrent sync run was misreported as auth/network and abandoned; now refreshes the lease and retries once. And gh pr view matched closed/merged PRs, so no fresh PR was opened and the branch stayed unmergeable; now lists OPEN PRs for the head and opens one when none is open.

Regression to avoid: Do not report a push failure from its error string alone, and do not treat any existing PR as an open one.

## 2026-07-21 - Absorbed Evidence Discipline (stale-copy failure class)

Baked the general grounding principle into core: new AGENTS.md Evidence Discipline gate (answer from the source not a copy; tag claims verified/proposal/unknown; other parties speak for themselves), extended the always-on agency-discipline-gate hook clause 4, widened the fresh critic to claim-heavy deliverables, and added matching dated rules to q-question and meta-bake-it-in. Trigger: four stale-copy corrections in two weeks, with the last one on a client integration relay. v1 was overfit (incident-shaped hook); reshaped after the user flagged it as too specific.

Regression to avoid: Do not re-add incident-shaped conditional hooks or questionnaire-specific doctrine; generalize to the failure class and extend always-on surfaces instead.

## 2026-07-21 - Harden meta-bake-it-in from self-review

Post-run review of the ponytail bake-in fixed five class-level gaps in meta-bake-it-in: security scans now require coverage proof (an unrun/no-op grep is not CLEAN, and text assets like SVG must be scanned); overlap comparison must span all doctrine sections, live skills, and hooks, not one section; a MERGE must end with a one-voice coherence read; the Step 5 approval pause scales to blast radius instead of blanket-pausing; and the marker keyword and record path were made consistent after the meta-absorb rename.

Regression to avoid: Do not grade a security scan CLEAN without naming coverage, do not compare a keeper against only its obvious landing section, and do not blanket-pause on low-blast reversible writes.

## 2026-07-21 - Skill descriptions describe, not list triggers

Rewrote all 102 live skill descriptions to lead with what the skill does and drop the invoking-phrase walls (65 corey via parallel agents, 26 core via folded-YAML strip, 2 by hand). Reversed the AGENTS.md 'Description format' rule (was 'keep every trigger phrase') and added a skill-system-audit.sh check that flags any description reverting to a Triggers:/'Also use when'/'When the user wants' phrase list.

Regression to avoid: Do not reintroduce trigger-phrase lists in descriptions - the audit's DESC_PHRASELIST check exists to catch that; the capability statement carries the routing signal.

## 2026-07-21 - Skill routing: two-field description + when_to_use

Verified via Claude Code docs that skill invocation is semantic matching on name+description, not literal trigger phrases. Kept the readable human-first descriptions and restored the example phrasings into the separate documented when_to_use field for 93 skills, so the picker stays clean while invocation signal is full.

Regression to avoid: Do not put trigger-phrase lists back into description; put them in when_to_use. Do not assume phrase lists are required for invocation - they are not.

## 2026-07-21 - Catalog enrichment layer

Added an enrichment layer above the Notion catalog. Tools now carry what-it-does, best-for and pricing; resources carry the real gist and takeaways instead of a bare title. Records live in the git-tracked context/notion-enriched/enrichment.json keyed by Notion page id, so a re-sync never wipes them (the raw mirror stays gitignored and free to rebuild). build_catalog.py merges enrichment, dedupes items sharing a URL, and labels sources that cannot be fetched. list_unenriched.py is the work queue.

Regression to avoid: Never enrich the Notes database into the tracked store - it holds client and personal material and that file is committed. Never write enrichment into context/notion/items/ (the sync overwrites it). Enrichment costs credits, so it stays a deliberate step, not part of the credit-free daily sync.

## 2026-07-21 - Notion sync scoped to Stack + Resources

Removed the Notes database from the notion-sync pipeline entirely. The user asked for a catalog of the Stack and Resources databases only; Notes holds client and personal material and was never meant to be mirrored into AI-OS. Dropped notes from DATABASES in notion_sync.py, cleared the already-synced context/notion/items/notes and the stale note-only tag files (to Trash, recoverable), and removed notes from .sync-state.json. Verified a full sync now fetches only stack and resources with zero client content anywhere in context/notion/.

Regression to avoid: Do not add the Notes database (19ec6192c26680139071c6f3071a89f8) back to the sync without the user asking. The catalog pipeline is Stack + Resources only.

## 2026-07-21 - Notion sync poll cadence 15 min

Changed the notion-sync launchd job from a daily 22:30 run to StartInterval 900 (every 15 minutes), in both the installed ~/Library/LaunchAgents copy and the repo template. The sync is credit-free and incremental, so frequent polling makes new Stack/Resources pages appear in AI-OS within minutes of saving, close to a live trigger without any webhook receiver. Reason: a true event trigger needs an always-on public HTTP endpoint (Notion webhooks exist as of 2026 but cron/launchd cannot receive them); for a personal catalog a fast poll is the right tradeoff over a tunnel plus n8n.

Regression to avoid: Do not confuse cron/launchd with an event listener - they only schedule. A true Notion trigger requires an exposed receiver (n8n behind a tunnel, or n8n cloud). Keep enrichment off the auto path (it costs credits); only capture runs on the poll.

## 2026-07-21 - Health rollup now reports the truth

collect_cron_streaks() in scripts/health-rollup.py only fired on a 3-in-a-row failure streak, so it printed 'all monitored loops are healthy' while two jobs sat failed, one job entry was dead, and a daily job had been silent for 6 days. It now reports any non-success result on the first failure, flags never-run/leftover entries, and adds cadence-aware staleness driven by each job's own days: field (daily 3, weekdays 4, weekly 16, monthly 62). Verified: went from 0 findings to 4 true findings.

Regression to avoid: Never let the monitor's threshold be looser than the thing it monitors - a watchdog that reports green while jobs are red is worse than no watchdog, it manufactures false confidence. Staleness must be cadence-relative, not a flat day count, or it either cries wolf on weekly jobs or misses dead daily ones.

## 2026-07-21 - Notion catalog backfilled and categorised

Verification against live Notion showed AI-OS held only 53 of 495 Stack+Resources items (11 percent): notion_sync.py had only ever run incrementally, so the entire back catalogue predating the first sync was never fetched. Ran notion_sync.py --full (Stack 17->260, Resources 36->235, now 0 missing, verified against live). Then ran a one-time judgement pass over all 495 items assigning a category from a controlled 27+13 taxonomy, stored in the git-tracked context/notion-enriched/categories.json; build_catalog.py now prefers an assigned category over keyword rules. Uncategorised went from 343 to 0.

Regression to avoid: Never report a mirror complete without counting it against the live source - an incremental sync silently hides everything older than its first run. Keyword category rules do not survive a 15x volume increase; seed a taxonomy from the real data. Schedule a periodic --full reconcile, since incremental sync also never notices Notion-side deletions.

## 2026-07-21 - Template licence boundary, team packs, and Notion team page

Added a never_publish list to the update manifest so proprietary vendored subtrees (cf-frameworks, planner, copy-qa, community-claude-md-rules) can never reach the public template, backed by an independent check in template-release-check.sh and skills-library/ added to TEAM_STRIP. Merged the never-landed team-sharing commit (194fe9f9): .aios optional capability packs, optional-enable/disable/list/status, team-publish/team-status, plus the missing team_copy_shared_tree helper. Renamed real client names used as test fixtures to acme/globex so six required test scripts, README.md, and three load-bearing docs could propagate. Removed the dangling meta-synthesize-locals reference.

Regression to avoid: Do not widen the template allowlist past ai_os_owned, do not allowlist real client names to force a held file through, and never republish a pack whose licence forbids it - exclude it instead of scrubbing it.

## 2026-07-21 - Vendor namespace for skills, team layer fixes

Renamed 65 vendored Corey Haines skills from corey-* to coreyhaines-*, a vendor namespace rather than an AI-OS category prefix, so provenance is visible in the picker and vendored methodology cannot silently compete with native mkt-*/str-* skills; added an accurate Context Needs contract and a learnings section to each, clearing the standing audit failure (0 failures, was 1 failure and 66 warnings). Finished the team layer: make-team-copy.sh now calls the shared team_copy_shared_tree instead of duplicating the export, team_leak_verify uses the canonical secret-scan.py with an explicit file list, and its home-path regex matches sanitize-strings.sh.

Regression to avoid: team_leak_verify must never pass when the scanner cannot run or is given no files - an export tree has no git history, so a bare secret-scan.py call scans nothing and falsely certifies a clean tree. Never rename a vendored skill into a category prefix.

## 2026-07-21 - Template distribution repointed, remove-skill parks instead of deleting

The public template README told downloaders to clone the PRIVATE camrontaylor/AI-OS repo with a token; that repo tracks 2,506 client files (brand assets, deliverables, current-state briefs), so the documented install path either failed for a stranger or exposed client work. Repointed the quickstart at the public AI-OS-Template repo (no token, no account), kept the Agentic Academy link as support rather than the clone path. Merged PR #8 to template main (0c9c965), the first real template release since 2026-06-24. Also made remove-skill.sh park a skill into _archived/ instead of hard-deleting the folder.

Regression to avoid: Never point the public template's install path at a private repo that tracks client data. Never let remove-skill.sh hard-delete: add-skill.sh restores from _archived/ first and only falls back to git history, which a fresh clone or team copy may not have.

## 2026-07-23 - Decision Ledger

Added context/decisions.md (root + per client): directional decisions (positioning, offer, pricing, naming, strategy) recorded as first-class objects with a reopen gate and a reopen counter. client-memory-maintenance.sh surfaces open/gated/churned entries at the top of current-state.md (loaded at client session start); meta-wrap-up Step 3g maintains them; AGENTS.md carries the rule. Built after MSF positioning was rewritten 4x in 7 weeks with 0 buyers, because a settled decision left no durable surfaced object carrying its reopen gate and the correction loop cannot catch a re-decision (nobody was wrong).

Regression to avoid: Do not let the ledger produce a false do-not-reopen that blocks a legitimate, user-authorized change; an authorized reopen (user directs it, or gate met) is normal. Keep it append-only; never overwrite a prior call. Do not add the deterministic thrash detector unless churn recurs despite the ledger.

## 2026-07-23 - Memory curator floor + stress tests

The MEMORY.md curator gate ran the whole trim as a full claude -p session invoked with exec, so when that session timed out (2026-07-21/22, two nights) nothing trimmed the file and it drifted over cap with no post-check. Added scripts/lib/memory-hygiene.py (deterministic remove-resolved + dedup + archive-oldest floor that guarantees the cap with zero AI, never deletes), rewired scripts/memory-curator-gate.sh to run the AI step best-effort and time-boxed then always enforce the floor and verify the result, added a 29-case stress suite (scripts/test-memory-curator-gate.sh), and a health-rollup collector for cold-thread drift.

Regression to avoid: Never let the memory cap depend solely on an LLM session with no deterministic floor and no post-condition check - a timed-out or timid curator must not silently leave the file over cap.

## 2026-07-23 - Absorbed ADHD divergence into Thinking Discipline

Baked UditAkhourii/adhd's divergence-before-convergence posture into SOUL.md and the AGENTS.md Thinking Discipline (widen past the first plausible answer, then commit and hand over the decided call, not the wide set), plus a new lazy-load context/thinking/divergence.md carrying the loop, a citation to the frame techniques already in q-unstuck and model-catalog, and the one novel piece: escalation to mechanical isolation (separate zero-shared-context subagents plus a separate critic) gated to high-stakes open-ended calls. Frames were MERGE/cited not duplicated; engine code dropped. Absorption is conceptual (principle in our own words), so no ADHD code vendored.

Regression to avoid: Do not let widen-before-you-narrow bloat responses: the widening is internal, the deliverable stays the committed call. Do not auto-fire mechanical isolation (2x cost) on ordinary turns, it is escalation-only. Do not re-import the frame techniques as a duplicate list, they already live in q-unstuck and model-catalog.md.

## 2026-07-23 - Memory curator: deterministic-only

Removed the inline AI step from the MEMORY.md curator after an independent adversarial review found it was the only unrecoverable-loss path (a model rewriting the file in place drops a distinct fact the archive never sees) and put nondeterminism in the frozen-snapshot file's write path. Curator is now purely deterministic: strict resolved-marker removal ([done]/checkmark only, no soft-word false positives like 'to be fixed'), dedup, stalest-first eviction to a 2300 target (Active Threads first; Env Notes and Decisions preserved), atomic writes via mkstemp+os.replace, exit-code-checked post-condition. Semantic merge/staleness suggestions moved to the weekly-memory-gaps REPORT (never edits MEMORY.md). Archive moved to context/archive/ (off the semantic-index source path). Fixed multi-line-entry shredding, unknown-heading folding, and the gate ignoring curate's exit code.

Regression to avoid: Never put an unattended LLM in the write path of MEMORY.md - semantic curation is a report a human applies; the write path stays deterministic and loss-free. Keep the archive out of context/memory/ so evicted entries do not re-enter semantic recall.

## 2026-07-23 - Response Discipline posture

Added an always-on Response Discipline to AGENTS.md (after Coding Discipline), wired context/SOUL.md and the Next Actions footer to it, driven by 2026-07-23 deep research (19 verified findings across 22 sources). It makes response length an adaptive judgment that scales to task difficulty and the data on the table (no numeric cap), keeps answer-first ordering scoped so it never forces a verdict before the reasoning, and cuts padding not depth so concision never costs thinking-partner depth. Refined through two adversarial critic passes, then validated by an A/B blind eval and an 8-scenario 3-judge adversarial harden (converged, no shape defect). Design of record: `projects/briefs/response-discipline/brief.md`.

Regression to avoid: Do not re-add a numeric length rule (line or word caps): LLMs cannot perceive them and rigid caps wreck answers where thinking matters most. Do not let answer-first force a verdict before the reasoning on genuine 'it depends' turns. Do not cut the counter-case, genuine forks, or honest uncertainty as 'padding' - padding is restating/hedging/narrating, not the analysis.

## 2026-07-23 - Absorbed scraper silent-rot + Reddit routing into scraping doctrine

Evaluated ai-job-search, codebase-memory-mcp, Agent-Reach; parked all three at repo level. Baked one paragraph into AGENTS.md Web Data & Scraping Routing: trust output not exit code (0-row/garbled at exit 0 is the real failure; canary; rate-limit/403 != dead), and route Reddit via Apify since anon .json is 403-dead and its API is gated. Security-scanned the absorb-source files clean first.

Regression to avoid: Do not run these repos' installers (codebase-memory writes global ~/.claude/skills + settings hooks = the 2026-07-08 collision wipe); do not scrape personal logged-in sessions (Agent-Reach) over the managed Apify path.

## 2026-07-23 - Added security-posture drift check to meta-systems-check (13b)

Built an install-agnostic tripwire (pattern from ai-job-search security_guards.py) that flags widened permissions.allow, an unrestricted Bash(*) allow, removed rm/curl/wget/ssh/scp denials, a dropped Read(.env) deny, and missing or negated personal-data .gitignore rules. Home is check 13b in meta-systems-check/scripts/check.sh, beside the existing settings.json JSON check. Tested clean on the real install and catching all 9 injected problems on a tampered copy.

Regression to avoid: Do not re-home this into template-sync: settings.json and .gitignore are NOT in ai_os_owned so template-sync never ships them - the tripwire belongs where the files actually live and get pushed (the install), not the template propagation path. Keep it install-agnostic so it also passes in the template.

## 2026-07-23 - Self-Monitoring Failsafes

Closed the biggest gap in AI-OS self-monitoring: it detected failures but only surfaced them into an interactive Claude Code session, so a broken loop could sit red for days (as the 2026-07-21..23 cron timeout cluster did). Added (1) a concurrency gate in claude-cron-wrapper.sh via a portable fcntl helper (scripts/lib/cron-claude-lock.py) that serializes headless claude cron jobs, killing the catch-up storm that timed out the whole memory-job cluster; (2) scripts/aios-watchdog.sh + com.aios.watchdog launchd agent, an independent watch-the-watcher that restarts a dead cron daemon and pages out-of-band, running outside cron every 30 min; (3) scripts/health-escalate.py, out-of-band phone/macOS escalation of loop-health findings with priority escalating by age, deduped; (4) an active-gate in health-rollup.py so retired/dead jobs stop burying real failures; (5) scripts/relink-client-scripts.sh to idempotently restore client script symlinks that drift whenever a root script is added. Also fixed the stale corey-marketing-aso installer entry and enabled decision-ledger-check.

Regression to avoid: Do not remove the concurrency gate in claude-cron-wrapper.sh or the catch-up storm returns (parallel claude sessions starve each other into timeouts). Keep the active-gate in health-rollup.py so retired jobs never re-pollute the rollup. The watchdog MUST stay a separate launchd agent, never a cron job, or it cannot detect a dead cron daemon. Escalation only reaches the phone if PUSHOVER_TOKEN/USER are set in .env; without them it is macOS-banner-only.

## 2026-07-23 - Recall Gate + Test Fixtures

Resolved two self-test failures surfaced by the failsafe verification. (1) test-client-memory-maintenance.sh: the temp fixture never copied scripts/lib/decision_ledger.py, so --mode brief died with ModuleNotFoundError; fixture now carries the module. (2) test-recall-golden.sh paraphrase gate: it hard-FAILed the whole health suite whenever cross-vocabulary recall dipped below 100%, on the false assumption that a paraphrase miss means the semantic layer is dead. Proven brittle - the 2 paraphrase cases flipped 0/2 to 2/2 within an hour purely from the live corpus shifting. Recalibrated recall_gate.classify to distinguish dead (no semantic/hybrid results at all -> FAIL) from dull (alive but ranked outside top-k -> WARN), consistent with the 2026-07-20 two-tier philosophy. Fusion/ranking untouched (retuning was explicitly declined). Gate regression test updated to lock the new contract.

Regression to avoid: Do not restore the paraphrase hard-FAIL - it false-alarms on a healthy but corpus-shifted index, the exact treadmill the two-tier gate exists to prevent. Keep the dead-layer FAIL (no semantic results) intact so a truly decorative index is still caught. Do not chase 100% paraphrase recall by retuning fusion - it risks the 18 passing cases.

## 2026-07-23 - Built absorb-scan.py + baked it into meta-bake-it-in Step 2

Deterministic read-only security scanner (scripts/lib/absorb-scan.py) that runs the whole references/security-scan.md battery over a source tree with coverage proof, reusing secret-scan.py and adding the installer/config-write + binary-download class. Wired into meta-bake-it-in Step 2, security-scan.md, and a Rules entry. Audited all three repos: ai-job-search + Agent-Reach = REVIEW, codebase-memory = HIGH but all drivers verified benign at source (test fixtures, generated parser tables, documented installer). All three are intrusive installers = contain, do not run.

Regression to avoid: A hand-run grep gate is not a scan: two manual passes silently no-opped on zsh word-splitting and read as clean. Always run the script, and always verify a HIGH secret hit at the source - the scanner fails closed and can flag a non-English placeholder or a test fixture.

## 2026-07-24 - Daily Notes Memory Layer

Added daily/ as a human-plus-auto Obsidian daily-note layer: scripts/daily-note.py composes each day's sessions (backlinked to client hubs) and Notion saves from Resources, Stack, and the previously-excluded Notes DB (rendered title-plus-link only). Backfilled 389 days, wired daily/ into routine memory recall (semantic index, markdown fallback, policy doc), and set Obsidian to open today's note on startup.

Regression to avoid: Keep Notes DB rendering to title-plus-link only so secrets never reach daily notes; do not index raw Notion note bodies; do not fork the session-memory hooks; past days must stay frozen once finalized.

## 2026-07-24 - Response bloat: kill-list + detection hook

Prompt-only Response Discipline (2026-07-23) did not remove bloat; transcript mining showed the correction post-mortem survived in ~19% of sessions. Added a named six-pattern kill-list to AGENTS.md point 3 (headed by the correction reflex, with exact banned phrasings), the correction reflex to SOUL.md, and a log-only response-bloat-check.js Stop hook wired in settings.local.json for measurement.

Regression to avoid: Do not turn the bloat hook into a length cap or a blocking check - it is observability only; the rigidity (numeric caps, hard cut-offs) is exactly what the user rejected. Do not drop the depth-protection clause when trimming - concision cuts hesitation, never the counter-case or the reasoning a decision turns on.

## 2026-07-24 - Memory freshness: dated recall + grounding backstop

Auto-recall (.claude/hooks/auto-recall.js) now stamps every injected fragment with its write-date and age and reframes the block from 'reference material you already know' to 'unverified leads, re-ground before relying'; added .claude/hooks/grounding-check.js (Stop, log-only) to flag substantive user-world claims made with no grounding tool; extended cron/jobs/weekly-memory-gaps.md from report-only to a re-ground queue. Root cause was that recall stripped dates, so the '>14 days = stale' rule had nothing to fire on and memory read as established fact.

Regression to avoid: Do not revert the injection to 'reference material you already know' framing, and do not strip the per-fragment date/age - that combination is what made memory read as verified-current when it was stale. Keep the grounding hook log-only (never blocking).

## 2026-07-24 - Decision ledger: last-confirmed currency field

Added an optional Confirmed: (last-verified) date to the decision ledger, separate from Decided:. scripts/lib/decision_ledger.py surfaces confirmation currency on every open decision in current-state.md (dated + age, or 'not re-confirmed since written - re-ground before relying' when absent). Schema updated in AGENTS.md, context/decisions.md, and the module docstring. Part of the 2026-07-24 memory-grounding fix: gives directional decisions a freshness signal so a stale settled call is not relied on as current.

Regression to avoid: Keep Confirmed optional - never add it to REQUIRED_FIELDS, or every pre-existing ledger entry becomes 'malformed'. The surfaced 'not re-confirmed' line is the freshness signal; do not silence it for unconfirmed entries.

## 2026-07-28 - Footer default-off: the sanctioned bloat

Reviewed a week of .claude/hooks_info/bloat-misses.log (73 flagged replies; long_tail 53 and recap 27 dominant, median 2964 chars). Root cause of persistent bloat: the response-bloat-check Stop hook only measures (a Stop hook fires after the reply and cannot retract it, only add), and the mandatory Next Actions footer was rule-sanctioned padding that directly contradicted the Response Discipline's cut-padding rule. Fix: flipped the footer from mandatory to default-off in AGENTS.md and context/SOUL.md, removed the contradicting scale-block table, and sharpened the recap ban to the top pattern (work saved to a file -> link plus one line, never a retell).

Regression to avoid: Do not re-introduce a mandatory or every-reply footer - it is the single most frequent sanctioned bloat. The footer is opt-in: only when there is a genuine, non-obvious next move. Passive Stop-hook logging does not change behavior, so do not treat the bloat log as a fix; the lever is removing sanctioned bloat and reducing the competing instruction load, not adding more rules.

## 2026-07-28 - Added skills-library/resources/ lane + meta-systems-check check 19

Built a second skills-library lane for non-skill external resources (apps, MCP servers, toolkits): metadata-only RESOURCE.md per entry, never full-source-vendored. Fixes the gap exposed 2026-07-23 when three evaluated repos got vendored via an ad-hoc judgment call instead of the standing automatic rule. sources.json gained a fourth array (resources, alongside sources/candidates/excluded). meta-skill-intake now routes automatically by shape (has SKILL.md -> backlog/, else -> resources/). meta-systems-check gained check 19: orphan folders, dangling registry entries, and a bloat guard for the metadata-only invariant - tested clean on the real repo and catching all 8 injected problems on a tampered fixture. Found and fixed two pre-existing orphans while building the check (stray .git-backup cruft, a misfiled unstuck ASSESSMENT.md).

Regression to avoid: Never vendor full source into resources/ regardless of repo size - the rule is categorical so a future reader never has to guess why one resource got full source and another did not. Kept inside skills-library/ rather than a new top-level folder per the 2026-07-15 'leave it as-is, the mess is external' verdict.

## 2026-07-28 - Fixed meta-find-skills staleness + wired resources/ lane awareness

meta-find-skills (the front-door skill-discovery skill) had gone stale: it referenced the dead triage->review->live pipeline removed in the 2026-07-21 simplification, and had zero awareness of the resources/ lane added earlier today. Fixed Search order to explicitly cover both lanes with correct current hand-offs (meta-skill-intake for backlog assess/promote, meta-bake-it-in for absorbing a resource piece), removed the dead pipeline references, expanded when_to_use triggers, added a resources-lane Eval test. Also named meta-find-skills explicitly in AGENTS.md Task Routing step 5 (factual naming only, not the previously-declined auto-invoke-as-default-fallback behavior).

Regression to avoid: When a user describes a capability that sounds like it needs a new skill, check whether an existing skill's own negative triggers already claim that job before building - meta-skill-intake's own description said 'not for finding, see meta-find-skills,' which was the real signal this already existed and just needed repair.

## 2026-07-28 - Memory Retrieval Observability

Built the memory retrieval-observability layer: the missing signal for what memory actually gets retrieved and surfaced vs sits in the index dead - the prerequisite for any adaptive memory work, and a health check for whether auto-recall is used at all. Added scripts/lib/recall-log.py (flock-guarded best-effort JSONL sink, size-capped/rotated), instrumentation in scripts/memsearch-search.sh (the retrieval chokepoint, backgrounded so logging is off the latency path and stdout stays byte-identical) and .claude/hooks/auto-recall.js (organic path, logs what was actually surfaced via detached spawn), eval/cron caller tagging so the organic signal stays clean, scripts/recall-usage-report.py (hot/cold/coverage readout with a MIN_DAYS data-sufficiency gate that refuses dead-weight conclusions on thin data), and a weekly recall-usage-review cron that surfaces an actionable line via the health-rollup only when warranted. A fresh subagent code review found two confirmed bugs (flock double-rotation clobbering the archive under concurrency; data_days counting out-of-window records and defeating the sufficiency gate) plus robustness gaps (caller-tag override, synchronous logging on the critical path, symlinked-ROOT path mismatch) - all fixed and regression-guarded in scripts/test-recall-observability.sh (8 checks). Deliberately did NOT build auto-ranking-tuning (proven-noisy, declined) or auto-aging (gated behind the real data this now collects).

Regression to avoid: Do not put recall logging back on the synchronous critical path - it runs inside auto-recall's 9s budget and a contended append could drop a successful recall. Keep the flock append's verify-live-inode loop; the naive fstat-after-lock rotates twice under concurrency and destroys the archive. Keep data_days measuring only in-window records or the 28-day sufficiency gate is defeated by a single old straggler. Never auto-tune the ranker from recall outcomes (gate G3).

## 2026-07-28 - Memory read-path overhaul: consumption was the broken half

Full diagnosis of the July correction record (3 audit agents over every session log, hook, cron, and skill) proved the memory system wrote faithfully but sessions barely consumed it: the auto-recall gate starved injection (0.75 floor vs real correct-hit scores of 0.50-0.90, exact-match hits structurally barred, one fire per session consumed on the first prompt), client sessions were scope-walled off root learnings/MEMORY, learnings.md had no guaranteed read path (85KB root + 31KB client rules effectively write-only), agency-gather.sh was wired into zero skills and its Taste-calls grep read a heading that never existed, and the markdown fallback multiplied every learnings.md hit by 0.35 on non-system queries (golden markdown recall: 45%). Fixes, each stress-tested against the real July failure prompts: auto-recall recalibrated (floor 0.5, exact-match lane with reserved slots, up to 4 fires/session with 90s cooldown + zero-yield backoff, cross-fire dedup, per-workspace daily-log exclusion, stale/root-note labels, two-class preamble: internal preferences apply directly, outside-world claims verify live); writing-context-gate v2 injects the CONTENT of the matching learnings sections (skill rules, Preferences, recent mistakes) at draft time with fit-scaled framing, budget, cooldown, cron guard, and gate-overlap dedup shared with auto-recall via hooks/lib/writing-prompt.js; load-memory-snapshot adds root MEMORY.md to client sessions; new workspace recall scope (client + root, never other clients) is the client-folder default; memory-search.py fallback fixed (penalty removed, source-diversity reorder 2-per-source, temporal-intent boost, reweights) lifting golden markdown recall 45% to 95%; client learnings restructured to a single # General; a client AGENTS.md gained load-first rules; comms-message and q-question wired to agency-gather. Three independent review passes (correctness, adversarial failure modes, coherence) each ran and their findings were fixed and re-verified; all recall/hook/snapshot test suites green.

Regression to avoid: Do not restore the 0.75 semantic floor, the once-per-session fire, the semantic-only lane, the client-only default scope, or the learnings.md 0.35 penalty - each was independently measured to suppress correct recall (this supersedes the 2026-07-20 auto-recall calibration notes and partially supersedes the unverified-leads framing entry: internal preferences/decisions are now apply-directly, outside-world claims remain verify-at-source). Do not flip the writing gate back to instruction-only text; injected content at draft time is the lever that addresses the July correction record. Keep the gate-overlap dedup in lib/writing-prompt.js - removing it re-creates verbatim double-injection.

## 2026-07-30 - Impeccable Comprehensive Mode override

Added an AI-OS-owned override (context/impeccable-comprehensive-mode.md + CLAUDE.local.md pointer) that makes the personal-scope impeccable skill use its full toolkit via a Step 0 dispatch gate (evaluate-only stops without editing; redesign hands off to new-work.md's mandatory roll + finish handoffs; planning follows shape; micro-tweak scales down; open-ended refinement runs the full five-phase pipeline with mode-gated lenses and bounded browser verification). Lives in AI-OS not the skill dir because npx impeccable update clean-replaces the whole skill folder. Also gitignored .impeccable/.

Regression to avoid: Do not put the override inside ~/.claude/skills/impeccable (update wipes it); do not run every lens on every invocation (force-edits evaluate-only requests, polishes discarded redesign looks, adds color/motion to restrained Operate surfaces, over-runs micro-tweaks); keep it update-safe and dispatch-gated.

## 2026-07-30 - Absorbed no-ai-slop (anti-slop default)

Made no-ai-slop's AI-tell pattern-and-word standard the system default for all prose: new AGENTS.md '## Anti-Slop Standard' always-on doctrine (chat replies + deliverables), 8 net-new patterns merged into tool-humanizer/pattern-library.md, and an 'ai_slop' measurement signal in response-bloat-check.js. Single canonical list in tool-humanizer; doctrine points to it, no duplication.

Regression to avoid: Do not re-add a full duplicated banned-word list into AGENTS.md (bloat) or overwrite existing tool-humanizer/Response-Discipline lines - doctrine names tells, the skill holds the catalog, edits are additive.

## 2026-08-04 - complete skill support in template sync

Template sync and update now share one ownership path matcher, so wildcard directory prefixes such as .claude/skills/*/references/ match nested skill support files correctly. The update manifest now includes standard skill support directories for references, assets, evals, scripts, agents, eval-viewer, and package.json files, letting promoted MIT skills such as the Corey Haines marketing and maker packs ship as complete template capabilities instead of SKILL.md-only shells.

Regression to avoid: Do not copy the entire .claude/skills tree or bypass sanitizer/never_publish; widen only explicit AI-OS-owned skill support paths and keep local overrides user-owned.
