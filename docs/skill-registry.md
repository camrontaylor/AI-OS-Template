# Skill Registry

Auto-populated as skills are installed. Each entry includes its name and trigger conditions.

---

## Meta Skills

| Skill | Triggers on |
|-------|-------------|
| `meta-skill-creator` | "create a skill", "build a skill", "new skill", "make a skill", "optimize skill description" |
| `meta-wrap-up` | "wrap up", "close session", "end session", "we're done", "session done" |
| `meta-goal-breakdown` | "break this down", "plan this out", "subtasks", "scope this work", "task breakdown", goal bar submissions |
| `meta-memory-write` | "remember this", "remember that", "note that", "save this to memory", "update memory", "log this", "forget about", "remove from memory" |
| `meta-memory-recall` | "what did we decide about", "do we have a record of", "search memory", "look up in memory", "what do we know about X" |

## Foundation Skills

| Skill | Triggers on | Writes to |
|-------|-------------|-----------|
| `mkt-brand-voice` | "tone", "writing style", "brand voice", "how we sound" | `voice-profile.md`, `samples.md` |
| `mkt-positioning` | "differentiation", "angle", "hooks", "USP" | `positioning.md` |
| `mkt-icp` | "target audience", "buyer persona", "ideal customer" | `icp.md` |

## Strategy Skills

| Skill | Triggers on |
|-------|-------------|
| `str-ai-seo` | "AI SEO", "AEO", "GEO", "LLMO", "answer engine optimization", "AI citations", "AI visibility", "optimize for ChatGPT/Perplexity/Claude", "show up in AI answers" |

## Visual Skills

| Skill | Triggers on |
|-------|-------------|
| `viz-stitch-design` | "design a UI", "create a screen", "stitch design", "UI mockup", "app design", "landing page design", "mobile screen", "web layout", "wireframe to UI", "design this page" |
| `viz-interface-design` | "dashboard", "admin panel", "SaaS UI", "data interface", "metrics display", "control panel", "monitoring UI", "analytics view", "settings page", "interactive tool interface" |

## Operations Skills

| Skill | Triggers on |
|-------|-------------|
| `ops-new-feature` | "new feature", "start feature", "add feature", "begin work on", "start working on", "finish feature", "done with feature", "merge feature", "feature done", "merge this" |
| `ops-release` | "release", "cut a release", "bump version", "ship it", "new version", "tag a release" |
| `ops-cron` | "schedule a job", "cron job", "run this every morning", "automate daily", "recurring task", "scheduled job", "check scheduled jobs", "list jobs", "run job manually", "start crons", "stop crons", "cron status", "cron logs" |

## Utility Skills

| Skill | Triggers on |
|-------|-------------|
| `tool-stitch` | "fetch stitch design", "get stitch screens", "stitch project", "pull from stitch", "stitch code", "export stitch" |

---

*Optional skills are auto-registered by reconciliation when their folders appear on disk. Install with `bash scripts/add-skill.sh <name>`. See `.claude/skills/_catalog/catalog.json` for the full list.*

<!-- AI-OS SKILL PACK:START -->
## Additional Registered Skills

All entries below are installed at the shared AI-OS root. Two existing skills, `mkt-copywriting` and `str-ai-seo`, also gain imported methods through their local extensions.

