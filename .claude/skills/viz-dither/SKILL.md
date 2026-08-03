---
name: viz-dither
description: "Generate a cohesive 1-bit dither graphic system in any brand palette: dithered duotone portraits and avatars, animated dither background 'bleeds', seamless texture tiles, and matching hard-edged pixel icons. Self-hosted (PIL + CSS), no third-party icon dependency. Not for full photo editing, charts, or vector illustration."
when_to_use: "Invoke when the request sounds like: 'dither', 'dithered graphics', '1-bit / halftone look', 'pixel icons', 'retro dither background', 'dither the portrait', 'make the graphics dither style', 'animated dither backgrounds'. Also when a site/section wants a distinctive cohesive graphic system built from one palette."
---

# viz-dither

A dither system that reads as one thing, not scattered retro effects. Every
graphic is 1-bit, in one palette (paper + ink + accent), with no anti-aliasing.
Imagery is true ordered-Bayer dither; icons are hard-edged pixel grids. The
result is distinctive and self-hosted: no CDN, no third-party icon package, all
assets generated from code you can read.

## Outcome

- Dither PNGs (duotone portrait, face avatar, radial/linear background bleeds,
  seamless tiles) written to an assets dir, in the caller's palette.
- A pixel-icon set: `pixel-icons.js` grid data + a `PixelIcon` component.
- A drop-in `dither.css` runtime (theming vars + three ambient animations,
  reduced-motion safe).

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/voice-profile.md` | — | Not used |
| The target's design tokens (palette, fonts) | Read if present | Match `--paper/--ink/--accent` to the brand; use the brand's mono face for labels |
| `context/learnings.md` | `## viz-dither` section | Apply previous feedback before starting |

This skill was extracted from a production website hero system (2026-07-31).
The craft rules in `references/usage.md` are the lessons from four independent
design critics on that build. Read that file before generating.

## Step 0: Prereqs

Needs Python with `numpy` and `Pillow` (PIL). Check:
`python3 -c "import numpy, PIL; print('ok')"`. If missing, `pip install numpy Pillow`.

## Step 1: Pick the palette

Three hexes: a light **paper**, a dark **ink**, one **accent**. That is the whole
palette on purpose. If the target has design tokens, reuse them. The accent is
what the dither imagery is tinted with, so it carries the brand.

## Step 2: Generate assets

```bash
python3 scripts/dither.py --out <assets-dir> \
  --paper "#..." --ink "#..." --accent "#..." \
  --portrait <photo> --face-crop l,t,r,b      # omit portrait flags for bg-only
python3 scripts/pixel_icons.py --out <js-dir>
```

Review the outputs before wiring them in:
- Open `portrait-accent.png` — the face must read; if it's a black mass the
  source has a dark background (embrace it as a dark panel, or tighten the crop).
- Open `_icons-contact.png` — every glyph legible and the same optical size.
- The avatar is the usual failure: see the dot-pitch rule in `references/usage.md`.

## Step 3: Wire it in and theme

Follow `references/usage.md`. Copy `assets/dither.css` and `assets/PixelIcon.jsx`,
set the `--dither-*` vars, place bleeds in `position:relative; overflow:hidden`
containers, and add one animation class per bleed.

## Step 4: Verify (the craft floor)

Before calling it done, check `references/usage.md` §5 against the built result:
matched dot pitch, masked + anchored bleeds, integer icon cells, one optical box,
mono-caps labels, accent restraint (~10%), motion only on the background layer,
and all label/secondary text above the 4.5:1 contrast floor. Reserve dither for
imagery and backgrounds; keep icons flat 1-bit.

## Self-Update

After a real build with this skill, append a dated line to `references/usage.md`
§5 and to `context/learnings.md` (`## viz-dither`) with any new failure mode and
its fix, so the craft rules keep accreting from real work.
