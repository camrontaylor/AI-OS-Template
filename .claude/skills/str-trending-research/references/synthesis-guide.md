# Synthesis Guide

> Adapted from [last30days by Ronnie-Nutrition](https://github.com/Ronnie-Nutrition/last30days-skill).
> Original "Judge Agent" concept — weighting sources by engagement and cross-validating across platforms.

---

## The Synthesis Process

After all searches complete, you have raw results from Reddit, X, and the web. The synthesis turns noise into signal.

### Phase 1: Ground in Actual Research

**Read the results carefully. Do NOT substitute your pre-existing knowledge.**

Pay attention to:
- **Exact product/tool names** mentioned — if research mentions "ToolX", that's different from "ToolY" even if they seem related
- **Specific quotes and insights** from sources — use THESE, not generic knowledge
- **What the sources actually say**, not what you assume the topic is about

Anti-pattern: User asks about "n8n workflow patterns" and research returns specific patterns. Don't synthesize as generic automation advice — report the specific patterns the community discusses.

### Phase 2: Weight by Engagement

Not all mentions are equal:

| Signal | Weight | Why |
|--------|--------|-----|
| Reddit thread, 100+ upvotes, 50+ comments | Very high | Community-validated, deep discussion |
| X post, 500+ likes | Very high | Viral, resonating broadly |
| Same insight on Reddit + X + blog | Very high | Cross-platform validation |
| Reddit thread, 20-50 upvotes | High | Solid community interest |
| Blog post from recognized expert | High | Authority signal |
| Reddit thread, <10 upvotes | Medium | Real opinion, less validated |
| X post, <50 likes | Medium | Fresh take, limited reach |
| Generic blog post, no comments | Low | May be SEO content |

### Phase 3: Extract Patterns

Look for:
1. **Consensus** — what does everyone agree on? (strongest signal)
2. **Contradictions** — where do sources disagree? (often the most interesting finding)
3. **Emerging trends** — what's new that only a few people are talking about? (opportunity signal)
4. **Specific recommendations** — named tools, techniques, approaches (actionable signal)
5. **Warnings** — what are people cautioning against? (risk signal)

### Phase 4: Synthesize by Query Type

**RECOMMENDATIONS:**
Extract specific names. Count mentions. Rank by frequency + engagement.

```
1. [Specific thing] — mentioned 5x
   - r/subreddit (200 upvotes): "Best thing I've used for X"
   - @handle (1.2K likes): "Everyone sleeping on this"
   - blog.com: "Top pick for 2026"

2. [Specific thing] — mentioned 3x
   - r/subreddit (45 upvotes): "Solid alternative to Y"
   - news.com: "Recently launched with Z feature"
```

**NEWS:**
Build a timeline. Lead with the most impactful development.

```
Key development: [What happened]
- [Date]: [Event] — community reaction: [sentiment]
- [Date]: [Follow-up event]
- What people are saying: [consensus/debate summary]
```

**HOW-TO:**
Extract techniques ranked by community validation.

```
Top techniques (by community validation):
1. [Technique] — recommended in 4 sources, 300+ combined upvotes
   - How: [brief explanation]
   - Caveat: [if any]

2. [Technique] — recommended in 3 sources
   - How: [brief explanation]

Common mistakes:
- [Anti-pattern] — multiple sources warn against this
```

**GENERAL:**
Summarize the landscape. What's the community's current state of mind?

```
Current sentiment: [positive/negative/mixed/debating]
Key themes:
1. [Theme] — [what people are saying]
2. [Theme] — [what people are saying]
Debates: [where opinion is split]
```

---

## Content Angle Extraction

After synthesis, identify 2-3 content angles that could be turned into posts, videos, or emails. Frame these as opportunities:

- **The contrarian take** — if everyone says X, there's a post in "why X might be wrong"
- **The roundup** — if you found 10 specific recommendations, that's a list post
- **The tutorial** — if a how-to technique is trending, that's a video
- **The hot take** — if there's a debate, taking a side is engaging content
- **The "I tested it"** — if something new is trending, testing and reporting is high-value

---

## Self-Check Before Presenting

Before showing results to the user:

1. Does your synthesis match what the research ACTUALLY says? Re-read your output against the raw findings.
2. Did you attribute specific findings to specific sources?
3. Are engagement numbers real (from the search results) or estimated?
4. Did you identify at least one contradiction or nuance? If everything agrees perfectly, you may be over-simplifying.
5. Are the content angles specific to THIS topic, not generic advice?
