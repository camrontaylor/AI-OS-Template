# Gemini Image — Prompt Patterns & Templates

Patterns tested against Gemini 3 Pro Image (Nano Banana Pro) and Gemini 2.5 Flash. Use these as building blocks.

---

## Core Prompt Structure

Gemini responds best to **narrative descriptive paragraphs**, not keyword lists. Describe scenes in natural language with context and intent.

**Five-component framework:**
1. **Style** — photograph, watercolor, illustration, 3D render
2. **Subject** — who/what, appearance, clothing, pose
3. **Setting** — location, environment, atmosphere
4. **Action** — what is happening
5. **Composition** — framing, camera angle, close-up vs wide

**Provide context and intent.** Explaining *purpose* improves results: "Create a logo for a high-end, minimalist skincare brand" outperforms "Create a logo."

**Sweet spot:** 80-250 words of clear descriptive prose.

---

## Text Rendering

Gemini has strong text rendering (best-in-class for Nano Banana Pro), but follow these rules:

1. **Enclose text in quotation marks:** `Create a neon sign that says "The Daily Grind"`
2. **Specify font style explicitly:** "bold sans-serif font", "flowing Brush Script", "heavy Impact font"
3. **Multi-line text:** Specify each line's styling separately
4. **Keep text short:** Works reliably for labels, headings, signage. Long passages may have errors.
5. **Generate text concepts first:** Describe what text you want conversationally, then ask for the image

**Text template:**
```
Create a [design type] with the text "[exact text]" in a [font style] font.
[Layout/positioning]. [Color scheme]. [Background].
```

Example: "Create a modern minimalist poster with 'GLOW' in flowing Brush Script at the top, '10% OFF' in heavy Impact font centered, and 'Your First Order' in thin Century Gothic at the bottom. Black and gold color scheme on a dark background."

---

## Semantic Positive Framing

Gemini does **not** support negative prompts. Instead, use positive framing:

| Instead of | Use |
|-----------|-----|
| "no cars in the street" | "an empty, deserted street with no signs of traffic" |
| "no people" | "a completely deserted landscape with no human presence" |
| "don't add text" | "clean image with no text or labels" |
| "no background" | "isolated on a clean white background" |

Describe what you *want* to see, not what to avoid.

---

## Templates by Use Case

### Photorealistic Scene
```
A photorealistic [shot type] of [subject doing action] in [environment].
[Lighting description — specific, not vague]. [Mood/atmosphere].
Shot on [camera/lens details — e.g., 85mm portrait lens with shallow depth of field].
The scene feels [emotional quality — contemplative, energetic, serene].
```

Example: "A photorealistic close-up portrait of an elderly Japanese ceramicist inspecting a freshly glazed tea bowl in a traditional workshop. Soft golden hour light streaming through paper screens. Contemplative mood. Shot on 85mm portrait lens with shallow depth of field."

### Editorial Illustration
```
Create an editorial illustration for [purpose/publication].
The scene shows [specific visual metaphor or concept].
The style should feel like a modern magazine illustration — clean lines,
a limited palette of [2-3 colors], with subtle texture.
The composition leaves space on the [side] for text overlay.
Soft, even lighting. [Aspect ratio].
```

### Lifestyle Photography
```
A candid photograph of [person description] in [setting].
They are [action], looking [direction/expression].
The environment feels [mood] with [atmospheric details].
Golden hour light streams through [source], creating warm highlights
and soft shadows across the scene. Shot on 35mm film, slightly warm
color grade, natural bokeh in the background.
The image feels lived-in and authentic, not posed.
```

### Product Mockup
```
High-resolution, studio-lit product photograph of [product description].
[Surface/background — e.g., brushed concrete, marble slab].
Three-point softbox lighting setup.
[Camera angle] showcasing [key features]. Sharp focus on [detail].
Clean, professional, suitable for e-commerce listing.
```

### Conversational Editing
```
Using the provided image, [add/remove/modify] only the [specific element]
to [new description]. Keep everything else unchanged.
```

### Character Consistency (multi-image)
```
[First image — full character description]:
A [character description with face shape, hair, clothing, color palette, art style].

[Subsequent images]:
The same character from the previous image, maintaining identical face,
[clothing description], proportions, and color palette.
Now [new scene/action description].
```

---

## Camera & Composition Language

Gemini responds well to photographic terminology:

- **Framing:** wide-angle shot, macro shot, close-up, medium shot
- **Lens:** 85mm portrait lens, 50mm standard, 24mm wide, 35mm film
- **Angle:** eye-level, low-angle, high-angle, Dutch angle, bird's-eye, worm's-eye
- **Focus:** shallow depth of field, deep focus, tilt-shift
- **Composition:** rule of thirds, centered, asymmetric, leading lines

---

## Style Transfer

Provide a reference image plus transformation instructions:

```
Transform this photograph into [target style].
Maintain the original composition, subject positioning, and lighting direction.
Apply [specific style characteristics — brushstrokes, color palette, line quality].
```

---

## Advanced Techniques

### Thinking Levels
Set `thinking_level` to "High" for complex compositions requiring deeper spatial reasoning. Default is minimal. Higher thinking = better results but more latency and cost.

### Reference Image Consistency
Upload reference images and assign distinct names to characters for visual continuity across scenes. Pro supports up to 6 objects + 5 characters.

### Batch Variations
Request "multiple variations" or "different color palettes" in a single prompt for comparison.

---

## Known Quirks

- **No transparent backgrounds:** Gemini does not support transparency. Use white or specified solid backgrounds.
- **Long text passages:** May have spelling errors or phantom characters. Keep text short and deliberate.
- **Facial detail at distance:** Small faces in wide shots may lack detail. Use closer framing for faces.
- **Day-to-night changes:** Lighting transformations may look unnatural. Better to generate fresh than edit.
- **Character drift:** Features may drift after many edits. Restart with a detailed description if consistency drops.
