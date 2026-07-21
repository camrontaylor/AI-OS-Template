# Skills Library - Index

> Secondary catalog. NOT auto-loaded, NOT auto-routed, NOT reconciled. Consulted only as a Task-Routing fallback (see AGENTS.md → Skills Library). Two folders, three actions: backlog (inert) → assess → promoted | parked.

_Built 2026-06-16, updated 2026-07-21 · 179 candidates_

## Candidates with a status (assessed - awaiting your promote/park call)

Everything else in the backlog is inert until you ask for an assessment. These few have already been assessed; reply "promote" or "park" to resolve. Each assessment lives in the candidate's own backlog folder.

| Candidate | Assessment | Recommendation |
|-----------|-----------|----------------|
| `slide-deck` (in `backlog/maker/`) | `backlog/maker/slide-deck-ASSESSMENT.md` | **Promote** as `viz-slide-deck` (Marp default) on the first real deck request; reply "go, Marp" or name a format. |
| `planner` | `backlog/planner/ASSESSMENT.md` | **Parked** - source is all-rights-reserved Conversion Factory material (open question 4) and no planner request has appeared in memory. Unpark by answering the 4 open questions in the assessment. |

_`meta-skill-intake` was promoted 2026-07-16 (it owns this pipeline). The old `skills-library-review-watcher` cron is retired - the review stage no longer exists._

## Backlog

### Personal Operator (maker)

_19 total · vendored 2026-07-08, re-synced 2026-07-21 (unstuck added). 3 PROMOTED live (domain -> tool-domain, read-book -> tool-read-book, unstuck -> q-unstuck), 1 assessed (slide-deck), 1 parked (personal-cfo). Rest inert. `coreyhaines31/makerskills` (MIT). "Active dup?" = overlaps a live AI-OS skill or posture; full per-skill call happens on request._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| slide-deck | viz | Draft/update/convert/export slide decks for a React/Next.js slide system (TypeScript Slide[] arrays). | **ASSESSED** - see `backlog/maker/slide-deck-ASSESSMENT.md` | slide deck, presentation, build slides, export deck | coreyhaines31/makerskills |
| unstuck | q | Roadblock antidote: classify a wall's type, run a 10-technique lateral-thinking inventory to a min-10-angles gate, agent fast-path (run on yourself before reporting a dead end). | **PROMOTED -> q-unstuck** (2026-07-21) | I'm stuck, this seems impossible, we hit a wall, dead end, work around this | coreyhaines31/makerskills |
| company-cfo | acc | Monthly CFO workflow: pull bank/processor/payroll/expense data, categorize, reconcile, month-end cash + scenario projection. | no (acc unused) | monthly finances, company cash flow, reconcile books, CFO cadence | coreyhaines31/makerskills |
| personal-cfo | acc | Model personal financial scenarios - house purchase + rental income, renovation, cash-flow forecasts, big-purchase what-ifs. | **PARKED 2026-07-16** - offered 2026-07-08, no go signal since; acc category has zero usage history. Trial in place from the backlog on a real request; unpark on request | personal finance, house hacking, cash-flow model, big purchase | coreyhaines31/makerskills |
| domain | tool | Brainstorm + check available .com domains, aftermarket pricing, USPTO trademark screen, social-handle availability. | **PROMOTED -> tool-domain** | find a domain, brand name, domain availability, trademark check | coreyhaines31/makerskills |
| read-book | q | Read + extract structured per-chapter notes from a book (PDF/EPUB/MOBI/md/txt/URL), chunked by chapter. | **PROMOTED -> tool-read-book** | read this book, book notes, summarize a book, extract chapters | coreyhaines31/makerskills |
| paste | tool | Clean/reformat terminal content for Slack/Notion/X/LinkedIn/email/GitHub (strip ANSI, box chars, prompts). | no | clean for pasting, reformat for Slack, strip ANSI, paste-ready | coreyhaines31/makerskills |
| business-brainstorm | str | Pressure-test a new business/product/side project against a serial-founder filter (should it exist + can you win). | no | new business idea, should I build this, evaluate a side project | coreyhaines31/makerskills |
| pm | ops | Manage projects across businesses with kanban + Eisenhower, one board per business, API/MCP-connected. | partial - ops + Notion | project management, kanban, prioritize tasks, Eisenhower | coreyhaines31/makerskills |
| jab-hook | mkt | Gary Vee jab-jab-hook content rotation across an X/LinkedIn portfolio (value posts vs promo asks). | partial - mkt-content-repurposing | build in public, content rotation, jab jab hook, X/LinkedIn cadence | coreyhaines31/makerskills |
| company-brain | meta | Team-scope AI-ready knowledge base (people, companies, meetings, SOPs, decisions) Claude answers from. | partial - AI-OS memory | team knowledge base, company brain, shared SOPs, team wiki | coreyhaines31/makerskills |
| second-brain | meta | Capture/compile/query a personal Second Brain (Karpathy LLM Wiki schema, Obsidian/markdown vault). | partial - AI-OS memory | second brain, personal wiki, Obsidian vault, capture notes | coreyhaines31/makerskills |
| social-fetch | tool | Fetch + normalize a social post by URL (X/LinkedIn/IG/TikTok/Bluesky/Reddit/Mastodon/Threads/HN). | partial - firecrawl/apify | fetch a tweet, get a LinkedIn post, scrape a social post | coreyhaines31/makerskills |
| toolify | meta | Wizard to integrate an external tool/API/MCP into a project (auth, env, wrapper, smoke test) - Next.js/Rails. | partial - mcp-builder | integrate an API, add an MCP, wire up a tool | coreyhaines31/makerskills |
| loopify | ops | Judgment layer over ScheduleWakeup/CronCreate//loop - decides pacing for autonomous recurring workflows. | partial - ops-cron | set up a loop, recurring agent task, schedule autonomous workflow | coreyhaines31/makerskills |
| deep-research | q | Multi-source, multi-step research (competitor, market, positioning, due diligence, tech decisions). | yes - q-question + Claude deep-research | deep research, competitor research, market research, due diligence | coreyhaines31/makerskills |
| decide | meta | Structured 37signals decision workflow - picks load-bearing questions, reaches a call or "wait", archives rationale. | yes - thinking-partner posture | help me decide, decision framework, should I do X, make a call | coreyhaines31/makerskills |
| skillify | meta | Create/adapt/update a Claude Code skill in your sibling repos (CREATE/adapt/update modes). | yes - meta-skill-creator | create a skill, update a skill, skillify | coreyhaines31/makerskills |
| watch-video | tool | Extract content from a video (YouTube/Loom/Vimeo/Zoom/local/yt-dlp) - transcript/visual/deep modes. | yes - tool-youtube | transcribe a video, watch this video, Loom transcript, video notes | coreyhaines31/makerskills |

