---
name: meta-skill-intake
description: "Bring an outside skill, pack, or repo into AI-OS: assess it, then promote it live or park it. Not for finding an existing skill (meta-find-skills) or building one from scratch (meta-skill-creator)."
when_to_use: 'Invoke when the request sounds like: "vendor this to backlog", "assess this candidate", "should I promote X", "park that skill", or pasting a skill repo'
---

# Meta Skill Intake

Owns `skills-library/` end to end with an intelligence layer. **Two folders, three actions**
(simplified 2026-07-21 from a five-stage pipeline): candidates sit inert in
`skills-library/backlog/`; from there you **assess**, then **promote** into `.claude/skills/`
or **park**. Never auto-injects into Claude. The backlog is the staging tier below the live
catalog. There is no `triage/` or `review/` folder and no sign-off gate - the assessment is
presented in chat, and you decide.

## Context Needs

| File | Load level | Why |
|---|---|---|
| `skills-library/INDEX.md` | full | Candidate inventory and statuses |
| `skills-library/sources.json` + `LICENSES.md` | targeted | Provenance and license authority |
| `docs/skills-catalog.md` | full | Live catalog to check dup/merge against |
| `context/SOUL.md` + `context/USER.md` | already loaded | Grain-fit judgment |
| `context/memory/` | grep per candidate | Real past-use evidence |
| `docs/connectors.md` | targeted | Dependency map (have vs need) |
| `context/learnings.md` | `## meta-skill-intake` | Prior intake lessons |

## The flow

| Action | Trigger | What happens |
|--------|---------|--------------|
| **vendor to backlog** | **Automatic** - any skill or repo brought into a session | Vendor it into `skills-library/backlog/<name>/` (never `skills add`, never `.claude/skills/`). Register: `INDEX.md` row, `sources.json` entry, `LICENSES.md` row. Change nothing in the content. Inert; no assessment yet. |
| **assess** | User asks ("assess X", "should I promote X", "what's worth keeping") | The intelligence layer (below). For a repo, assess every sub-skill - do NOT decompose, bundle, or restructure here; that is a promote-time action. Present the assessment **in chat**; save `ASSESSMENT.md` into the candidate's own `backlog/<name>/` folder for the record. |
| **promote** | User decides yes | EXECUTE the recommendations - decompose / bundle / merge / de-tailor / register through the full registration bar (below). Update the candidate's `INDEX.md` status to `promoted:{cat}-{name}`. |
| **park** | User decides no (or zero real use) | Mark `parked` in `INDEX.md` with a one-line reason. The candidate stays in `backlog/` (no hard delete); parking is reversible. |

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
