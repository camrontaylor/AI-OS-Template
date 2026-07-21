---
name: mkt-ugc-scripts
description: "Write short-form UGC video scripts for talking-head and avatar delivery. Not for video generation (viz-ugc-heygen), repurposing (mkt-content-repurposing), or ad copy (mkt-copywriting)."
when_to_use: 'Invoke when the request sounds like: "write a script", "UGC script", "video script for", "TikTok script", "Reels script", "write me a hook", "batch scripts", "what should I make a video about". Writes with timing cues and delivery notes'
---

# UGC Script Writing

Write scripts people actually want to watch. Every script is built for someone talking to a camera — a real person or an avatar. The goal is a script that sounds natural when spoken aloud, holds attention through the first 3 seconds, and delivers one clear idea.

## Outcome

Platform-ready scripts saved to `projects/mkt-ugc-scripts/{YYYY-MM-DD}_{batch-name}/`. Each script includes timing cues, delivery notes, on-screen text suggestions, and a hook designed for talking-head delivery.

## Context Needs

| File | Load level | Why |
|------|-----------|-----|
| `brand_context/voice-profile.md` | full | Scripts match how the brand actually talks |
| `brand_context/positioning.md` | angle only | The chosen angle shapes the script's argument |
| `brand_context/icp.md` | language section | Words and phrases the audience uses |
| `brand_context/samples.md` | tone refs | How conversational delivery should sound |
| `context/learnings.md` | `## mkt-ugc-scripts` section | What's worked, what hasn't |

Load what exists. Skip what doesn't. This skill works standalone.

## Dependencies

| Skill | Required? | What it provides | Without it |
|-------|-----------|-----------------|------------|
| `str-trending-research` | Optional | Trending topics and angles from Reddit, X, and web | User provides their own topic — no research-driven suggestions |
| `tool-humanizer` | Optional | AI pattern removal before saving | Scripts saved without humanizer pass |

## Skill Relationships

- **Upstream:** `str-trending-research` (topic angles), `mkt-brand-voice` (voice context), `mkt-icp` (audience language)
- **Downstream:** `viz-ugc-heygen` (takes finished scripts and generates avatar videos), `mkt-content-repurposing` (scripts can be atomized into text posts)

---

## Step 1: Load Context

Check `brand_context/` and load per the table above. Show a brief status:

```
Script context:
  Voice Profile     [loaded / not found]
  Positioning       [loaded / not found]
  ICP               [loaded / not found]
  Learnings         [N entries / none yet]
```

Read `context/learnings.md` → `## mkt-ugc-scripts`. Apply any previous corrections before writing.

If voice profile is missing, work with a natural conversational tone and mention that `/mkt-brand-voice` would sharpen the scripts.

## Step 2: Topic Selection

Two paths:

**Path A — User has a topic:** They tell you what to script. Confirm the core message and move to Step 3.

**Path B — Research-driven:** If the user wants ideas, or says something like "what should I make a video about":

1. Ask: "What's your niche or business area? I'll research what's trending."
2. Run `str-trending-research` on their niche (or read a recent research brief if one exists in `projects/str-trending-research/`)
3. Read `references/research-to-script.md` for the methodology on turning research into script angles
4. Present 3-5 script-worthy angles with a one-line pitch for each
5. User picks one (or combines)

Either path: confirm **one core idea** before writing. A script that tries to say two things says nothing.

## Step 3: Pick Script Format + Platform

Ask (or infer from context):

- **Platform target:** TikTok, Instagram Reels, YouTube Shorts, or multi-platform
- **Duration target:** 15s, 30s, 45s, 60s, 90s max (default: 30s)

Then read `references/script-frameworks.md` and pick the format that fits the topic:

| Topic type | Best format |
|------------|-------------|
| Teaching something | Quick Teach |
| Sharing an experience | Story Arc |
| Challenging a belief | Myth Bust / Hot Take |
| Showing results | Before/After |
| Reviewing something | "I Tried X" |
| Relating to audience | Day-in-My-Life / POV |
| Selling without selling | Problem-Agitate-Solve |
| Building trust | Testimonial / Social Proof |

Tell the user which format you're using and why. If they want a different one, switch.

## Step 4: Write the Script

Read `references/script-frameworks.md` for the chosen format's structure and `references/hook-library.md` for hook options. Before writing, read the reference script in `assets/reference-script-openclaw-loop.md` to calibrate tone — scripts should match that energy: personal experience, specific details, natural flow, no listicle structure.

**The script IS the spoken words.** Nothing else. No timestamps like `[0-3s]`, no stage directions like `[lean in]`, no `[ON SCREEN:]` annotations. The output must be directly pasteable into HeyGen or readable as a teleprompter script. Follow the scripting conventions from `viz-ugc-heygen/references/scripting-guide.md`.

**Script format:**

