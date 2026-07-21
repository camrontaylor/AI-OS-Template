---
name: str-trending-research
description: "Research what's trending in the last 30 days across Reddit, X, and the web, and produce a brief other skills can use. Not for feasibility or should-I questions (q-question), brand voice, positioning, or simple URL fetching."
when_to_use: 'Invoke when the request sounds like: "what''s trending", "trending in", "last 30 days", "recent discussions", "what are people saying about", "community sentiment on"'
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

Other skills (mkt-content-atomizer, email-sequences, etc.) can read the latest research brief for timely, relevant content.

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/icp.md` | Language section | Helps frame research through the audience's lens |
| `context/learnings.md` | `## str-trending-research` section | Apply previous feedback |

Load if they exist. Proceed without them if not.

---

## Before You Start

1. Check `projects/str-trending-research/` for recent research on the same topic. If a brief exists from the last 7 days, show the user: "I researched [topic] on [date]. Want to use that, refresh it, or research something new?"

2. **Check API keys.** Read `.env` for `OPENAI_API_KEY` and `XAI_API_KEY`. If either is missing, tell the user once before starting:
   - **Both missing:** "I'll use web search for this research. For much richer results with real engagement data (upvotes, likes, comments), add `OPENAI_API_KEY` (for Reddit — get one at platform.openai.com) and `XAI_API_KEY` (for X — get one at console.x.ai) to your `.env` file."
   - **Only OpenAI missing:** "I have X data but not Reddit. Add `OPENAI_API_KEY` to `.env` for Reddit threads with real upvotes and comments."
   - **Only xAI missing:** "I have Reddit data but not X. Add `XAI_API_KEY` to `.env` for X posts with real likes and reposts."
   - **Both present:** Skip this — say nothing, just proceed.

   This is informational only. Never block work because keys are missing.

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

### Primary: Python Script (requires API keys)

The `scripts/last30days.py` script uses external APIs to search Reddit and X with real engagement data:

```bash
python3 .claude/skills/str-trending-research/scripts/last30days.py "{topic}" --emit=compact
```

- **Reddit** via OpenAI Responses API (`web_search` tool, domain-locked to reddit.com) — returns threads with real upvotes, comments, and top comment insights
- **X / Twitter** via xAI API (`x_search` tool) — returns posts with real likes, reposts, and reply counts
- Supports `--quick` (fewer sources) and `--deep` (comprehensive) flags
- Supports `--sources=reddit|x|both|auto` to control which platforms to search
- Supports `--include-web` to add general web search alongside Reddit/X

**Requires:** `OPENAI_API_KEY` (for Reddit) and/or `XAI_API_KEY` (for X) in `.env`. Script auto-detects available keys and adapts.

### Fallback: WebSearch (no API keys needed)

If neither API key is configured, use Claude's built-in WebSearch:

#### Reddit (community discussions)
Search for: `{topic} site:reddit.com` and related queries.

#### X / Twitter (real-time pulse)
Search for: `{topic} site:x.com OR site:twitter.com` and related queries.

#### Web (blogs, docs, news)
Search for: `{topic}` with time-filtered queries. Exclude reddit.com and x.com.

WebSearch works but lacks real engagement metrics (upvotes, likes). The script provides much richer data.

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

If the user flags an issue — bad sources, irrelevant results, wrong synthesis — update the `## Rules` section immediately with the correction and today's date.

---

## Troubleshooting

**Too few results:** Broaden the search terms. Strip modifiers and search for the core noun. Try `--deep` flag.
**Results feel outdated:** Add year to search queries. Use "2026" or "this month" qualifiers.
**Platform-specific content missing:** Some topics are discussed more on Reddit vs X. Use `--sources=reddit` or `--sources=x` to focus.
**User wants real engagement metrics:** Use the Python script with API keys. WebSearch fallback lacks exact counts.
**Script errors:** Check `.env` has valid `OPENAI_API_KEY` and/or `XAI_API_KEY`. Fall back to WebSearch if scripts fail.
