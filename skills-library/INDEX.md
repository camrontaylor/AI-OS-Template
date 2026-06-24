# Skills Library - Index

> Secondary catalog. NOT auto-loaded, NOT auto-routed, NOT reconciled. Consulted only as a Task-Routing fallback (see AGENTS.md → Skills Library). Pipeline: backlog → triage → review → promoted/parked.

_Built 2026-06-16, updated 2026-06-22 · 74 skills_

## Triage (the assess trigger)

_Empty - move a candidate here from the backlog to trigger meta-skill-intake's full assessment._

## Review (awaiting your sign-off)

_Empty - a skill lands here with its ASSESSMENT.md and a Notion task once the assessment is done._

## Backlog

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

### Marketing & Strategy

_44 total · 4 net-new, 40 already-live._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| marketing-plan | mkt | Generate an exhaustive 13-section AARRR-structured 12-month fCMO marketing plan, customized to budget/team/stage with audit rubric and ops stack mapping. | no | marketing plan, growth plan, GTM plan, AARRR plan | coreyhaines31/marketingskills |
| prospecting | mkt | Build and qualify prospect lists across B2B SaaS, general B2B, and local SMB motions - ICP to verified scored lead sheet. | no | prospecting, build a prospect list, find leads, outbound list | coreyhaines31/marketingskills |
| public-relations | mkt | Earned-media work - find journalists, pitch stories, newsjacking, and respond to HARO/Qwoted press requests. | no | public relations, press release, media outreach, pitch a journalist | coreyhaines31/marketingskills |
| sms | mkt | Plan and optimize SMS/MMS marketing flows (welcome, abandoned cart, win-back) with TCPA/10DLC compliance. | no | SMS marketing, text message campaigns, abandoned cart text, Klaviyo SMS | coreyhaines31/marketingskills |
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

### Ad Creative Suite (viz)

_3 total · 3 live in `.claude/skills/`._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| ad-creative-suite/viz-ad-creative-codex | viz | Full ad-creative pipeline (onboarding, brand lock, creative matrix, prompt pack, native image generation, multi-size slate, QA) using Codex-native image generation with no model API key. | yes - live | Codex ad creative, no API key ad creative, paid ad creatives, batch ad variations, ad creative matrix | local (ad-creative-suite, 2026-06-24) |
| ad-creative-suite/viz-ad-creative-fal | viz | Full ad-creative pipeline (brand lock, copy, generate, multi-size, slate, QA) using fal.ai as the engine for photoreal, typography, and short-video concepts. | yes - live | fal ad creatives, multi-model ad creative, paid ad creatives, batch ad variations, ad creative matrix | local (ad-creative-suite, 2026-06-24) |
| ad-creative-suite/viz-ad-creative-figma | viz | Full ad-creative pipeline with deterministic Figma, Figma MCP, Figma Buzz/Weave-style templates, or local HTML rendering for brand-strict and regulated creative. | yes - live | figma ad creatives, template ad creatives, brand-exact ad creatives, batch ad variations | local (ad-creative-suite, 2026-06-24) |

### Thinking & Decisions

_1 total · 0 net-new, 1 promoted to live (str-thinking-partner)._

| Skill | Cat | What it does | Active dup? | Triggers | Source |
|-------|-----|--------------|-------------|----------|--------|
| thinking-partner | str | Deterministic thinking partner: challenges assumptions and applies 150+ mental models (full catalog in references/model-catalog.md, loaded on demand) to sharpen decisions and solve problems. One router SKILL.md + on-demand catalog - the model for bundled promotion. | promoted -> str-thinking-partner (live) | help me think through X, challenge my assumptions, what am I missing, stress-test this, play devil's advocate, decide between X and Y, second-order effects, apply mental models | mattnowdev/thinking-partner |

## Legend

**Cat prefixes:** `sec` = security · `mkt` = marketing · `str` = strategy · `ops` = operations / client delivery · `eng` = engineering · `viz` = visual / design · `tool` = utility / integration.

**Active dup? = yes** means the skill duplicates a capability already live in AGENTS.md, so Task-Routing skips it - it stays here for reference only. **no** means net-new: a capability the active set does not yet cover.
