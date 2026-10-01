# Default Moves (Neutral Identity)

The three universal moves that the neutral default ships with. Each implements one or more of the 10 universal principles in `references/design-principles.md`. When the user provides references, brand-specific moves replace these.

The `ssc-designer` Step 7.8 audit (specifically `7.8.6_repetition` and `7.8.10_functional_decoration`) reads this file. The audit passes when ≥2 moves from the catalog appear on EVERY content slide.

## Move 1 — Canvas margins (80px)

**What it is:** every slide reserves 80px on all four sides as the canvas margin. No content touches the edge.

**Why:** consistent margins signal "this is part of a series, not a standalone slide". Reads as composed, not chaotic. Implements **principle 6 (repetition)** and **principle 7 (alignment)**.

**Where the value lives:** `tokens.json → spacing.canvas_padding` (80).

**When it breaks:** when a hero uses `image_zone: full-bleed` the image extends to the edges but the **headline overlay** still respects the 80px margin.

## Move 2 — Page indicator (mono caption, bottom-right)

**What it is:** small monospace caption in the bottom-right corner showing `02 · 06` (current slide · total slides).

**Why:** orients the reader within the carousel; consistent placement reads as "this is slide N of a series". Implements **principle 6 (repetition)** and **principle 8 (proximity)** — the indicator stays in a single, predictable corner.

**Visual recipe:**
- Font: Geist Mono, 22px, `letter-spacing: 0.18em`, `text-transform: uppercase`
- Color: `text_muted` (#6c6a64) on light backgrounds, `text_on_dark` at 70% opacity on dark
- Position: `bottom: 24px; right: 24px;` (anchors against the canvas margin)

## Move 3 — Accent bar (6px, single use per slide)

**What it is:** a 6px-thick band in the `accent` color, used exactly once per slide to mark the one bold element.

**Why:** implements **principle 9 (one bold move per slide)**. The bar is functional, not decorative — it always abuts the slide's anchor element (eyebrow tag, oversized numeral, or pull quote).

**Visual recipe:**
- Color: `colors.accent` (#e25a45 in default)
- Length: matches the width of the element it anchors (eyebrow tag width, or 120-200px standalone)
- Position: directly above the eyebrow tag, OR to the left of an oversized numeral, OR below a pull quote

**When NOT to use:** if a slide already uses the accent color elsewhere (mark, button, callout), the accent bar is omitted — otherwise two bold moves compete.

## Universal hardcoded constants (apply regardless of brand)

These are not "moves" — they are baselines every brand inherits:

- **Type sizes** never go below the floor in `references/output-formats.md` (display ≥90px, h1 ≥68px, body ≥28px for linkedin-carousel).
- **Whitespace** stays between 30% and 65% of the canvas (principle 3).
- **Layering** — every slide has ≥2 z-index levels (principle 4). Even when the visual is pure typography, the page indicator and accent bar count as a second layer.

When the user adds references, these baselines do not change. The brand-specific moves layer on top of them.
