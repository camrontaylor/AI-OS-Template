---
name: mkt-content-repurposing
description: "Repurpose one piece of content into platform-native posts (LinkedIn, X, Instagram, TikTok, YouTube, Threads, Bluesky, Reddit). Not for original content creation, brand voice, positioning, or audience research."
when_to_use: 'Invoke when the request sounds like: "repurpose this", "turn this into social posts", "atomize this", "LinkedIn post from this", "thread from this", "content calendar from this"'
---

# Content Repurposing

## Outcome

One piece of source content turned into 10-16 platform-native assets, saved to `projects/mkt-content-repurposing/{YYYY-MM-DD}_{campaign-name}/`. Each file is ready to copy-paste and publish — not a reworded version of the same post, but content that feels like it belongs on each platform.

## Context Needs

| File | What to load | Why |
|------|-------------|-----|
| `brand_context/voice-profile.md` | Full | Tone, vocabulary, rhythm — adapted per platform |
| `brand_context/samples.md` | Yes | Reference for how they actually write |
| `context/learnings.md` | `## mkt-content-repurposing` section | What's worked before, what hasn't |

Load what exists. Skip what doesn't. This skill works standalone.

## Dependencies

| Skill | Required? | What it provides | Without it |
|-------|-----------|-----------------|------------|
| `tool-youtube` | Optional | Fetch latest videos and transcripts from YouTube channels | Ask user to paste transcript or provide a URL manually |
| `tool-humanizer` | Optional | AI pattern removal before saving | Output saved without humanizer pass |

---

## Step 1: Check What We're Working With

Load brand context per the table above. Tell the user what's available:

```
Brand context:
  Voice Profile     [loaded / not found]
  Samples           [loaded / not found]
  Learnings         [N entries / none yet]
```

If voice profile exists, note the tone in one line. If not, work with a neutral professional voice and mention that `/mkt-brand-voice` would make the output sharper.

## Step 2: Get the Source Content

Take whatever the user gives you — pasted text, a URL, a file path. Valid sources:

| Source | How Much You Can Get From It |
|--------|----------------------------|
| Blog post / article | A lot — usually 10+ assets |
| Newsletter | Similar to blog — lots of material |
| Podcast / video transcript | Even more — spoken content is rich |
| Case study | Good — built-in narrative arc |
| Framework / process | Good — naturally breaks into steps |
| Data / research | Moderate — needs more creative framing |

If they give a URL, try WebFetch first. If that fails (JS-heavy site, bot protection), fall back to `firecrawl-scraper` (needs `FIRECRAWL_API_KEY` in `.env`). If both fail, ask them to paste the content.

## Step 3: Break It Into Atoms

Pull the source apart into the pieces you'll remix across platforms:

1. **The core insight** — if someone remembers one thing, this is it
2. **Supporting points** — 3-7 ideas that build the case
3. **Stories and examples** — specific, concrete moments
4. **Numbers and proof** — data, stats, results
5. **Spicy takes** — opinions that challenge what people assume
6. **Action steps** — things the reader can actually go and do
7. **Quotable lines** — punchy phrases that work as standalone posts

Show the atoms to the user before generating. "Here's what I pulled out. Anything to add or drop?"

## Step 4: Check for Algorithm Changes

Before writing anything, do a quick search for each target platform:

```
"{platform} algorithm update {current month} {current year}"
```

Compare what you find against the platform references. If something meaningful changed, flag it. If search isn't available, use the reference data and note it.

## Step 5: Pick the Platforms

Ask: "All 8 platforms, or specific ones?"

Default to all unless they narrow it. If you have ICP data, recommend the platforms where their audience actually hangs out.

## Step 6: Adapt the Voice

Read `references/voice-adaptation.md` for the full adaptation framework.

The same insight needs to hit differently on each platform. Take the user's voice profile and adjust the register, pace, length, and vocabulary to match where it's going. Same person, different room.

## Step 7: Write the Content

For each platform, read the relevant reference:

- LinkedIn + Twitter/X: `references/platform-text.md`
- Instagram + TikTok + YouTube: `references/platform-visual-video.md`
- Threads + Bluesky + Reddit: `references/platform-emerging.md`

Use the hooks, templates, format specs, and CTAs from those references. Write content that feels native to each platform — not the same post reformatted.

For each piece, include:
- The content itself (publish-ready)
- Format recommendation (carousel, thread, reel script, etc.)
- Posting time suggestion (if learnings have data)
- A CTA that fits the platform

## Step 8: Content Calendar (If Asked)

If they want a weekly schedule, read `references/voice-adaptation.md` for the 5-3-2 weekly rhythm and map the assets across the week.

## Step 9: Humanizer Gate

Before saving, run all generated content through `tool-humanizer` in pipeline mode. Use `deep` mode if `brand_context/voice-profile.md` was loaded, `standard` otherwise. Read `tool-humanizer/SKILL.md` and apply its pattern detection + replacement process to each platform's content. Only show the score summary if the delta exceeds 2 points.

## Step 10: Save Everything

Create: `projects/mkt-content-repurposing/{YYYY-MM-DD}_{campaign-name}/`

One file per platform: `linkedin.md`, `twitter-x.md`, `instagram.md`, `tiktok.md`, `youtube.md`, `threads.md`, `bluesky.md`, `reddit.md`. Add `calendar.md` if they asked for scheduling.

Show actual content previews — the hook and format for each platform. Don't just list file paths.

---

## Rules

*Updated when the user flags issues. Read before every run.*

---

## Self-Update

If the user says something's off — wrong tone, bad format, missing nuance — fix the `## Rules` section here immediately. Also log to `context/learnings.md` under `## mkt-content-repurposing`.

---

## Troubleshooting

**Source is too thin:** Under 300 words doesn't give enough to work with. Ask for more or suggest combining two pieces.
**Output sounds generic:** Probably missing brand context. Offer `/mkt-brand-voice` or ask for 2-3 sentences in their voice as a quick reference.
**Platform doesn't fit:** Don't force it. Skip platforms where their audience doesn't exist unless they specifically ask.
**Algorithm data might be outdated:** If the references are 3+ months old and search turned up nothing, say so and proceed with best available.
**They want to schedule posts:** This skill writes the content. Point them to Buffer or Hootsuite for scheduling — include optimal posting times in the output so they can plug it straight in.
