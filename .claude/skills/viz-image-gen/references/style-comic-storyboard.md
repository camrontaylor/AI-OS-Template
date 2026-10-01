# Comic / Storyboard Style

(Upgraded version of the original "comic" preset)

## When to Use

Sequential narratives, step-by-step processes told as stories, before/after journeys, user journey visualization, pitch deck storytelling, storyboarding for video, tutorial sequences, narrative marketing.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Characters and environments in sequential panels telling a story — simple expressive figures, clear action in each panel, speech bubbles or narrative captions | Each panel = one clear moment |
| Framing | Multi-panel grid (3-6 panels), consistent panel sizes OR dramatic size variation for emphasis, clear left-right/top-bottom reading order | Panel layout IS pacing |
| Lighting | Simplified — flat fills with minimal shadow OR strong noir-style contrast for dramatic comics. Shadow serves mood not realism | Keep lighting simple to maintain readability |
| Mood | Varies with story — humorous (loose, bouncy lines), dramatic (heavy blacks, tight frames), educational (clear, open, friendly) | Line quality conveys mood as much as content |
| Medium | Black ink on white paper (default), can add single accent color for emphasis, clean linework with variation in weight for depth | Ink is the medium — pen quality matters |
| Style | Newspaper strip (4-panel, simple), indie comic (detailed, personal), manga (dynamic, speed lines), graphic novel (cinematic, atmospheric) | Name the comic tradition |

## Model Recommendation

**Either works well** — true tie for comic/storyboard work.

- **GPT:** Better at consistent character design across panels, more reliable speech bubble text, cleaner panel borders
- **Gemini:** More dynamic line quality, better at conveying motion and energy, more natural ink variation
- **For text-heavy comics (speech bubbles):** GPT
- **For action/motion comics:** Gemini
- **Default to GPT** for consistent multi-panel narratives

## Example Breakdown

**Request:** "3-panel comic showing someone's morning routine going wrong"

```
Subject: Simple character (stick-figure-plus level — expressive face, basic body) in 3 sequential moments: (1) alarm clock ringing, person reaching groggily, (2) coffee mug tipping over on laptop keyboard, (3) person standing in rain without umbrella, looking defeated. Speech/thought elements in each panel.
Framing: 3 equal panels in horizontal strip (3:1 aspect ratio), consistent simple backgrounds (bedroom, kitchen, outdoors), clear panel borders with small gutters
Lighting: Flat, minimal — single shadow under characters for grounding, no complex lighting
Mood: Relatable comedy, "we've all been there" commiseration, escalating misfortune played for laughs
Medium: Black ink on white paper, medium line weight (consistent), small spots of black fill for emphasis (alarm clock, coffee, rain clouds). No color.
Style: Newspaper comic strip — simple, efficient, readable. Calvin and Hobbes clarity meets XKCD simplicity. Every line earns its place.
---
Aspect Ratio: 3:1
Model: GPT (consistent character across panels + speech bubble text)
Key Details: Character face must be recognizable across all 3 panels (same hairstyle, basic features), escalating visual density from panel 1 (simple) to panel 3 (busy with rain lines), sound effects ("BEEP BEEP", "SPLASH", rain drops)
```

**Prompt:** A three-panel horizontal comic strip in 3:1 format, black ink on white paper with clean panel borders and small gutters between panels. A simple but expressive character (round head, basic body, distinctive messy bed hair maintained across all panels) experiences an escalating bad morning. Panel 1: The character reaches groggily from under covers toward a ringing alarm clock, "BEEP BEEP" in bold jagged letters above the clock, eyes still closed, simple bedroom background with minimal detail. Panel 2: In the kitchen, a coffee mug tips dramatically onto a laptop keyboard, "SPLASH" rendered in dynamic dripping letters, the character's face showing shock with wide eyes and open mouth, coffee arcing through the air. Panel 3: The character stands in heavy rain without an umbrella, drawn with many vertical rain lines filling the background, shoulders slumped in defeat, a small thought bubble containing a single storm cloud. Line weight is medium and consistent, with small areas of solid black fill (the alarm clock face, the coffee, the rain clouds). Style is clean newspaper comic strip — Calvin and Hobbes clarity, every line earns its place. No color, no gray tones, purely black and white.

## Known Pitfalls

- Character consistency across panels is the #1 challenge — define 2-3 distinctive features (hairstyle, glasses, specific clothing) and specify they persist
- Speech bubble text must be short (3-5 words max per bubble) or it will render incorrectly
- Panel borders: specify "clean borders with gutters" or panels bleed into each other
- Reading order: always specify "left to right, top to bottom" flow explicitly
- "Comic style" alone is meaningless — specify the comic tradition (newspaper strip vs manga vs graphic novel)
- Sound effects work better than dialogue for maintaining text accuracy

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** More consistent character design across panels, better speech bubble text, cleaner borders, more predictable layout
- **Gemini:** More dynamic line energy, better motion/speed lines, ink variation feels more natural, slightly less consistent character between panels
- **Verdict:** True tie — GPT for narrative consistency, Gemini for dynamic energy. Default GPT for multi-panel work where character consistency matters.
