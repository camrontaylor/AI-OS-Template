# AGENTS.md

Canonical instruction file for AI-OS. Codex and other AGENTS-aware tools
read this directly; Claude Code reads it through `CLAUDE.md` via `@AGENTS.md`.

## What This Project Is

AI-OS is an agent-first operating system for Codex and Claude Code that turns
either agent into a business assistant. Operating rules, registries and conventions live here.

---

## Session Startup

Resolve shared docs and inherited skills against the directory containing this
root AGENTS.md; resolve context, config and projects against the active workspace.
At the start of each session, read the root's `docs/agent-startup.md` and follow the shared
scope, identity, memory and first-use rules. Begin a stated task immediately;
optional onboarding never takes precedence over it. Claude hooks are optional
runtime support, not a requirement for Codex. Quick start: `docs/quick-start.md`.

## Task Routing

When the user asks for something:
1. Check **Built-in Operations** first — if it matches, execute directly.
2. Otherwise search `.claude/skills/` frontmatter for a matching skill. Codex
   discovers the same source through `.agents/skills/`; respect active client
   `skillOverrides` and prefer client-local skills over inherited ones.
3. If a skill matches, invoke it (and read its `SKILL.local.md` alongside).
4. If none matches, say so and offer to either build a skill or handle it now
   with base knowledge.

Never fall back to base knowledge when a skill exists, and never handle a task
without naming the skill gap, so the user gets the maintained methodology and can
choose to build a skill when none matches.

## Answer vs Action

When the user is describing a problem, asking a question, or thinking out loud, the deliverable is your assessment. Report your findings and stop. Don't apply a fix until they ask for one. This is the default for conversational turns; it does not apply to an explicitly requested task or to a scheduled/autonomous job, which carries its own instruction.

## Built-in Operations

Core system functions handled by scripts. Check these before searching skills.

| User says | Action |
|-----------|--------|
| "add a client", "new client" | See **Add Client Flow** below |
| "remove a skill", "uninstall {skill}" | Root: `bash scripts/remove-skill.sh {skill-name}`. Inside a client: hide it by adding `{ "skillOverrides": { "{skill-name}": "off" } }` to that client's `.claude/settings.local.json` (merge into the existing JSON, don't replace) — never remove from root, run `remove-skill.sh`, or write a "do not use" note in the client's `AGENTS.md`. Details: `docs/multi-client-guide.md` |
| "add a skill", "install {skill}" | `bash scripts/add-skill.sh {skill-name}` |
| "synthesize skills", "sync local overrides" | Run `meta-synthesize-locals` skill |
| "list skills", "what skills are installed" | `bash scripts/list-skills.sh` |
| "start / stop / status / logs crons" | `bash scripts/{start,stop,status,logs}-crons.sh` |
| "setup memory", "enable searchable memory" | `bash scripts/setup-memory.sh` |

### Add Client Flow

Run `bash scripts/add-client.sh "{name}"` (ask for the name if missing), then
tell them to switch to `clients/{slug}` in Codex, or launch `codex` or `claude`
from `cd {absolute path}/clients/{slug}`. Full
structure: `docs/multi-client-guide.md`.

---

## Team OS Context Snapshot

When Team OS is connected, the injected session-scoped snapshot is the only
runtime authority for team, client and private-user context. Safety invariants:
- Do not read other users' or other teams' files; do not infer `teamId`,
  `userId` or client access from local paths — the server resolves them.
- Do not read workspace `AGENTS.local.md`, `CLAUDE.local.md`, `context/*`,
  `team_context/`, `brand_context/` while Team OS is active.
- Later context layers add preferences only — never reduce safety, bypass
  permissions, or cross tenant boundaries.
- If the server is unavailable, do not reuse stale context; continue only in
  explicit conversation-only mode. No Team OS login → Solo flow unchanged.

Import local context after signing in: `npm run context:import` from
`command-centre/`; refresh a connected workspace with `npm run context:sync`.
Snapshot resolution and Chat-UI skill scoping: `docs/team-os-identity-and-scope.md`.

## Local Agent Overrides

Solo mode: read `AGENTS.local.md` after this file when present. Team OS mode: use
only the private-user rules in the injected snapshot. User-owned, never updated.

---

## Operating Rules

- **Skill & MCP reconciliation:** compare disk against what's registered — fix
  additions silently, confirm removals. Per-case steps: `docs/building-skills.md`.
- **Skill mechanics** (local overrides, categories, naming, three-layer,
  registry): `docs/building-skills.md`.
- **Client scoping** (hide vs uninstall, `skillOverrides`): `docs/multi-client-guide.md`.
- **Before a major deliverable:** load `brand_context/` per `docs/context-matrix.md`
  and read the skill's section in `context/learnings.md`. Missing context never
  blocks work — offer to build it.
- **After a major deliverable:** ask "How did this land? Any adjustments?" and
  log feedback to `context/learnings.md` under the skill's section.

### Branching Policy

`main` is protected: PR to merge, CI must pass, no force-push. `dev` is the
working branch. Zone routing: content → commit direct to `dev`; config → `dev`
too, but a feature branch is advised; code → a feature branch off `dev`. Release
flow, per-zone file lists and Solo-vs-team defaults: `docs/branching.md`.

---

## Memory System

Loaded at session start: `context/SOUL.md`, `context/USER.md`, `context/MEMORY.md`
(**2,500-char hard cap**), today's daily log. Lazy: `context/learnings.md`.
Claude automatic capture runs via its Stop hook. Codex maintains the daily
block and uses `meta-wrap-up` on sign-off per `docs/agent-startup.md`.

