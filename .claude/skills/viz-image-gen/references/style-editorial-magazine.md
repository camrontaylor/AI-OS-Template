# Style — Editorial Magazine (carousel cover preset)

For: vertical 4:5 carousel covers in editorial-magazine style. Bold display typography over dramatic photography with magazine mastheads + bottom info bar.

Best for: hero slides of system-reveal / framework / opinion carousels. Vibe = "Vogue meets LinkedIn".

Model recommendation: `gpt-image-2` `quality=high` (text rendering critical).

---

## Anatomy (anchor structure)

Every editorial-magazine cover in this preset has these zones:

| Zone | Height | Contains |
|---|---|---|
| **Masthead** | top 6-8% | Date · Category · Author labels in tracked uppercase, thin sans, white/light gray |
| **Photography** | middle 70% | Full-bleed dramatic photo with duotone treatment, vintage film grain |
| **Hero typography** | overlay on photo, lower-middle | ONE massive display word filling ~40% width, bold condensed sans OR italic display serif |
| **Supporting line** | above or below hero word | Short phrase, regular weight sans, smaller |
| **Bottom bar** | bottom 12% | Solid accent-color banner with CTA / tagline in white bold sans, centered |
| **Brand badge** | corner overlay | Small circular logo element (composite in post, NOT generated) |

Palette anchor (default editorial-magazine): burnt orange `#E85D26` + deep black `#1A1A1A` + clean white `#FFFFFF`. Override via brand tokens.

---

## Single-shot template

Use when you don't need conversational iteration (one-shot API call). Fill the bracketed placeholders.

```
Create a vertical editorial magazine cover, 1080x1350 pixels, 4:5 aspect ratio.

MASTHEAD: At the very top, small uppercase text reading "[DATE]" left-aligned,
"[CATEGORY]" centered, and "[AUTHOR/BRAND]" right-aligned, all in thin
sans-serif, white or light gray.

HERO TYPOGRAPHY: The word "[HERO_WORD]" in massive bold condensed sans-serif,
filling approximately 40% of the image width. Positioned in the center-lower
third. White or cream colored with slight shadow for legibility.

SUPPORTING TEXT: Above the hero word, smaller text reading "[SUPPORTING_LINE]"
in regular weight sans-serif, white.

PHOTOGRAPHY: Behind the text, [PHOTO_DESCRIPTION — e.g., "a dramatic
high-contrast black and white silhouette of a person walking toward camera,
with warm orange duotone color grading, vintage film grain texture"].

BOTTOM BAR: A solid burnt orange (#E85D26) banner across the bottom 12% of
the image containing "[BOTTOM_TEXT]" in small white bold sans-serif, centered.

PALETTE: Burnt orange (#E85D26), deep black (#1A1A1A), clean white (#FFFFFF).
Style: Modern editorial design fused with retro photography aesthetic.
High contrast, intentional grain, premium feel.

No extra text, no additional words, no random lettering, no watermarks.
```

---

## Multi-slide consistency template

For carousels where 3-5 slides need to share the same visual system. Run as ONE conversation with gpt-image-2 — model retains layout/palette across turns.

```
I'm creating a 5-slide Instagram carousel. All slides must share:
- Same 1080x1350 format, 4:5 ratio
- Same magazine masthead layout at top (date, category, brand)
- Same burnt orange / black / white palette
- Same bold condensed sans-serif for hero text
- Same vintage editorial photography treatment (high-contrast, duotone, grain)
- Same bottom bar design

SLIDE 1 (Cover/Hook):
  Hero word: "[WORD]"
  Supporting text: "[TEXT]"
  Photo: [description]
  Bottom bar: "[TEXT]"

SLIDE 2:
  Hero word: "[WORD]"
  ...

[Continue for each slide]

Maintain identical typography style, color palette, and layout grid across
all slides. No extra text, no random lettering, no watermarks.
```

Each slide is one tool call but in the same conversation — the previous turn's image is automatically used as visual reference.

---

## Layer Method (maximum control, 4 turns)

