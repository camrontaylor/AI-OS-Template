# Skills Library

A staging area for skills collected from elsewhere - used before, might be useful later, or
clearly wanted but not yet adapted. It sits **below** the live catalog and feeds into it.

```
backlog/  ──assess──►  promote  ──►  .claude/skills/{cat}-{name}   (live)
(inert dump,           or park       (curated, registered, auto-routed)
 skill-shaped
 candidates)

resources/  ──(evaluated at vendor time)──►  RESOURCE.md
(non-skill: apps,       PARKED / CONNECTOR-CANDIDATE / PARTIALLY-ABSORBED / ABSORBED
 MCP servers,           (metadata only - never full-source-vendored;
 toolkits)               a keeper piece flows to meta-bake-it-in, not .claude/skills/)
```

**Two lanes, one home** (the backlog lane simplified 2026-07-21 from an over-built five-stage
pipeline; the resources lane added 2026-07-28, deliberately kept inside this same folder rather
than a new top-level one - see "Why not a third top-level folder" below).
Everything here is **inert by default**: nothing is auto-loaded at session start,
auto-discovered by Claude Code, or touched by skill reconciliation. The only file read at
runtime is `INDEX.md`, and only on the Task-Routing fallback (see `AGENTS.md → Skills Library`).

---

## The two lanes

| Folder | Meaning | Vendored content | In the `/` picker? |
|--------|---------|---|:---:|
| **`backlog/`** | Every skill-shaped candidate (has `SKILL.md`), grouped by source. Raw, inert. | Full source | No |
| **`resources/`** | Every non-skill external resource (app, MCP server, toolkit, framework) evaluated for AI-OS. | Metadata-only `RESOURCE.md` - never full source | No |
| **`.claude/skills/`** | Registered, curated, the real live catalog. | Full source | Yes |

`meta-skill-intake` routes automatically by shape: a source with `SKILL.md` file(s) anywhere →
`backlog/`; a source without → `resources/`. There is no ambiguous "neither fits" case.

### Why not a third top-level folder

A 2026-07-15 audit already asked "is `skills-library/` part of the mess?" and the answer was no -
leave it as-is, the actual clutter was external (stray plugins, duplicate global skill dirs). Given
that verdict, a genuinely new kind of citizen (a non-skill external resource) gets a new *lane
inside the existing home*, not a parallel system: same `INDEX.md`, same `sources.json` (one
`resources` array alongside `sources`/`candidates`/`excluded`), same `LICENSES.md`. One place to
look, regardless of which lane a given source belongs to.

## The actions (`meta-skill-intake` owns both lanes)

1. **vendor to backlog** (automatic, skill-shaped sources). Any source with `SKILL.md` file(s)
   brought into a session lands in `backlog/<name>/`, inert and registered (`INDEX.md` row,
   `sources.json` `sources` entry, `LICENSES.md` row). Never `skills add`, never straight into
   `.claude/skills/`. No assessment yet.
1b. **vendor to resources** (automatic, non-skill sources). An app, MCP server, toolkit, or
   framework with no `SKILL.md` gets read (never run), scanned
   (`python3 scripts/lib/absorb-scan.py <source>` - the same Step 2 gate `meta-bake-it-in` uses),
   and recorded as `resources/<name>/RESOURCE.md` - source, license, scan grade, disposition, what
   was kept, why parked. The source itself is never copied in.
2. **assess** (when you ask - backlog lane). `meta-skill-intake` reads the whole candidate (every
   sub-skill of a repo) and reasons against the live system - inferred intent, dependency
   have/need map, grain-check against AI-OS principles, real past-use cases mined from
   `context/memory/`, and per-piece dispositions (NEW / MERGE / REDUNDANT / DE-TAILOR / SYNERGY).
   The assessment is presented **in chat**; a copy is saved to `backlog/<name>/ASSESSMENT.md` for
   the record. Analysis only - nothing is restructured here. A resource's assessment IS its
   `RESOURCE.md`, written at vendor time (step 1b) - there is no separate assess step for it.
