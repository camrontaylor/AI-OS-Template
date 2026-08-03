---
name: meta-skill-intake
description: "Bring an outside skill, pack, or repo into AI-OS: assess it, then promote it live or park it. Not for finding an existing skill (meta-find-skills) or building one from scratch (meta-skill-creator)."
when_to_use: 'Invoke when the request sounds like: "vendor this to backlog", "assess this candidate", "should I promote X", "park that skill", or pasting a skill repo'
---

# Meta Skill Intake

Owns `skills-library/` end to end with an intelligence layer. **Two lanes, one home**
(the backlog lane simplified 2026-07-21 from a five-stage pipeline; the resources lane
added 2026-07-28 - deliberately kept inside the same `skills-library/` home rather than a new
top-level folder, per the 2026-07-15 verdict that the existing structure is clean and the fix
belongs elsewhere): every source that reaches a session gets read, then routed by shape.

- **Skill-shaped** (has `SKILL.md` file(s)): `skills-library/backlog/<name>/` - inert, full source
  vendored, then **assess** → **promote** into `.claude/skills/` or **park**.
- **Not skill-shaped** (an app, MCP server, toolkit, framework - no `SKILL.md` anywhere): route to
  `skills-library/resources/<name>/RESOURCE.md` instead - **metadata-only, never full-source
  vendored** (a compiled server or a thousand-file repo would bloat this repo for no reason; the
  source URL + pinned commit is enough to reclone on demand). Assessed the same intelligence-layer
  way, but the disposition set is PARKED / CONNECTOR-CANDIDATE / PARTIALLY-ABSORBED / ABSORBED, not
  promote-into-`.claude/skills/` - there is nothing to promote a non-skill resource into. Hand any
  `SYNERGY -> AI-OS system` piece to `meta-bake-it-in`, same as the backlog lane.

Never auto-injects into Claude. Both lanes are staging tiers below the live catalog. There is no
`triage/` or `review/` folder and no sign-off gate for either - the assessment is presented in
chat, and you decide. `skills-library/sources.json` has one array per physical concept
(`sources` = vendored skill packs, `resources` = evaluated non-skill records, `candidates` =
noted-but-unevaluated, `excluded` = rejected outright) - read its `_comment` before adding a row.

## Context Needs

| File | Load level | Why |
|---|---|---|
| `skills-library/INDEX.md` | full | Candidate + resource inventory and statuses, both lanes |
| `skills-library/sources.json` + `LICENSES.md` | targeted | Provenance and license authority, both lanes |
| `docs/skills-catalog.md` | full | Live catalog to check dup/merge against |
| `context/SOUL.md` + `context/USER.md` | already loaded | Grain-fit judgment |
| `context/memory/` | grep per candidate/resource | Real past-use evidence |
| `docs/connectors.md` | targeted | Dependency map (have vs need) |
| `context/learnings.md` | `## meta-skill-intake` | Prior intake lessons |

## The flow

| Action | Trigger | What happens |
|--------|---------|--------------|
| **vendor to backlog** | **Automatic** - a skill-shaped source (has `SKILL.md`) brought into a session | Vendor it into `skills-library/backlog/<name>/` (never `skills add`, never `.claude/skills/`). Register: `INDEX.md` row, `sources.json` `sources` entry, `LICENSES.md` row. Change nothing in the content. Inert; no assessment yet. |
| **vendor to resources** | **Automatic** - a non-skill-shaped source (app/server/toolkit/framework, no `SKILL.md`) brought into a session | Do NOT copy the source. Read it fully (in place or from scratch clone), run the Step 2 security scan (`python3 scripts/lib/absorb-scan.py <source>`, same gate `meta-bake-it-in` uses), then write `skills-library/resources/<name>/RESOURCE.md` per the schema below. Register: `INDEX.md` `## Resources` row, `sources.json` `resources` entry, `LICENSES.md` row. |
| **assess** | User asks ("assess X", "should I promote X", "what's worth keeping") | The intelligence layer (below). For a repo, assess every sub-skill - do NOT decompose, bundle, or restructure here; that is a promote-time action. Present the assessment **in chat**; save `ASSESSMENT.md` into the candidate's own `backlog/<name>/` folder for the record (backlog lane only - a resource's assessment IS its `RESOURCE.md`, written at vendor time). |
| **promote** | User decides yes (backlog lane only) | EXECUTE the recommendations - decompose / bundle / merge / de-tailor / register through the full registration bar (below). Update the candidate's `INDEX.md` status to `promoted:{cat}-{name}`. |
| **park** | User decides no (or zero real use) | Backlog: mark `parked` in `INDEX.md` with a one-line reason, stays in `backlog/` (no hard delete). Resources: set `RESOURCE.md`'s Disposition to `PARKED` with the reason; the record itself never gets deleted. Reversible either way. |