### Security (sec)

_29 total · 29 net-new, 0 already-live._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| ai-risk-management | sec | Apply the NIST AI RMF 1.0 to govern AI/ML systems across the model lifecycle - fairness, robustness, transparency, drift monitoring, and AI incident response. | no | AI risk, AI governance, NIST AI RMF, ML governance | briiirussell/cybersecurity-skills |
| api-audit | sec | Audit REST, GraphQL, and RPC APIs against the OWASP API Security Top 10 (2023) - BOLA, BFLA, mass assignment, rate limiting, excessive data exposure. | no | API security, API audit, BOLA, broken object level authorization | briiirussell/cybersecurity-skills |
| breach-patterns | sec | Extract the audit question implied by public breach disclosures (Capital One, LastPass, Okta, Snowflake, MOVEit, SolarWinds) and check your own stack against known attacker playbooks. | no | breach analysis, lessons learned, security postmortem, breach patterns | briiirussell/cybersecurity-skills |
| cloud-audit | sec | Audit AWS, GCP, and Azure cloud infrastructure for misconfigurations, excessive permissions, and security gaps. | no | cloud security, cloud audit, AWS security, GCP security | briiirussell/cybersecurity-skills |
| container-audit | sec | Audit container images, Dockerfiles, and Kubernetes manifests for misconfigurations, excessive privileges, exposed secrets, and runtime risks. | no | container security, Docker security, Dockerfile audit, Kubernetes security | briiirussell/cybersecurity-skills |
| crypto-audit | sec | Audit cryptography implementation - algorithm choice, key sizes, KDF params, IV/nonce handling, signature verification, randomness, TLS config, key rotation. | no | crypto review, cryptography audit, encryption review, KDF | briiirussell/cybersecurity-skills |
| csf-mapping | sec | Map security posture against NIST Cybersecurity Framework 2.0 (Govern/Identify/Protect/Detect/Respond/Recover) - gap analysis, tier assessment, roadmap in board/CISO language. | no | NIST CSF, CSF 2.0, cybersecurity framework, security posture | briiirussell/cybersecurity-skills |
| dependency-audit | sec | Audit project dependencies, frameworks, and toolchains for known CVEs, vulnerable packages, and supply-chain anti-patterns. | no | dependency audit, npm audit, CVE, vulnerable packages | briiirussell/cybersecurity-skills |
| disk-forensics | sec | Analyze disk images, file systems, and memory captures for digital evidence recovery in forensic investigations and CTF challenges. | no | disk forensics, forensic analysis, disk image, file carving | briiirussell/cybersecurity-skills |
| finding-triage | sec | Triage a single security finding (scanner/audit/advisory) to a defensible disposition - mitigation plan, false-positive justification, or accepted-risk writeup. | no | triage this finding, is this a real vulnerability, mitigation plan, false positive | briiirussell/cybersecurity-skills |
| hipaa-audit | sec | Audit systems handling PHI against HIPAA Security/Privacy/Breach Notification Rules plus HITECH - ePHI scoping, 18 identifiers, BAA chain, minimum-necessary. | no | HIPAA, HIPAA Security Rule, PHI, ePHI | briiirussell/cybersecurity-skills |
| iam-audit | sec | Audit, design, and migrate Identity & Access Management - cloud IAM, IdPs (Okta, Entra, Auth0), app authz (RBAC/ABAC/ReBAC), and federated identity. | no | IAM, identity, access management, least privilege | briiirussell/cybersecurity-skills |
| incident-triage | sec | Guide rapid triage and initial response to security incidents following NIST SP 800-61. | no | incident response, security incident, triage, we've been hacked | briiirussell/cybersecurity-skills |
| mobile-audit | sec | Audit iOS and Android apps against OWASP MASVS/MASTG - insecure storage, weak crypto, cert pinning, deeplinks, IPC, jailbreak/root detection. | no | mobile security, iOS security, Android security, mobile audit | briiirussell/cybersecurity-skills |
| osint-recon | sec | Gather and correlate open-source intelligence from public sources for authorized investigations, threat intel, and attack-surface assessment. | no | OSINT, open source intelligence, digital footprint, public records | briiirussell/cybersecurity-skills |
| owasp-audit | sec | Audit application source code against the OWASP Top 10 (2021) - broken access control, crypto failures, injection, SSRF, auth failures, and more. | no | OWASP, OWASP Top 10, security audit, secure code review | briiirussell/cybersecurity-skills |
| pci-audit | sec | Audit systems handling payment card data against PCI DSS v4.0 - scope determination, CHD storage/transmission, secure SDLC, access, logging, testing. | no | PCI, PCI DSS, PCI DSS 4.0, payment card | briiirussell/cybersecurity-skills |
| privacy-engineering | sec | Implement and audit privacy controls - GDPR, CCPA/CPRA, LGPD, PIPEDA - data minimization, consent, DSARs, DPIA, right-to-be-forgotten across backups/caches/third parties. | no | GDPR, CCPA, CPRA, data privacy | briiirussell/cybersecurity-skills |
| prompt-injection | sec | Audit applications for AI prompt injection, agent security, and LLM permission-boundary vulnerabilities. | no | prompt injection, LLM security, AI security, jailbreak | briiirussell/cybersecurity-skills |
| recon | sec | Perform structured reconnaissance and attack-surface enumeration for authorized pentests, CTFs, and bug bounty programs. | no | recon, reconnaissance, enumerate, attack surface | briiirussell/cybersecurity-skills |
| red-team-engagement | sec | Plan, scope, and execute an authorized red-team engagement - assumed-breach scenarios, ATT&CK emulation plans, rules of engagement, deconfliction, debriefs. | no | red team, red team engagement, adversary emulation, ATT&CK emulation | briiirussell/cybersecurity-skills |
| secrets-audit | sec | Find leaked secrets in source, Git history, build artifacts, and infra - and audit the secrets-management posture preventing future leaks. | no | secrets audit, secret scanning, leaked credentials, API key in code | briiirussell/cybersecurity-skills |
| security-comms | sec | Translate technical security work into the language of non-security audiences - board, execs, engineering, customers, legal - for incidents, post-mortems, and risk justification. | no | security comms, communicate this finding, explain to my boss, board update | briiirussell/cybersecurity-skills |
| siem-detection | sec | Engineer and audit SIEM detection rules - log coverage, Sigma/KQL/SPL/Elastic authoring, MITRE ATT&CK mapping, false-positive tuning, detection-as-code. | no | SIEM, detection engineering, detection rules, Sigma | briiirussell/cybersecurity-skills |
| soc-operations | sec | Build, run, and improve a Security Operations Center - alert prioritization, runbooks, escalation, on-call, analyst tiering, MTTD/MTTR KPIs, shift handoffs. | no | SOC, security operations, SOC analyst, alert triage workflow | briiirussell/cybersecurity-skills |
| threat-hunting | sec | Conduct proactive, hypothesis-driven threat hunts across SIEM/EDR/logs using ATT&CK and the PEAK framework to find adversaries that evaded alerts. | no | threat hunting, proactive hunt, TaHiTI, PEAK framework | briiirussell/cybersecurity-skills |
| threat-modeling | sec | Run a structured threat-modeling session for a new feature or architecture - STRIDE, attack trees, data flow diagrams, abuse cases - before code is written. | no | threat model, threat modeling, STRIDE, attack tree | briiirussell/cybersecurity-skills |
| vuln-research | sec | Research a specific CVE end-to-end - affected versions, code reachability, public PoC, patch availability, exposure window, and mitigation if you can't patch now. | no | CVE, vulnerability research, is this CVE relevant, zero-day | briiirussell/cybersecurity-skills |
| web-pentest | sec | Perform black-box/grey-box web application penetration testing on an authorized target - auth bypass, IDOR, session and business-logic flaws, Burp/ZAP workflows. | no | web pentest, web application penetration test, pentesting, bug bounty | briiirussell/cybersecurity-skills |

