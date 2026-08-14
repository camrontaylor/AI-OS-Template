# UGC Video Scripting Guide

## Speech Timing

- **150 words/minute** at 1.0x speed
- 300 words ≈ 2 minutes, 750 words ≈ 5 minutes
- Short-form social (TikTok/Reels): 75-150 words (30-60s)
- YouTube/LinkedIn: 150-450 words (1-3 min)

## Sentence Rules

- Keep sentences 10-20 words max
- Use contractions (you're, don't, here's, it's)
- Write how people talk, not how they write
- Spell out abbreviations on first mention
- No parenthetical asides — AI voices struggle with them
- No run-on sentences — they sound unnatural synthesized

## Script Structure (Social UGC)

```
HOOK (3-5s) — Pattern interrupt, question, or bold claim
CONTEXT (5-10s) — Quick setup, why this matters
BODY (15-40s) — Main content, one idea per beat
CTA (3-5s) — Clear next step
```

## Pauses (SSML)

Use `<break time="Xs"/>` for natural rhythm:

```
Here's what most people get wrong. <break time="0.8s"/>
They think more features means better product.
<break time="0.5s"/>
But that's not how it works.
<break time="1.2s"/>
Let me explain.
```

| Pause type | Duration | When to use |
|-----------|----------|-------------|
| Micro | 0.3-0.5s | Between related sentences |
| Breath | 0.5-1.0s | After greetings, before key points |
| Transition | 1.0-1.5s | Between sections/topics |
| Dramatic | 1.5-2.0s | Before reveals, after questions |

## Hook Formulas (First 3 Seconds)

- **Bold claim:** "This one trick changed everything about how I..."
- **Question:** "Want to know why 90% of people fail at...?"
- **Pattern interrupt:** "Stop scrolling. This is important."
- **Contrarian:** "Everyone's telling you to do X. They're wrong."
- **Story:** "Last week I discovered something that..."
- **Direct:** "Here's exactly how to..."

## Voice Matching

When `brand_context/voice-profile.md` exists:
- Use the vocabulary and connectors from the profile
- Match the energy level (e.g., "warm + playful" vs "authoritative + direct")
- Include the user's speech patterns (intensifiers, filler reduction, teacher voice)
- Reference `brand_context/samples.md` for rhythm and phrasing

## Common Mistakes

- **Too formal:** "I would like to present to you" → "Let me show you"
- **Too wordy:** 30+ word sentences → Split into 2-3 shorter ones
- **No pauses:** Wall of text → Add breaks every 2-3 sentences
- **Weak hooks:** Starting with "Hi, today I'm going to..." → Start with the value
- **No CTA:** Ending without direction → Always tell them what to do next
- **Jargon:** Technical terms without context → Explain or replace

## Platform-Specific Scripting

### TikTok / Reels / Shorts (15-60s)
- Hook MUST land in first 1.5 seconds
- One idea only — no tangents
- Speed: 1.0-1.1x feels natural
- End with a loop-friendly phrase or question

### YouTube (1-5 min)
- Hook in first 5 seconds, preview in first 15
- Can be more detailed — multiple beats OK
- Speed: 0.95-1.0x for clarity
- Transitions between sections need verbal signposting

### LinkedIn (30-90s)
- Professional but not corporate
- Lead with insight or data
- Speed: 0.95-1.0x
- CTA: comment, follow, or DM

## Read-Aloud Test

Before generating, read the script out loud:
- Does it sound like something a person would actually say?
- Are there tongue-twister combinations?
- Do the pauses feel natural?
- Is the word count within platform limits?