3. **promote or park** (backlog) / **disposition** (resources) - you decide, right there in chat.
   Promote executes the recommendations (decompose / bundle / merge / de-tailor / register)
   through the registration bar below and marks `promoted:{cat}-{name}` in `INDEX.md`. Park marks
   `parked` with a one-line reason and leaves the candidate in `backlog/` (no hard delete;
   reversible). A resource's disposition (PARKED / CONNECTOR-CANDIDATE / PARTIALLY-ABSORBED /
   ABSORBED) lives directly in its `RESOURCE.md`, updated whenever `meta-bake-it-in` absorbs a
   piece of it - the record is never deleted either way.

There is **no `triage/` folder, no `review/` folder, and no Notion sign-off gate.** You point
at a candidate or resource, I assess it in chat, you decide.

---

## Promotion = your existing bar

Registration runs the normal pipeline: `meta-skill-creator` + the full checklist (category
prefix, frontmatter < 1024 chars, Skill Registry + Context Matrix rows, `context/learnings.md`
section, humanizer gate for publishable text, declared dependencies). The library is a head
start, not a shortcut around registration. New categories (e.g. `sec`, `eng`) are added only
when the first skill in that domain is actually promoted.

## Status vocabulary (in `INDEX.md`)

Backlog: `backlog` → `promoted:{cat}-{name}` | `parked`

Resources: `PARKED` | `CONNECTOR-CANDIDATE` | `PARTIALLY-ABSORBED` | `ABSORBED` (in each
`RESOURCE.md`'s own Disposition line, not `INDEX.md` - the `## Resources` table there just links
to the record).

`Active dup?` flag = a skill of that name/function is already live in the session (most of the
marketing set). Routing skips those - kept only so the backlog is a complete record.

Nothing is ever deleted (no-hard-delete rule) - parked, not removed, in either lane.

## Files

- `INDEX.md` - the human catalog routing reads (the only file consulted at runtime) - both lanes
- `sources.json` - upstream repos, licenses, commit SHAs, provenance - four arrays: `sources`
  (backlog, full-vendored), `resources` (evaluated, metadata-only), `candidates` (noted, not yet
  evaluated, nothing physical), `excluded` (looked at, rejected outright)
- `LICENSES.md` - license roll-up (redistribution safety per subtree) - both lanes
- `backlog/` - skill-shaped candidates, full source vendored
- `resources/` - non-skill external resources, metadata-only `RESOURCE.md` per entry, never
  full-source-vendored (a compiled server or a thousand-file repo would bloat this repo for
  nothing the source URL + pinned commit doesn't already give you)

## Not to be confused with

`.claude/skills/_catalog/catalog.json` - AI-OS's registry of *first-party optional* skills.
This library is *third-party / collected* candidates: different source, trust level, pipeline.

## Provenance & licensing

See `sources.json` and `LICENSES.md`. Cybersecurity + marketing + maker sets are MIT
(attribution preserved). The Conversion Factory material (`cf-frameworks`, planner, copy-qa) was
the work of a third-party agency and ships **without a license**. All real client and agency
names have been scrubbed to placeholders, and the methodology is vendored for **private
personal use only** in this private repo. Do not republish.

## Intake rule (canonical detail; AGENTS.md points here)

- **Never auto-inject into Claude.** Do NOT `skills add` a pack straight into Claude Code: it
  dumps every command into the `/` picker and muddles everything (this is how 68 GSD commands
  and 40 marketing skills got in). To trial one ad hoc without installing, use
  `skills use <pkg>@<skill>` or let the Task Routing fallback surface it from `INDEX.md`.
- **Promote one capability at a time, bundled.** A multi-file pack becomes ONE live skill when
  the capability is one thing: a single router `SKILL.md` plus a `references/` catalog loaded on
  demand. When the capability is core posture rather than an invokable tool (the
  `mattnowdev/thinking-partner` case), absorb it into `AGENTS.md` and `context/` instead of
  creating a `/` skill at all - see AGENTS.md "Thinking Discipline" for the worked example.