### Client Delivery & Ops

_22 total · 18 net-new, 4 already-live._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| brand-guidelines | viz | Applies Anthropic's official brand colors and typography to any artifact needing Anthropic's look-and-feel. | no | brand colors, style guidelines, visual formatting, company design standards | conversionfactory/agent-config (shared) |
| brand-strategy | mkt | Stage 3 brand strategy workshop - discover desired emotional response, identify muses and inspirations for three distinct creative concepts. | no | brand strategy, brand strategy workshop, creative concepts, muses and inspirations | conversionfactory/agent-config (shared) |
| brand-style-guide | viz | Stage 7 (optional) brand style guide - a comprehensive reference document for brand handoff to other designers. | no | brand style guide, style guide for handoff, brand handoff document, designer reference doc | conversionfactory/agent-config (shared) |
| branding | viz | Implement and enforce a defined brand system in code - color roles, typography rules, visual motifs, and design tokens. | no | building a site with established brand identity, brand consistency review in code, generating design tokens, color roles and typography rules | conversionfactory/agent-config (shared) |
| client-handoff | ops | Stage 11 client handoff and training - ensure the client can independently manage, update, and maintain their website. | no | client handoff, client training materials, handoff documentation, client delivery prep | conversionfactory/agent-config (shared) |
| client-intake | ops | Stage 0 client intake and sales - sales calls, preliminary info collection, and the 99-point audit for onboarding. | no | onboarding a new client, starting an engagement, client intake, sales calls | conversionfactory/agent-config (shared) |
| creative-direction | viz | Stage 5 creative direction - translate brand strategy into a concrete visual direction with an approved aesthetic (stylescapes, hero concepts). | no | creative direction, stylescapes, hero concepts, finalizing visual direction | conversionfactory/agent-config (shared) |
| growth-engine | mkt | Stage 13 post-launch growth engine - continuous experimentation, content production, and funnel expansion using the audit roadmap as backlog. | no | post-launch growth, continuous experimentation, content production, funnel expansion | conversionfactory/agent-config (shared) |
| logo-design | viz | Stage 6 logo design using the SAD framework (Simple, Appropriate, Distinct) with full identity presentation. | no | logo design, designing a logo, refining a logo, SAD framework | conversionfactory/agent-config (shared) |
| marketing-website-design | viz | Design and build marketing websites with intentional typography, color, layout, motion, and craft details that separate designed sites from assembled ones. | no | building or reviewing a marketing site, landing page design, product page design, design principles for a marketing website | conversionfactory/agent-config (shared) |
| sitemap-workshop | ops | Stage 4 CF delivery: map full site architecture, lock every integration, and define every user happy path - the critical integration checkpoint before design/dev. | no | planning site structure, site architecture session, integration requirements map, CMS architecture and happy paths | conversionfactory/agent-config (shared) |
| website-build-framer | viz | Stage 10C CF delivery: build a high-fidelity client site in Framer where designers own the full process, with dev support only for integrations and technical SEO. | no | building a client site on Framer, Relume to Figma to Framer workflow, Framer technical SEO check, Framer integration wiring | conversionfactory/agent-config (shared) |
| website-build-native | ops | Stage 10A CF delivery: AI Native (Next.js) build where design and dev happen simultaneously in Figma + Claude Code, then engineering wires integrations. | no | building a client site on AI Native/Next.js, Figma to Claude Code build, design tokens from creative direction, integration wiring phase | conversionfactory/agent-config (shared) |
| website-build-webflow | ops | Stage 10B CF delivery: translate approved Figma designs into a functional Webflow site with CMS collections, integrations wired, and content populated. | no | building a client site on Webflow, Figma to Webflow translation, Webflow CMS setup, Webflow integration wiring | conversionfactory/agent-config (shared) |
| website-copy | mkt | Stage 8 CF delivery: produce all website copy rooted in positioning and customer research, delivered in markdown ready for design placement (copy before wireframes). | no | writing or reviewing website copy for a client, page-by-page content plan, copy rooted in positioning doc, markdown copy for design handoff | conversionfactory/agent-config (shared) |
| wireframes | viz | Stage 9 CF delivery: create page-by-page wireframes in Relume with copy placed, CMS sections marked, and integration touchpoints visible before high-fidelity design. | no | building or reviewing wireframes, Relume wireframe assembly, placing Stage 8 copy into layouts, marking CMS and integration touchpoints | conversionfactory/agent-config (shared) |
| planner | ops | Conversational Motion-style daily planner that reads/writes tasks in Notion and meetings in Google Calendar, with a per-user profile, priority ladders, meeting reschedule cascades, and an undo guarantee. | no | plan my day, what's my #1 priority, push my next meeting 30 minutes, reschedule | conversionfactory/planner-skill |
| copy-qa | ops | Section-by-section copy QA that starts from a Notion task link, picks the correct copy-doc version, and compares approved copy against the Figma design (Design tasks) or live Webflow page (Web Dev tasks), then drafts a Notion feedback comment. | no | /qa <notion-link>, QA this page, check copy on this, verify the copy matches | conversionfactory/QA-skill |
| audit | ops | Comprehensive product marketing audit across marketing, design, and web dev with scored categories, video walkthroughs, and a prioritized roadmap. | yes - skip | onboarding a new client, evaluating an existing client, product marketing audit, scored audit | conversionfactory/agent-config (shared) |
| audit-marketing | mkt | Marketing-team slice of the CF product marketing audit - automated research, URL inventory, 17 scored sections, Notion-ready output. | yes - skip | marketing audit, client product marketing audit, 17 scored marketing sections, URL inventory audit | conversionfactory/agent-config (shared) |
| brand-voice | mkt | Apply and enforce brand voice, style guide, and messaging pillars across content for consistency and tone adaptation. | yes - skip | brand voice, brand consistency review, documenting a brand voice, tone adaptation | conversionfactory/agent-config (shared) |
| positioning | mkt | Stage 2 CF delivery: define who a client serves, what they do differently, why it matters, and how they talk about it via the Positioning Canvas at Revolution/Evolution/Optimization depth. | yes - skip | developing or refining client market positioning, positioning canvas, REO depth positioning, North Star for copy and design | conversionfactory/agent-config (shared) |