## The intelligence layer (assess)

Read EVERYTHING in the candidate - every `SKILL.md`, every `references/` file, scripts,
evals, README. For a repo, cover every sub-skill. Then reason about it against the live
system using the Context Needs sources above.

Present the assessment in chat and save `backlog/<candidate>/ASSESSMENT.md` (one section per sub-skill if a repo) with:

1. **Snapshot** - source, license, size, vendored date, status (from `sources.json`).
2. **Inferred intent and potential** - why the user likely grabbed this, and the upside *for
   them specifically*, given their work, connected tools, and how AI-OS runs. Concrete.
3. **Capability decomposition** - every discrete piece (workflow, reference, script, method).
   One row each: what it does, how novel.
4. **Dependency map** - every MCP, `.env` key, service, and sibling skill it needs, each
   marked **have** (already in AI-OS) or **need (blocking)**.
5. **Grain-check** - does any piece fight how AI-OS works? Check against: no-hard-delete, the
   single USER/memory model, the tool-agnostic contract, the category system, the humanizer
   gate, the voice rules. Flag conflicts explicitly.
6. **Past-use-case examples** - grep `context/memory/` and learnings for real moments where
   this skill would have fired (cite the date). If none fit, theorise the likeliest future
   trigger. Zero real past use is a signal to park, not promote - a bloated live catalog is
   the failure this pipeline exists to prevent.
7. **Per-piece disposition** - `NEW` / `MERGE -> {live-skill}` / `REDUNDANT ({skill})` /
   `DE-TAILOR` / `SYNERGY -> {AI-OS system}`. One candidate can resolve into several
   destinations. When the capability is core posture rather than an invokable tool, the
   disposition is absorb into `AGENTS.md` + `context/`, not a `/` skill (thinking-partner
   and karpathy-coding-discipline precedents). Hand any `SYNERGY -> AI-OS system` piece to
   the **`meta-bake-it-in`** skill, which owns the security-scan-then-bake-in execution; do not
   hand-edit core files from here.
8. **Recommendation + open questions** - overall verdict, the concrete promote plan (name,
   category, what to strip, what to merge where), and the questions the user must answer to
   sign off. Thorough enough that approval makes integration mechanical.

## The intelligence layer for a resource (RESOURCE.md)

Same reasoning depth as a skill assessment, lighter shape - no promote plan (nothing to promote a
non-skill resource into), and the security scan is mandatory up front, not optional. Write
`skills-library/resources/<name>/RESOURCE.md` with these sections (see
`skills-library/resources/*/RESOURCE.md` for worked examples from the 2026-07-23 run):

1. **Snapshot** - source, license, commit evaluated (not pinned unless you have a real reason to
   pin it - state "reclone for a fresh SHA if revisited"), size (file count), explicit
   "NOT vendored" line, evaluated date, evaluated by.
2. **What it is** - 1-3 lines, plain, no marketing language from the source's own README.
3. **Security scan** - run `python3 scripts/lib/absorb-scan.py <source-dir>` FIRST (this is Step 2
   of `meta-bake-it-in`'s gate, reused here so every intake path shares one scanner). Report the
   grade, coverage, and findings. **Verify every HIGH or secret-shaped hit at the source before
   trusting the grade** - the scanner fails closed and can flag a non-English placeholder, a test
   fixture, or the project's own security-pattern file as a false positive (happened on both
   codebase-memory-mcp and Agent-Reach in the 2026-07-23 run). Never skip this step because the
   repo "looks fine."
