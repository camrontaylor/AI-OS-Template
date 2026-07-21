---
name: mkt-brand-voice
description: "Extract or build a brand's voice so every skill writes in their style. Not for positioning, audience, or keyword work."
when_to_use: 'Invoke when the request sounds like: "brand voice", "writing style", "make this sound like me", "define our voice", "tone of voice", "analyze my website", "voice playbook". Modes: Import, Extract, Build, Auto-Scrape. Foundation skill, run before execution skills that read voice'
---

# Brand Voice

## Outcome

Files saved to `brand_context/`:
- `voice-profile.md` — the full voice system (tone, vocabulary, rhythm, platform rules)
- `samples.md` — 5-10 gold-standard sentences with source and reason noted
- `assets.md` — (Auto-Scrape only, if Firecrawl available) visual brand assets auto-discovered from URL: logo, colors, fonts, brand traits. Reports what was found and what wasn't.

The voice profile includes a structured JSON data block validated against `references/voice-profile.schema.json`. This enables downstream skills and automation to read voice data programmatically.

Any skill can reference these to write on-brand without asking the user about voice again.

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/positioning.md` | Summary | Informs voice positioning — a challenger brand sounds different from a trusted advisor |
| `context/learnings.md` | `## mkt-brand-voice` section | Apply any previous corrections before starting |

Load if they exist. Proceed without them if not.

---

## Before You Start

**Check if `brand_context/voice-profile.md` exists.**

If it exists → **Update mode.** Read the existing profile, show a one-paragraph summary of the current voice, and ask what they'd like to change. Don't rebuild from scratch. Before overwriting any section, show what changed and confirm.

If it doesn't exist → **Mode selection.** Ask:

> "How do you want to set up your voice?
> 1. I have brand guidelines — import them and I'll map everything across
> 2. I have content samples — paste them and I'll extract your voice
> 3. Start from scratch — I'll ask a few questions and build it
> 4. Here's my URL — research it yourself"

If the user provides a URL in their first message, skip mode selection and go directly to Auto-Scrape. If they attach or paste a structured brand guide, go directly to Import.

**Playbook note:** Mode 3 (Build) has two variants — a Quick 8-question flow and a deep "AI-OS Voice Playbook" flow. Playbook is an opt-in sub-variant of Build, never a separate mode. Only offer it when the user is entering Build mode, has no existing `voice-profile.md`, and hasn't already gathered a strong sample corpus from Import/Extract/Auto-Scrape. Users with an existing profile always hit **Update mode** and never see Playbook unless they explicitly ask for a "deep rebuild" or say "run the brand voice playbook".

---

## Mode 1: Import

Best for: brands that already have voice/tone guidelines, brand books, or style guides.

**Accepts:** Pasted text, PDF, or any document containing existing brand voice guidelines.

**Process:**
1. Read the provided guidelines fully
2. Map their structure into the voice-profile.md format (see `references/voice-profile-template.md`)
3. Flag any gaps — common missing pieces: real samples, anti-patterns (what the brand does NOT sound like), platform-specific rules, vocabulary lists
4. Present a summary: "Here's what your guidelines cover and what's missing"
5. **Enrich offer:** Ask if they want to layer on additional sources to fill gaps and add real-world samples:
   - "Want me to pull from your LinkedIn, website, or other content to add real samples and fill the gaps?"
   - If yes → run Auto-Scrape or Extract on the additional sources, then merge findings into the imported profile
   - If no → proceed with what's there, noting gaps in the profile

**Merge rules when enriching:**
- The imported guidelines are the authority — enriched content fills gaps, it doesn't override
- If enriched content contradicts the guidelines, flag it: "Your guidelines say X but your LinkedIn sounds more like Y — which is the real you?"
- Samples from real content always go to `samples.md`, even when the guidelines provided example copy

---

## Mode 2: Extract

Best for: raw content — website copy, emails, social posts, newsletters, transcripts.

**Sample gate:** Minimum 5 samples OR 800+ total words. Under the threshold → offer Quick mode (top 5 traits + 3 rules) or ask for more content.

**Sample priority — most to least authentic:**
1. Slack messages or casual emails (raw, unedited)
2. Podcast or call transcripts
3. Social posts (LinkedIn, Twitter)
4. Website copy (most edited, least authentic)

**Run the extraction:**
Read `references/extraction-guide.md` for the full methodology — 6 dimensions, phrase harvesting, confidence zone mapping, anti-pattern sourcing, and self-critique checklist.

After analyzing, collect 5-10 sentences that best represent the voice for `samples.md`.

---

## Mode 3: Build

Best for: starting fresh, or existing content is too generic to reliably extract from.

**Quick vs Deep fork (ask this first):**

> "Quick setup (5-8 targeted questions, ~5 min) or the full AI-OS voice playbook (deeper interview, ~10-15 min, better for people starting from zero)?"

- **Quick** → use `references/build-questions.md`. Ask a maximum of 8 questions, prioritised by what context is already loaded. If `positioning.md` is loaded, skip questions it already answers. After building, ask for 2-3 sample sentences for `samples.md`.
- **Playbook** → use `references/playbook-questions.md`. Walk through Step 1 (Personality, 5 questions), Step 2 (Strategic Framework, 4 questions — skip Q1/Q2 if `icp.md`/`positioning.md` exist), and Step 3 (Example Collection). Samples collected during the interview feed directly into `samples.md`. Follow the Playbook's Synthesis Instructions — derive every characteristic from the user's actual answers, never template from the example brief.