### Marketing & Strategy

_47 total · 7 net-new, 40 already-live. Updated 2026-07-08 (added marketing-council, marketing-loops, offers)._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| marketing-plan | mkt | Generate an exhaustive 13-section AARRR-structured 12-month fCMO marketing plan, customized to budget/team/stage with audit rubric and ops stack mapping. | no | marketing plan, growth plan, GTM plan, AARRR plan | coreyhaines31/marketingskills |
| prospecting | mkt | Build and qualify prospect lists across B2B SaaS, general B2B, and local SMB motions - ICP to verified scored lead sheet. | no | prospecting, build a prospect list, find leads, outbound list | coreyhaines31/marketingskills |
| public-relations | mkt | Earned-media work - find journalists, pitch stories, newsjacking, and respond to HARO/Qwoted press requests. | no | public relations, press release, media outreach, pitch a journalist | coreyhaines31/marketingskills |
| sms | mkt | Plan and optimize SMS/MMS marketing flows (welcome, abandoned cart, win-back) with TCPA/10DLC compliance. | no | SMS marketing, text message campaigns, abandoned cart text, Klaviyo SMS | coreyhaines31/marketingskills |
| marketing-council | mkt | Simulated board of legendary marketers (Godin, Ogilvy, Schwartz, Dunford, ...) giving multiple expert angles on a marketing question. | no | marketing council, board of advisors, expert panel, what would Ogilvy do | coreyhaines31/marketingskills |
| marketing-loops | str | Set up a recurring, self-running marketing workflow an agent runs on a cadence (weekly/daily/trigger) rather than a one-off. | **PARKED 2026-07-16** - speculative; no session has asked for a recurring marketing cadence, and ops-cron + live mkt skills compose one on demand. Unpark on a real request | marketing loop, recurring marketing workflow, automated marketing cadence | coreyhaines31/marketingskills |
| offers | mkt | Design or improve the thing you actually sell - value framing, bonus stacking, guarantees, scarcity, naming, payment structure. | no | design an offer, offer construction, bonus stack, guarantee, pricing offer | coreyhaines31/marketingskills |
| ab-testing | mkt | Plan and design statistically valid A/B tests and build a growth experimentation program (ICE scoring, hypotheses, significance). | yes - skip | A/B test, split test, experiment, statistical significance | coreyhaines31/marketingskills |
| ad-creative | mkt | Generate and iterate ad creative at scale (headlines, descriptions, primary text) for paid platforms based on performance. | yes - skip | ad copy variations, ad creative, generate headlines, RSA headlines | coreyhaines31/marketingskills |
| ads | mkt | Strategy, targeting, bidding, and optimization for paid campaigns across Google, Meta, LinkedIn, and X. | yes - skip | PPC, paid media, ROAS, CPA | coreyhaines31/marketingskills |
| ai-seo | mkt | Optimize content to be cited by AI search engines and LLMs (AEO/GEO/LLMO, AI Overviews, llms.txt, knowledge bundles). | yes - skip | AI SEO, AEO, GEO, LLMO | coreyhaines31/marketingskills |
| analytics | mkt | Set up, audit, and improve analytics tracking and measurement (GA4, GTM, events, UTMs, attribution). | yes - skip | set up tracking, GA4, conversion tracking, event tracking | coreyhaines31/marketingskills |
| aso | mkt | Audit and optimize App Store / Google Play listings - fetches live data, scores metadata/visuals/ratings, returns a prioritized plan. | yes - skip | ASO audit, app store optimization, optimize my app listing, app store ranking | coreyhaines31/marketingskills |
| churn-prevention | mkt | Reduce voluntary and involuntary churn via cancel flows, save offers, dunning, win-back, and retention strategy. | yes - skip | churn, cancel flow, save offer, dunning | coreyhaines31/marketingskills |
| co-marketing | mkt | Identify co-marketing partners and brainstorm high-impact joint campaigns for SaaS. | yes - skip | co-marketing, partner marketing, joint campaign, cross-promotion | coreyhaines31/marketingskills |
| cold-email | mkt | Write B2B cold outreach emails and multi-touch follow-up sequences that read human and get replies. | yes - skip | cold outreach, prospecting email, outbound email, sales email | coreyhaines31/marketingskills |
| community-marketing | mkt | Design, launch, and grow product communities (Discord/Slack/forums) and community-led growth and advocate programs. | yes - skip | build a community, community strategy, Discord community, community-led growth | coreyhaines31/marketingskills |
| competitor-profiling | str | Turn competitor URLs into structured profile docs by combining live scraping with SEO and market data. | yes - skip | competitor profile, competitor research, competitive intelligence, competitor deep dive | coreyhaines31/marketingskills |
| competitors | str | Build competitor comparison and alternative pages (vs / alternative / battle cards) that rank and convert evaluators. | yes - skip | alternative page, vs page, comparison page, competitive landing pages | coreyhaines31/marketingskills |
| content-strategy | mkt | Plan what content to create - topic clusters, pillars, editorial calendar - to drive traffic and authority. | yes - skip | content strategy, what should I write about, topic clusters, content pillars | coreyhaines31/marketingskills |
| copy-editing | mkt | Improve or refresh existing marketing copy through focused single-dimension editing passes, preserving the core message. | yes - skip | edit this copy, review my copy, proofread, tighten this up | coreyhaines31/marketingskills |
| copywriting | mkt | Write or rewrite conversion copy for any marketing page (homepage, landing, pricing, features, about). | yes - skip | write copy for, value proposition, headline help, CTA copy | coreyhaines31/marketingskills |
| cro | mkt | Analyze marketing pages and forms and recommend changes to lift conversion rates. | yes - skip | CRO, conversion rate optimization, this page isn't converting, improve conversions | coreyhaines31/marketingskills |
| customer-research | str | Conduct and synthesize customer research - interviews, transcripts, reviews, VOC, JTBD, personas, review mining. | yes - skip | customer research, voice of customer, VOC, JTBD | coreyhaines31/marketingskills |
| directory-submissions | mkt | Plan directory submissions (Product Hunt, G2, AI/MCP directories) for backlinks, domain rating, and discovery. | yes - skip | directory submissions, submit to directories, Product Hunt, G2 listing | coreyhaines31/marketingskills |
| emails | mkt | Design lifecycle email sequences - welcome, nurture, onboarding, re-engagement, win-back automated flows. | yes - skip | email sequence, drip campaign, nurture sequence, welcome series | coreyhaines31/marketingskills |
| free-tools | mkt | Plan and evaluate free interactive tools (calculators, graders, generators) as engineering-as-marketing lead gen. | yes - skip | engineering as marketing, free tool, calculator, ROI calculator | coreyhaines31/marketingskills |
| image | mkt | Create and optimize marketing images via AI models and design tools (heroes, social graphics, mockups, OG images). | yes - skip | generate an image, create a graphic, hero image, social media graphic | coreyhaines31/marketingskills |
| launch | mkt | Plan product/feature launches and GTM moments (Product Hunt, beta, waitlist, launch checklist). | yes - skip | launch, Product Hunt, go-to-market, waitlist | coreyhaines31/marketingskills |
| lead-magnets | mkt | Plan and optimize downloadable lead magnets (ebooks, checklists, templates) for email capture. | yes - skip | lead magnet, gated content, content upgrade, ebook | coreyhaines31/marketingskills |
| marketing-ideas | mkt | Library of 139 proven SaaS marketing ideas matched to the user's stage, audience, and resources. | yes - skip | marketing ideas, growth ideas, marketing tactics, ways to promote | coreyhaines31/marketingskills |
| marketing-psychology | mkt | Apply mental models and behavioral science (anchoring, social proof, scarcity, framing) to marketing decisions. | yes - skip | psychology, mental models, cognitive bias, persuasion | coreyhaines31/marketingskills |
| onboarding | mkt | Optimize post-signup onboarding and activation to reach the aha moment fast and build retention. | yes - skip | onboarding flow, activation rate, first-run experience, aha moment | coreyhaines31/marketingskills |
| paywalls | mkt | Create and optimize in-app paywalls and upgrade screens to convert free to paid at value-realized moments. | yes - skip | paywall, upgrade screen, upsell, feature gate | coreyhaines31/marketingskills |
| popups | mkt | Create and optimize popups, modals, slide-ins, and banners that convert without harming brand. | yes - skip | exit intent, popup conversions, lead capture popup, email popup | coreyhaines31/marketingskills |
| pricing | mkt | Help with pricing, packaging, and monetization strategy (tiers, value metrics, Van Westendorp, willingness to pay). | yes - skip | pricing, pricing tiers, freemium, value metric | coreyhaines31/marketingskills |
| product-marketing | mkt | Create/maintain the `.agents/product-marketing.md` context doc (positioning, ICP, messaging) that all other marketing skills reference. | yes - skip | product context, marketing context, set up context, positioning | coreyhaines31/marketingskills |
| programmatic-seo | mkt | Build SEO pages at scale from templates and data (location, comparison, integration pages) without thin-content penalties. | yes - skip | programmatic SEO, pSEO, template pages, pages at scale | coreyhaines31/marketingskills |
| referrals | mkt | Design and optimize referral, affiliate, and word-of-mouth programs and viral loops. | yes - skip | referral, affiliate, ambassador, word of mouth | coreyhaines31/marketingskills |
| revops | mkt | Design lead lifecycle and marketing-to-sales handoff systems (lead scoring/routing, MQL/SQL, pipeline stages, CRM automation). | yes - skip | RevOps, lead scoring, lead routing, MQL | coreyhaines31/marketingskills |
| sales-enablement | mkt | Create sales collateral - pitch decks, one-pagers, objection docs, demo scripts, playbooks reps actually use. | yes - skip | sales deck, pitch deck, one-pager, objection handling | coreyhaines31/marketingskills |
| schema | mkt | Implement and fix schema.org structured data (JSON-LD) for rich results in search. | yes - skip | schema markup, structured data, JSON-LD, rich snippets | coreyhaines31/marketingskills |
| seo-audit | mkt | Audit and diagnose technical and on-page SEO issues, returning prioritized recommendations. | yes - skip | SEO audit, technical SEO, why am I not ranking, my traffic dropped | coreyhaines31/marketingskills |
| signup | mkt | Optimize signup/registration/trial-activation flows to reduce friction and increase completion. | yes - skip | signup conversions, registration friction, signup abandonment, trial conversion rate | coreyhaines31/marketingskills |
| site-architecture | str | Plan website page hierarchy, navigation, URL structure, and internal linking (information architecture / sitemaps). | yes - skip | sitemap, site structure, information architecture, navigation design | coreyhaines31/marketingskills |
| social | mkt | Create, schedule, and optimize social content across platforms plus social listening and engagement triage. | yes - skip | LinkedIn post, Twitter thread, content calendar, social listening | coreyhaines31/marketingskills |
| video | mkt | Produce marketing video via AI models, avatars, and programmatic frameworks (Remotion, HeyGen, Veo, Sora, Runway). | yes - skip | video production, AI video, Remotion, HeyGen | coreyhaines31/marketingskills |

