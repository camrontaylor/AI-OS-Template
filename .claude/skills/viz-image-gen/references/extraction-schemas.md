# Extraction Schemas — Image to Template

Schemas that Claude fills in when looking at a reference image during the `ref-to-template.md` flow. **It is not an external system prompt** — Claude already has vision built-in; this is just the field structure it follows when describing the ref.

Three schemas, one per case:
- **A — HTML Layout** → when the ref is typographic/structural (Stripe carousel, magazine page)
- **B — AI Prompt** → when the ref is compositional (photo, illustration, 3D scene)
- **C — Hybrid** → when there's an image background + text/UI overlaid

---

## Schema A — HTML Layout Extraction

```yaml
zones:                  # how the canvas divides top-to-bottom
  - { name, height_pct, role }   # role: top-bar | hero-stage | image-zone | body-block | footer-band
alignment:              # left | center | right (default per zone)

type_hierarchy:         # visible typographic roles (subset of _shared/styles.css)
  - role: display | h1 | h2 | h3 | body-l | body-m | body-s | caption
    rel_height_pct: <float>     # font size as % of canvas height
type_weights:           # observed weights — subset of [light, regular, medium, bold, black]
italic_accents:         # which keywords appear in italic (Fraunces WONK accent)

ornaments:              # decorative elements
  - type: vertical-rail | divider-line | dot-grid | badge | accent-bar | watermark | sketch-underline
    placement: left-edge | top | bottom | behind-headline | embedded-in-headline
    color_reference: brand-primary | brand-secondary | brand-accent | brand-accent-2

image_zone:             # full-bleed | top-half | bottom-half | framed | centered-frame | split | none
spacing_rhythm:         # tight | balanced | airy
```

### Filled-in example (Stripe-style hero)

```yaml
zones:
  - { name: top-bar,   height_pct: 8,  role: top-bar }
  - { name: stage,     height_pct: 84, role: hero-stage }
  - { name: footer,    height_pct: 8,  role: footer-band }
alignment: left

type_hierarchy:
  - { role: display, rel_height_pct: 10 }
  - { role: body-l,  rel_height_pct: 1.6 }
type_weights: [regular, bold]
italic_accents: ["verb in headline"]

ornaments:
  - { type: vertical-rail, placement: left-edge,        color_reference: brand-accent }
  - { type: watermark,     placement: behind-headline,  color_reference: brand-primary }

image_zone: none
spacing_rhythm: airy
```

From here Claude writes the `.html`, mapping each field to CSS variables. Ornaments become divs, type_hierarchy becomes classes (`.display`, `.h2`), spacing_rhythm becomes `var(--space-2xl)` vs `var(--space-md)`.

---

## Schema B — AI Prompt Extraction

Extends the **6-Element Framework** already present in viz-image-gen (Subject · Framing · Lighting · Mood · Medium · Style) by adding palette/focal_point/texture/camera/constraints.

```yaml
subject:            # 1-2 sentences about the focus (person, object, abstract scene)
environment:        # scene/context (desk, studio, outdoor, abstract space)
composition:        # close-up | medium | wide | overhead | front-facing | dutch-angle
lighting:           # natural morning | golden hour | overcast | studio | neon | candlelit
style:              # photographic | illustrative | 3D render | painterly | isometric | sketchnote
mood:               # 3-5 adjectives (calm, refined, melancholic…)
palette:            # observed colors (approximate hex — informs whether to add an accent to the brand)
focal_point:        # what draws the eye first
texture:            # matte | glossy | gritty | paper | glass | film grain
camera:             # optional — camera language (35mm, shallow DoF, telephoto…)
constraints:        # negative — what to NEVER include
```

### Filled-in example (desk-scene photo)

```yaml
subject: "Person at a wooden desk working on a laptop, hands visible but face cropped"
environment: "Sunlit home office, plants in soft-focus background"
composition: medium
lighting: natural morning, soft from window left
style: photographic
mood: [focused, calm, intentional, warm]
palette: ["#e8dcc4", "#3a2a1a", "#7a8b4d"]
focal_point: laptop screen with code visible
texture: matte paper, glass screen, polished wood
camera: 35mm, shallow DoF, slight grain
constraints: [no faces visible, no readable text on screen, no logos]
```

