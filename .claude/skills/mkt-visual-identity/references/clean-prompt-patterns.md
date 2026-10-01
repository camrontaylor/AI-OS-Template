# Clean-prompt patterns

When extracting a template from a ref that has a photographic background OR a non-CSS texture, Claude calls `clean_ref.py` with a prompt it writes per-ref. This file collects the prompt patterns that work, grouped by case.

The principle: be SPECIFIC about what to remove, what to preserve, and what to recolor. Vague prompts ("clean this image") regenerate from scratch and lose the user's actual material. Specific prompts produce surgical edits that preserve identity.

---

## Universal preamble (always include)

Every clean prompt should start with:

```
Edit this photograph surgically. Do NOT regenerate the composition, the subjects, the framing, or the lighting. Output dimensions: 1080×1350 (4:5 vertical). Keep all natural elements (sky, grass, skin, hair, water, wood, stone, fabric) exactly as photographed.
```

This single block prevents the model from "improving" the image. We want a faithful clone with surgical edits, not a re-imagining.

---

## Case A — Photo with text + pill overlays (most common)

**Ref signal:** photograph of a scene/person + designer added text + pill/badge on top.

Examples: <ref-name> (the figures in the ref + "<a methodology name>" + <creator-tool pill>), <ref-name> (feet in grass + "<named-concept>" headline + body text).

**Prompt template:**

```
<universal preamble>

REMOVE these designer overlays:
- Text "{exact text 1}" at approximately (x%, y%) — fill the area with the underlying scene texture (extrapolate from neighboring pixels: brick continues, sky continues, grass continues).
- Text "{exact text 2}" at approximately (x%, y%) — same treatment.
- Pill/badge with text "{pill text}" at approximately (x%, y%, w%, h%) — remove the pill shape entirely and fill with underlying scene.
- Decorative shape "{shape}" at approximately (x%, y%) — remove and fill.

PRESERVE everything else exactly:
- The {subject description, e.g. "the figures in the cleaned bg"}
- The {background description, e.g. "concrete wall behind them with subtle warm tone"}
- All shadows, lighting, depth-of-field, photographic grain

DO NOT remap colors in this prompt. Color remapping is a separate step.
```

**Why this shape works:** the model is told EXACTLY which pixels are designer-added vs photographic. It removes only what's identified, leaves the rest untouched. Listing approximate coords + the exact text helps localize.

---

## Case B — Photo with non-natural color accents to remap

**Ref signal:** photograph with a clearly non-natural color (a painted accent wall, a colored prop, a tinted strip) that needs to match the brand's accent.

Examples: <ref-name> has a warm orange wall that should become brand coral. <ref-name> (gallery) has a warm-orange wall that should adapt.

**Prompt template (run as a SECOND clean pass after Case A):**

```
<universal preamble>

REMAP these designer-chosen color regions to the brand palette:
- The {region description} at approximately (x%, y%, w%, h%) is currently {original hue} (#hex_estimate). Repaint it to {brand color name} (#brand_hex).
- The {other region} at (x%, y%, w%, h%) is currently {hue} — repaint to {brand color} (#brand_hex).

PRESERVE absolutely:
- All natural colors (sky, grass, skin tones, hair, water, wood grain, fabric texture)
- All grays, blacks, whites — DO NOT shift these even slightly
- All shadows, highlights, and lighting on the regions being repainted (preserve luminance, change only chroma)

The repaint should look like the SAME object photographed in a SAME LIGHT but painted a different color — not a digital color overlay. Maintain photographic realism.
```

**Why this shape works:** explicit "preserve grays/blacks/whites" prevents the model from accidentally tinting neutrals. Naming the color (e.g., "coral" + hex) gives both perceptual and exact anchors. Asking for "same object, different paint" guides the model toward photographic believability.

**When to combine A+B vs run them separate:**
- If overlay removal and color remap are independent regions → one prompt with both blocks.
- If they overlap (e.g., text sits on the wall that needs remapping) → two passes: A first, then B on the cleaned output.

---

## Case C — Pure texture (no photographic subject, just paper-grain or wash)

**Ref signal:** ref shows a textured solid (warm paper, gradient wash) with text on top. No people, no scene, just a canvas surface.

Examples: <ref-name> (cream paper-grain with 3 lines of type), brand-cover.jpg (similar).

**Prompt template:**

```
<universal preamble>

REMOVE all text and all graphic overlays. The result must be a CLEAN bg of just the textured surface.

PRESERVE:
- The exact texture character (paper grain, fiber direction, density of noise)
- The exact base tone (warm cream / off-white / specific shade — match the unfaded edges of the original)
- Subtle vignetting or gradient if present

The output should look like the ORIGINAL paper with the text-printed area erased — not a different paper, not a flat color.
```

**Why this shape works:** when there's nothing photographic to preserve, the prompt focuses on the TEXTURE character. Naming the texture type ("paper grain", "fiber direction") guides the model.

