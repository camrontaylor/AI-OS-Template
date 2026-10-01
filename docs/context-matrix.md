# Context Matrix

Load only the `brand_context/` files listed for each skill.

| Skill | voice-profile | positioning | icp | samples | assets | learnings |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|
| `mkt-brand-voice` | **writes** | summary | — | **writes** | **writes** (via firecrawl branding) | `## mkt-brand-voice` |
| `mkt-positioning` | — | **writes** | full | — | — | `## mkt-positioning` |
| `mkt-icp` | — | summary | **writes** | — | — | `## mkt-icp` |
| `meta-wrap-up` | — | — | — | — | — | `## meta-wrap-up` |
| `meta-goal-breakdown` | — | summary | summary | — | — | `## meta-goal-breakdown` |
| `meta-memory-write` | — | — | — | — | — | `## meta-memory-write` |
| `meta-memory-recall` | — | — | — | — | — | `## meta-memory-recall` |
| `meta-find-skills` | none | none | none | none | none | `## meta-find-skills` |
| `str-ai-seo` | tone only | summary | full | — | — | `## str-ai-seo` |
| `tool-stitch` | — | — | — | — | — | `## tool-stitch` |
| `viz-stitch-design` | tone only | summary | language section | — | — | `## viz-stitch-design` |
| `viz-interface-design` | tone only | summary | language section | — | — | `## viz-interface-design` |
| `ops-cron` | — | — | — | — | — | `## ops-cron` |
| `ops-new-feature` | — | — | — | — | — | `## ops-new-feature` |
| `ops-release` | — | — | — | — | — | `## ops-release` |

**Matrix key:** `writes` = creates file | `full` = entire file | `summary` = 1-2 sentences | `tone only` = tone + vocabulary | `language section` = words-they-use section | `## skill-name` = read only that section from `context/learnings.md`

**Learnings rule:** Every skill reads and writes to its own section in `context/learnings.md`. Cross-skill insights go under `# General`. Skill-specific entries go under `# Individual Skills` → `## {folder-name}`.

<!-- AI-OS SKILL PACK:START -->
## Additional Skill Context

The imported skill entries specify any further operational, financial or knowledge-vault inputs. Resolve the active root/client before reading local context. In connected Team mode, use only the authorized injected snapshot; never read local context or another user/client.

