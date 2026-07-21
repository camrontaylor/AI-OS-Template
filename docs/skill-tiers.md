# Skill Tiers

How AI-OS decides which skills earn a place, using your real usage data.

## The two layers

Claude Code installs hundreds of skills on its own: auto-installed plugin
packs, bundled "inline" packs, and an agents store (`~/.agents/skills`) that
also feeds Cursor. That pile is a firehose, and it is not AI-OS.

AI-OS is the curated layer: a deliberate set of skills in `.claude/skills/`,
each self-describing through `SKILL.md`, documented, and named to one convention
(`category-name`).

A skill does not become an AI-OS skill just by being available in Claude. It
graduates only when both are true:

1. You have actually USED it (proven value).
2. It can be DOCUMENTED (clear triggers, named to the convention, learnings section).

## The tiers

Claude Code logs a lifetime use count for every skill you invoke, in
`~/.claude.json`. `scripts/skill-tiers.py` reads that and ranks everything.

| Tier | Use count | Meaning |
|------|-----------|---------|
| A | 8 or more | proven, high value |
| B | 3 to 7 | recurring |
| C | 1 to 2 | occasional / trial |

A **graduation candidate** is any Tier A or B skill that is not already an
AI-OS native skill - something you lean on that AI-OS does not yet own.

## How to run it

```
python3 scripts/skill-tiers.py
```

Or say "rank my skills by usage" or "skill tiers" in a session. Re-run it any
time; the picture sharpens as your usage accumulates, so the list of what is
worth building into AI-OS clarifies itself over time.

## Reading the result

- **AI-OS native, Tier A/B** - working as intended; curated skills doing real work.
- **Non-AI-OS, Tier A/B (graduation candidates)** - the real signal. Proven by
  use, but living outside AI-OS. Pick from here when deciding what to build next.
- **Tier C** - not enough use to justify graduation yet. Leave parked or off.
- **"unknown" source** - the script could not place it; trace it before acting.

## First run (2026-06-23): the gaps it found

Your real workflow leans heavily on skills AI-OS does not yet cover. Top
graduation candidates with a confirmed AI-OS gap:

- `seo-audit` (8x) - technical / on-page SEO. `str-ai-seo` explicitly defers to
  a `seo-audit` skill that does not exist in AI-OS yet.
- `site-architecture` (12x) - information architecture; no AI-OS equivalent.
- `programmatic-seo` (11x) - templated pages at scale; no AI-OS equivalent.
- `cro` (5x) - conversion diagnosis; distinct from `mkt-copywriting`.
- `content-strategy` (7x) - content planning; `mkt-content-repurposing` only
  atomizes an existing piece, it does not plan a calendar.

`copywriting` (15x) is already covered by `mkt-copywriting` - use that one.
`impeccable` (43x), `figma` (10x), and `agent-browser` (8x) are genuine
external tools kept enabled, not candidates to rebuild inside AI-OS.