### Engineering (eng)

_16 total · 14 net-new, 2 already-live._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| ai-integration | eng | AI SDK patterns for Anthropic Claude and OpenAI - streaming, tool use, and chat interface implementation in apps. | no | adding AI features to apps, streaming responses, tool use, building chat interfaces | conversionfactory/agent-config (shared) |
| api-designer | eng | Designs REST and GraphQL APIs with best practices for endpoints, contracts, and design review. | no | creating new endpoints, designing API contracts, reviewing API design, REST API | conversionfactory/agent-config (shared) |
| deployment | eng | Deployment patterns for Vercel and Heroku - environment config, CI/CD setup, and deployment troubleshooting. | no | deploying apps, configuring environments, setting up CI/CD, troubleshooting deployments | conversionfactory/agent-config (shared) |
| documentation | eng | Writes clear technical documentation - READMEs, API docs, code comments, and general technical writing. | no | creating READMEs, API docs, code comments, technical writing | conversionfactory/agent-config (shared) |
| drizzle | eng | Drizzle ORM patterns for schema, migrations, queries, and type-safe database access. | no | Drizzle schema, migrations, queries, type-safe database access | conversionfactory/agent-config (shared) |
| nextjs | eng | Next.js App Router patterns with TypeScript - routing, server components, API routes, and data fetching conventions. | no | building Next.js applications, creating routes or server components, API routes, data fetching in Next.js | conversionfactory/agent-config (shared) |
| prisma | eng | Prisma ORM patterns for schema design, migrations, queries, and database modeling. | no | working with Prisma schema, database migrations, Prisma queries, data modeling | conversionfactory/agent-config (shared) |
| rails | eng | Ruby on Rails development patterns and conventions - models, controllers, migrations, generators, and naming. | no | working with Rails apps, generating models/controllers/migrations, Rails best practices, ActiveRecord patterns | conversionfactory/agent-config (shared) |
| react-best-practices | eng | Vercel's 57-rule React/Next.js performance optimization guide across 8 priority categories (waterfalls, bundle size, server perf, etc.). | no | writing or refactoring React/Next.js code, performance optimization, bundle size reduction, eliminating data-fetching waterfalls | conversionfactory/agent-config (shared) |
| scraping | eng | Web scraping and data extraction patterns - Cheerio, Playwright/Puppeteer, fetch-based APIs, and Crawlee selected by use case. | no | building scrapers, extracting data from websites, parsing HTML, automating web data collection | conversionfactory/agent-config (shared) |
| security-best-practices | sec | Web app and infrastructure security - HTTPS, security headers, CORS, XSS, SQL injection, CSRF, rate limiting, and OWASP Top 10. | no | securing APIs, preventing common vulnerabilities, security audit, implementing OWASP/compliance controls | conversionfactory/agent-config (shared) |
| stripe | eng | Stripe payments, subscriptions, and billing - checkout sessions, subscription management, webhooks, and pricing-page wiring. | no | implementing checkout, managing subscriptions, handling Stripe webhooks, building pricing pages with payments | conversionfactory/agent-config (shared) |
| typefully | tool | Create, schedule, and manage social posts across Twitter/X, LinkedIn, Threads, Bluesky, and Mastodon via the Typefully API and CLI. | no | draft/schedule/post tweets or threads, manage social media content, Typefully, cross-platform social publishing | conversionfactory/agent-config (shared) |
| systematic-debugging | eng | Root-cause-first debugging discipline - no fixes without investigation, applied to bugs, test failures, and unexpected behavior. | yes - skip | encountering any bug or test failure, unexpected behavior, performance or build problems, before proposing fixes | conversionfactory/agent-config (shared) |
| test-driven-development | eng | TDD discipline - write the failing test first, watch it fail, then write minimal code to pass; no production code without a failing test. | yes - skip | implementing any feature or bugfix, before writing implementation code, refactoring, behavior changes | conversionfactory/agent-config (shared) |

