---
name: str-trending-research
version: 1.1.0
description: >
  Research what's trending in the last 30 days across Reddit, X, and the web.
  Surface real discussions, recommendations, and patterns people are talking
  about right now. Produces a research brief other skills can consume.
  Triggers on: "research", "what's trending", "research topic", "research X",
  "what are people saying about", "trending in", "last 30 days", "recent
  discussions", "what's hot", "look into", "dig into", "find out what people
  think about", "what's new with", "community sentiment on".
  Does NOT trigger for brand voice, positioning, ICP, or content writing.
  Does NOT trigger for general web browsing or simple URL fetching.
---

# Trending Research

> Adapted from [last30days by Ronnie-Nutrition](https://github.com/Ronnie-Nutrition/last30days-skill).
> Original skill focused on research + prompt generation. This version strips the prompt layer
> and focuses purely on research synthesis — designed as a backend that other skills consume.

## Outcome

A research brief saved to `projects/str-trending-research/{YYYY-MM-DD}_{topic}.md` containing:
- What people are actually discussing, recommending, and debating right now
- Engagement-weighted insights (upvotes, likes, comments signal what resonates)
- Patterns across platforms (strongest signals appear everywhere)
- Actionable takeaways for content creation

Other skills (mkt-content-repurposing, mkt-ugc-scripts, mkt-copywriting) can read the latest research brief for timely, relevant content.

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/icp.md` | Language section | Helps frame research through the audience's lens |
| `context/learnings.md` | `## str-trending-research` section | Apply previous feedback |

Load if they exist. Proceed without them if not.

---

## Before You Start

1. Check `projects/str-trending-research/` for recent research on the same topic. If a brief exists from the last 7 days, show the user: "I researched [topic] on [date]. Want to use that, refresh it, or research something new?"

2. **Check API keys.** Reddit needs no key: the script talks to Reddit directly and returns real upvotes, comment counts, and top comments for free. Read `.env` for `XAI_API_KEY`, which only affects X:
   - **Missing:** "I have Reddit but not X. Add `XAI_API_KEY` to `.env` (get one at console.x.ai) for X posts with real likes and reposts."
   - **Present:** Skip this — say nothing, just proceed.

   This is informational only. Never block work because keys are missing, and never skip the script because a key is missing.

---

## Step 1: Parse the Request

Extract from the user's input:

- **TOPIC** — what they want to research
- **QUERY TYPE** — what kind of research:
  - **RECOMMENDATIONS** — "best X", "top X", "what X should I use" → wants a ranked list of specific things
  - **NEWS** — "what's happening with X", "X news", "latest on X" → wants current events
  - **HOW-TO** — "how to X", "X techniques", "X best practices" → wants methods and approaches
  - **GENERAL** — anything else → wants broad understanding of community sentiment
- **SCOPE** — quick (5-8 searches) or deep (12-18 searches). Default: balanced (8-12).

If the topic is vague, ask one clarifying question. Don't over-ask — get moving.

---

## Step 2: Run the Research

Read `references/research-methodology.md` for the full search strategy.

### Always run the script first

`scripts/last30days.py` is the evidence layer. **Run it on every research request, with or without keys.** WebSearch cannot reach Reddit, so skipping the script means losing community signal entirely.

```bash
python3 .claude/skills/str-trending-research/scripts/last30days.py "{topic}" --emit=compact
```

- **Reddit, no key required** — talks to Reddit directly (RSS discovery, arctic-shift for vote counts, shreddit for comments) and returns threads with real upvotes, real comment counts, and the vote-ranked top comments with the author of each
- **Hacker News, no key required** — stories with points and comment counts, plus the top comments on the biggest threads. Always runs, and it is what keeps the run useful when Reddit hits a rate limit
- **YouTube, no key required** — videos published this month with view counts, and the spoken transcript of the most-watched ones. This is the only source that carries what was *said* rather than written
- **X / Twitter** via xAI API (`x_search` tool) — returns posts with real likes, reposts, and reply counts. Needs `XAI_API_KEY`; without it the run says so instead of pretending X was covered
- Supports `--quick` (fewer sources) and `--deep` (comprehensive) flags
- Supports `--sources=reddit|x|both|auto` to control which platforms to search
- Supports `--include-web` to add general web search alongside Reddit/X

### Then supplement with WebSearch

The script covers the community. Use WebSearch on top of it for blogs, docs and news, never as a replacement for it:

#### Web (blogs, docs, news)
Search for: `{topic}` with time-filtered queries. Exclude reddit.com.

#### X / Twitter (only when `XAI_API_KEY` is absent)
Search for: `{topic} site:x.com OR site:twitter.com`. Expect no engagement numbers.

**Do not** search `site:reddit.com`. WebSearch cannot crawl Reddit, so it returns nothing and wastes a search. Reddit comes from the script.

### Report the coverage honestly

After the run, state per source what happened: how many items came back, and for anything that returned nothing, whether it was not configured, rate limited, or genuinely empty. Never explain a gap with a guess. If Reddit returns zero, say the run got zero and why the script reported it, not that "Reddit is blocked".

---

## Step 3: Synthesize Findings

Read `references/synthesis-guide.md` for the full methodology.

**Weight sources by engagement signals:**
- Reddit threads with 50+ upvotes and active discussion = strong signal
- X posts with high engagement (likes, reposts) = trending signal
- Blog posts from known authors/sites = authority signal
- Multiple sources saying the same thing = strongest signal

**Synthesize by query type:**

**RECOMMENDATIONS** → Extract specific names, count mentions, rank by popularity:
```
Most mentioned:
1. [Specific thing] — mentioned 5x (r/sub, @handle, blog.com)
2. [Specific thing] — mentioned 3x (sources)
```

**NEWS** → Timeline of events, key developments, community reactions

**HOW-TO** → Top techniques, common approaches, what's working vs what's not

**GENERAL** → Key themes, community sentiment, debates and consensus

---

## Step 4: Show Results

Display the synthesis in this format:

```
## What I found — {TOPIC} (last 30 days)

[2-4 sentence synthesis of the key insight]

### Key findings
1. [Finding with source attribution]
2. [Finding with source attribution]
3. [Finding with source attribution]

### Sources scanned
- Reddit: {n} threads across r/{sub1}, r/{sub2}
- Hacker News: {n} stories
- YouTube: {n} videos ({n} with transcripts)
- X: {n} posts from @{handle1}, @{handle2}
- Web: {n} pages from {domain1}, {domain2}
```

---

## Step 5: Save the Brief

Save to `projects/str-trending-research/{YYYY-MM-DD}_{topic-slug}.md`.

The brief format is defined in `references/brief-template.md`. Include:
- Research metadata (topic, date, query type, sources scanned)
- Synthesis (findings, patterns, recommendations)
- Raw source list (URLs, engagement metrics where available)
- Suggested content angles (how this research could inform content)

This file is what other skills consume. Keep it structured and scannable.

---

## Step 6: Offer Next Steps

Based on the research and installed skills, recommend one action:

- "This would make a strong [LinkedIn post / YouTube video / email topic] — want me to draft something?"
- "I found [X] trending hard — want me to research deeper on that angle?"
- Route to the appropriate content skill if installed.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user flags an issue with the output, add a dated entry under `## Rules` in this skill's `SKILL.local.md` (create it if missing) and log it to `context/learnings.md` under `## str-trending-research`. Write the general rule the correction implies, not the one-off fix.

---

## Troubleshooting

**Too few results:** Broaden the search terms. Strip modifiers and search for the core noun. Try `--deep` flag.
**Results feel outdated:** Add the current year or "this month" to search queries.
**Platform-specific content missing:** Some topics are discussed more on Reddit vs X. Use `--sources=reddit` or `--sources=x` to focus.
**Reddit returned 0 threads:** almost always a temporary rate limit from running several searches back to back. Wait a minute and re-run. Do not conclude that Reddit is unreachable, and do not tell the user it is blocked.
**User wants real engagement metrics:** they come from the script. WebSearch has none.
**Script errors:** the script never needs a key for Reddit. If X is missing, check `XAI_API_KEY` in `.env`.