| Skill | voice-profile | positioning | icp | samples | assets | learnings | product-marketing |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `fin-company-cfo` | — | summary | — | — | — | `## fin-company-cfo` | if specified |
| `fin-invoice-reconciliation` | per skill | per skill | per skill | per skill | per skill | `## fin-invoice-reconciliation` | if specified |
| `fin-month-end-reporting` | per skill | per skill | per skill | per skill | per skill | `## fin-month-end-reporting` | if specified |
| `fin-personal-cfo` | — | — | — | — | — | `## fin-personal-cfo` | if specified |
| `meta-skill-creator` | per skill | per skill | per skill | per skill | per skill | `## meta-skill-creator` | if specified |
| `meta-skillify` | — | — | — | — | — | `## meta-skillify` | if specified |
| `meta-synthesize-locals` | per skill | per skill | per skill | per skill | per skill | `## meta-synthesize-locals` | if specified |
| `meta-toolify` | — | — | — | — | — | `## meta-toolify` | if specified |
| `mkt-ab-testing` | summary | summary | full | as needed | as needed | `## mkt-ab-testing` | full |
| `mkt-ad-creative` | full | summary | full | tone refs | as needed | `## mkt-ad-creative` | full |
| `mkt-ads` | full | summary | full | tone refs | as needed | `## mkt-ads` | full |
| `mkt-aso` | full | summary | full | tone refs | as needed | `## mkt-aso` | full |
| `mkt-churn-prevention` | full | summary | full | tone refs | as needed | `## mkt-churn-prevention` | full |
| `mkt-co-marketing` | full | summary | full | tone refs | as needed | `## mkt-co-marketing` | full |
| `mkt-cold-email` | full | summary | full | tone refs | as needed | `## mkt-cold-email` | full |
| `mkt-community-marketing` | full | summary | full | tone refs | as needed | `## mkt-community-marketing` | full |
| `mkt-content-repurposing` | per skill | per skill | per skill | per skill | per skill | `## mkt-content-repurposing` | if specified |
| `mkt-copy-editing` | full | summary | full | tone refs | as needed | `## mkt-copy-editing` | full |
| `mkt-copywriting` | full | summary | full | tone refs | as needed | `## mkt-copywriting` | full |
| `mkt-cro` | full | summary | full | tone refs | as needed | `## mkt-cro` | full |
| `mkt-directory-submissions` | full | summary | full | tone refs | as needed | `## mkt-directory-submissions` | full |
| `mkt-emails` | full | summary | full | tone refs | as needed | `## mkt-emails` | full |
| `mkt-events` | full | summary | full | tone refs | as needed | `## mkt-events` | full |
| `mkt-free-tools` | full | summary | full | tone refs | as needed | `## mkt-free-tools` | full |
| `mkt-influencer-marketing` | full | summary | full | tone refs | as needed | `## mkt-influencer-marketing` | full |
| `mkt-jab-hook` | full | summary | full | full | — | `## mkt-jab-hook` | if specified |
| `mkt-launch` | full | summary | full | tone refs | as needed | `## mkt-launch` | full |
| `mkt-lead-magnets` | full | summary | full | tone refs | as needed | `## mkt-lead-magnets` | full |
| `mkt-marketing-loops` | full | summary | full | tone refs | as needed | `## mkt-marketing-loops` | full |
| `mkt-offers` | full | summary | full | tone refs | as needed | `## mkt-offers` | full |
| `mkt-onboarding` | full | summary | full | tone refs | as needed | `## mkt-onboarding` | full |
| `mkt-paywalls` | full | summary | full | tone refs | as needed | `## mkt-paywalls` | full |
| `mkt-popups` | full | summary | full | tone refs | as needed | `## mkt-popups` | full |
| `mkt-programmatic-seo` | full | summary | full | tone refs | as needed | `## mkt-programmatic-seo` | full |
| `mkt-prospecting` | full | summary | full | tone refs | as needed | `## mkt-prospecting` | full |
| `mkt-public-relations` | full | summary | full | tone refs | as needed | `## mkt-public-relations` | full |
| `mkt-referrals` | full | summary | full | tone refs | as needed | `## mkt-referrals` | full |
| `mkt-sales-enablement` | full | summary | full | tone refs | as needed | `## mkt-sales-enablement` | full |
| `mkt-schema` | summary | summary | full | as needed | as needed | `## mkt-schema` | full |
| `mkt-signup` | full | summary | full | tone refs | as needed | `## mkt-signup` | full |
| `mkt-sms` | full | summary | full | tone refs | as needed | `## mkt-sms` | full |
| `mkt-social` | full | summary | full | tone refs | as needed | `## mkt-social` | full |
| `mkt-ugc-scripts` | per skill | per skill | per skill | per skill | per skill | `## mkt-ugc-scripts` | if specified |
| `mkt-visual-identity` | per skill | per skill | per skill | per skill | per skill | `## mkt-visual-identity` | if specified |
| `ops-analytics` | summary | summary | full | as needed | as needed | `## ops-analytics` | full |
| `ops-attribution` | summary | summary | full | as needed | as needed | `## ops-attribution` | full |
| `ops-ingest` | tone only | summary | summary | — | — | `## ops-ingest` | if specified |
| `ops-loopify` | — | — | — | — | — | `## ops-loopify` | if specified |
| `ops-project-management` | tone only | summary | — | — | — | `## ops-project-management` | if specified |
| `ops-revops` | summary | summary | full | as needed | as needed | `## ops-revops` | full |
| `str-business-brainstorm` | — | summary | summary | — | — | `## str-business-brainstorm` | if specified |
| `str-competitor-profiling` | full | summary | full | tone refs | as needed | `## str-competitor-profiling` | full |
| `str-competitors` | full | summary | full | tone refs | as needed | `## str-competitors` | full |
| `str-content-strategy` | full | summary | full | tone refs | as needed | `## str-content-strategy` | full |
| `str-customer-research` | full | summary | full | tone refs | as needed | `## str-customer-research` | full |
| `str-decide` | — | summary | — | — | — | `## str-decide` | if specified |
| `str-deep-research` | — | summary | summary | — | — | `## str-deep-research` | if specified |
| `str-domain` | — | summary | summary | — | — | `## str-domain` | if specified |
| `str-maker-council` | — | summary | summary | — | — | `## str-maker-council` | if specified |
| `str-marketing-council` | full | summary | full | tone refs | as needed | `## str-marketing-council` | full |
| `str-marketing-ideas` | full | summary | full | tone refs | as needed | `## str-marketing-ideas` | full |
| `str-marketing-plan` | full | summary | full | tone refs | as needed | `## str-marketing-plan` | full |
| `str-marketing-psychology` | full | summary | full | tone refs | as needed | `## str-marketing-psychology` | full |
| `str-pricing` | full | summary | full | tone refs | as needed | `## str-pricing` | full |
| `str-product-marketing` | full | summary | full | tone refs | as needed | `## str-product-marketing` | full |
| `str-seo-audit` | summary | summary | full | as needed | as needed | `## str-seo-audit` | full |
| `str-site-architecture` | summary | summary | full | as needed | as needed | `## str-site-architecture` | full |
| `str-trending-research` | per skill | per skill | per skill | per skill | per skill | `## str-trending-research` | if specified |
| `str-unstuck` | — | summary | — | — | — | `## str-unstuck` | if specified |
| `tool-firecrawl-scraper` | per skill | per skill | per skill | per skill | per skill | `## tool-firecrawl-scraper` | if specified |
| `tool-humanizer` | per skill | per skill | per skill | per skill | per skill | `## tool-humanizer` | if specified |
| `tool-paste` | tone only | — | — | — | — | `## tool-paste` | if specified |
| `tool-read-book` | — | — | — | — | — | `## tool-read-book` | if specified |
| `tool-social-fetch` | — | — | — | — | — | `## tool-social-fetch` | if specified |
| `tool-watch-video` | — | — | — | — | — | `## tool-watch-video` | if specified |
| `tool-youtube` | per skill | per skill | per skill | per skill | per skill | `## tool-youtube` | if specified |
| `viz-excalidraw-diagram` | per skill | per skill | per skill | per skill | per skill | `## viz-excalidraw-diagram` | if specified |
| `viz-image-gen` | per skill | per skill | per skill | per skill | per skill | `## viz-image-gen` | if specified |
| `viz-marketing-image` | full | summary | full | tone refs | as needed | `## viz-marketing-image` | full |
| `viz-marketing-video` | full | summary | full | tone refs | as needed | `## viz-marketing-video` | full |
| `viz-slide-deck` | full | full | full | full | full | `## viz-slide-deck` | if specified |
| `viz-ugc-heygen` | per skill | per skill | per skill | per skill | per skill | `## viz-ugc-heygen` | if specified |
<!-- AI-OS SKILL PACK:END -->
