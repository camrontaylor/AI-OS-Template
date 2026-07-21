# Skills Library

A staging area for skills collected from elsewhere - used before, might be useful later, or
clearly wanted but not yet adapted. It sits **below** the live catalog and feeds into it.

```
backlog/  ──assess──►  promote  ──►  .claude/skills/{cat}-{name}   (live)
(inert dump,           or park       (curated, registered, auto-routed)
 raw candidates)       (stay in backlog, marked)
```

**Two folders, three actions** (simplified 2026-07-21 from an over-built five-stage pipeline).
Everything here is **inert by default**: nothing is auto-loaded at session start,
auto-discovered by Claude Code, or touched by skill reconciliation. The only file read at
runtime is `INDEX.md`, and only on the Task-Routing fallback (see `AGENTS.md → Skills Library`).

---

## The two folders

| Folder | Meaning | In the `/` picker? |
|--------|---------|:---:|
| **`backlog/`** | Every candidate, grouped by source. Raw, inert. Candidates, not capabilities. | No |
| **`.claude/skills/`** | Registered, curated, the real live catalog. | Yes |

## The three actions (`meta-skill-intake` owns these)

1. **vendor to backlog** (automatic). Any skill or repo brought into a session lands in
   `backlog/<name>/`, inert and registered (`INDEX.md` row, `sources.json` entry,
   `LICENSES.md` row). Never `skills add`, never straight into `.claude/skills/`. No
   assessment yet.
2. **assess** (when you ask). `meta-skill-intake` reads the whole candidate (every sub-skill of
   a repo) and reasons against the live system - inferred intent, dependency have/need map,
   grain-check against AI-OS principles, real past-use cases mined from `context/memory/`, and
   per-piece dispositions (NEW / MERGE / REDUNDANT / DE-TAILOR / SYNERGY). The assessment is
   presented **in chat**; a copy is saved to `backlog/<name>/ASSESSMENT.md` for the record.
   Analysis only - nothing is restructured here.
3. **promote or park** (you decide, right there in chat). Promote executes the recommendations
   (decompose / bundle / merge / de-tailor / register) through the registration bar below and
   marks `promoted:{cat}-{name}` in `INDEX.md`. Park marks `parked` with a one-line reason and
   leaves the candidate in `backlog/` (no hard delete; reversible).

There is **no `triage/` folder, no `review/` folder, and no Notion sign-off gate.** You point
at a candidate, I assess it in chat, you say promote or park.

---

## Promotion = your existing bar

Registration runs the normal pipeline: `meta-skill-creator` + the full checklist (category
prefix, frontmatter < 1024 chars, Skill Registry + Context Matrix rows, `context/learnings.md`
section, humanizer gate for publishable text, declared dependencies). The library is a head
start, not a shortcut around registration. New categories (e.g. `sec`, `eng`) are added only
when the first skill in that domain is actually promoted.

## Status vocabulary (in `INDEX.md`)

`backlog` → `promoted:{cat}-{name}` | `parked`

`Active dup?` flag = a skill of that name/function is already live in the session (most of the
marketing set). Routing skips those - kept only so the backlog is a complete record.

A skill is never deleted (no-hard-delete rule) - parked, not removed.

## Files

- `INDEX.md` - the human catalog routing reads (the only file consulted at runtime)
- `sources.json` - upstream repos, licenses, commit SHAs, provenance
- `LICENSES.md` - license roll-up (redistribution safety per subtree)
- `backlog/` - the one staging folder

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
