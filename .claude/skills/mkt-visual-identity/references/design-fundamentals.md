# Design Fundamentals — Universal Constraints

These are **graphic design fundamentals** that apply to EVERY template in this system, regardless of brand, ref, or pool. They are independent of any specific reference image. The measurement protocol's job is to identify how each ref EXPRESSES these fundamentals — never to invent its own.

The 5 universal pillars: **alignment**, **type scale**, **spacing rhythm**, **legibility floors**, **hierarchy contrast**.

---

## 1. Content Gutter (the universal alignment baseline)

Every template has ONE content gutter — a vertical line that ALL primary content shares as its left edge.

- **Default content gutter**: `left = 10%` (right edge `90%`, so primary content width `≤ 80%`)
- ALL of these MUST share the gutter: headline, body, badges, pills, kickers, watermarks-when-in-content-area
- Exceptions allowed for: full-bleed display words (e.g., a magazine-style word spanning canvas edge-to-edge), background photos, decorative elements that don't carry meaning

**Why this matters**: misalignment is the #1 reason a slide looks amateur. The eye reads aligned edges as intentional design; mismatched left-edges read as "thrown together". A badge at `left:7%` over a headline at `left:6%` is a 1% drift that destroys composure.

**Enforced by validator**: all primary elements must have `bbox_pct[0]` within ±0.5% of the gutter value, OR be explicitly tagged `breaks_gutter: true`.

---

## 2. Type Scale (modular ratios, not arbitrary)

Font sizes follow a **1.5× modular scale** (the Major Third — industry standard for editorial typography). Every role in a template draws from this scale:

| Role | cqw range | Use |
|---|---:|---|
| `display-massive` | 22–28 | One word that crosses the entire canvas (magazine-cover scale) |
| `display-large`   | 9–12  | Cover hero — fills most of the upper half |
| `display`         | 6–8   | Standard 2-line headline |
| `headline`        | 5     | Secondary headline, large lead paragraph |
| `body-lead`       | 4     | Primary body content (the slide's main message) |
| `body`            | 3.2–3.5 | Body paragraph (multi-line supporting text) |
| `caption`         | 2.2–2.5 | Caption, secondary info |
| `kicker`          | 1.4–1.6 | Masthead labels, uppercase tracked |

**Rule**: pick the role first, then pick within the role's range. Never set a font_size that falls BETWEEN two roles — that signals indecision and reads as noise.

---

## 3. Legibility Floors (hard — validator blocks below)

Social-feed previews compress aggressively. A "barely readable" body on a 1080×1350 desktop preview becomes **illegible** on a 300×375 LinkedIn/IG feed thumb. The floors below are empirically derived to survive feed compression.

| Role | Min cqw | Why |
|---|---:|---|
| Primary body (main message of the slide) | 3.0 | If the slide HAS a body that carries the message, ≥3.0 |
| Secondary body | 2.4 | Supplementary, OK to be quieter |
| Caption / footnote | 2.0 | Tiny but readable at thumbnail |
| Kicker / masthead label | 1.2 | These are chrome, not message — OK to be tiny |
| Display (any subtype) | 4.5 | Below this, "display" stops being display |
| Numeral inside badge | 5.5 | Badge is the highlight; the digit MUST pop |
| Single-letter / icon-only | 4.0 | Standalone glyphs need presence |

**The body floor of 3.0 cqw is the big rule.** I (the orchestrator) historically have shipped body at 2.4–2.8 cqw because it "looked OK in the desktop preview". It does NOT look OK on feed. Default body to **3.5 cqw** unless the content is explicitly supporting/caption.

---

## 4. Spacing Rhythm (base unit + multiples)

Base unit: **1 cqw** (= ~10.8 px at 1080×1350 canvas).

All vertical gaps between elements use multiples of this base:

| Gap type | Multiplier | Example use |
|---|---:|---|
| Tight stack within a group | 1× | Multi-line headline → next line of same headline |
| Within group | 2× | Two body paragraphs of the same block |
| Between groups | 3–4× | Badge → headline; headline → body |
| Section break | 6× | Major hierarchy change (cover headline → tagline pill) |
| Canvas top/bottom safe area | 3–5× | Above masthead, below tagline |

**Rule**: never use a gap that's between multipliers (e.g., 2.5×). The eye reads non-multiples as accidental.

---

## 5. Hierarchy Contrast (size + weight + color, NEVER size alone)

To establish hierarchy, use AT LEAST TWO of:

- **Size** — bigger = more important
- **Weight** — bolder = more important
- **Color contrast** — high-contrast (white on coral) = more important than low-contrast (white on textured-coral with shadow)

A headline that's only "bigger than body" reads as flat. A headline that's bigger AND bolder AND brighter-contrast pops.

**Anti-pattern**: changing only the font size between two roles. Always change at least one other axis.

---

## 6. Width Floor for Primary Content

If a primary text element occupies < 60% canvas width, it reads as a footnote, not a primary element.

- Headlines: width ≥ 60% canvas (subject to character-count fit math)
- Body: width ≥ 50% canvas (multi-line bodies can be narrower than headlines)
- Display: width ≥ 80% canvas (display is meant to dominate)

---

## 7. The Fit-Check Math (do this BEFORE setting font_size)

Before writing any text element's `font_size_cqw`, compute the required width:

```
required_width_cqw = char_count × char_width_ratio × font_size_cqw
```

If `required_width_cqw > available_width_pct`, the text WILL wrap to more lines than intended. Empirical `char_width_ratio` by font (calibrated against real renders):

| Font family / weight | Ratio |
|---|---:|
| Inter Tight 900 | 0.52 |
| Inter Tight 700 | 0.50 |
| Inter 700 | 0.55 |
| Inter 500 | 0.58 |
| Playfair Display Italic 700 | 0.48 |
| Geist Black | 0.50 |
| Generic sans (fallback) | 0.55 |

**Example**: "I never write carousel copy" = 27 chars (incl. spaces) in Inter Tight 900 (ratio 0.52).
For a single line in 86% width: max font = `86 / (27 × 0.52)` = **6.13 cqw**.
For 2 lines: split the longest line (~14 chars: "carousel copy") and recompute.

If the math says the font WON'T fit, you have two choices: smaller font, or wider bbox. Never ship a font that doesn't fit — it produces unwanted line-wraps and ruins the composition.

---

## Compliance contract

Every `_measurements.yaml` must conform to this doc OR explicitly tag each violation:

```yaml
elements:
  - id: my-headline
    bbox_pct: [7, 26, 86, 16]      # left = 7% (matches gutter)
    role: display                   # in the type scale
    font_size_cqw: 6.7              # within display range 6-8
    font_role: display-bold
    # ...

# OR if breaking a rule:
  - id: full-bleed-word
    bbox_pct: [0, 25, 100, 22]      # breaks gutter intentionally
    breaks_gutter: true              # explicit ack
    breaks_gutter_reason: "Display word spans canvas edge-to-edge per ref"
```

The validator blocks ANY unacknowledged violation.
