---
name: coreyhaines-skills-deep-research
description: "Runs multi-source, multi-pass research (WebSearch, WebFetch, agent-browser, recency scan of Reddit/X/YouTube/HN, memory, Notion) and outputs a cited brief with contradictions, gaps, and next steps, archived for reuse. Not for a one-shot lookup where a single WebSearch answers it."
when_to_use: 'Invoke when the request sounds like: "research X", "investigate X", "deep dive on", "look into", "due diligence on", "validate this market"'
metadata:
  version: 0.2.0
---

# /deep-research - Multi-source research with archive

Plans, executes, and synthesizes research from multiple sources. Archives the output so the corpus compounds.

## Context Needs

Load only what the task needs. Missing files never block the work: ask for what
is missing, or produce solid generic output and say what would sharpen it.

| File | Load level | Why |
|---|---|---|
| `context/learnings.md` | `## coreyhaines-skills-deep-research` | Past corrections and preferences for this skill |

## Step 1 - Frame the question

Restate the research question in one tight sentence. If ambiguous, ask the user:
- What's the decision this research will inform?
- What's the minimum useful answer? (Saves over-researching.)
- Any sources to prioritize or avoid?

Output: `**Research question:** <one sentence>`

## Step 2 - Plan the sources

Pick from this menu based on the question type. Note which sources you'll hit and why.

| Source | When to use | Tool |
|---|---|---|
| Web search (Google) | Authoritative articles, docs, official statements | `WebSearch` |
| Recency scan | What people are *actually saying* right now - Reddit, X, YouTube, HN, web recency | `Skill({skill: "str-trending-research", args: "<topic>"})` |
| Specific URLs | When the user hands over starting URLs | `WebFetch` |
| Browsable pages (auth-walled, JS-heavy) | Pricing pages, product tours, profiles | the AI-OS `agent-browser` skill |
| Memory | Prior research / decisions / context the user already captured | AI-OS memory: `memory-recall` skill, or grep `context/` (`MEMORY.md`, `memory/`, `learnings.md`) and `projects/` |
| Notion | If the topic touches a known Notion workspace | AI-OS's Notion connector (see `docs/connectors.md`) |
| Research archive | Prior `coreyhaines-skills-deep-research` runs that touched this topic | grep `projects/coreyhaines-skills-deep-research/` |

Run discovery passes **in parallel** where possible. Sequential only when one source needs another's output (e.g., agent-browser a URL discovered by WebSearch).

## Step 3 - Execute discovery

Run each chosen source. For each result, capture:
- The source (URL or system)
- 1-3 sentence summary of what was said
- Date / recency
- Confidence in the source (high/medium/low)

Don't synthesize yet - just collect.

## Step 4 - Synthesize

1. **Group findings** by theme or sub-question
2. **Contradiction check** - flag anywhere sources disagree. Don't average them; surface the disagreement.
3. **Confidence**: high (multiple independent sources agree), medium (one strong source or several weak), low (single anecdote or speculation)
4. **Gaps**: what would change the answer? What's NOT in the corpus?

## Step 5 - Output the brief

Use this template:

```markdown
# Research: <question>

**Date:** <YYYY-MM-DD>
**Decision this informs:** <one line>
**Confidence overall:** high / medium / low

## TL;DR
<2-4 sentences with the answer>

## Key findings

### 1. <Finding>
<2-4 sentences>. Sources: [1], [3], [5]

### 2. <Finding>
...

## Contradictions / uncertainty
- <where sources disagree, with each side cited>

## Gaps
- <what's missing from the corpus>
- <what to research next to close the gap>

## Recommended next steps
1. <action>
2. <action>

## Sources
[1] <Title> - <URL or system> (<date>) - <confidence>
[2] ...
```

## Step 6 - Archive

Archives live in `projects/coreyhaines-skills-deep-research/` (create the directory if missing). Never write archives inside the skill's own folder. Skill installs and upgrades re-sync from source and wipe anything saved there. **Migration:** if this skill's folder contains an old `references/research-archive/` with user entries, move those files into the archive directory first.

Write the brief to `projects/coreyhaines-skills-deep-research/<YYYY-MM-DD>-<slug>.md` so it's grep-able forever. Slug = kebab-case of the topic.

Also append a one-line entry to `projects/coreyhaines-skills-deep-research/INDEX.md` (create if missing):

```markdown
- 2026-06-15 - [<topic>](./<filename>.md) - <one-line TL;DR>
```

## Step 7 - Surface

After archiving:
- Show the full brief in chat
- Tell the user the archive path
- Offer: *"Push to Notion or save to a project's docs?"*

## Composes with

- `coreyhaines-skills-business-brainstorm` - calls this skill during the market validation step
- `coreyhaines-skills-domain` - when research includes "is the .com available"
- `str-trending-research` - one of the data sources (the recency scan)
- `q-question` - AI-OS's lighter route when the ask is a single feasibility or should-I question, not a full multi-pass brief

## Notes on quality

- **Always cite.** Every claim in the brief needs a source pointer.
- **Recency matters** - note dates on each source. For fast-moving topics (AI, startups), de-weight sources >12 months old.
- **Don't trust a single source** for high-stakes claims. Re-search until you have at least 2 independent corroborations or surface the uncertainty.
- **No padding.** If the answer is one paragraph, return one paragraph. The template is a maximum, not a minimum.