If the user has already indicated a preference (e.g. the `/onboarding` flow passed through a "deep flow" flag, or the user said "run the brand voice playbook"), skip the fork and route directly to the matching variant.

If the user already produced a strong sample corpus through Import / Extract / Auto-Scrape in this session, do **not** offer Playbook — they already have the raw material; keep Build as Quick.

---

## Mode 4: Auto-Scrape

Best for: user provides a URL and wants research done for them.

### Scraping Strategy

Try sources in this order, using the cheapest tool that works:

1. **WebFetch first** (free) — try homepage, About page, 2-3 blog posts, LinkedIn
2. **If WebFetch fails** (JS-heavy site, bot protection, empty content) → fall back to `tool-firecrawl-scraper` skill
   - Check `.env` for `FIRECRAWL_API_KEY` first
   - If missing → trigger the **Fallback** flow below (offer API key or build assets now). Do NOT stop here.
   - If present, use Firecrawl scrape endpoint with `formats=["markdown"]`

### Brand Asset Extraction

When a URL is provided, also run **Firecrawl branding extraction** (if API key available) to auto-discover visual brand assets:

```
formats=["branding"]  →  colors, fonts, logos, spacing, brand traits
```

Report back to the user:
> **Found from your site:**
> - Logo: [URL or "not found"]
> - Primary colors: [hex values or "not found"]
> - Fonts: [font names or "not found"]
> - Brand traits: [if detected]
>
> **Couldn't find automatically:**
> - [List anything missing — social handles, brand photography, etc.]
>
> You can add these manually to `brand_context/assets.md`.

If Firecrawl isn't available, skip branding extraction and note: "I couldn't auto-detect your visual brand assets. You can add them manually to `brand_context/assets.md` later."

### Voice Extraction Process

1. Fetch content from: homepage, About page, 2-3 blog posts, LinkedIn bio + recent posts, Twitter/X
2. Report what was found (pages, word count, quality signal)
3. Feed all content into Extract mode (Mode 2)
4. Follow up with 2-3 gap-filling questions: evolution intent, hated phrases, voice inspiration

### Fallback — Never Block Brand Asset Creation

If scraping fails for any reason (missing API key, site blocks requests, JS-heavy page), **always offer to build brand assets anyway**. Never stop the flow because a URL couldn't be scraped.

**When a URL can't be scraped**, ask the user:

> "I couldn't scrape that URL — [reason]. Two options:
> 1. **Add your API key now** — paste your `FIRECRAWL_API_KEY` and I'll retry immediately
> 2. **Build your brand assets now** — I'll ask you a few questions instead, and we can scrape the URL later to enrich everything"

If the user picks option 2 (or doesn't have a key), switch to **Build mode (Mode 3)** and complete the full voice profile, samples, and any other brand assets. The URL stays noted in the profile so it can be scraped in a future session to enrich the existing profile.

**Critical rule:** The user should always leave the onboarding flow with complete brand assets — voice-profile.md, samples.md — regardless of whether scraping worked. Scraping enriches the output; it never gates it.

---

## Step 5: Voice Test (All Modes)

After producing any voice profile, validate before saving. Do not skip.

Write 3 samples using the extracted or built profile:
- A 3-4 sentence email opening
- A social post (match their most-used platform)
- A landing page headline + 2 supporting sentences

Ask: *"Does this sound like you when you're not overthinking it?"*

- **Yes** → save
- **Close but off** → ask what's wrong, adjust specific sections, retest
- **Not right** → ask for an example that IS right, re-extract from it

Cap at 3 rounds. If still unresolved, offer to save current version and refine over time using `/brand-voice` again.

---

## Step 6: Save Output

**`brand_context/voice-profile.md`**
Read `references/voice-profile-template.md` for the exact format. All sections required.
Include a structured JSON data block at the end (inside a `<details>` tag) that conforms to `references/voice-profile.schema.json`. Read the schema before generating the JSON to ensure all required fields are present.

If Playbook mode was used, ensure every section in `voice-profile.md` is traceable to a specific answer — no templated language from the example brief. Core Voice Characteristics must be named from the user's actual words; signature phrases must be their actual phrases; the never list must reflect their Q1 anti-corporate answer.

**`brand_context/samples.md`**
5-10 sentences. For each, note: source type, and why it's representative.

```
## [Source] — [e.g., email to list / LinkedIn post / homepage]
"[Sentence exactly as written]"
*Why it's representative: [1 sentence]*
```

After saving, show the user actual excerpts — not just confirmation of file paths.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

- 2026-04-29: Match output language to the user's language. If the user writes in Portuguese, produce the voice profile, samples, and all questions in Portuguese. Never default to English when the user hasn't written in English.

---

## Self-Update

If the user flags an issue with the output — wrong tone, bad format, missing context, incorrect assumption — update the `## Rules` section in this SKILL.md immediately with the correction and today's date. Don't just log it to learnings; fix the skill so it doesn't repeat the mistake.

---

## Troubleshooting

**Not enough samples:** Request more content, or switch to Build mode.
**Voice feels generic after extraction:** Website copy is often sanitised. Ask for emails or Slack messages.
**User can't decide on tone:** Write two contrasting versions of the same sentence, ask which is closer.
**Positioning not loaded:** Proceed, but note it would sharpen the voice positioning.
**Profile already exists but user wants to start over:** Confirm before overwriting. Offer to save old version with a date suffix.