Use when the cover is the carousel's signature slide and quality matters more than speed. Each turn refines one dimension. Costs 4× a single-shot but produces dramatically better results.

**Turn 1 — Composition (gray-tone placeholder)**
```
Create a 1080x1350 editorial layout. Divide it into zones:
- Top 8%: thin masthead bar
- Middle 70%: full-bleed photography with large text overlay
- Bottom 12%: solid color information bar
Show me the composition with placeholder gray tones.
```

**Turn 2 — Photography & mood**
```
Fill the middle zone with [specific photo description]. Apply a duotone
treatment in burnt orange and deep black. Add subtle vintage film grain.
High contrast, editorial feel.
```

**Turn 3 — Typography**
```
Add the masthead: "MAY 2026" left, "PRODUCTIVITY" center, "CREATIVE STUDIO" right.
Hero text: "[WORD]" in massive bold condensed sans-serif, white, center-lower third.
Supporting: "[LINE]" above hero in regular weight, smaller.
Bottom bar: solid #E85D26 with "[TEXT]" in white small caps, centered.
```

**Turn 4 — Polish**
```
Warm the overall tone slightly. Increase grain subtlety. Ensure all text
is crisp and fully legible. No extra text or artifacts.
```

---

## What works vs what breaks

| Works well | Breaks (avoid) |
|---|---|
| Bold headline text over photos | Specific named fonts (Helvetica, Futura) |
| Magazine masthead layouts with quoted text | Exact font matching to a brand's type system |
| Vintage/retro photography styles | Perfect logo reproduction (better to composite in Figma) |
| Burnt orange / black / warm earth palettes | More than 3 edits on same image (quality degrades) |
| Consistent multi-slide aesthetic via sequential gen | Very dense small body text (keep to headlines + one supporting line) |
| 1080x1350 carousel format, quality=high | Pixel-perfect alignment (expect ±5% drift) |
| Era-specific anchors ("1960s European film poster") | Generic descriptors like "editorial style" |

**Real limitation (TechRadar field test):** GPT Image 2 magazine layouts look real but are "completely unusable" for print production — text can't be extracted, columns can't be reflowed. For carousel covers this doesn't matter (raster output is the deliverable), but don't promise the result as press-ready InDesign source.

---

## Era / publication anchors (boost specificity)

Generic "editorial style" produces generic AI-magazine. Anchor to a specific era + publication + medium:

- `"1960s European film poster — Cahiers du Cinéma aesthetic"`
- `"1970s Time magazine cover, news-photography heavy"`
- `"1980s Esquire long-form opener with brutalist masthead"`
- `"1990s Wired tech cover — neon over gray photography"`
- `"2010s Bloomberg Businessweek — bold flat color blocks + portrait"`
- `"2020s i-D Magazine — fashion editorial collage"`
- `"Mid-century New York Times Magazine longread, b&w photojournalism"`

The brief calls this "era / medium / publication aesthetic anchor" — borrowing a known visual language is more reliable than describing a new one from scratch.

---

## API invocation (programmatic)

```python
from openai import OpenAI
client = OpenAI()

response = client.images.generate(
    model="gpt-image-2",      # latest, best text fidelity
    prompt=editorial_prompt,  # use single-shot template above
    n=1,                       # bump to 4-10 for variation pool
    size="1080x1350",
    quality="high",            # MANDATORY for text-heavy editorial
)
```

**Critical params:**
- `quality="high"` — never use `low`, text degrades visibly
- `size="1080x1350"` — exact carousel dimensions, must be ×16 multiples ≤ 3:1 ratio
- `n` — generate 4-10 candidates and filter by text accuracy first; cheaper than iterating

---

## Cross-references

- Universal GPT Image 2 text-rendering rules: `references/prompt-patterns-gpt.md`
- Model selection rationale: `references/model-selection.md`
- Sibling editorial styles: `references/style-editorial-collage.md`, `references/style-editorial-illustration.md`
- 6-element visual framework: `references/visual-framework.md`
