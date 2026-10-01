# Visual Framework — 6-Element Prompt Construction

## The 6 Elements

### 1. Subject

What is in the image. Person, object, scene, concept. Include pose, expression, action, clothing, props.

### 2. Framing

How the camera sees it. Angle, distance, lens, crop, aspect ratio.

Options: extreme close-up, close-up, medium shot, full body, wide/environmental, bird's eye, low angle, Dutch angle, over-the-shoulder, POV.

### 3. Lighting

How light shapes the scene. Direction, quality, color, number of sources.

Options: golden hour, Rembrandt, rim light, neon, volumetric, chiaroscuro, three-point softbox, overcast/flat, hard side light, split lighting, butterfly lighting, practical/ambient.

### 4. Mood

The emotional tone.

Options: melancholic, vibrant/energetic, serene, mysterious, dramatic, nostalgic, clinical, whimsical, gritty, intimate, epic, tense, playful, elegant.

### 5. Medium

What it's made with. The physical or digital substrate.

Options: smartphone (iPhone), DSLR photograph, 35mm film, medium format, oil painting, watercolor, ink wash, digital illustration, 3D render, pencil sketch, cel animation, screen print, collage, vector, charcoal.

### 6. Style

The aesthetic school or reference.

Options: photojournalistic, editorial fashion, cinematic (Blade Runner, Fincher), anime (Ghibli, Shinkai), hyperreal fantasy, minimalist, brutalist, art nouveau, vaporwave, noir, Wes Anderson, documentary, commercial/advertising.

## Adapting Emphasis by Image Type

| Image Type | Heavy Elements | Light Elements |
|-----------|---------------|----------------|
| UGC/Influencer | Subject + Medium | Lighting (ring light default) |
| Cinematic | Lighting + Mood | Subject (secondary to atmosphere) |
| Portrait | Subject + Lighting | Medium (photo default) |
| Product | Subject + Framing | Mood (clean default) |
| Illustration | Medium + Style | Framing (flexible) |
| Typography | Subject (the text) + Style | Lighting (flat default) |

## Output Format

### Visual Breakdown (max 15 lines, shown to user for approval)

```
Subject: [what's in the image]
Framing: [camera angle, distance, lens]
Lighting: [light setup]
Mood: [emotional tone]
Medium: [physical/digital substrate]
Style: [aesthetic reference]
---
Aspect Ratio: [ratio]
Model: [GPT/Gemini + why]
Key Details: [2-3 specific details that make this unique]
```

### Image Prompt (single paragraph, every decision embedded)

After user approves the breakdown, convert it to a dense single paragraph where every framework decision is embedded as specific visual description. No vague adjectives — every word earns its place.

## Worked Examples

### Example 1: Cinematic Rain

**Request:** "A person standing alone in the rain at night in a city"

**Visual Breakdown:**
```
Subject: Solitary figure, back to camera, dark overcoat, standing still on wet pavement
Framing: Wide shot, low angle, anamorphic 2.39:1, figure occupies left third
Lighting: Neon reflections on wet ground (teal + orange), single streetlamp creating rim light on shoulders, volumetric fog catching light
Mood: Melancholic isolation, urban loneliness
Medium: Digital cinematography, Arri Alexa look
Style: Blade Runner 2049 meets Wong Kar-wai — saturated neon bleeding into rain
---
Aspect Ratio: 21:9
Model: Gemini — atmospheric scenes with volumetric light, artifact-free neon
Key Details: Rain visible as streaks in neon light, reflection of figure in puddle, fog softening background buildings
```

**Prompt:** A solitary figure in a dark overcoat stands with their back to camera on rain-slicked pavement, occupying the left third of an anamorphic 2.39:1 frame shot from low angle. Neon signs in teal and orange bleed their reflections across the wet ground. A single streetlamp creates a sharp rim light on their shoulders while volumetric fog catches and diffuses the colored light from surrounding buildings. Rain is visible as luminous streaks where it passes through the neon glow. The figure's reflection ripples in a puddle at their feet. The mood is melancholic urban isolation — a still moment in a restless city. Shot with cinematic depth and color grading reminiscent of Blade Runner 2049 meets Wong Kar-wai, rich saturated color against deep blacks.

### Example 2: Ink Wash Warrior

**Request:** "A samurai warrior in an artistic style"

**Visual Breakdown:**
```
Subject: Lone samurai mid-stride, katana sheathed, straw hat tilted down obscuring face, hakama flowing with movement
Framing: Full body, slight low angle, negative space on right suggesting journey ahead
Lighting: Diffused overcast, no harsh shadows, luminous sky behind
Mood: Stoic resolve, quiet before the storm
Medium: Sumi-e ink wash on rice paper, visible paper texture
Style: Traditional Japanese ink painting meets Takehiko Inoue (Vagabond manga)
---
Aspect Ratio: 3:4
Model: Gemini — clean artifact-free output for ink wash, strong atmospheric rendering
Key Details: Ink splatter effects suggesting wind, gradual wash from dark (figure) to light (sky), single red seal stamp in corner
```

