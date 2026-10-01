# Measurement Protocol — Phase 3.5

Before writing `template.html`, the orchestrator (Claude in chat) MUST produce a structured `_measurements.yaml` per ref. The template HTML is then a **deterministic translation** of measurements — never invented numbers.

This phase exists because vision-as-classifier (Phase 2 briefing) does not produce the geometric / typographic / silhouette data needed to write a faithful template. Without it, the orchestrator guesses bboxes and iteration cannot fix structural mistakes (only tweak cosmetic ones).

## Where it lives

`brand_context/templates/{pool}/{slug}/_measurements.yaml` — one per template, committed before `template.html`.

## What it captures

Seven blocks, in order. **A template is a PARAMETERIZED RECIPE, not a fixed render** — every element declares whether it's required, user-editable, brand-locked. The bg is itself a SLOT with substitution options.

```yaml
ref: <ref-name>.png
canvas: 1080x1350
content_gutter_left_pct: 10

# 1. Where the bg PHYSICALLY constrains the foreground
bg_occupancy:
  # Y-percentages of features in the cleaned bg.png that text must respect or interact with.
  # Use null for features that don't exist in this ref.
  figures_head_top_y_pct: null         # where heads start (for refs with people)
  figures_chest_y_pct: null
  figures_feet_y_pct: null
  texture_only: true                   # if no figures, just a textured surface
  safe_text_top_pct: 6                 # text can sit here without clashing
  safe_text_bottom_pct: 94

# 2. BG SLOT — the background is itself a replaceable slot
bg_slot:
  type: photo-replaceable | textured | gradient | solid | none
  required: true                              # template needs SOMETHING as bg
  default_source:
    path: bg.png                              # produced by clean_ref.py, used as fallback
    description: "what the default looks like — used for previews/QA"
  subject_type: person-portrait | product-shot | scene-backdrop | textured-surface | none
  substitution_options:
    - method: brand-headshot                  # | brand-product | ai-generated | user-upload | keep-default
      source_pattern: brand_context/visual-identity/headshots/*.{jpg,png}
      processing: clean_ref_multi_image       # | direct | none
      when: "brand has headshot AND post.subject == 'founder'"
    - method: ai-generated
      source: viz-image-gen
      prompt_template: "Cinematic studio portrait of {{subject}}, dark teal lighting, camera equipment visible"
      when: "user wants fresh photo per post"
    - method: keep-default
      when: "no override — use default_source.path"

# 3. Each visible foreground element — measured, parameterized
elements:
  - id: <kebab-case-id>
    type: text | pill | icon | icon-composite | mixed-line | bg-watermark
    role: masthead-left | masthead-center | masthead-right | cover-line-1 | cover-line-2 | body | tagline-pill | numeral-badge | creator-badge | ...
    content: "literal text from the ref"     # or null for icon-only — used as DEFAULT sample
    bbox_pct: [left, top, width, height]      # measured by reading the ref image
    align: left | center | right
    font_role: display-bold | display-italic | body | kicker | numeral
    color_role: text-on-dark | text-on-light | accent
    silhouette: null | round | rounded-rect | rounded-square | scalloped | hard-rect | custom-vector
    z_order: 0                                # 0 = bg layer, higher = on top
    overlaps: []                              # ids of elements this OVERLAPS

    # Typography (REQUIRED for text/mixed-line elements)
    font_size_cqw: <number>                   # DERIVED from bbox.height + observed_line_count when text wraps — see "Font-size derivation"
    line_height: <number>                     # e.g. 0.95 for display, 1.35 for body
    letter_spacing_em: <number>               # optional; affects horizontal width math
    observed_line_count: <int>                # REQUIRED when text wraps to >1 line in the ref. Count what you see.

    # NEW — parameterization flags
    required: true | false                    # template is broken without this slot filled
    user_editable: true | false               # content can be customized per post (true for most text)
    brand_locked_color: true | false          # color MUST come from --brand-* token (no hardcoded hex)
    omit_behavior: hide | placeholder | fallback-text  # what happens when required:false AND omitted

# 3. Inline-flow pairs (italic+bold sharing a line, etc.) — distinct from stacked elements
mixed_lines:
  - id: mixed-line-1
    bbox_pct: [left, top, width, height]
    align: left
    font_role: body                            # base role; spans switch role
    parts:
      - { role: display-italic, text: "I never write" }
      - { role: display-bold,   text: "carousel copy from scratch anymore." }
    # When this is present, the orchestrator MUST render a SINGLE div with inline spans,
    # NOT two separate stacked zones. This is the most-missed structural detail.

# 4. Per-element rendering route (where the pixels come from)
render_strategy:
  - element_id: <id>
    route: html-overlay | vendor-svg | ai-edit-crop | bake-into-bg
    asset_path: null                           # for vendor-svg / ai-edit-crop output
    notes: "why this route"

# 5. Overlap intents (z-stacking that the bg can't carry alone)
overlaps:
  - over: <id>     # element that sits on top
    under: <id>    # element underneath (often a bg-feature)
    depth_pct: 4   # how much overlap (e.g., descender crosses head by 4% canvas-h)
    treatment: html-z-index | bake-into-bg

# 6. COMPOSITION TECHNIQUES — visual layer between bg and text (NOT elements, properties)
# Examples: dark gradient at bottom to make text legible over photo,
# radial vignette for focal anchor, blur overlay for mood
composition_techniques:
  - id: bottom-scrim
    type: gradient-scrim                     # | radial-vignette | blur-overlay | linear-gradient
    purpose: text-legibility                 # | mood | focal-anchor | brand-accent-wash
    bbox_pct: [0, 60, 100, 40]               # where the technique sits
    css: "background: linear-gradient(transparent 0%, rgba(0,0,0,0.65) 80%);"
    z_index_between: [0, 2]                  # sits between bg (0) and text zones (2+)
    triggered_by: text_zones_in_y_range_60_to_100  # optional auto-attach condition

  - id: top-vignette
    type: radial-vignette
    purpose: focal-anchor
    bbox_pct: [0, 0, 100, 30]
    css: "background: radial-gradient(ellipse at top, rgba(0,0,0,0.3), transparent);"
    z_index_between: [0, 2]
```

