# GPT Image — Prompt Patterns & Templates

Patterns tested against gpt-image-1 and gpt-image-2. Use these as building blocks when constructing prompts.

---

## Core Prompt Structure

GPT weights earlier words more heavily. Use this order:

```
Background/scene → Subject → Key details → Style → Constraints
```

For complex requests, use labeled segments:

```
Background: [environment description]
Subject: [main subject with specific details]
Key details: [materials, textures, colors, typography]
Style: [visual medium, artistic style, lighting, mood]
Constraints: [what to exclude, what to preserve]
```

**Sweet spot:** 80-250 words. Over 300 risks incoherence.

---

## Text Rendering (GPT's strength)

GPT Image 2 reaches ~99% text accuracy when text is quoted. Best practices:

1. **Quote exact text:** `Include the text "WEEKLY PLAN" centered at the top` — quoted strings hit ~99%, unquoted descriptions ~70%
2. **Specify typography:** `bold sans-serif, white, 72pt, centered at top` (can't name specific fonts like "Helvetica" — style descriptors only)
3. **Spell brand names letter-by-letter** for tricky/unusual words: `"ZEITGEIST" (Z-E-I-T-G-E-I-S-T)` bumps accuracy from ~95% to ~99%
4. **Demand verbatim:** `Include ONLY this text (verbatim): 'Fresh and clean' — no extra characters`
5. **Use quality="high"** for ANY text-heavy editorial — `low`/`medium` visibly degrades small text and kerning
6. **Add rendering cues:** `sharp text rendering, clean kerning`

### The Anti-Text Directive (MANDATORY for text-controlled outputs)

Without it: ~60% of GPT Image 2 outputs contain random extra text (placeholder Latin, fake byline numbers, scattered words in the background).
With it: <10% leakage.

Always append this exact phrase (or equivalent) to any prompt that controls text placement:

```
No extra text, no additional words, no random lettering, no watermarks.
```

For posters/covers with intentional empty zones, expand: *"No filler text, no placeholder Latin, no fake page numbers, no signatures."*

### Text template:
```
[Scene description].
Include the exact text "[YOUR TEXT]" in [font style], [color], [size],
positioned [placement]. Sharp text rendering, clean kerning.
No extra text, no additional words, no random lettering, no watermarks.
```

### The Layer Method (conversational construction)

For complex text-heavy outputs (posters, magazine covers, multi-zone layouts), build images in **4 conversational turns** instead of one monolithic prompt — gpt-image-2's conversation memory carries each layer forward:

1. **Composition** — establish zones with placeholder gray tones (no photo, no text yet)
2. **Photography / mood** — fill the visual zones, apply color treatment
3. **Typography** — drop in the exact quoted text in the exact zones
4. **Polish** — refine grain, warmth, atmosphere, verify text legibility

Each turn is one tool call; the previous output stays as visual reference. Worth the 4× cost when the slide is the carousel's signature.

---

## Anti-Slop Rules

Replace vague words with visual specifics:

| Instead of | Use |
|-----------|-----|
| "stunning" | "overcast daylight with soft shadows" |
| "beautiful" | "warm golden tones, shallow depth of field" |
| "masterpiece" | "brushed aluminum surface, matte finish" |
| "minimalist brutalist editorial" | "cream background, heavy black condensed sans serif, asymmetric type block, generous negative space" |
| "professional" | "studio three-point softbox lighting, clean white background" |

**One revision per iteration.** Small targeted edits beat massive combined rewrites.

---

## Templates by Use Case

### Photorealistic Portrait
```
Background: [environment with specific lighting].
Subject: [person description — age, features, clothing, expression].
Key details: [skin texture, visible pores, natural imperfections].
Shot on [camera/film type], [framing] at eye level, [lens mm].
Lighting: [specific lighting setup]. Shallow depth of field.
Style: honest, unposed. No glamorization or retouching.
```

### Product Photography
```
Background: [surface/backdrop color and material].
Subject: professional product photograph of [product with material details].
Key details: [specific textures — brushed aluminum, matte finish, visible grain].
Studio lighting with soft key light from upper left, subtle fill right.
Subtle contact shadow. Crisp silhouette, no halos or fringing.
Style: commercial product shot. Label text must remain legible.
```

### Marketing / Social Media
```
Background: [color or scene].
Subject: [creative concept for target audience].
Include the exact tagline "[TAGLINE]" in [typography specs].
Key details: [layout description, visual hierarchy].
Style: [tasteful/energetic/polished]. Aspect ratio [ratio].
Constraints: no watermarks, no extra text beyond specified copy.
```

### UI Mockup
```
Background: [device frame or browser chrome].
Subject: screenshot of a [platform] app showing [screen/function].
Key details: [layout — sidebar, cards, navigation]. Typography: [font], [hierarchy].
Color scheme: [primary], [secondary], [accent].
Style: realistic UI, shipped production quality, proper spacing.
Include the text "[Header]" and "[Button Label]".
```

### Infographic
```
Background: white, clean.
Subject: infographic about [topic].
Title: "[TITLE]" in bold sans-serif at top.
Key details: [sections with icons, bullets, numbered steps].
Color palette: [2-3 colors]. Generous whitespace. Readable labels.
Style: clean, professional, suitable for presentations.
quality="high"
```

### Brand Logo Exploration
```
Subject: original logo for "[BRAND NAME]", a [business type].
Key details: clean vector-like shapes, strong silhouette, balanced negative space.
The word "[BRAND NAME]" appears below the icon in [font style].
Color: [guidance]. White background.
Style: [2-3 adjectives: warm, modern, timeless].
Constraints: no gradients, no photorealism. Clean and reproducible.
```

### Image Editing (three-sentence pattern)
```
Change: [exactly what should change].
Preserve: [face, identity, pose, lighting, framing, background, geometry, text, layout].
Physical realism: [match scale, shadow pattern, color temperature to existing scene].
```

---

## Photorealism Activators

Include one of these to trigger photorealistic mode:
- `photorealistic`
- `real photograph`
- `taken on a real camera`
- `professional photography`
- `iPhone photo`
- `shot on [specific camera]`

---

## Known Quirks

- **Warm color bias:** GPT tends toward warm/yellow tint. Counter with "cool color temperature" or "neutral white balance" if needed.
- **Over-sharpening:** Can produce overly crisp edges. Add "natural, organic edges" if results look artificial.
- **Hand/pose issues:** Human poses and hands can still be inconsistent. Be explicit about pose details.
- **Spatial positioning:** Unreliable for precise pixel-level placement. Use relative terms ("top-third", "centered") rather than exact coordinates.
- **Object counting:** Hit-or-miss. Specify exact counts and verify output.
- **No prompt rewriting:** Unlike DALL-E 3, GPT follows your prompt literally. Be explicit about style — there's no `vivid`/`natural` toggle.