`context/MEMORY.md` writes ("remember this", "note that", "forget about") route to
`meta-memory-write` — add / replace / remove under `## Active Threads`,
`## Environment Notes`, `## Pending Decisions` (no new sections). Over the cap,
consolidate first, then ask which entry to drop. Never store secret values, only
env var names. Mid-session writes take effect next session (prefix cache) — always
say so when confirming: `Saved — will be active from next session.`

Recall a past fact or decision: `npm run memory:recall -- "query"` from
`command-centre/`, or the `meta-memory-recall` skill. Full retrieval ladder,
capture mechanics and budget procedure: `docs/memory-retrieval.md`,
`docs/memory/session-capture.md`.

---

## Output Standards

- Level 1 (single task) → `projects/{category}-{output-type}/`. Level 2/3 (brief /
  GSD project) → `projects/briefs/{project-name}/`. Rules: `docs/projects-guide.md`.
- Filename: `{YYYY-MM-DD}_{descriptive-name}.md`. Default format markdown.
- Show the full absolute path after saving. Copy non-markdown outputs to `~/Downloads/`.
- **Humanizer gate:** every skill producing publishable text runs `tool-humanizer`
  before saving (`deep` when `brand_context/voice-profile.md` exists, else
  `standard`). Research briefs, ICP profiles and positioning docs skip it.
- **Graceful degradation:** no `brand_context/` → produce solid generic output;
  partial → default the rest; full → personalise. Context enhances, never gates.

## Writing

Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of the response on the main answer. When asked to explain something, give a high-level summary unless an in-depth explanation is specifically requested. Please remove all mannered prose.

For documents the agent writes to disk (posts, reports, drafts), match the length to what the task needs: cover the substance, but do not pad with filler sections, redundant summaries, or boilerplate. This length guidance is about conversational responses; it does not cap the deliverables a skill is asked to produce.

## External Services & API Keys

Some skills use external services; keys live in `.env` (gitignored), documented in
`.env.example`. Per skill: check the key exists, tell the user what it does and the
fallback, never block when the fallback is usable. Full registry: `.env.example`.

## Reference Index

- Multi-client structure → `docs/multi-client-guide.md`
- Skill registry → `docs/skill-registry.md` (add rows when registering skills)
- Context matrix → `docs/context-matrix.md`
- Skill categories, naming, three-layer architecture → `docs/building-skills.md`
- Building skills → `docs/building-skills.md`

<!-- Permissions live in .claude/settings.json (permissions.allow / deny). -->

<!-- AI-OS SKILL PACK:START -->
## Installed Skill Pack

93 skills are installed, including 69 adapted workflows (67 new folders and
extensions to `mkt-copywriting` and `str-ai-seo`). The complete trigger registry
is `docs/skill-registry.md`; context loads are in `docs/context-matrix.md` and
each skill's Context Needs. Read the active skill's learnings section only.
`str-product-marketing` maintains `brand_context/product-marketing.md` alongside
the existing foundations. Shared tools are in `.claude/skills/_shared/tools/`;
optional credentials and manual fallbacks are documented there and in
`.env.example`. No account or external memory service is connected automatically.
- fin: `fin-company-cfo`, `fin-invoice-reconciliation`, `fin-month-end-reporting`, `fin-personal-cfo`
- meta: `meta-memory-recall`, `meta-memory-write`, `meta-skill-creator`, `meta-skillify`, `meta-synthesize-locals`, `meta-toolify`, `meta-wrap-up`
- mkt: `mkt-ab-testing`, `mkt-ad-creative`, `mkt-ads`, `mkt-aso`, `mkt-brand-voice`, `mkt-churn-prevention`, `mkt-co-marketing`, `mkt-cold-email`, `mkt-community-marketing`, `mkt-content-repurposing`, `mkt-copy-editing`, `mkt-copywriting`, `mkt-cro`, `mkt-directory-submissions`, `mkt-emails`, `mkt-events`, `mkt-free-tools`, `mkt-icp`, `mkt-influencer-marketing`, `mkt-jab-hook`, `mkt-launch`, `mkt-lead-magnets`, `mkt-marketing-loops`, `mkt-offers`, `mkt-onboarding`, `mkt-paywalls`, `mkt-popups`, `mkt-positioning`, `mkt-programmatic-seo`, `mkt-prospecting`, `mkt-public-relations`, `mkt-referrals`, `mkt-sales-enablement`, `mkt-schema`, `mkt-signup`, `mkt-sms`, `mkt-social`, `mkt-ugc-scripts`, `mkt-visual-identity`
- ops: `ops-analytics`, `ops-attribution`, `ops-cron`, `ops-ingest`, `ops-loopify`, `ops-project-management`, `ops-revops`
- str: `str-ai-seo`, `str-business-brainstorm`, `str-competitor-profiling`, `str-competitors`, `str-content-strategy`, `str-customer-research`, `str-decide`, `str-deep-research`, `str-domain`, `str-maker-council`, `str-marketing-council`, `str-marketing-ideas`, `str-marketing-plan`, `str-marketing-psychology`, `str-pricing`, `str-product-marketing`, `str-seo-audit`, `str-site-architecture`, `str-trending-research`, `str-unstuck`
- tool: `tool-firecrawl-scraper`, `tool-humanizer`, `tool-paste`, `tool-read-book`, `tool-social-fetch`, `tool-stitch`, `tool-watch-video`, `tool-youtube`
- viz: `viz-excalidraw-diagram`, `viz-image-gen`, `viz-interface-design`, `viz-marketing-image`, `viz-marketing-video`, `viz-slide-deck`, `viz-stitch-design`, `viz-ugc-heygen`

After skill changes, run `python3 scripts/sync-agent-skills.py` to update Codex.
<!-- AI-OS SKILL PACK:END -->