4. **Disposition** - one of PARKED / CONNECTOR-CANDIDATE / PARTIALLY-ABSORBED / ABSORBED.
5. **What was kept** (if any) - each kept piece with a file:line pointer to where it landed
   (an `AGENTS.md` paragraph, a `meta-systems-check` check, a skill). Hand any keeper to
   `meta-bake-it-in` for the actual absorption - do not hand-edit core files from here.
6. **Why parked / not run** - the specific risk (intrusive installer, personal-session scraping,
   irrelevant capability), grounded, not generic.
7. **If revisited** - the safe path to use it later, if one exists.
8. **Full record** - link to the `projects/meta-bake-it-in/` record if `meta-bake-it-in` ran.

Bias to park, same as the backlog lane - a resource earns PARTIALLY-ABSORBED or ABSORBED only when
a specific piece survives the same grain-check the skill intelligence layer applies (no-hard-delete,
the tool-agnostic contract, the voice rules), not because the source is impressive engineering.

## Registration bar (promote)

Promotion runs the normal live-skill checklist, no shortcuts:

- Folder `.claude/skills/{category}-{name}/`, frontmatter `name` matching the folder exactly.
- Frontmatter under 1,024 chars with triggers and negative triggers.
- An explicit `## Context Needs` section.
- A `## {category}-{name}` section added to `context/learnings.md`.
- Regenerate the catalog: `python3 scripts/gen-skills-catalog.py` (also syncs
  `catalog.json`/`installed.json` and lints trigger collisions - keep the lint clean).
- Humanizer gate declared when the skill produces publishable text; dependencies declared.
- A multi-file pack becomes ONE live skill when the capability is one thing: a single router
  `SKILL.md` plus self-contained `references/` (the eng-implement shape). Never many sibling
  skills for one capability.
- Update the candidate's status in `INDEX.md` to `promoted:{category}-{name}`, and run
  `bash scripts/skill-system-audit.sh` to confirm 0 failures.

## Eval

Run two disposable intake cases: a repo containing `SKILL.md`, and one with no skill shape. Pass when the first is registered inert under `skills-library/backlog/`, the second creates metadata only under `skills-library/resources/<name>/RESOURCE.md`, neither becomes live without an explicit promote decision, parking preserves the source, and a promoted fixture passes `bash scripts/skill-system-audit.sh` with Context Needs, learnings, catalog, and attribution intact.

## Rules

- **Never auto-inject.** Vendoring stops at backlog (inert). Live happens only after the user
  says promote. No sign-off gate, no Notion task - the assessment goes in chat and the user
  decides right there (AGENTS.md Skills Library).
- **Assess only when asked.** Vendoring to backlog is automatic; assessing a candidate is not -
  wait for "assess X" / "should I promote X" before spending the analysis effort.
- **Assess analyses; promote acts.** No decompose/bundle/merge/de-tailor until promotion.
- **No hard deletes.** Rejected candidates are parked in place with a one-line reason in
  `INDEX.md`. Parking is a status, not a removal, and it is reversible.
- **Ground every disposition** in the specific live skill or AI-OS subsystem it was checked
  against, plus real memory evidence. No ungrounded verdicts.
- **Bias to park.** Promote only candidates with demonstrated or clearly imminent use.
- 2026-07-28: **Route by shape, always - never skip a non-skill source or judgment-call it into
  `backlog/`.** On the 2026-07-23 run, three repos (an app, an MCP server, a CLI toolkit) reached
  a session and got evaluated via `meta-bake-it-in`, but the standing automatic-vendor rule was
  skipped on an ad-hoc "not a skill, not worth backlog bloat" call - a real judgment, but one that
  left no persistent record and contradicted this skill's own contract. The fix, built 2026-07-28,
  is structural, not a reminder: `skills-library/resources/` now exists specifically for this
  shape, metadata-only so size is never a reason to skip it. Every source that reaches a session
  gets vendored to ONE of the two lanes automatically - there is no longer a legitimate "neither
  fits" case.
- 2026-07-28: **Resources are never full-source-vendored, on principle, not by repo size.** Do not
  vendor a small repo's full source into `resources/` just because it would fit - the rule is
  categorical (metadata-only) so a future reader never has to guess why one resource got full
  source and another did not. If a specific file's content is worth keeping verbatim for reference
  (not just cited), that is a `meta-bake-it-in` KEEP-CORE call landing in AGENTS.md/a hook/a check,
  not a reason to vendor source here.