```
PLATFORM: [TikTok / Reels / Shorts]
DURATION: [estimated seconds]
FORMAT: [framework name]
WORD COUNT: [number]

---

The exact spoken words go here. Every sentence is what the person says out loud.

Use <break time="0.8s"/> for pauses between beats.

<break time="1.2s"/>

Continue with the next section. No labels, no annotations, no brackets.

The CTA closes the script naturally.
```

**On-screen text suggestions** go in a separate section AFTER the script body:

```
ON-SCREEN TEXT:
- [when]: [text overlay]
- [when]: [text overlay]
```

This keeps the script clean and pasteable while still providing production notes.

**Writing rules for spoken delivery:**
- 150 words per minute at natural pace — use this to estimate duration
- Sentences: 10-20 words max. No run-on sentences.
- Use contractions. "It's" not "it is". "Don't" not "do not".
- Write how people talk, not how they write. Read it aloud.
- No parenthetical asides — AI voices struggle with them
- Front-load the hook — the first sentence decides if they stay
- One idea per beat. Don't stack concepts.
- Use `<break time="Xs"/>` for pauses: 0.3-0.5s between sentences, 0.8-1.0s between sections, 1.2-1.5s for dramatic beats
- Every script ends by directing to the configured community link in bio. Vary the phrasing naturally — never repeat the same CTA across a batch.

Present the script to the user. This is a creative checkpoint — wait for their feedback before finalising.

## Step 5: Batch Mode (If Asked)

If the user wants multiple scripts:
- Write 3-5 scripts per batch
- Vary the formats across the batch (don't write 5 quick teaches)
- Each script gets the same full treatment from Step 4
- Present all scripts together for review

## Step 6: Humanizer Gate

Before saving, run all scripts through `tool-humanizer` in pipeline mode. Use `deep` mode if `brand_context/voice-profile.md` was loaded, `standard` otherwise. Only show the score summary if the delta exceeds 2 points.

Spoken scripts should score high naturally since they're already conversational — if the humanizer is changing a lot, the script probably needs a rewrite, not just pattern removal.

## Step 7: Save Output

**Always save scripts to disk.** This is not optional — every script produced by this skill gets saved as a file, every time.

Create folder: `projects/mkt-ugc-scripts/{YYYY-MM-DD}_{batch-name}/`

One file per script: `{topic-slug}_{platform}.md`

Each file contains:
1. YAML frontmatter with metadata
2. The script body (spoken words only)
3. ON-SCREEN TEXT section after a `---` divider

```yaml
---
platform: tiktok
format: personal-experience
duration_estimate: 45s
word_count: 112
topic: "the core topic"
date: YYYY-MM-DD
---

The spoken script goes here exactly as written...

---

ON-SCREEN TEXT:
- Hook: text overlay
- Mid: text overlay
- Close: text overlay
```

After saving, show actual script excerpts — not just file paths.

Suggest next steps:
- "Want to generate this as a video? I can send it to HeyGen." (→ `viz-ugc-heygen`)
- "Want more scripts on related angles?"
- "Want to repurpose this script into text posts?" (→ `mkt-content-repurposing`)

## Step 8: Collect Feedback

Ask: "How do these read? Anything feel off when you imagine saying it out loud?"

Log feedback to `context/learnings.md` → `## mkt-ugc-scripts` with date and context.

---

## Rules

- 2026-03-10: Maximum script duration is 90 seconds. Never write a script longer than 90s. Most scripts should land between 15-60s.
- 2026-03-10: Every script must end with a community CTA. The close/CTA section always directs viewers to the configured community link in bio. Use natural variations like "Link to the free community is in my bio", "Join the free community — link in bio", "I break this down deeper inside the community — link in bio". Never use the same CTA phrasing twice in a batch.
- 2026-03-10: Scripts must be the exact spoken words only — no timestamps like [0-3s], no stage directions like [lean in], no [ON SCREEN:] inline. Output must be directly pasteable into HeyGen or usable as a teleprompter. Use SSML `<break time="Xs"/>` for pauses only where a dramatic beat is needed — don't litter the script with them. Most scripts flow naturally without any. On-screen text suggestions go in a separate section after the script body.
- 2026-03-10: Scripts must sound like personal experience, not teaching or selling. Write in first person about what YOU did, what YOU switched to, what problems YOU had. Name specific tools, specific frustrations, specific results. The audience learns by overhearing your experience, not by being lectured. "I will never use X again because..." beats "Stop using X. Here's why." No promotional language, no listicle energy, no "here are 3 tips" structure unless specifically asked for. The CTA should be soft and conditional: "If you want the full breakdown, link's in my bio" not "Join the free community!"

---

## Self-Update

If the user flags an issue — wrong tone, bad pacing, unnatural hook, script too long — update the `## Rules` section immediately with the correction and today's date. Don't just log it to learnings; fix the skill so it doesn't repeat the mistake.
