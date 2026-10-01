# Agent Readiness — Can an Agent Reach, Navigate, and Parse Your Site?

AI visibility work splits into two layers: what your content says (the rest of this skill) and whether an agent can *get to it at all*. This reference covers the second layer — the access/discovery/parseability audit — plus the emerging shift from agent-*readable* to agent-*actionable* sites.

A supported readiness checker can make the audit measurable; verify its current availability before use:

| Tool | Run it | Method |
|---|---|---|
| **Frase Agent Readiness Checker** | [frase.io/tools/agent-readiness](https://www.frase.io/tools/agent-readiness) | Access / Discovery / Parseability triad; 80+ = agents can reliably use the site, 60–79 = solid with gaps, <60 = real access problems |

Run a checker before and after any agent-readiness work — the score is a shareable artifact and the failed checks are your worklist. Use the checks as evidence and note the vendor/tool limitations.

## The three questions

### 1. Access — can an agent get to the page and see real content?

- **Core content in the initial HTML response.** Most agents never execute JavaScript. If the content only exists after client-side rendering, it doesn't exist. This is the #1 essential check in the checker.
- **No bot challenge or firewall block** on the request path. Aggressive bot protection (Cloudflare challenges, WAF rules) that blocks `GPTBot`, `PerplexityBot`, `ClaudeBot`, etc. is self-inflicted invisibility. Audit what your CDN/WAF actually does to those user agents — many sites block them by default without anyone deciding to.
- **Correct HTTP behavior**: real status codes (no soft-404s), stable canonical URLs, recoverable errors.

### 2. Discovery — do your files tell agents what's here?

- **robots.txt with an explicit AI-crawler stance** — name the major AI crawlers and state your policy, rather than leaving it to be assumed (see the bot-access table in ai-os-workflow-methodology.md for the allow/block list).
- **A sitemap that loads and parses cleanly.**
- **llms.txt at the domain root** (see Machine-Readable Files in ai-os-workflow-methodology.md).
- **`llms-full.txt`** — the newer companion: your entire site content in one file, so an agent gets everything in a single request instead of crawling. Emerging, cheap to generate alongside llms.txt, and scored as bonus signal by some checkers.
- **robots.txt content-usage statements** — an emerging convention for declaring what AI may do with your content (train / cite / summarize), so the answer comes from you instead of being assumed.

### 3. Parseability — once there, can the agent tell what the page is?

- **Valid, substantive structured data** (JSON-LD — see the `mkt-schema` skill).
- **A Markdown representation of the page.** This is the newest technique in the stack, two implementations:
  - **Content negotiation**: serve compact Markdown at the *same canonical URL* when the request asks for `Accept: text/markdown`, with a `Vary` header keeping the HTML and Markdown cache entries separate. Agents get Markdown, browsers get HTML, using one canonical URL.
  - **Link header**: an HTTP `Link` header on the HTML page pointing to a parallel Markdown version — discoverable without guessing URLs.
- Clear document structure — one H1, headings that answer sub-questions, extractable answer blocks (the content-patterns reference).

## Emerging: agent-actionable, not just agent-readable

Reading is becoming table stakes. The next race is whether an agent can *act* on your site — fill the form, book the meeting, start the trial. **WebMCP** is the emerging standard here: a page declares its forms and CTAs as callable tools with input schemas, so an agent doesn't have to reverse-engineer your UI. Early days (label: emerging, not yet a ranking/citation signal), but the direction is clear — if agents are becoming buyers, the site that exposes "start trial" as a structured action wins the agent-mediated conversion that a pretty button loses.

Practical today: make sure your highest-intent actions (signup, pricing, demo booking, contact) work without JavaScript-only flows, have labeled semantic form fields, and return machine-readable confirmation.

## Citation-source volatility (why you diversify)

Third-party citation mixes are **not stable** — they shift overnight with model and retrieval updates, and August 2026 provided the case study: **ChatGPT's query fan-out changes nearly wiped Reddit as a citation source** within days (practitioner-reported by multiple AEO teams; one had been earning 24-hour citations from Reddit at 1M+ impressions/month before the change). Meanwhile the same practitioners report **business-owned websites dominate Gemini citations (~60%)**.

What this means for strategy:

- **Never concentrate AI-visibility work in one third-party surface.** The Presence pillar's list (Wikipedia, Reddit, YouTube, podcasts, review sites, Quora) is a portfolio, not a menu to pick one from. A surface that's 2% of citations today can be 0% after one retrieval update — or vice versa.
- **Owned-site fundamentals hedge the volatility.** Platform deals and retrieval changes reshuffle third-party sources; your own agent-readable site is the one surface no platform can drop you from — and on Gemini it's already the dominant citation class.
- **Treat any citation-share statistic as dated.** The "Reddit = 1.8% of ChatGPT citations" class of stats (including the ones in this skill) are snapshots — check the date, and verify against your own citation monitoring (the DIY monitoring loop in ai-os-workflow-methodology.md) before betting budget on them.
- **Speed is real**: fresh content on retrieved surfaces can be cited within ~24 hours. AI search rewards freshness faster than classic SEO ever did.

---

*Agent-readiness check taxonomy distilled from Frase's Agent Readiness Checker (both August 2026, credited); citation-volatility events practitioner-reported (Ashni of Hype Partners (@ashnichrist) and others, August 2026) — labeled accordingly, verify against your own monitoring.*