## Safety constraints (HARD floor — checked by validate_measurements.py)

These exist to prevent unreadable or off-canvas output. Violations BLOCK template.html generation.

| Constraint | Value | Applies to |
|---|---:|---|
| bbox.left >= 0 AND bbox.left+bbox.width <= 100 | — | every element |
| bbox.top  >= 0 AND bbox.top+bbox.height  <= 100 | — | every element |
| min font_size_cqw — kicker / masthead | 1.2 | font_role: kicker, masthead-* |
| min font_size_cqw — body | 1.8 | font_role: body |
| min font_size_cqw — display | 4.0 | font_role: display-bold, display-italic, numeral |
| min edge distance — body / kicker | 4% | bbox.left >= 4 AND right_edge <= 96 |
| min edge distance — display | 0% | display can go full-bleed if ref shows it |
| min element height — text | 3% | text bbox.height < 3% is unreadable |
| min element height — pill / icon | 4% | pill bbox.height < 4% loses identity |
| max font_size_cqw — display | 32 | runaway sizing |
| max canvas coverage per single element | 30% area | nothing should eat the whole canvas alone |

The **floors are not creative limits — they are unreadability cliffs**. The renderer's canvas is 1080×1350. 1.8cqw at 1080px wide = ~19px, the floor for body legibility on social feed thumbnails. 4% edge distance prevents text from kissing the canvas border on every social platform's safe-area.

## How the orchestrator measures (vision-as-ruler)

Reading the ref image at full size, the orchestrator estimates each measurement by:

1. **Horizontal**: identify left-edge and right-edge of element vs canvas edges → convert to `left_pct` and `width_pct`.
2. **Vertical**: identify top and bottom of element → `top_pct` and `height_pct`.
3. **Baseline & descenders (text)**: locate the baseline (where most lowercase letters sit) and the deepest descender (`y`, `g`, `p`, `j`). Descender depth = (descender-y - baseline-y) / canvas-h.
4. **Silhouette — MANDATORY ZOOM-CROP**: for every `icon-composite`, `pill`, `icon`, or `numeral-badge`, the orchestrator MUST crop a small region containing only that element from the ref (4-8x upscale via Pillow) and inspect the resulting image BEFORE declaring `silhouette:`. Reasons: at full-canvas resolution, a scalloped/wavy edge looks identical to a rounded-square; an 8-ray icon looks identical to a 12-petal icon. The cost is one Pillow crop + one image read; the gain is catching the silhouette mistakes that pure full-canvas vision misses every time.
5. **Color role**: identify whether the element's color is the bg-dark, bg-light, or accent of THE BRAND (tokens.json), not whatever pixel-color it happens to be in this ref.