**Alternative:** if the texture is a SOLID color with no grain, skip clean_ref entirely and use CSS bg in the template.

---

## Case D — Photo with text "embedded" in the scene (text on a sign / chalkboard / canvas in frame)

**Ref signal:** the text isn't an OVERLAY — it's PART of the scene. A blackboard with chalk text, a billboard with painted letters, a canvas on a gallery wall with the slogan painted onto it.

Examples: <ref-name> (figure looking at a blank canvas with body text "painted" on the canvas), other ref-types with whiteboards.

**Prompt template:**

```
<universal preamble>

REMOVE the text/painting on the {surface description, e.g. "blank white canvas mounted on the gray wall"} at approximately (x%, y%, w%, h%). The result should show the {surface} as it would look IF NO ONE HAD PAINTED ON IT — a clean, blank {surface}. Preserve:
- The surface's material character (paper / canvas / chalkboard texture)
- The surface's lighting (any glare, shadow, vignette on the surface)
- The 3D mounting / framing of the surface (frame visible? hung how?)

DO NOT remove the surface itself. Just empty it.
```

**Why this shape works:** distinguishing "surface" from "content of surface" is the trick. The model has to leave the canvas/blackboard/sign and only erase what's on it. Naming the surface helps.

**Note for instructions.md:** templates with Case D refs often need `strategy: ai-edit-fallback` — because text rendered with HTML overlay on top of a 3D surface looks "stuck on top" rather than "painted on". The render then re-uses gpt-image-2 edit at runtime to PAINT the slot text onto the surface authentically.

---

## Case E — Texture that CSS can't fake (analog paper, watercolor, painterly bg)

**Ref signal:** the ref has no scene subjects, just a complex textured bg that CSS paper-grain SVG noise can't replicate.

**Prompt template:**

```
<universal preamble>

REMOVE all text. Generate a clean version of this {texture description} backdrop.

PRESERVE:
- {texture character}
- {color palette of the bg}
- {any compositional flow — e.g. "warm-to-cool gradient bottom-to-top", "vignette darker at edges"}

The output is a reusable bg asset. Output 1080×1350.
```

**When to use:** when CSS approximation would be lossy. Skip if a `linear-gradient` + `svg-noise` can be eyeballed close.

---

## Hard-won prompt-writing rules

### Rule 1 — Look at the ref's actual surface, don't assume

When the ref has a wall/floor/backdrop in a non-natural color, **describe it with a hex code, not a material name**. Saying "brick wall" when the ref is actually flat-painted concrete tells gpt-image-2 to add brick texture you don't want.

**Bad:** "Preserve the brick wall behind them"
**Good:** "Preserve the flat painted wall surface (approximately <original-wall-hex> warm orange)"

### Rule 2 — Designer-chosen colors get REPAINT, not PRESERVE

Painted walls / accent strips / pill backgrounds in non-natural colors are designer-chosen. They should be remapped to brand.accent when the user wants brand adaptation. Be EXPLICIT about it: "REPAINT the wall to <brand-accent-hex> (brand coral)" not "tint the wall".

**Bad:** "Make the wall warmer"
**Good:** "REPAINT the wall to a vertical gradient: top <brand-accent-hex>, bottom <brand-accent-darker-hex>. Preserve the paint character (subtle imperfection, photographic feel — not flat solid color)."

### Rule 3 — "EXACT positions" for human subjects

gpt-image-2 will move/replace humans freely unless told otherwise. Anchor them strictly:

**Bad:** "Two men sitting on a bench"
**Good:** "Two men sitting on the wooden bench in their EXACT positions, both at the same height on the bench, the LEFT man wearing a hat reading a newspaper, the RIGHT man without hat reading a book, both wearing dark suits. Do NOT alter their faces, postures, or relative spacing."

### Rule 4 — Two-pass when remove + recolor overlap

If the text-to-remove sits ON the surface-to-recolor, run two clean passes:
1. Pass A: remove overlays, fill with original surface
2. Pass B: recolor surface

One-shot ("remove text and recolor wall") often misses one of them.

---

## Anti-patterns (prompt mistakes to avoid)

- ❌ **"Make this look better"** — model regenerates from scratch. Lose user material.
- ❌ **"Generate a similar photo of [subject]"** — same as above, even if you describe carefully.
- ❌ **Naming the brand by name in the prompt** — "make it look like the <Brand> brand" — the model has biases. Use HEX codes and adjectives.
- ❌ **Asking for new compositional elements** — "add a logo bottom-right" — that's a second step, not part of cleaning. Keep clean prompts focused on REMOVE + RECOLOR.
- ❌ **Vague color names** — "make it warmer" — give a hex code AND a perceptual name ("coral <brand-accent-hex>").
- ❌ **Forgetting the universal preamble** — without it, the model thinks it can regenerate the whole image.

---

## Examples — full prompts for the 5 fresh-brand-test refs

### <ref-name> (paper texture + 3 lines of type)

