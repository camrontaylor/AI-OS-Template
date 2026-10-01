## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/str-deep-research/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-deep-research/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /str-deep-research — Multi-source research with archive

Plans, executes, and synthesizes research from multiple sources. Archives the output so the corpus compounds.

<a id="step-1--frame-the-question"></a>
## Step 1 — Frame the question

Restate the research question in one tight sentence. If ambiguous, ask the user:
- What's the decision this research will inform?
- What's the minimum useful answer? (Saves over-researching.)
- Any sources to prioritize or avoid?

Output: `**Research question:** <one sentence>`

<a id="step-2--plan-the-sources"></a>
## Step 2 — Plan the sources

Pick from this menu based on the question type. Note which sources you'll hit and why.

| Source | When to use | Tool |
|---|---|---|
| Web search (Google) | Authoritative articles, docs, official statements | `WebSearch` |
| current web research | What people are *actually saying* right now — Reddit, X, YouTube, HN, web recency | `available web search with a recency filter` |
| Specific URLs | When the user hands over starting URLs | `WebFetch` |
| Browsable pages (auth-walled, JS-heavy) | Pricing pages, product tours, profiles | available browser tool |
| Memory | Prior research / decisions / context the user already captured | grep `context/knowledge/personal/notes/` |
| Notion | If the topic touches a known Notion workspace | Direct Notion API (key in `$NOTION_API_KEY`, use current official API documentation) |
| Research archive | Prior `/str-deep-research` runs that touched this topic | grep `projects/str-deep-research/` |

Run discovery passes **in parallel** where possible. Sequential only when one source needs another's output (e.g., agent-browser a URL discovered by WebSearch).

<a id="step-3--execute-discovery"></a>
## Step 3 — Execute discovery

Run each chosen source. For each result, capture:
- The source (URL or system)
- 1–3 sentence summary of what was said
- Date / recency
- Confidence in the source (high/medium/low)

Don't synthesize yet — just collect.

<a id="step-4--synthesize"></a>
## Step 4 — Synthesize

1. **Group findings** by theme or sub-question
2. **Contradiction check** — flag anywhere sources disagree. Don't average them; surface the disagreement.
3. **Confidence**: high (multiple independent sources agree), medium (one strong source or several weak), low (single anecdote or speculation)
4. **Gaps**: what would change the answer? What's NOT in the corpus?

<a id="step-5--output-the-brief"></a>
## Step 5 — Output the brief

Use this template:

```markdown
# Research: <question>

**Date:** <YYYY-MM-DD>
**Decision this informs:** <one line>
**Confidence overall:** high / medium / low

<a id="tldr"></a>
## TL;DR
<2–4 sentences with the answer>

<a id="key-findings"></a>
## Key findings

<a id="1-finding"></a>
### 1. <Finding>
<2–4 sentences>. Sources: [1], [3], [5]

<a id="2-finding"></a>
### 2. <Finding>
...

<a id="contradictions--uncertainty"></a>
## Contradictions / uncertainty
- <where sources disagree, with each side cited>

<a id="gaps"></a>
## Gaps
- <what's missing from the corpus>
- <what to research next to close the gap>

<a id="recommended-next-steps"></a>
## Recommended next steps
1. <action>
2. <action>

<a id="sources"></a>
## Sources
[1] <Title> — <URL or system> (<date>) — <confidence>
[2] ...
```

<a id="step-6--archive"></a>
## Step 6 — Archive

Archives live in `projects/str-deep-research/` (create the directory if missing). Never write archives inside the skill's own folder — skill installs and upgrades re-sync from source and wipe anything saved there. **Migration:** if this skill's folder contains an old `research-archive/` with user entries, move those files into the archive directory first.

Write the brief to `<archive dir>/<YYYY-MM-DD>-<slug>.md` so it's grep-able forever. Slug = kebab-case of the topic.

Also append a one-line entry to `<archive dir>/INDEX.md` (create if missing):

```markdown
- 2026-06-15 — [<topic>](./<filename>.md) — <one-line TL;DR>
```

<a id="step-7--surface"></a>
## Step 7 — Surface

After archiving:
- Show the full brief in chat
- Tell the user the archive path
- Offer: *"Push to Notion or save to a project's docs?"*

<a id="composes-with"></a>
## Composes with

- `str-business-brainstorm` — calls this skill during the market validation step
- `/str-domain` — when research includes "is the .com available"
- current web research — one of the data sources

<a id="notes-on-quality"></a>
## Notes on quality

- **Always cite.** Every claim in the brief needs a source pointer.
- **Recency matters** — note dates on each source. For fast-moving topics (AI, startups), de-weight sources >12 months old.
- **Don't trust a single source** for high-stakes claims. Re-search until you have at least 2 independent corroborations or surface the uncertainty.
- **No padding.** If the answer is one paragraph, return one paragraph. The template is a maximum, not a minimum.