When unsure, estimate conservatively but DO STATE A NUMBER. "Around 13-15%" is wrong here; pick one. The diff phase will surface mismatches.

### Font-size derivation (REQUIRED for multi-line text — NOT estimated visually)

When a text element wraps to multiple lines in the ref, `font_size_cqw` is **DERIVED**, not eyeballed. Two independent constraints must both hold; if either fails, the bbox or line_count is wrong, not the font.

**Constraint A — Vertical fill (the previously-missing rule):**

The bbox.height + observed_line_count + line_height jointly determine the font size that fills the bbox vertically.

```
font_size_cqw = bbox.height_pct × (canvas_h_px / canvas_w_px × 100) / (observed_line_count × line_height)

For canvas 1080×1350: (1350 / 1080 × 100) = 125
    font_size_cqw = bbox.height_pct × 1.25 / (observed_line_count × line_height)
```

Worked example — cover headline observed at bbox.height=38%, 4 lines, line_height=0.95:
`font_size_cqw = 38 × 1.25 / (4 × 0.95) = 12.5cqw` ← USE THIS, do not eyeball "around 8 or 9".

**Constraint B — Horizontal fit (the existing char-count rule, kept):**

The widest expected line of content must fit inside bbox.width at the chosen font_size.

```
required_width_cqw = char_count_widest_line × char_width_ratio × font_size_cqw / bbox.width_pct × 100
   (must be ≤ 100 — i.e., the line fits)
```

Equivalently: `font_size_cqw ≤ bbox.width_pct / (char_count × char_width_ratio)`.

**`char_width_ratio` table (empirical — calibrated against real renders, NOT from font specs):**

| Font (weight, style)              | Ratio | Notes |
|---|---:|---|
| Inter Tight 900, letter-spacing -0.02em or tighter | 0.55 | Real Playwright-rendered width, NOT the spec's 0.42. Calibrated 2026-05 on cover-dark-byline-pill |
| Inter Tight 700, default spacing | 0.55 |  |
| Inter Tight 500                   | 0.58 |  |
| Inter 700 / SemiBold              | 0.56 |  |
| Inter 400 Regular                 | 0.54 |  |
| Playfair Italic                   | 0.50 |  |
| Geist Black                       | 0.52 |  |

If a brand uses a font not in this table, render a one-line sample at a known font_size_cqw and bbox.width; measure the pixel width of the rendered text; back-solve the ratio. Add the entry to this table.

**Combining the two constraints:**