**Prompt:** A lone samurai mid-stride rendered in traditional sumi-e ink wash on textured rice paper. Full body composition with slight low angle, negative space to the right suggesting the journey ahead. The figure wears flowing hakama caught by wind, katana sheathed at the hip, straw hat tilted to obscure the face. Ink application ranges from bold concentrated black in the figure's core to delicate gray washes dissolving into the luminous paper sky. Deliberate ink splatter effects suggest gusting wind. The mood is stoic resolve — quiet tension before action. Style references traditional Japanese ink painting crossed with Takehiko Inoue's Vagabond — expressive brushwork with disciplined composition. A single small red seal stamp sits in the lower right corner. Visible rice paper texture throughout.

### Example 3: Street Food Vendor

**Request:** "A food vendor at their stall"

**Visual Breakdown:**
```
Subject: Middle-aged vendor tossing ingredients in a wok, steam rising, colorful ingredients mid-air, weathered hands, genuine smile, apron with oil stains
Framing: Medium shot, eye-level, shallow depth of field isolating vendor from busy background
Lighting: Warm practical light from the wok's flame below + string lights above, golden hour ambient from the side
Mood: Vibrant warmth, authentic daily life, human connection to craft
Medium: DSLR photograph, 85mm f/1.4, Fuji Velvia-inspired saturation
Style: Steve McCurry documentary portraiture — vivid color, human dignity, environmental context
---
Aspect Ratio: 4:5
Model: GPT — superior skin detail, organic texture rendering, food looks appetizing
Key Details: Steam catching the warm light, bokeh string lights in background, sweat beads on forehead catching light
```

**Prompt:** A middle-aged street food vendor captured in medium shot at eye level, tossing colorful ingredients in a well-seasoned wok with practiced confidence. Steam rises dramatically, catching warm golden light from the gas flame below and string lights above. Shot at 85mm f/1.4 creating shallow depth of field that isolates the vendor from the bustling evening market behind them — string lights render as warm golden bokeh. The vendor's weathered hands move with practiced precision, their genuine smile visible despite concentration. An oil-stained apron tells years of dedicated craft. Warm practical lighting creates rich skin tones with subtle sweat beads catching light on the forehead. Fuji Velvia-inspired color saturation brings vivid warmth to the scene. The style channels Steve McCurry — documentary portraiture that honors human dignity through vivid color and environmental storytelling. Ingredients frozen mid-air in the wok add dynamic energy.

## Non-Negotiable Rules

1. **Every element must be decided before writing the prompt.** No defaults by omission — if an element isn't relevant, state why it's deemphasized.
2. **Specificity over adjectives.** "Neon teal light reflecting off wet pavement" beats "dramatic lighting." "iPhone 15 front camera, slightly below eye level" beats "selfie angle."
3. **The prompt is a single dense paragraph.** No bullet points, no labels, no structure visible to the model. Every framework decision is woven into flowing description.
4. **Show the Visual Breakdown to the user before generating.** This is the approval gate — they can adjust any element before committing to generation.
5. **Medium defines the rendering engine.** If Medium is "iPhone photograph," the model must produce something that looks shot on a phone — not a DSLR, not a render.
6. **Style is the final seasoning, not the main ingredient.** A style reference without strong Subject and Lighting decisions produces generic results.
7. **Framing controls storytelling.** The same subject at different framings tells completely different stories. Always be intentional.
8. **Mood must be felt, not stated.** Achieve mood through the other 5 elements working together, not by writing "the mood is sad."

## Progressive Prompt Building

Demonstration of how each element layers quality:

**Baseline (no framework):** "A woman drinking coffee in a cafe"

**+ Subject:** "A woman in her 30s in a cream cable-knit sweater, both hands wrapped around a ceramic mug, eyes closed in a moment of quiet pleasure, wisps of steam rising"

**+ Framing:** "Medium close-up from across the small round table, 85mm compression, shallow depth of field, the woman slightly off-center to the left with the cafe window behind her"

**+ Lighting:** "Soft winter daylight streaming through a rain-spotted window behind her, creating a gentle backlight halo on her hair and catching the steam from the mug, cool blue-gray from outside contrasting with warm amber interior light"

**+ Mood:** "Intimate solitude, the particular peacefulness of being alone in public, a stolen quiet moment"

**+ Medium:** "35mm film photograph, Kodak Portra 400, natural grain visible in the shadows, slightly lifted blacks"

**+ Style:** "Saul Leiter through-the-window intimacy, color field composition where the background becomes abstract warmth"

**Final prompt combines all six into one flowing paragraph.**