### Software Engineering Discipline (mattpocock)

_37 total · vendored 2026-07-11. Real-software-engineering workflow pack (not vibe-coding), organized by the author into engineering / productivity / misc / personal / in-progress / deprecated. Overlaps AI-OS mostly at the posture level (grill-me vs Thinking Discipline, research vs q-question/deep-research, code-review vs the built-in `/code-review` skill). `mattpocock/skills` (MIT). **6 PROMOTED 2026-07-16, bundled into ONE live router skill `eng-implement`** (tdd, diagnosing-bugs, implement, to-spec, domain-modeling, wizard) - this closed the user's 2026-07-11 "make these skills available to me" ask. The rest stays inert; full per-skill call happens on request._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| engineering/grill-with-docs | eng | Relentless interview to sharpen a plan or design, writing ADRs and a glossary as it goes. | partial - AGENTS.md Thinking Discipline / brainstorming | align before building, grill with docs, sharpen a design, interview me about this plan | mattpocock/skills |
| engineering/tdd | eng | Red-green-refactor test-driven development discipline: what makes a test worth keeping. | **PROMOTED -> eng-implement** (bundled) | build test-first, red-green-refactor, TDD, integration tests | mattpocock/skills |
| engineering/code-review | eng | Reviews changes since a fixed point along Standards (repo conventions) and Spec (does it match the issue/PRD) axes, in parallel sub-agents. | partial - built-in `/code-review` skill | review this PR, review my diff, code review | mattpocock/skills |
| engineering/diagnosing-bugs | eng | Discipline for hard bugs and performance regressions; a diagnosis loop, phases skipped only when justified. | **PROMOTED -> eng-implement** (bundled) | diagnose this, debug this, something's broken/throwing/slow | mattpocock/skills |
| engineering/domain-modeling | eng | Build and sharpen a project's domain model / ubiquitous language, recording architectural decisions as it goes. | **PROMOTED -> eng-implement** (bundled) | pin down domain terms, ubiquitous language, record an ADR | mattpocock/skills |
| engineering/codebase-design | eng | Shared vocabulary for designing deep modules - where a seam goes, what makes code testable and AI-navigable. | no | design a module's interface, deepening opportunities, where should this seam go | mattpocock/skills |
| engineering/implement | eng | Implement a piece of work from a spec or set of tickets. | **PROMOTED -> eng-implement** (bundled) | implement this spec, implement these tickets | mattpocock/skills |
| engineering/improve-codebase-architecture | eng | Scans a codebase for deepening opportunities, presents them as a visual HTML report, then grills through the one picked. | no | improve architecture, deepening opportunities report, architecture scan | mattpocock/skills |
| engineering/prototype | eng | Build a throwaway prototype whose only job is answering one design question. | no | prototype this, sanity-check this state model, throwaway prototype | mattpocock/skills |
| engineering/research | eng | Background agent investigates a question against primary sources and writes findings to a markdown file in-repo. | partial - q-question / str-trending-research / deep-research | research this, gather docs/API facts, delegate the reading | mattpocock/skills |
| engineering/resolving-merge-conflicts | eng | Resolve an in-progress git merge/rebase conflict by understanding the primary source of each conflicting change. | no | resolve this merge conflict, rebase conflict | mattpocock/skills |
| engineering/setup-matt-pocock-skills | eng | One-time setup: configures issue tracker, triage label vocabulary, and doc layout for the rest of this pack. | no (installer, not portable as-is) | setup-matt-pocock-skills | mattpocock/skills |
| engineering/to-spec | eng | Turns the current conversation into a spec and publishes it to the project issue tracker, synthesis only, no interview. | **PROMOTED -> eng-implement** (bundled) | turn this into a spec, publish a spec | mattpocock/skills |
| engineering/to-tickets | eng | Breaks a plan/spec/conversation into tracer-bullet tickets with declared blocking edges, published to the configured tracker. | partial - Notion tasks:plan / tasks:build | break this into tickets, tracer-bullet tickets | mattpocock/skills |
| engineering/triage | eng | State machine for moving issues/external PRs through categorise, verify, grill-if-needed, agent-ready brief. | partial - Notion task dashboard | triage this issue, triage this PR | mattpocock/skills |
| engineering/wayfinder | eng | Plans a huge chunk of work as a shared map of investigation tickets on the issue tracker, resolved one at a time. | no | plan a huge chunk of work, map of investigation tickets | mattpocock/skills |
| engineering/ask-matt | eng | Router over this pack's own skills - "which skill fits my situation". | no (pack-internal router) | ask-matt, which skill should I use | mattpocock/skills |
| productivity/grill-me | eng | The relentless-interview primitive that grill-with-docs and grilling build on. | partial - AGENTS.md Thinking Discipline | grill me about this plan | mattpocock/skills |
| productivity/grilling | eng | Interview the user relentlessly about a plan/design until reaching shared understanding, walking each branch of the design tree. | partial - AGENTS.md Thinking Discipline | stress-test this plan, grill trigger phrases | mattpocock/skills |
| productivity/handoff | eng | Compact the current conversation into a handoff doc for another agent to pick up. | partial - claude-handoff (this pack) / Claude Code session handoff | hand this off, write a handoff doc | mattpocock/skills |
| productivity/teach | eng | Teach the user a new skill or concept within the current workspace. | no | teach me this, explain this concept | mattpocock/skills |
| productivity/writing-great-skills | meta | Reference vocabulary and principles for writing predictable skills. | partial - meta-skill-creator | writing great skills, how to write a skill | mattpocock/skills |
| misc/git-guardrails-claude-code | ops | Sets up a PreToolUse hook blocking dangerous git commands (push, reset --hard, clean, branch -D) before they execute. | partial - guard-delete.sh (delete-only, narrower scope) | block git push/reset, git safety hooks | mattpocock/skills |
| misc/setup-pre-commit | eng | Sets up Husky pre-commit hooks with lint-staged (Prettier), type checking, and tests. | no | add pre-commit hooks, set up Husky, lint-staged | mattpocock/skills |
| misc/migrate-to-shoehorn | eng | Migrates test files from `as` type assertions to @total-typescript/shoehorn. | no (TS/shoehorn-specific) | migrate to shoehorn, replace `as` in tests | mattpocock/skills |
| misc/scaffold-exercises | eng | Scaffolds exercise directory structures (sections, problems, solutions, explainers) that pass linting. | no (author's course-business specific) | scaffold exercises, new course section | mattpocock/skills |
| personal/edit-article | mkt | Edits and improves article drafts - restructuring sections, tightening prose. | partial - tool-humanizer / mkt-copywriting | edit this article, revise this draft | mattpocock/skills |
| personal/obsidian-vault | meta | Search/create/manage notes in an Obsidian vault with wikilinks and index notes. | no (needs de-tailoring - hardcoded vault path) | find/create/organize Obsidian notes | mattpocock/skills |
| in-progress/claude-handoff | eng | Hands the current conversation to a fresh background agent that picks the work up immediately. | partial - Claude Code's own session/agent handoff | hand off to a background agent | mattpocock/skills |
| in-progress/loop-me | eng | Grills the user about specs for workflows to build inside the current workspace. | partial - /loop skill | loop-me, grill me about workflows to build | mattpocock/skills |
| in-progress/setup-ts-deep-modules | eng | Wires dependency-cruiser into a TS repo so each package is a deep module reachable only via entry points. | no (TS-specific) | wire dependency-cruiser, deep modules | mattpocock/skills |
| in-progress/wizard | ops | Generates an interactive bash wizard walking a human through a manual procedure (URLs, secrets, env files, GH Actions secrets). | **PROMOTED -> eng-implement** (bundled) | build a setup wizard, walk me through this migration | mattpocock/skills |
| in-progress/writing-fragments | mkt | Writing stage 1 (explore): mine raw fragments, no structure yet. | partial - mkt-content-repurposing | mine raw fragments | mattpocock/skills |
| in-progress/writing-beats | mkt | Writing stage 2 (exploit): assemble fragments into a journey of beats, grounding each term before it's leaned on. | partial - mkt-copywriting | assemble beats | mattpocock/skills |
| in-progress/writing-shape | mkt | Writing stage 3 (exploit): shape raw material into an article, paragraph by paragraph. | partial - mkt-copywriting | shape this into an article | mattpocock/skills |
| deprecated/design-an-interface | eng | Generates radically different interface designs for a module via parallel sub-agents ("design it twice"). | no (author-deprecated) | design it twice, compare module shapes | mattpocock/skills |
| deprecated/qa | eng | Conversational QA session that files GitHub issues while exploring the codebase for context. | no (author-deprecated) | QA session, report bugs conversationally | mattpocock/skills |
| deprecated/request-refactor-plan | eng | Creates a tiny-commits refactor plan via interview, filed as a GitHub issue. | no (author-deprecated) | plan a refactor, refactor RFC | mattpocock/skills |
| deprecated/ubiquitous-language | eng | Extracts a DDD ubiquitous-language glossary from the conversation, flagging ambiguities. | no (author-deprecated; folded into domain-modeling) | build a glossary, harden terminology | mattpocock/skills |

### Design & Visual

_9 total · 7 net-new, 2 already-live._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| ad-creative-suite/viz-ad-creative-fal | viz | Full ad-creative pipeline (brand lock, copy, generate, multi-size, slate, QA) using fal.ai as the engine. Routes per job across FLUX.2, Recraft, Ideogram, nano-banana edit, Kling/Veo for video. Locks the brand with reference images, fixed seed, and Recraft style_id. | **PROMOTED -> viz-ad-creative-fal** | make ad creatives, fal ad creatives, paid ad creatives, batch ad variations, ad creative matrix, client ad set | local (ad-creative-suite, 2026-06-23) |
| ad-creative-suite/viz-ad-creative-codex | viz | Full ad-creative pipeline using Codex's native image generation - no model API key needed. The Codex-native engine of the three-variant suite. | **PROMOTED -> viz-ad-creative-codex** | codex ad creatives, batch ad variations, ad creative matrix | local (ad-creative-suite, 2026-06-23) |
| ad-creative-suite/viz-ad-creative-nano (historical) | viz | Former Gemini Nano Banana engine variant. **PARKED 2026-07-16 (superseded)**: user decision 2026-06-24 set the suite as Codex + Fal + Figma ("Gemini/Nano is not part of this three-skill ad setup"); the stale nano live skill was removed then and the backlog folder no longer carries a nano variant. Row kept for record only. | superseded by viz-ad-creative-codex | nano banana ad creatives, gemini ad creatives | local (ad-creative-suite, 2026-06-23) |
| ad-creative-suite/viz-ad-creative-figma | viz | Full ad-creative pipeline with a deterministic engine: a Figma design-system file exported via the REST API, or a local HTML-to-image template. No AI imagery, so pixel-exact, no drift, no AI-content label needed. Best for regulated categories and text-heavy carousels. | **PROMOTED -> viz-ad-creative-figma** | figma ad creatives, template ad creatives, brand-exact ad creatives, batch ad variations | local (ad-creative-suite, 2026-06-23) |
| diagram-maker | viz | Creates visual diagrams to explain systems, flows, and architecture when visual representation aids understanding. | no | explaining how something works, documenting architecture, visual representation, system/flow diagram | conversionfactory/agent-config (shared) |
| remotion | viz | Best-practices reference for Remotion - programmatic video creation in React, covering animations, captions, audio, transitions, charts, and fonts via per-topic rule files. | no | working with Remotion code, React-based video creation, captions/subtitles in video, animation and composition in Remotion | conversionfactory/agent-config (shared) |
| shadcn-ui | viz | shadcn/ui component patterns with Tailwind CSS - installing components, variants, and accessible React interface composition. | no | building UI with shadcn components, styling with Tailwind, creating accessible React interfaces, shadcn variants and forms | conversionfactory/agent-config (shared) |
| web-design-guidelines | viz | Review UI code against Vercel's Web Interface Guidelines (accessibility, UX, design best practices), fetching the latest rules and reporting file:line findings. | no | review my UI, check accessibility, audit design, review UX against best practices | conversionfactory/agent-config (shared) |
| canvas-design | viz | Create beautiful visual art in .png and .pdf documents using a design philosophy - posters, art, static design pieces. | yes - skip | create a poster, piece of art, design, static visual piece | conversionfactory/agent-config (shared) |
| theme-factory | viz | Apply 10 preset (or on-the-fly) color/font themes to artifacts - slides, docs, reports, HTML landing pages - for consistent professional styling. | yes - skip | styling slides or artifacts with a theme, applying a color/font palette, theme showcase selection, generating a new theme | conversionfactory/agent-config (shared) |

### Thinking & Decisions

_1 total · 0 net-new, 1 absorbed into AI-OS core (thinking-partner -> AGENTS.md "Thinking Discipline" + context/thinking/)._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| thinking-partner | core | Deterministic thinking partner: challenges assumptions, detects orientation capture (GT0 to GT7), deploys 8 named pushback probes, and applies 150+ mental models on demand. Capability is core posture, not an invokable skill, so it was absorbed into AI-OS core instead of promoted to a `/` skill. | absorbed -> AGENTS.md "Thinking Discipline" + context/thinking/{diagnostics.md, model-catalog.md} | always-on; activates on every turn that involves a real decision, ambiguous question, or high-stakes call. Session-only off-switch: "thinking partner off" | mattnowdev/thinking-partner |

### Video

_1 total · registered retroactively 2026-07-16 (vendored 2026-07-06 without an INDEX row)._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| claude-video/watch | tool | Watch any video (URL or local): captions first, scene-aware frames, timestamped transcript, Whisper fallback. Upstream of the live tool-youtube skill; update tool-youtube via this vendored copy so the hand-applied patches carry over. | yes - tool-youtube (live, patched) | watch this video, /watch, video transcript, what happens at timestamp | bradautomates/claude-video |

### Coding Rules & Postures

_2 total · reference material for AGENTS.md postures, not invokable skills._

| Item | Cat | What it is | Status | Source |
|------|-----|------------|--------|--------|
| karpathy-coding-discipline | core | Provenance trail for the four Karpathy-derived coding rules. | absorbed 2026-07-08 -> AGENTS.md "Coding Discipline" (re-expressed, not copied) | multica-ai/andrej-karpathy-skills |
| community-claude-md-rules | core | "Ten rules CLAUDE.md" doc from X (June 2026): six community self-check rules (verify before fixing, token budgets, fail loud, deterministic code for plumbing / LLM for judgment) on top of the four absorbed Karpathy rules. **Karpathy attribution UNVERIFIED secondhand** (TechTimes 2026-06-28; aibuilderclub.com frames them as community additions). | backlog (vendored 2026-07-16); NOT absorbed - normal intake applies | community / X, June 2026 |

## Legend

**Cat prefixes:** `sec` = security · `mkt` = marketing · `str` = strategy · `ops` = operations / client delivery · `eng` = engineering · `viz` = visual / design · `tool` = utility / integration.

**Active dup? = yes** means the skill duplicates a capability already live in AGENTS.md, so Task-Routing skips it - it stays here for reference only. **no** means net-new: a capability the active set does not yet cover.