1. Read the ref. Observe `bbox` (the SMALLEST rectangle containing all lines of the zone) and `observed_line_count` (count visible lines).
2. Derive `font_size_cqw` from Constraint A.
3. Verify Constraint B holds for the widest expected line.
4. If A and B disagree (font too big to fit width / font too small to fill height):
   - The MEASUREMENT is wrong, not the font. Re-look at the ref.
   - Most common error: bbox.height was overestimated (text doesn't actually reach as low as you thought) OR bbox.width was underestimated (the text extends further than you thought).
   - Adjust bbox and re-derive.
5. The derived `font_size_cqw` is what goes in `_measurements.yaml`. Do NOT round to a "nicer" number — the math is the spec.

**Vision-as-ruler still overestimates** display font-size by 20-50% when guessed directly. The fix is to MEASURE THE BBOX (containing rectangle) instead, then derive the font from math.

### Single-line height check (1-line text — coherence, not derivation)

When a text element wraps to a single line in the ref (`observed_line_count: 1`), the same formula applies but as a **coherence band** rather than a strict derivation:

```
expected_font_cqw = bbox.height_pct × 1.25 / (1 × line_height)

Tolerance: 70% ≤ actual / expected ≤ 130%
```

The band is wider (±30%) than the multi-line derivation (±15%) because a single-line bbox can carry intentional vertical whitespace — a 4% bbox holding a 3cqw label is fine even though math says ~4cqw. But when the ratio falls outside 70%-130%, the bbox and font are visibly disagreeing:

| Verdict | Trigger | What it means |
|---|---|---|
| `SINGLE_LINE_UNDERFILL` | `actual < expected × 0.70` | Font is too small for its bbox — text reads as a tiny floating footnote inside a zone sized for something larger. Classic example: cover byline at `font_size_cqw: 1.6` inside a `bbox.height: 4%` slot (expected ~4.17cqw, actual is 38% of that). The bbox promised footer-weight text; the font delivered fine-print. |
| `SINGLE_LINE_OVERFILL` | `actual > expected × 1.30` | Font is too large for its bbox — text won't fit vertically and will clip or overflow at render. The bbox was eyeballed too short. |

The fix when triggered: either raise/lower `font_size_cqw` to land inside the band, OR resize `bbox.height` to match the visual size the font actually occupies. **Exclusions:** chrome elements (`type: bg-watermark | icon | icon-composite | image-zone | pill`, `role: chrome | framed-card-border | dot-grid-corner | masthead-* | kicker`) escape this check — their visual budgets aren't height-derivation-shaped. Single-line check defaults to a warning; flip `STRICT_SINGLE_LINE_FIT = True` in `validate_measurements.py` to escalate to error.

### Alignment intent (design-intent vs raw position)

`bbox_pct` records WHERE an element IS. `alignment_intent` records WHY it's there and what would visually break if the margins changed. Required for any element/group occupying ≥10% canvas area (primary text blocks, hero images, framed cards, callout containers).

```yaml
elements:
  - id: framed-card-border
    bbox_pct: [4, 26, 92, 47]
    alignment_intent:
      vertical: center            # margin_top ≈ margin_bottom
      horizontal: center
    # ...
```

Allowed values: `top | center | bottom | floating` for vertical, `left | center | right | floating` for horizontal. Field is OPTIONAL — omit when the element has no clear anchor (e.g., a label that's positioned by its relationship to a neighbor rather than to the canvas).

**The check (validate_measurements.py):**

| Declared | Constraint | Verdict if violated |
|---|---|---|
| `vertical: center` | `\|margin_top - margin_bottom\| ≤ 3%` | `ALIGNMENT_DRIFT vertical` (ERROR) |
| `vertical: top` | `margin_top < margin_bottom` AND `margin_top < 25%` | `ALIGNMENT_DRIFT vertical` (WARNING) |
| `vertical: bottom` | `margin_bottom < margin_top` AND `margin_bottom < 25%` | `ALIGNMENT_DRIFT vertical` (WARNING) |
| `horizontal: center` | `\|margin_left - margin_right\| ≤ 3%` | `ALIGNMENT_DRIFT horizontal` (ERROR) |
| `horizontal: left` | `margin_left < margin_right` | `ALIGNMENT_DRIFT horizontal` (WARNING) |
| `horizontal: right` | `margin_right < margin_left` | `ALIGNMENT_DRIFT horizontal` (WARNING) |

`floating` skips the check entirely — use this when the element really has no canvas-level anchor (e.g., the handwritten "One click magic" label that's positioned relative to the code-line, not the canvas).

**The CTA failure mode (vertical-centering miss).** A ref showed a framed CTA card that visually appears anchored to the top of the canvas — until you measure the empty space ABOVE the frame (8%) AND the empty space BELOW (45%). The total margin is 53%, split asymmetrically only because the agent's bbox grabbed `top=8%` (correct visual top edge of frame) but never asked "given a 47% frame, where SHOULD the top be if the design intent is centered?" Answer: `(100-47)/2 = 26.5%`. The fix is `alignment_intent: {vertical: center}` — the validator computes the symmetry constraint and flags `ALIGNMENT_DRIFT` when delta > 3%. Bbox stays as the source of truth for rendering; the intent annotation makes the design contract explicit so misreads are catchable.

## Mixed-line vs stacked — the #1 missed call

If two pieces of differently-styled text share a baseline (same Y position for the bottom of x-height), they belong in `mixed_lines[]` as one entry with multi-role `parts`. If their baselines are visibly different Y's, they are separate `elements[]`.

Test: does line N end mid-word, with line N+1 continuing the same sentence? If yes → mixed-line. If line N ends with punctuation / period, and line N+1 is a new thought → stacked.

The renderer for mixed-lines produces ONE `<div>` with `<em>` and `<strong>` spans. For stacked, it produces multiple `<div class="zone">`. Picking the wrong one is structurally unfixable by bbox tweaks.

## Per-element rendering route — when html-overlay is wrong

`render_strategy[].route` rules:

| If the element is... | Route |
|---|---|
| Plain text in brand font | `html-overlay` |
| Geometric pill (round, rounded-rect, rounded-square) with text | `html-overlay` |
| Known vendor mark (Lucide icon, Anthropic Claude SVG, Tabler) **AND** pixel-test shows ≥90% match to ref | `vendor-svg` |
| Custom icon (decorative numeral pill, brand-specific sun-burst, mark with scalloped edge) | `ai-edit-crop` — `clean_ref.py` with ref-crop as input image + minimal prompt |
| Display text whose descenders MUST cross figures with shadow/light interaction the bg can't carry | `bake-into-bg` — include in `clean_ref.py` prompt with exact bbox |
| Photographic subject in the ref | (lives in `bg.png` after `clean_ref.py`) |

The `ai-edit-crop` route is the missing piece that fixes "Claude logo doesn't match" and "icon behind the 5". Both are custom icons whose pixel signature does NOT match any vendor SVG — they need ref-as-input gen.

## Diff loop (Phase 4.6)

After preview renders, the orchestrator produces `_diff.yaml`:

```yaml
ref: ref-074528.png
preview: preview.png
elements:
  - id: cover-line-2
    bbox_pct_ref:     [0, 18, 100, 24]
    bbox_pct_preview: [0, 25, 100, 22]
    delta:
      top: +7         # SHIPPED 7% too low
      height: -2
    descender_overlap_ref:     4
    descender_overlap_preview: 0
    verdict: STRUCTURAL_MISS    # descender does NOT cross figures

  # NEW — wrap fidelity check (for any text element with observed_line_count > 1)
  - id: hero-headline
    line_count_ref:     4       # what the ref shows
    line_count_preview: 3       # what the renderer produced
    bbox_pct_ref:     [10, 14, 84, 38]
    bbox_pct_preview: [10, 14, 72, 33]
    declared_font_size_cqw: 8.0
    expected_font_size_cqw: 12.5  # bbox.height × 1.25 / (4 × 0.95)
    verdict: WRAP_MISMATCH        # font too small OR bbox too wide → text wraps to fewer lines than ref
```

### Verdict taxonomy

| Verdict | Trigger | Fix |
|---|---|---|
| `COSMETIC_DRIFT` | < 2% bbox delta, line_count matches | ships with note |
| `STRUCTURAL_MISS` | descender/overlap intent broken | edit `_measurements.yaml` to fix bbox or overlap entry |
| `WRAP_MISMATCH` | `line_count_preview ≠ line_count_ref` for any text element | edit `_measurements.yaml`: re-derive `font_size_cqw` from observed bbox + line_count per Font-size derivation rule; widen/narrow bbox.width if needed |
| `FONT_SIZE_DRIFT` | `abs(declared_font_size_cqw - expected_font_size_cqw) / expected > 0.15` | `_measurements.yaml` violates the derivation formula — recompute |

`STRUCTURAL_MISS`, `WRAP_MISMATCH`, and `FONT_SIZE_DRIFT` block ship. The refinement loop edits `_measurements.yaml` if measurement was wrong, OR edits template.html if translation was wrong — never both at once.

## Post-render line-count comparison

`validate_measurements.py` only checks that the declared numbers are internally consistent — if the agent eyeballs the ref and writes `observed_line_count: 4` when there are actually 5 lines, the font/bbox/line-height math will balance against the wrong N and the validator passes. `compare_render_to_ref.py` closes that gap by actually inspecting the pixels: for every element where `type: text` and `observed_line_count` is declared, it crops the bbox from both ref.png and preview.png, Otsu-thresholds to a text mask (auto-detecting bg polarity), runs a horizontal projection, clusters contiguous active rows into lines, and compares the count to what was declared. Run it AFTER `render_template.py` produces preview.png but BEFORE accepting the template; it emits `LINE_COUNT_MISMATCH` whenever `ref_lines`, `preview_lines`, and `declared_lines` don't all agree, and exits non-zero so CI can gate on it.

```bash
uv run .claude/skills/mkt-visual-identity/scripts/compare_render_to_ref.py \
    --ref brand_context/templates/<pool>/<slug>/ref.png \
    --preview brand_context/templates/<pool>/<slug>/preview.png \
    --measurements brand_context/templates/<pool>/<slug>/_measurements.yaml \
    --output _qa-renders/<slug>-linecheck.json
```