### The `.prompt.md` template that comes out of this

```
{{BRAND_MOOD_BLOCK}}

{subject}. {environment}. {composition} framing. {lighting} lighting.
{style} aesthetic. Mood: {mood_adjectives_joined}. {camera}.
Texture: {texture}.
Palette: predominantly {palette_first_two}, with {{BRAND_ACCENT}} as small intentional accent.
Focal point: {focal_point}.

Negative: {constraints_joined}
```

`{{BRAND_MOOD_BLOCK}}` and `{{BRAND_ACCENT}}` are substituted at runtime by the renderer with values from the user's brand_kit.

---

## Schema C — Hybrid

When the ref has an image background + text/UI overlay (Anthropic hero, podcast cover with a photo).

Fills in BOTH schemas (A and B). Produces 2 files side by side:

```
templates/<pool>/heroes/custom-X.html         ← from Schema A
templates/<pool>/heroes/custom-X.prompt.md    ← from Schema B
```

The HTML references the AI image via `{{IMAGE_HTML}}`:

```html
<div class="slide hero-hybrid">
  <div class="bg-image">{{IMAGE_HTML}}</div>   <!-- generated by the .prompt.md at runtime -->
  <div class="overlay">                         <!-- Schema A structure -->
    <h1 class="display">{{HEADLINE}}</h1>
  </div>
</div>
```

At runtime the renderer:
1. Reads the `.prompt.md` → calls AI image gen → saves temp PNG
2. Replaces `{{IMAGE_HTML}}` in the HTML with the `<img>` tag holding the PNG data URI
3. Renders via Playwright

---

## Universal rules (apply to all 3 schemas)

1. **The ref's hex never gets hardcoded into the HTML/prompt.** It goes into the `palette` field as an observation only. The output uses `var(--brand-*)` or `{{BRAND_*}}`.
2. **If the ref's `palette` has a strong color that isn't in the user's brand**, Claude asks: *"Does this color come in as Accent N in your palette, or do we ignore it?"*. If it comes in, update `brand_context/assets.md`.
3. **Constraints are critical in AI prompts.** For `HYBRID_AI` / `HYBRID_REAL` / `HYBRID_FROM_REAL`, always include the defaults: `no readable text` (text goes in the overlay), `no logos` (the logo is separate), `no faces if topic isn't about people`. **Exception — FULL_AI text-baking archetypes (`dense-infographic` / cover-framework-diagram):** do NOT include the `no readable text` constraint. Instead the prompt lists every text string explicitly and verbatim (text-capable models bake the labels into the image, and a verification gate checks them). The `no logos` / `no faces` defaults still apply unless the archetype intentionally injects a logo tile or a real headshot.
4. **Schema A type sizes are RELATIVE** (% of the canvas). The renderer converts them to px using `tokens.md → type_scale`. This guarantees the brand dominates.

---

## Provenance

Schemas consolidated from:
- **6-Element Framework** (already present in `viz-image-gen/SKILL.md`) — Subject/Framing/Lighting/Mood/Medium/Style
- **Atomic schema split** ([freestylefly/awesome-gpt-image-2](https://github.com/freestylefly/awesome-gpt-image-2)) — subject/lighting/materials/layout/palette/constraints
- **Camera language framing** ([kousen/nano-banana-skill](https://gist.github.com/kousen/f7c66a70cefe90b12c8b5285688a0016)) — composition/camera/lighting precision
- **Editorial publishing convention** — type-hierarchy/ornaments/spacing-rhythm vocabulary

The rest of the repos reviewed (langgptai/Awesome-Multimodal-Prompts, wuyoscar/gpt_image_2_skill, nidhinjs/prompt-master, elder-plinius/CL4R1T4S) did not contribute — they were forward-only or too generic.
