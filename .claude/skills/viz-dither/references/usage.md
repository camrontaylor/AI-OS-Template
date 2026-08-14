# viz-dither — usage and craft rules

The whole point is one cohesive 1-bit look: dither imagery + pixel icons, in
one palette, no anti-aliasing. Get the craft rules right or it reads as broken.

## The system, in one line

- **Imagery** = true dither PNGs: a duotone portrait, a small face avatar,
  radial/linear gradient "bleeds" for atmosphere, seamless density tiles.
- **Icons** = hard-edged pixel-grid SVG (`<PixelIcon>`), one weight, one grid.
- **Palette** = paper + ink + accent ONLY. No third colour. No smoothing.

## 1. Generate assets

```bash
python3 scripts/dither.py --out ./public/dither \
  --paper "#FAF9F7" --ink "#0F0F0F" --accent "#E5532A" \
  --portrait ./photo.jpg --face-crop 160,150,460,450
python3 scripts/pixel_icons.py --out ./src/dither
```

`--face-crop l,t,r,b` is the square box around the face for the avatar. Omit
`--portrait` (or pass `--no-portrait`) to make backgrounds only.

## 2. Wire it in

- Copy `assets/dither.css` into the project; override the `:root` `--dither-*`
  vars to theme. If you change the hex, regenerate the PNGs to match.
- Copy `assets/PixelIcon.jsx` (React) next to the generated `pixel-icons.js`.
  Non-React: render each `[x,y]` cell as a 1x1 `<rect>` in a 12-viewBox SVG.

```jsx
// Background atmosphere — container MUST be position:relative; overflow:hidden
<section style={{ position: 'relative', overflow: 'hidden' }}>
  <div className="dither-bleed dither-bleed--tr dither-bleed--masked dither-anim-drift">
    <img src="/dither/grad-accent-radial.png" alt="" aria-hidden="true" />
  </div>
  ...content (give it position:relative; z-index:1 so it sits above)...
</section>

// Duotone portrait
<img className="dither-img" src="/dither/portrait-accent.png" alt="..." />

// Pixel icon (size in multiples of 12)
<PixelIcon name="mail" size={24} className="pixel-icon--accent" />
```

## 3. Colour

- One accent, used with restraint (~10% of the surface). A full-bleed accent
  duotone portrait is a strong focal moment; do not also flood the section
  with accent bleeds + accent chips + accent buttons around it.
- Accent as **small text** fails contrast. Use `--dither-accent-ink` (a darker
  cut of the accent) for anything small and coloured; the vivid accent is for
  large display type and the dither imagery only.
- Secondary/label text: use a muted ink (>=4.5:1 on paper), never a soft grey
  that drops below the contrast floor.

## 4. Animation

Three ambient options on the bleeds, one slow authored moment each:
`dither-anim-drift` (scale + slight rotate), `dither-anim-breathe`
(scale + opacity), `dither-anim-rotate` (very slow full turn). Tune speed with
`--dither-drift-dur`. All are disabled under `prefers-reduced-motion`. Never
put motion on more than the background layer — a jittering foreground reads as
broken, not crafted.

## 5. Craft rules (learned the hard way)

- **Match dot pitch across assets.** Portrait, avatar, and bleeds must show a
  similar dot size (~2px displayed). The avatar is the trap: generate it near
  its display size at an integer scale, never a big PNG downscaled 5x, or it
  moires. A tiny avatar also needs a tight face crop and >=40 dots to read.
- **Mask the bleeds.** A radial dither PNG is a square; without a radial mask
  (or reliance on the asset's own density falloff) its corners read as a hard
  block. Use `dither-bleed--masked`.
- **Anchor the bleeds.** The bleed's container must be `position: relative`
  (plus `overflow: hidden` to clip). Otherwise the absolute bleed resolves
  against a distant ancestor and lands in the wrong place/size.
- **Integer icon cells.** Render `<PixelIcon>` at a multiple of 12 (24, 36).
  Non-integer sizes make `crispEdges` snap cells to uneven widths.
- **One optical box for icons.** Fit every glyph to ~10 of the 12 cells so
  they read at the same visual size in a row.
- **Labels as mono caps.** Stat/label text in the mono face, uppercase, tight
  tracking keeps the structural voice consistent with the 1-bit imagery.
- **Never dither tiny icons.** Dithering a 24px icon fights its own pixel grid.
  Keep icons flat 1-bit; reserve dither for imagery and backgrounds.
- **2026-08-03 — protect average coverage, not only peaks.** A moving field can
  keep its approved maximum density while spending too long in sparse phases.
  Add a low-frequency, noise-shaped coverage shelf inside the existing peak cap
  so the correction applies globally without darkening dots or becoming uniform.
- **2026-08-04 — use one post-composite control for tiny global lifts.** When
  the approved composition only needs to read slightly more clearly, raise the
  final alpha multiplier instead of retuning density or individual layer ink.
  This keeps colour ratios, motion, coverage, pointer behaviour, and copy masks
  intact across every route.