Case C:
```
Edit this photograph surgically. Do NOT regenerate the composition, the subjects, the framing, or the lighting. Output dimensions: 1080×1350 (4:5 vertical). Keep all natural elements exactly as photographed.

REMOVE all text and all graphic overlays. The result must be a CLEAN bg of just the textured paper surface.

PRESERVE:
- The exact paper-grain texture character (fiber direction, density of noise)
- The exact warm-cream base tone (match the unfaded edges, approximately #f0e8d5)
- Subtle vignetting at the edges if present
```

### <ref-name> (feet in grass + "<named-concept>" headline + body)

Case A:
```
Edit this photograph surgically. Do NOT regenerate the composition, the subjects, the framing, or the lighting. Output dimensions: 1080×1350 (4:5 vertical). Keep all natural elements exactly as photographed.

REMOVE these designer overlays:
- Text "I fixed this by building what I call a" at approximately (20%, 12%) — fill with the underlying grass/sky texture.
- Text "<named-concept>" at approximately (20%, 18%) — fill with the underlying grass/sky.
- Text body paragraph at approximately (10%, 38%) — fill with grass/sky.
- Top masthead row text "<brand-handle>" at approximately (5%, 4%) — fill with sky.
- Bottom tagline strip at approximately (5%, 92%) — fill with grass.

PRESERVE everything else exactly:
- The boots and legs in tall green grass at the lower half
- The mountains and sky at the upper half
- The warm afternoon light, all shadows, the photographic depth-of-field

DO NOT remap colors. This ref's colors are natural.
```

### <ref-name> (the figures in the ref sitting + "<a methodology name>" + <creator-tool pill> + tagline)

Case A + Case B:

Pass 1 (overlays):
```
<universal preamble>

REMOVE these designer overlays:
- Text "may ©2026" at approximately (5%, 4%)
- Text "<brand-handle>" at approximately (45%, 4%)
- Text "creative strategist" at approximately (80%, 4%)
- Text "<short bold preamble>" at approximately (15%, 11%)
- Text "system" (large italic serif) at approximately (5%, 18%)
- Pill/badge with text "Claude" at approximately (42%, 50%, 16%, 6%) — remove the pill SHAPE entirely.
- Decorative sunburst/asterisk star at approximately (42%, 50%) — remove.
- Bottom strip with text "that makes every piece of content on-brand before you even start." at approximately (10%, 75%, 80%, 10%) — remove the strip and the text.

PRESERVE everything else exactly:
- The two men in dark suits sitting on the leather sofa
- The brick wall behind them
- The wooden bench/sofa they sit on
- All shadows, lighting, fabric texture, suit detail
```

Pass 2 (color remap, only if user wanted to swap brand color):
```
<universal preamble>

REMAP these designer-chosen color regions to the brand palette:
- The wall behind the figures appears warm-orange (<original-ref-hex>). Repaint it to coral (<brand-accent-hex>, brand.accent).

PRESERVE absolutely:
- The men, the suits, the bench, all photographic detail
- All shadows on the wall (preserve luminance)
- The wall's masonry/concrete texture
```

(If brand accent ≈ ref accent — both coral — skip Pass 2.)

### <ref-name> (gallery scene + body text on canvas + "setup" oversized)

Case D + Case A:

Pass 1 (canvas emptying + overlays):
```
<universal preamble>

REMOVE these designer overlays:
- Text body paragraph at approximately (22%, 12%, 56%, 28%) — painted onto the blank canvas on the wall. The canvas should appear BLANK after this edit.
- Text "setup" oversized (white display) at the bottom edge, approximately (5%, 85%, 90%, 12%) — remove.
- Top masthead row text at approximately (5%, 4%, 90%, 4%) — remove, restore wall.

PRESERVE everything else exactly:
- The seated figure on the wooden bench, viewed from behind
- The large rectangular canvas on the wall (frame and surface intact, just no painting on it)
- The concrete floor with subtle reflections
- The light gray wall around the canvas
- All lighting, shadows, atmosphere
```

### <ref-name> (coral wall + numbered pill "5" + headline + body + red CTA pill)

Case C:
```
Edit this photograph surgically. Do NOT regenerate the composition, the subjects, the framing, or the lighting. Output dimensions: 1080×1350 (4:5 vertical). Keep all natural elements exactly as photographed.

REMOVE all text and all graphic overlays. The result must be a CLEAN coral-painted wall surface.

PRESERVE:
- The exact coral wall color (approximately <original-ref-hex>)
- The wall's flat, slightly matte texture (no obvious grain — preserve the paint character)
- Edge vignetting if present
```

---

## How to USE this file

1. Look at your ref.
2. Identify which case it matches (A / B / C / D / E or combination).
3. Use that case's prompt template as a starting point.
4. Fill in the specifics: exact text strings, approximate bboxes, color hexes from extract_tokens.py spec.json, named subjects.
5. Call `clean_ref.py --ref X --prompt "..." --output bg.png`.
6. Read the output. If imperfect, refine the prompt (be MORE specific about what to preserve) and re-run.