| Skill | Triggers and scope |
|-------|--------------------|
| `fin-company-cfo` | Analyze company cash, reconciled monthly financials, runway, and forecasts. Use for "monthly cash report", "CFO snapshot", "cash pulse", "runway… |
| `fin-invoice-reconciliation` | Reconcile bank transactions with their receipts/invoices found in email and cloud storage, attach or link the matching documents, track repeat misses, and… |
| `fin-month-end-reporting` | Run a month-end financial close on the user's finance spreadsheet - complete categorization formulas on the raw transactions tab, add newly-seen merchants… |
| `fin-personal-cfo` | Model household financial choices and compare scenarios with disclosed inputs and sensitivity. Use for "house math", "rental forecast", "renovation… |
| `meta-skillify` | Create, adapt, or update a capability using AI-OS’s own skill-building workflow. Use for "turn this into a skill", "skill from this chat/video", "adapt… |
| `meta-synthesize-locals` | Synthesizes verbose SKILL.local.md files after migration from the old single-file pattern. For each skill that has a SKILL.local.md that looks like a full… |
| `meta-toolify` | Integrate one external API, SDK, connector, or MCP into AI-OS or an explicitly selected project. Use for "wire up this API", "connect this service", "add… |
| `mkt-ab-testing` | When the user wants to plan, design, or implement an A/B test or experiment, or build a growth experimentation program. Also use when the user mentions… |
| `mkt-ad-creative` | When the user wants to generate, iterate, or scale ad creative — headlines, descriptions, primary text, or full ad variations — for any paid advertising… |
| `mkt-ads` | When the user wants help with paid advertising campaigns on Google Ads, Meta (Facebook/Instagram), LinkedIn, Twitter/X, or other ad platforms. Also use… |
| `mkt-aso` | When the user wants to audit or optimize an App Store or Google Play listing. Also use when the user mentions 'ASO audit,' 'app store optimization,'… |
| `mkt-churn-prevention` | When the user wants to reduce churn, build cancellation flows, set up save offers, recover failed payments, or implement retention strategies. Also use… |
| `mkt-co-marketing` | When the user wants to find co-marketing partners, plan joint campaigns, or brainstorm partnership opportunities. Use when the user says 'co-marketing,'… |
| `mkt-cold-email` | Write B2B cold emails and follow-up sequences that get replies. Use when the user wants to write cold outreach emails, prospecting emails, cold email… |
| `mkt-community-marketing` | Build and leverage online communities to drive product growth and brand loyalty. Use when the user wants to create a community strategy, grow a Discord or… |
| `mkt-content-repurposing` | Repurpose one piece of content into platform-native posts across LinkedIn, Twitter/X, Instagram, TikTok, YouTube, Threads, Bluesky, and Reddit. Triggers… |
| `mkt-copy-editing` | When the user wants to edit, review, or improve existing marketing copy, or refresh outdated content. Also use when the user mentions 'edit this copy,'… |
| `mkt-copywriting` | Persuasive writing for anything that needs to sell. Landing pages, sales pages, emails, ads, social posts, headlines, CTAs. Triggers on: "write copy for",… |
| `mkt-cro` | When the user wants to optimize, improve, or increase conversions on any marketing page or form — including homepage, landing pages, pricing pages,… |
| `mkt-directory-submissions` | When the user wants to submit their product to startup, SaaS, AI, agent, MCP, no-code, or review directories for backlinks, domain rating, and discovery.… |
| `mkt-emails` | When the user wants to create or optimize an email sequence, drip campaign, automated email flow, or lifecycle email program. Also use when the user… |
| `mkt-events` | When the user wants to plan, run, sponsor, speak at, or get pipeline from events — webinars, conferences, trade shows, meetups, dinners, workshops,… |
| `mkt-free-tools` | When the user wants to plan, evaluate, or build a free tool for marketing purposes — lead generation, SEO value, or brand awareness. Also use when the… |
| `mkt-influencer-marketing` | When the user wants to run influencer, creator, or ambassador partnerships to promote their product — finding and vetting partners, structuring deals,… |
| `mkt-jab-hook` | Plan, choose, draft, or audit X and LinkedIn content using a value-first jab/jab/jab/hook rotation across the user’s configured properties. Use for "plan… |
| `mkt-launch` | When the user wants to plan a product launch, feature announcement, or release strategy. Also use when the user mentions 'launch,' 'Product Hunt,'… |
| `mkt-lead-magnets` | When the user wants to create, plan, or optimize a lead magnet for email capture or lead generation. Also use when the user mentions "lead magnet," "gated… |
| `mkt-marketing-loops` | When the user wants to set up a recurring, self-running marketing workflow — a repeatable loop an AI agent runs on a cadence (weekly, daily, on a trigger)… |
| `mkt-offers` | When the user wants to design, construct, or improve an offer — the thing they actually sell — including value framing, bonus stacking, guarantee design,… |
| `mkt-onboarding` | When the user wants to optimize post-signup onboarding, user activation, first-run experience, or time-to-value. Also use when the user mentions… |
| `mkt-paywalls` | When the user wants to create or optimize in-app paywalls, upgrade screens, upsell modals, or feature gates. Also use when the user mentions "paywall,"… |
| `mkt-popups` | When the user wants to create or optimize popups, modals, overlays, slide-ins, or banners for conversion purposes. Also use when the user mentions "exit… |
| `mkt-programmatic-seo` | When the user wants to create SEO-driven pages at scale using templates and data. Also use when the user mentions "programmatic SEO," "template pages,"… |
| `mkt-prospecting` | When the user wants to find, qualify, and build a list of prospects to reach out to — across B2B SaaS, general B2B, or local small businesses. Also use… |
| `mkt-public-relations` | When the user wants help with public relations, earned media, press coverage, journalist outreach, or media strategy (not pull requests). Also use when… |
| `mkt-referrals` | When the user wants to create, optimize, or analyze a referral program, affiliate program, or word-of-mouth strategy. Also use when the user mentions… |
| `mkt-sales-enablement` | When the user wants to create sales collateral, pitch decks, one-pagers, objection handling docs, or demo scripts. Also use when the user mentions 'sales… |
| `mkt-schema` | When the user wants to add, fix, or optimize schema markup and structured data on their site. Also use when the user mentions "schema markup," "structured… |
| `mkt-signup` | When the user wants to optimize signup, registration, account creation, or trial activation flows. Also use when the user mentions "signup conversions,"… |
| `mkt-sms` | When the user wants to plan, build, or optimize SMS or MMS marketing — including welcome flows, abandoned cart texts, post-purchase, win-back, promotional… |
| `mkt-social` | When the user wants help creating, scheduling, or optimizing social media content for LinkedIn, Twitter/X, Instagram, TikTok, Facebook, or other… |
| `mkt-ugc-scripts` | Write short-form UGC video scripts for talking-head and avatar delivery. Triggers on: "write a script", "UGC script", "video script for", "short form… |
| `mkt-visual-identity` | Build and refine a brand's visual identity from any reference (PDFs, URLs, screenshots, posts, brand docs) incrementally: each new reference UPDATES the… |
| `ops-analytics` | When the user wants to set up, improve, or audit analytics tracking and measurement. Also use when the user mentions "set up tracking," "GA4," "Google… |
| `ops-attribution` | When the user wants to figure out which marketing actually drives conversions and revenue, choose or interpret an attribution model, or reconcile… |
| `ops-ingest` | Convert transcripts, client messages, email text, meeting notes, and voice dumps into structured decisions, action items, bugs, questions, and durable… |
| `ops-loopify` | Design an idempotent recurring task or bounded in-session loop for AI-OS. Use for "run this daily", "schedule this", "keep checking until", "make this… |
| `ops-project-management` | Manage a portfolio using five-column Kanban, Eisenhower triage, work-in-progress limits, and clear async updates. Use for "triage my backlog", "what… |
| `ops-revops` | When the user wants help with revenue operations, lead lifecycle management, or marketing-to-sales handoff processes. Also use when the user mentions… |
| `str-business-brainstorm` | Pressure-test a new business, product, or side project on problem, audience, wedge, monetization, moat, portfolio fit, distribution, energy, and… |
| `str-competitor-profiling` | When the user wants to research, profile, or analyze competitors from their URLs. Also use when the user mentions 'competitor profile,' 'competitor… |
| `str-competitors` | When the user wants to create competitor comparison or alternative pages for SEO and sales enablement. Also use when the user mentions 'alternative page,'… |
| `str-content-strategy` | When the user wants to plan a content strategy, decide what content to create, or figure out what topics to cover. Also use when the user mentions… |
| `str-customer-research` | When the user wants to conduct, analyze, or synthesize customer research. Do not use for unrelated deliverables; use the matching native channel skill. |
| `str-decide` | Make and record a decision using the 37signals question bank plus opportunity cost. Use for "help me decide", "go/no-go", "deciding between", or a… |
| `str-deep-research` | Produce a multi-pass, cited research brief with source dates, contradictions, confidence, gaps, and next steps. Use for "research this", "investigate",… |
| `str-domain` | Brainstorm project names and investigate domain availability, registrar and aftermarket prices, trademark screening, and social handles. Use for "find a… |
| `str-maker-council` | Apply contrasting published founder and operator frameworks to a company-building decision. Use for "maker council", "board of advisors", "what would… |
| `str-marketing-council` | When the user wants multiple expert perspectives on a marketing question — a simulated board of advisors staffed by legendary marketers (Seth Godin, David… |
| `str-marketing-ideas` | When the user needs marketing ideas, inspiration, or strategies for their SaaS or software product. Also use when the user asks for 'marketing ideas,'… |
| `str-marketing-plan` | When the user needs a comprehensive marketing plan for a client, a company they advise, or their own product. Also use when the user mentions "marketing… |
| `str-marketing-psychology` | When the user wants to apply psychological principles, mental models, or behavioral science to marketing. Also use when the user mentions 'psychology,'… |
| `str-pricing` | When the user wants help with pricing decisions, packaging, or monetization strategy. Also use when the user mentions 'pricing,' 'pricing tiers,'… |
| `str-product-marketing` | Create or update the AI-OS product marketing foundation by synthesizing existing positioning, ICP, voice and product evidence into… |
| `str-seo-audit` | When the user wants to audit, review, or diagnose SEO issues on their site. Also use when the user mentions "SEO audit," "technical SEO," "why am I not… |
| `str-site-architecture` | When the user wants to plan, map, or restructure their website's page hierarchy, navigation, URL structure, or internal linking. Also use when the user… |
| `str-trending-research` | Research what's trending in the last 30 days across Reddit, X, and the web. Surface real discussions, recommendations, and patterns people are talking… |
| `str-unstuck` | Find safe alternative approaches when a user or agent hits a roadblock. Use for "I am stuck", "we hit a wall", "out of options", "work around this", or… |
| `tool-firecrawl-scraper` | Convert websites into LLM-ready data with Firecrawl API. Scrape, crawl, map, search, extract, agent, batch, change tracking, and branding extraction.… |
| `tool-humanizer` | Remove AI-generated writing patterns and restore natural human voice. Detects and fixes 50+ AI tells: inflated symbolism, promotional language, hedging,… |
| `tool-paste` | Clean terminal or copied content for Slack, Notion, X, LinkedIn, email, GitHub, Markdown, HTML, or plain text. Use for "paste-ready", "strip ANSI", "clean… |
| `tool-read-book` | Read a supplied book or long document in chunks and produce notes, summary, quotes, or study cards. Use for "read this book", "summarize this ebook",… |
| `tool-social-fetch` | Fetch a supplied public social post or thread URL and normalize author, text, time, engagement, and media links. Use for "read this post", "fetch this… |
| `tool-watch-video` | Extract transcripts and optional visual observations from supplied video URLs or local recordings. Use for "transcribe this video", "watch this… |
| `tool-youtube` | Fetch latest videos from YouTube channels and extract full transcripts. Two modes: channel mode (list recent uploads, needs YOUTUBE_API_KEY) and… |
| `viz-excalidraw-diagram` | Generate Excalidraw diagram JSON files that make visual arguments — not just labelled boxes. Workflows, architectures, concepts, protocols, system… |
| `viz-image-gen` | Interactive visual direction and image generation via GPT Image or Gemini. Uses the 6-Element Framework (Subject, Framing, Lighting, Mood, Medium, Style)… |
| `viz-marketing-image` | When the user wants to create, generate, edit, or optimize images for marketing — blog heroes, social graphics, product mockups, profile banners, listing… |
| `viz-marketing-video` | When the user wants to create, generate, or produce video content using AI tools or programmatic frameworks. Also use when the user mentions 'video… |
| `viz-slide-deck` | Create, update, convert, or export slide decks using a chosen narrative, density mode, and AI-OS brand context. Use for "make a deck", "speaker notes",… |
| `viz-ugc-heygen` | Create UGC-style avatar videos via HeyGen API. Use when: "create a video", "UGC video", "heygen video", "talking head video", "avatar video", "make a… |
<!-- AI-OS SKILL PACK:END -->
