# Isometric Style

## When to Use

3D illustration for SaaS/tech carousels: agent architecture diagrams, tool stacks, workflow flows, team/process overviews. Any concept that benefits from floating modular geometry — Stripe, Linear, Notion, or Lottie animation aesthetic in static form.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Abstract system or concept rendered as 3D geometry — floating cards, layered blocks, dashboard fragments, icons on pedestals | Avoid photographic subjects entirely |
| Framing | Isometric 30-degree projection, axonometric perspective, centered or slightly off-center, 1:1 or 4:5 | Never perspective foreshortening — keep parallel lines parallel |
| Lighting | Single soft directional source from top-left, subtle ambient-occlusion shadows, no harsh specular | Clay-render diffuse look — shadows define volume without drama |
| Mood | Calm, systematic, modern SaaS confidence — Dribbble-polished but not sterile | Like documentation art for a well-funded B2B tool |
| Medium | Clay 3D render / vector illustration hybrid — smooth rounded geometry, inflated balloon forms, gradient-free fills | Rendered in Blender mental model but not realistically lit |
| Style | Stripe documentation art, Linear app onboarding, Notion illustrations, Lottie-style statics | Reference specific brand style if available |

## Model Recommendation

**Gemini** — strong in mini-test: correctly stacked 4 labeled cards with soft shadows and crimson accent. Clean and readable.

**GPT Image 2** — slightly better at following explicit geometry constraints and text on card labels.

**Recraft V3** — purpose-built for vector illustration with brand palette (`colors[]` API param). Best for production carousels.

**Best default:** Gemini for speed/cost. GPT Image 2 when card labels need to be legible.

## Example Breakdown

**Request:** "AI agent technology stack for a social carousel slide"

```
Subject: Four floating modular cards stacked diagonally — Memory, Tools, Reasoning, Output — each with a flat icon and label
Framing: 30-degree isometric projection, center-right composition, 4:5 aspect ratio
Lighting: Soft top-left directional, subtle ambient-occlusion shadows under each card
Mood: Modern SaaS, calm, systematic, Stripe-documentation energy
Medium: Clay 3D render, large border radius, inflated pill shapes, smooth shading
Style: Stripe/Linear documentation aesthetic, trending on Dribbble, off-white background
---
Aspect Ratio: 4:5
Model: Gemini
Key Details: Top card highlighted with brand-accent color, other cards in neutral ivory; clean white background; no clutter
```

**Prompt (Gemini):** Isometric 3D illustration of an AI agent technology stack visualized as four floating modular cards stacked diagonally at a 30-degree projection. Each card is labeled — Memory, Tools, Reasoning, Output — with a simple flat icon centered on the card face. The cards have a clay-render aesthetic with smooth shading and subtle ambient-occlusion shadows beneath each one. The topmost active card glows with a single crimson red accent while the others stay neutral ivory white. Soft directional top-left lighting, seamless off-white background, rounded geometry, large border radius, minimalistic Stripe documentation aesthetic. Clean composition, no clutter, vibrant yet restrained palette.

## Known Pitfalls

- "Isometric" alone produces random objects — must specify the concept and number of elements explicitly
- Labels on cards often garble with Gemini; if text accuracy is critical, use GPT Image 2 or render labels via HTML overlay
- Hard shadows make it look like product photography, not illustration — specify "soft ambient-occlusion only"
- Perspective creep: models drift to standard 3D perspective if not reinforced with "30-degree isometric projection, parallel lines"
- Color bleed: pastel palettes work better than dark palettes for this preset — dark backgrounds fight the clay-render aesthetic

## Comparison Notes (GPT vs Gemini)

- **GPT:** Better text accuracy on card labels, stronger adherence to geometry constraints; can produce messy lighting if not prompted carefully
- **Gemini:** Cleaner overall composition, natural soft shadows, occasionally labels are partially correct — inspect output
- **Verdict:** Gemini is the faster default; GPT Image 2 when label legibility is non-negotiable
