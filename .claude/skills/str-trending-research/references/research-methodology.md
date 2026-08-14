# Research Methodology

> Adapted from [last30days by Ronnie-Nutrition](https://github.com/Ronnie-Nutrition/last30days-skill).
> Original approach used OpenAI Responses API (Reddit web_search) and xAI API (x_search)
> for direct platform access. This version uses WebSearch for a zero-dependency approach.

---

## Search Strategy by Query Type

Before searching, extract the **core subject** from the topic. Strip noise words:
- "best nano banana prompting practices" → core: "nano banana"
- "top Claude Code skills" → core: "Claude Code skills"
- "what's happening with OpenAI" → core: "OpenAI"

Don't add terms from your own knowledge. If user says "ChatGPT image prompting", search for exactly that — don't substitute "DALL-E" or "GPT-4o".

### RECOMMENDATIONS ("best X", "top X")

| # | Query | Platform | Purpose |
|---|-------|----------|---------|
| 1 | `best {topic} site:reddit.com` | Reddit | Community picks |
| 2 | `{topic} recommendations site:reddit.com` | Reddit | Discussion threads |
| 3 | `top {topic} site:x.com OR site:twitter.com` | X | Viral recommendations |
| 4 | `best {topic} 2026` | Web | Blog roundups, reviews |
| 5 | `{topic} list examples` | Web | Curated lists |
| 6 | `most popular {topic}` | Web | Popularity signals |

### NEWS ("what's happening with X")

| # | Query | Platform | Purpose |
|---|-------|----------|---------|
| 1 | `{topic} site:reddit.com` | Reddit | Community reaction |
| 2 | `{topic} announcement site:x.com OR site:twitter.com` | X | Breaking news, hot takes |
| 3 | `{topic} news 2026` | Web | News coverage |
| 4 | `{topic} update announcement` | Web | Official announcements |
| 5 | `{topic} release changelog` | Web | Product updates |

### HOW-TO ("how to X", "X techniques")

| # | Query | Platform | Purpose |
|---|-------|----------|---------|
| 1 | `{topic} tips site:reddit.com` | Reddit | Community techniques |
| 2 | `{topic} how to site:reddit.com` | Reddit | Step-by-step threads |
| 3 | `{topic} tutorial site:x.com OR site:twitter.com` | X | Thread tutorials |
| 4 | `{topic} guide tutorial 2026` | Web | Published guides |
| 5 | `{topic} best practices` | Web | Expert advice |
| 6 | `{topic} mistakes avoid` | Web | Anti-patterns |

### GENERAL (default)

| # | Query | Platform | Purpose |
|---|-------|----------|---------|
| 1 | `{topic} site:reddit.com` | Reddit | Community discussion |
| 2 | `{topic} discussion site:reddit.com` | Reddit | Debates, opinions |
| 3 | `{topic} site:x.com OR site:twitter.com` | X | Real-time sentiment |
| 4 | `{topic} 2026` | Web | Recent coverage |
| 5 | `{topic} review opinion` | Web | Expert takes |

---

## Depth Scaling

**Quick (5-8 searches):** Use the top 5-6 queries from the relevant table. Good for a fast pulse check.

**Balanced (8-12 searches, default):** Full query set plus 2-3 follow-up searches based on what the first results surface. If Reddit mentions a specific tool or trend, search for that specifically.

**Deep (12-18 searches):** Full query set plus targeted follow-ups. Add queries for:
- Specific subreddits that appeared in results (e.g., `{topic} site:reddit.com/r/specific_sub`)
- Specific people/accounts that appeared as authorities
- Related topics that emerged from initial results
- Comparison queries ("X vs Y") if alternatives surfaced

---

## Extracting Engagement Signals

WebSearch results often include engagement hints in snippets. Look for:

**Reddit:**
- "X upvotes" or "X points" in the snippet
- "X comments" — indicates active discussion
- Subreddit name — r/technology (broad) vs r/ClaudeAI (niche but focused)
- Thread age — prefer threads from last 30 days

**X / Twitter:**
- Like counts, repost counts in snippets
- "viral" or high-engagement indicators
- Verified accounts or known authorities
- Quote tweets (indicates debate)

**Web:**
- Publication date — strongly prefer last 30 days
- Author credibility — known experts, official blogs
- Comment counts on articles
- "Updated" dates

---

## Source Quality Ranking

Not all sources are equal. Weight them:

| Source type | Weight | Why |
|------------|--------|-----|
| Reddit thread with 50+ upvotes | High | Community-validated, real opinions |
| X post with high engagement | High | Trending signal, real-time pulse |
| Blog post from known expert | Medium-High | Authority signal, usually well-reasoned |
| Reddit thread with <10 upvotes | Medium | Real opinion but less validated |
| News article | Medium | Current but often surface-level |
| Generic blog post | Low-Medium | May be SEO content, less authentic |
| Forum post (non-Reddit) | Low | Usually older or less engaged |

**Cross-platform validation:** If the same insight appears on Reddit AND X AND a blog, that's the strongest possible signal. Prioritize these in synthesis.

---

## Common Pitfalls

1. **Adding your own knowledge to search terms.** Search for what the user said. Your training data may be outdated.
2. **Treating all sources equally.** A Reddit thread with 500 upvotes matters more than a blog post with no comments.
3. **Ignoring contradictions.** If Reddit says "X is great" but X/Twitter says "X is broken", report both. The contradiction IS the insight.
4. **Over-filtering by date.** Some evergreen threads get new comments recently. Include them if the discussion is current.
5. **Stopping at the first page.** If initial results are thin, reformulate and search again with different terms.
