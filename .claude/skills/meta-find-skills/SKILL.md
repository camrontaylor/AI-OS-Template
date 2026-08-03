---
name: meta-find-skills
description: "Find the right skill for a task, searching AI-OS's own curated sources - live skills, the skills-library backlog and resources lanes, the optional catalog - before reaching outside. Not for building a new skill from scratch (meta-skill-creator) or installing a named optional skill (add-skill.sh)."
when_to_use: 'Invoke when the request sounds like: "find a skill", "is there a skill for", "do we have a skill for", "what skill handles X", "can the system already do X", "what is in the backlog for", "check the backlog", "surface backlog options", "skills-backlog", "is there a resource for"'
---

# Find Skills

The front door to the AI-OS skill system. When someone wants a capability, this
finds whether it already exists - live, parked, or installable - before anyone
reaches outside or builds from scratch.

## When to use

- "find a skill for X", "is there a skill for X", "do we have a skill for X"
- "I need to do X" where a skill might already cover it
- "extend my capabilities" / "I wish I had a skill for X"

## When NOT to use

- Building a brand-new skill from scratch -> `meta-skill-creator`
- Ranking which skills get used most -> `python3 scripts/skill-tiers.py`
- Installing a specific named optional skill -> `bash scripts/add-skill.sh <name>`

## Context Needs

| File | Load level | Why |
|---|---|---|
| `.claude/skills/*/SKILL.md` | frontmatter; full file only for the match | Live capability authority |
| `skills-library/INDEX.md` | targeted search | Inert candidate inventory, both lanes (`## Backlog` skill packs, `## Resources` non-skill external resources) |
| `skills-library/resources/*/RESOURCE.md` | full, once a resource looks promising | The resource's own evaluation - security scan, disposition, what was kept, safe path if any |
| `.claude/skills/_catalog/catalog.json` | targeted search | First-run optional menu only |
| `context/learnings.md` | `## meta-find-skills` | Prior discovery and intake lessons |

## The one hard rule

NEVER install an external skill globally (`npx skills add -g`, or any global
install that drops commands into the `/` picker). That is what floods the menu,
and it is the exact problem AI-OS exists to prevent. Outside finds always enter
through the backlog (inert), then the review pipeline, then live. AI-OS stays the
curated source of truth; nothing skips the line.

## Search order (stop at the first real match)

Search the cheapest, most-curated source first. Recommend ONE path with its command.

### 1. Live AI-OS skills (already have it?)
Search `.claude/skills/*/SKILL.md` frontmatter for a trigger match. The live
filesystem is authoritative; `docs/skills-catalog.md` is its generated overview.
If one exists, name it and use it. Done.

### 2. Skills Library - both lanes (a parked candidate, or an evaluated resource?)
Search `skills-library/INDEX.md` - it covers both lanes under `## Backlog` (skill-shaped
candidates) and `## Resources` (non-skill external resources - apps, MCP servers, toolkits,
already evaluated with a security-scan grade and a disposition in their own `RESOURCE.md`).

**A `backlog/` skill candidate:**
- offer to **trial it in place** by reading its SKILL.md straight from
  `skills-library/backlog/...` (stays parked, NOT promoted), or
- if it keeps proving useful, hand off to **`meta-skill-intake`** to **assess** it (if not
  already assessed) and **promote** it into `.claude/skills/` - the current flow is
  vendor -> assess -> promote or park, no `triage/` or `review/` stage (removed 2026-07-21;
  do not reference them, they no longer exist).

**A `resources/` non-skill entry:** it is already evaluated (its `RESOURCE.md` has the
security-scan grade, disposition, and what was kept). Read it, then:
- if the disposition is already `PARTIALLY-ABSORBED` or `ABSORBED`, say what was kept and
  where it landed - the work may already be done;
- if a fresh look suggests genuine current value, hand off to **`meta-bake-it-in`** to
  absorb a specific piece, or note the resource's own "if revisited" safe path (e.g. a
  `--skip-config` install flag) if the whole tool is worth running now. A non-skill resource
  never moves into `.claude/skills/` directly - there is nothing to promote it into; what
  moves is the specific piece that gets absorbed or wired as a connector.

Never run a backlog skill or an unvetted resource silently as if it were curated - both stay
inert until a human decision moves something out.

### 3. Optional AI-OS catalog (an off-the-shelf AI-OS skill?)
Check `.claude/skills/_catalog/catalog.json`. If a fit exists, install it with
`bash scripts/add-skill.sh <name>` - the supported, registered path.

### 4. Usage signal (already leaning on something un-graduated?)
Run `python3 scripts/skill-tiers.py`. If the need maps to a Tier A/B graduation
candidate the user already uses, recommend graduating that into AI-OS rather than
finding something new.

### 5. External ecosystem (last resort, backlog-bound)
Only if steps 1-4 turn up nothing. Use the open ecosystem to FIND, never to install:
- check the leaderboard at https://skills.sh first (most-installed, battle-tested),
- else `npx skills find <query>` to search by keyword,
- verify quality before recommending: install count (prefer 1K+), source reputation
  (vercel-labs, anthropics, microsoft over unknown authors), repo stars.
Then **vendor the chosen candidate into `skills-library/backlog/`** (inert, recorded
in INDEX.md) so it enters the pipeline. Do NOT `npx skills add -g`.

### 6. Nothing fits
Say so plainly. Offer to build a proper AI-OS skill with `meta-skill-creator`, or to
handle the task now with base knowledge. Never silently fall back to base knowledge
when a live skill or a fit-for-purpose backlog candidate exists.

## Output

One recommendation, not a menu (SOUL.md). Name the exact skill or candidate, its
source tier (live / backlog / catalog / external), and the single command or next
step. If you reached step 5, state the quality signals you checked.

## Why this shape

AI-OS already has the discovery primitives - the live filesystem, the skills-library INDEX
(both the backlog lane and the resources lane), the optional catalog, the usage tiers, and
`meta-skill-creator`/`meta-skill-intake`. This skill is the single front door over them,
ordered so the curated, no-flood paths win and the external ecosystem is a fallback that
still respects the pipeline. See `docs/skill-tiers.md` for the graduation rule this serves.

## Eval

Run this manual eval before changing search order, install rules, or external
skill handling:

1. Ask for a capability already covered by a live skill. Pass if the answer names
   the live skill and does not search externally.
2. Ask for a capability present only in `skills-library/INDEX.md`'s backlog lane. Pass if the
   answer offers to trial the backlog candidate or hand off to `meta-skill-intake` to assess
   and promote it, without treating it as live, and without mentioning `triage/` or `review/`
   (those folders were removed 2026-07-21 and no longer exist).
3. Ask for a capability present only in `skills-library/INDEX.md`'s resources lane (e.g. "is
   there something for code intelligence" when only `codebase-memory-mcp` is recorded). Pass
   if the answer reads that resource's `RESOURCE.md`, states its disposition and safe path
   (or what was already kept), and does not claim it can be "promoted into `.claude/skills/`"
   - a non-skill resource has nothing to promote into.
4. Ask for an unknown external skill. Pass if the answer vendors or recommends
   backlog intake and does not run `npx skills add -g`.
5. Ask to install a specific optional catalog skill. Pass if the answer routes to
   `bash scripts/add-skill.sh <name>`.

The eval fails if the skill silently falls back to base knowledge when a curated
skill exists, globally installs an external skill, or presents a menu instead of
one recommended path.
