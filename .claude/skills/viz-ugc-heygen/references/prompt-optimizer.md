# Video Agent Prompt Optimizer

For use with `generate_video_agent` — the one-shot prompt-to-video endpoint.

## Core Principle

Video Agent interprets prompts like an HTML renderer. Describe B-roll as **layered text motion graphics with action verbs** — not layout specs.

## Prompt Structure

```
1. FORMAT & TONE — Duration, vibe, reference style
2. AVATAR — Appearance, wardrobe, setting (60-100 words)
3. VISUAL STYLE — Colors (hex), typography, motion feel
4. ON-SCREEN TEXT — Every stat/quote that must appear literally
5. SCENE BREAKDOWN — Alternate A-roll/B-roll/overlay scenes
6. VOICEOVER — Script for every scene including B-roll
7. MUSIC — Genre, tempo, reference tracks
```

## Scene Types

| Type | What it is | Rules |
|------|-----------|-------|
| A-Roll | Avatar speaks to camera | Primary delivery |
| B-Roll | Motion graphics only | Min 10-15 seconds, 4+ animated layers |
| A-Roll + Overlay | Split frame: avatar + content | Good for showing while telling |

**Mandatory:** Never use the same type 3+ times in a row. Rotate.

## Motion Vocabulary (What Works)

Use action verbs that describe animation:
- SLAMS into frame
- CASCADES down the screen
- COUNTS UP from 0 to 10,000
- PULSES with each beat
- SPLITS into columns
- FLOODS the background

**What fails:** Layout coordinates ("upper-left"), position specs, references without concrete descriptions.

## B-Roll Layering (5 Levels)

```
L1: Background — gradient, texture, or slow pan
L2: Primary content — headline, key stat
L3: Supporting data — secondary text, labels
L4: Motion accent — lines, particles, shapes
L5: Transition element — wipe, dissolve setup
```

Every B-roll scene needs 4+ layers with motion. Static B-roll looks broken.

## Duration Guidelines

- B-roll scenes: minimum 10 seconds (under 5 looks rushed)
- A-roll scenes: match script length (~150 words/min)
- Total: aim for prompt-specified duration ±10%

## Visual Style Presets (Top Performers)

### Deconstructed
Raw, editorial, Emigre-magazine energy. Overlapping text, exposed grids, brutalist motion.

### Swiss Pulse
Clean grids, Helvetica, minimal palette. Data animates with precision. Best for reports and analysis.

### Carnival
Maximum energy. Massive text, rapid cuts, saturated colors. Best for social ads.

## Avatar Description Template

```
[Name] appears as a [age-range] [gender] [professional role].
They wear [specific outfit details matching content context].
Setting: [environment description with lighting].
Energy: [calm/confident/enthusiastic/authoritative].
They speak directly to camera with [specific manner].
```

## Quick Template: Social UGC

```
FORMAT: [30/60]s vertical UGC-style video, [casual/professional] energy

AVATAR: [avatar_id]. Wearing [outfit]. [Setting]. Speaking directly
to camera, natural and conversational.

VISUAL STYLE: Clean, minimal. Text appears as bold overlays on key
points. [Brand colors if available].

SCRIPT:
[Hook - 3s]
[Body - main content]
[CTA - 3s]

CAPTIONS: Bold white text, dark semi-transparent background.
MUSIC: [Lo-fi/upbeat/corporate] background, low volume.
```

## Common Prompt Mistakes

1. **No visual direction** → Agent picks random styles
2. **Bullet-point content** → Write as narrative, not lists
3. **No on-screen text specified** → Key stats won't appear
4. **Style reference without specs** → "Make it look like Apple" fails. Describe the actual colors, fonts, motion.
5. **Too short B-roll** → Under 5s looks glitchy
