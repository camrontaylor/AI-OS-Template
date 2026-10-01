# Social Design Style — Professional Ad Composition Archetypes

## When to Use

Agency-quality social media ad compositions. Use when the post needs design-aware visuals — split layouts, visual metaphors, editorial portraits, conceptual substitutions, or structured graphic design — rather than a generic photorealistic background. Inspired by fintech, agency, and personal-brand social campaigns.

Key constraint (HYBRID_AI / HYBRID_REAL): **AI never renders text or typography in the image.** All text is added via the HTML template layer. Only composition, subjects, and design elements are generated. (Exception: `FULL_AI` mode — see eligibility rules below.)

---

## Composition Density Recipe

**Every archetype prompt in this file is written to ~150–250 words to produce agency-quality output.** Prompts under ~100 words produce generic-photo results. The recipe is:

1. **Opener** — `"Premium agency-quality social media advertising poster composition, vertical 4:5 format."`
2. **Background** — solid brand color OR color-blocked using 2 brand colors (primary + secondary/accent), often with organic blob shapes.
3. **5–7 numbered layered elements**, each on its own line:
   - (1) Atmosphere/lighting element behind the subject (radial glow, gradient, vignette)
   - (2) Hero subject (person, object, scene) — specific, expressive, brand-tinted clothing where applicable
   - (3) Archetype-defining prop (smartphone mockup, billboard, machine, canvas, pedestal, etc.)
   - (4) **UI/badge elements** — empty pill shapes, abstract notification cards with avatar circles + UI bars (no readable text), floating chat bubbles
   - (5) **Accent decorative shapes** in `[{brand_accent}]` — 4-point sparkles, plus signs, small stars, circle outlines
   - (6) **Topic-related floating icons** — currency symbols for fintech, geometric icons for tech, contextual objects
   - (7) Atmospheric particles or subtle background dots
4. **Clear zone declaration** — `"the lower 30–40% of the canvas is intentionally clear and subject-free — reserved for text overlay"`
5. **Lighting/focus** — `"Sharp focus on subject, soft drop shadows on all floating elements"`
6. **Style reference** — name a finishing aesthetic (Nomba/Revolut for fintech, The New Yorker for portraits, etc.)
7. **No-text guard** — end with `"No readable text anywhere in the frame — not on the subject's clothing, not on any UI element, not in the background, not as a brand name or logo. The brand name '{brand_name}' is metadata only, never to be rendered visually. Use abstract UI bars / avatar circles / shape outlines for all interface elements."` This stronger guard prevents brand-name leakage that occurs when the brand tokens block mentions a name.

**Brand color rule:** if `brand_accent` is missing in the kit, derive a tonal complement (yellow primary → pink-magenta accent; blue primary → orange accent; dark → bright accent).

### Agnostic & Variability Patterns

**Why:** this skill serves users at many different companies generating many different posts. Hardcoded demographics ("person in their 20s-30s with wide smile") and fixed counts ("6 badges, 3 sparkles") produce template-y output where every post by every user looks alike. Use these patterns to keep structure while letting details vary naturally.

| Replace fixed value | With menu-style spec |
|---|---|
| Specific age/look — "person in their 20s-30s with brown hair" | `"a person matching the brand audience (age, gender, ethnicity, styling appropriate to the brand mood and post topic)"` |
| Fixed expression — "wide genuine smile" | `"natural authentic expression appropriate to the post tone (confident / curious / contemplative / energetic — choose to match)"` |
| Fixed clothing — "beige blazer over white shirt" | `"[brand-tinted clothing] in a style fitting the brand context (smart casual / corporate / creative / streetwear — choose)"` |
| Fixed count — "6 pill badges, 3 sparkles" | `"5–7 pill badges, 2–4 accent shapes — vary count per generation"` |
| Fixed accent list — "a sparkle, a plus sign, a circle outline" | `"pick any 3–4 from: 4-point sparkles, plus signs, circle outlines, small stars, abstract dots, diamond marks, tiny doodle scribbles, micro-asterisks"` |
| Fixed prop choice — "vintage typewriter" | `"a vintage typewriter OR retro dot-matrix printer OR mechanical stamp machine OR label-maker — pick one"` |
| Fixed setting — "modern office desk" | `"a working environment fitting the brand context (modern office / home office / café / co-working / studio — pick)"` |

**Rule of thumb:** if a detail is **identity-defining for the archetype** (e.g., billboard for archetype 03, suspended object for 23), keep it fixed. If a detail is **about who/where/with-what**, express it as a menu. The structural skeleton stays — the flesh varies.

When the agent (Step 5.5a) builds the final prompt, it does NOT pre-resolve the menus — it leaves them in the prompt so the image model picks one per generation. This is intentional.

---

## FULL_AI Eligibility & Sanitization

`FULL_AI` mode bakes the headline text directly into the AI image. The agent (Step 5.6) checks these conditions before upgrading to `FULL_AI`:

**Eligibility:**
- Archetype must have a `FULL_AI text pattern` block in its archetype entry below (currently: 03, 05, 09, 17, 20, 23)
- Headline must be ≤ 8 words AND ≤ 60 characters
- Headline must not contain em-dashes, en-dashes, curly quotes, ellipses, or HTML entities (sanitize to plain ASCII punctuation first)
- For carousels: only the FRONT slide (slide 1) is eligible. Content slides always use `HYBRID_AI` for cross-slide typographic consistency.

**Sanitization (applied to `{HEADLINE}` before insertion):**
1. Replace em-dash (—) / en-dash (–) with hyphen-minus (-)
2. Replace curly quotes (" " ' ') with straight quotes (" ')
3. Replace ellipsis (…) with three periods (...)
4. Strip HTML entities (`&amp;` → `&`, `&nbsp;` → space)
5. Collapse multiple spaces
6. If anything outside basic Latin / Latin-1 supplement remains that the model has historically struggled with, fall back to `HYBRID_AI`

If any check fails: fall back to `HYBRID_AI` and log the reason in the slide's `.log.md`.

---

## Archetype Selection Decision Matrix

Analyze the post's `caption` and select the archetype whose trigger best matches.

| Post Characteristic | Best Archetype | ID |
|---|---|---|
| Product / app / digital service launch | Dynamic Digital Showcase | 01 |
| Calls out a specific role/demographic ("CEOs", "Freelancers") | Demographic Megaphone | 02 |
| Bold opinion, manifesto, industry statement | Public Structure (Billboard) | 03 |
| Pain point: feeling stuck, wrong tool, imposter | Surreal Substitution | 04 |
| Methodology, framework, or step-by-step reveal | Analog Reveal (Typewriter) | 05 |
| Personal brand authority, founder introduction | Typographic Interlock Portrait | 06 |
| Transformation, before/after, shift in perspective | Contrast Portal | 07 |
| "Do one thing" insight, minimalist focus message | Asymmetrical Anchor | 08 |
| Nostalgia, outdated industry practice, archive | Macro Archive Container | 09 |
| Heavy challenge, overwhelming burden, overload | Exaggerated Burden | 10 |
| Strategy, roadmap, navigating complexity | Overhead Environment Map | 11 |
| Core principle, key tool, single hero concept | Elevated Artifact | 12 |
| Process with multiple benefits, ecosystem explanation | Node Network Flow | 13 |
| Trust, guarantees, security, risk reduction | Translucent Trust Interface | 14 |
| 24/7 access, convenience, "always there" message | Cinematic Illumination | 15 |
| Myth-busting, "it's not magic, it's strategy" | Illusionist Metaphor | 16 |
| Comparison: do this vs that, prioritization | Archive Filing System | 17 |
| Deep relatable pain, emotional scene, frustration | High-Conflict Scene | 18 |
| Luxury, exclusivity, whispered secret, premium | Intimate Macro Detail | 19 |
| Strong stance, protest, manifesto | Walking Canvas | 20 |
| Decision-making, giving permission, green/red light | Urban Signal Metaphor | 21 |
| Identity loss, burnout, "are you really you?" | Identity Block | 22 |
| Culture, environment, subtle long-term effect | Suspended Object | 23 |
| Formula, system, variables, matrix | Matrix Grid | 24 |
| Authentic journey, behind-the-scenes, milestones | Documented Reflection | 25 |
| Data security, legal protection, cybersecurity | Armor Interface | 26 |
| All-in-one solution, total control, dashboard | Command Center Dashboard | 27 |

**Fallback:** no clear match → archetype **02** for people-forward content, **03** for opinion content.

---

## Render Mode × Archetype Decision Table

**This table is the single source of truth for Step 5.6's render-mode upgrade decision.** Each row shows the default mode and what triggers an upgrade.

`R` = upgrade to `HYBRID_REAL` if `brand_context/visual_refs/` has photos AND the post topic plausibly maps to user photography.
`F` = upgrade to `FULL_AI` if eligibility checks pass (headline ≤ 8 words, ≤ 60 chars, sanitized clean, FRONT slide only for carousels).

| ID | Archetype | Default | `R`? | `F`? |
|---|---|---|---|---|
| 01 | Digital Showcase | HYBRID_AI | — | — |
| 02 | Demographic Megaphone | HYBRID_AI | — | — |
| 03 | Billboard | HYBRID_AI | — | **F** |
| 04 | Surreal Substitution | HYBRID_AI | — | — |
| 05 | Analog Reveal | HYBRID_AI | — | **F** |
| 06 | Editorial Portrait | HYBRID_AI | **R** | — |
| 07 | Contrast Portal | HYBRID_AI | — | — |
| 08 | Asymmetrical Anchor | HYBRID_AI | — | — |
| 09 | Archive Container | HYBRID_AI | — | **F** |
| 10 | Exaggerated Burden | HYBRID_AI | — | — |
| 11 | Overhead Map | HYBRID_AI | — | — |
| 12 | Elevated Artifact | HYBRID_AI | — | — |
| 13 | Node Network | HYBRID_AI | — | — |
| 14 | Translucent Trust | HYBRID_AI | **R** | — |
| 15 | Cinematic Illumination | HYBRID_AI | — | — |
| 16 | Illusionist Metaphor | HYBRID_AI | — | — |
| 17 | Archive Filing | HYBRID_AI | — | **F** |
| 18 | High-Conflict Scene | HYBRID_AI | **R** | — |
| 19 | Intimate Macro | HYBRID_AI | — | — |
| 20 | Walking Canvas | HYBRID_AI | — | **F** |
| 21 | Urban Signal | HYBRID_AI | — | — |
| 22 | Identity Block | HYBRID_AI | — | — |
| 23 | Suspended Object | HYBRID_AI | — | **F** |
| 24 | Matrix Grid | HYBRID_AI | — | — |
| 25 | Documented Reflection | HYBRID_AI | **R** | — |
| 26 | Armor Interface | HYBRID_AI | — | — |
| 27 | Command Center | HYBRID_AI | **R** | — |

If both `R` and `F` were eligible, `HYBRID_REAL` takes precedence (real photo > AI text bake).

---

## Archetype Library

Each block contains everything the agent needs to execute the archetype: meta, composition prompt, and (if applicable) FULL_AI text pattern.

`[{brand_primary}]` / `[{brand_secondary}]` / `[{brand_accent}]` are placeholders replaced by the agent with hex values from `brand_kit`.

---

### 01 — Dynamic Digital Showcase

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (product/UI detail) |

**Composition prompt:**
```
Premium agency-quality fintech advertising poster composition, vertical 4:5. Background: vibrant solid [{brand_primary}] with subtle organic blob shapes in [{brand_secondary}] filling about 25-35% of the canvas in one or two opposing corners (lower-left + upper-right, OR upper-left + lower-right). Multiple layered design elements: (1) cutout photograph of a person matching the brand audience (age, gender, ethnicity, styling appropriate to brand mood and post topic) in [brand-tinted clothing], holding or interacting with a modern smartphone or product at chest level — pose can be: looking at the phone with quiet satisfaction OR showing the phone toward camera OR mid-tap engagement (pick to match post tone), positioned center-left or center-right at chest-up framing; (2) the held device screen displays a clean abstract UI relevant to the product type — balance area, list items, dashboard tiles, or status panels, all shown as abstract bars and shapes (no readable text), with a subtle confirmation indicator in [{brand_accent}] or green; (3) one or two floating secondary device or product mockups (large smartphone, tablet, app card, or product unit) at slight perspective angles in the empty quadrant, showing similar abstract UI; (4) 2-4 small floating circular badges with topic-relevant abstract symbols (currency / arrow / checkmark / cart / heart / star) in [{brand_accent}] on white or transparent circles, count varies per generation; (5) 1-3 small abstract notification cards in white with rounded corners — each with avatar circle + 2 short UI bars + small accent indicator, no readable text, scattered loosely around the main device; (6) any 3-5 floating accents from: 4-point sparkles, plus signs, small dots, tiny stars, abstract doodle marks (vary mix and count); (7) subtle background gradient or particle dust adding atmospheric depth. The lower 25-35% of the canvas is intentionally clear and subject-free for text overlay. Bright even studio lighting on subject, color temperature matching brand mood (warm for friendly brands, cool for tech/security brands). Sharp focus on subject, soft drop shadows on floating elements. Production-grade fintech/SaaS advertising aesthetic. No readable text, no logos, no typography labels.
```

---

### 02 — Demographic Megaphone

| Field | Value |
|---|---|
| Image zone | `bottom-half` |
| Default mode | `HYBRID_AI` |
| Model | GPT (composition density) — Gemini acceptable |

**Composition prompt:**
```
Premium agency-quality social media advertising poster composition, vertical 4:5. Vibrant solid [{brand_primary}] background filling the entire canvas with subtle grain texture. Multiple layered design elements creating poster-like depth: (1) behind the central subject, a large soft white-to-transparent radial gradient glow acting as a spotlight; (2) cutout photograph of a person matching the brand audience (age, gender, ethnicity, styling appropriate to the brand mood and post topic) with natural authentic expression appropriate to the post tone — confident / curious / energetic / contemplative (pick to match the headline), positioned center-right at chest-up framing, wearing [brand-tinted clothing] in a style fitting the brand context; (3) 5-7 horizontally-oriented pill-shaped badge UI elements with thin white borders and subtle drop shadows, empty inside, floating at varying heights and depths — some larger and closer, some smaller and further (vary count per generation); (4) any 3-4 small floating decorative accents from: 4-point sparkles, plus signs, circle outlines, small stars, abstract dots, diamond marks — in [{brand_accent}] color, scattered around the subject; (5) 1-2 small white rounded notification cards floating near the subject (no text inside, just an abstract avatar circle and 2 short horizontal lines suggesting message UI); (6) subtle small floating particles in the background for atmosphere — white dots, micro-sparkles, or tiny accent flecks. The lower 35-45% of the canvas is intentionally clear and subject-free — reserved for text overlay. Natural professional studio lighting on the subject's face, color temperature matching brand mood. Sharp focus on subject, soft drop shadows on all floating elements. Production-grade social media advertising aesthetic, agency-quality finish. No readable text, no logos, no typography labels.
```

---

### 03 — Public Structure / Billboard

| Field | Value |
|---|---|
| Image zone | `boxed-center` |
| Default mode | `HYBRID_AI` (upgradable to `FULL_AI`) |
| Model | GPT for FULL_AI text fidelity; Gemini for HYBRID atmospheric |

**Composition prompt (HYBRID_AI):**
```
Premium agency-quality outdoor advertising photograph, vertical 4:5. Hyper-realistic outdoor scene with cinematic composition. Layered design elements: (1) expansive sky filling the upper 60% — deep blue with warm sunset gradient toward the horizon OR golden hour with soft pink-orange clouds; (2) ground/roadside environment in the lower third — tall yellow-green grass, distant treeline, hint of a road or pathway; (3) in the center, a large dominant retro billboard structure or vintage roadside sign on a sturdy metal pole, slightly angle-perspective for depth, weathered metal frame with realistic rivets and paint chips; (4) the billboard face is completely blank, clean, light-cream painted surface — no artwork, no lettering, no marks, ready for text overlay; (5) one small subtle accent — a bird silhouette in the sky OR a small lens flare from the sun angle, in [{brand_accent}] tonal area; (6) atmospheric depth with subtle haze near the horizon, fine film grain. Warm natural light from the side, long realistic shadows from the billboard structure. Cinematic 24mm wide establishing shot, sharp focus on billboard, soft natural background. Production-grade outdoor advertising photography. No text, no content on the billboard face, no logos anywhere.
```

**FULL_AI text pattern** (replaces the no-text guard when render_mode is FULL_AI):
```
The billboard face displays this exact text in solid bold black sans-serif lettering: "{HEADLINE}". The text is centered on the billboard, all caps, taking approximately 60% of the billboard width, sharp, legible, professionally typeset, with high contrast against the white billboard surface. Spell every letter exactly as written. No other text, no logos, no marks anywhere else in the frame.
```

---

### 04 — Surreal Substitution

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (precise surreal replacement) |

**Composition prompt:**
```
Premium agency-quality surreal conceptual photography composition, vertical 4:5. High-contrast vibrant solid [{brand_primary}] background with subtle grain texture, optionally with a soft blob shape in [{brand_secondary}] occupying one corner about 20%. Layered elements: (1) a person in professional business-casual attire, photographed from chest-up or three-quarter view, engaged in a typical work activity (at a desk, holding a phone, gesturing) — body fully photorealistic and natural; (2) the person's head OR a key prop they're holding has been surreally replaced by an oversized, completely unrelated natural or inanimate object — a large watermelon, a granite boulder, a vintage CRT TV set, a cactus, a brick wall — fitting exactly where the head/prop would be, at natural scale with realistic lighting and shadow continuity; (3) 2–3 small floating accent shapes in [{brand_accent}] — a tiny exclamation mark, a thought bubble outline, a small sparkle — placed near the surreal element; (4) one small contextual prop or background element hinting at the topic (laptop with abstract bars on the screen, a coffee cup, a small plant); (5) subtle atmospheric particles in the background. The right or left side of the frame has clear negative space for text overlay. Even studio lighting, sharp focus on both the human body and the surreal object, soft drop shadows on floating accents. No text, no labels, no readable typography anywhere.
```

---

### 05 — Analog Reveal / Typewriter

| Field | Value |
|---|---|
| Image zone | `boxed-center` |
| Default mode | `HYBRID_AI` (upgradable to `FULL_AI`) |
| Model | GPT (texture detail) |

**Composition prompt (HYBRID_AI):**
```
Premium agency-quality product photography composition, vertical 4:5. Solid bright [{brand_primary}] background or warm off-white cream with subtle texture, optionally with a [{brand_secondary}] soft blob in one corner. Layered elements: (1) at the bottom center, a realistic vintage typewriter, retro dot-matrix printer, or mechanical stamp/label machine, well-lit and anchored to the lower edge, with visible mechanical detail (keys, rollers, levers) and slight wear/patina; (2) emerging vertically upward from the machine: a crisp blank white sheet of paper or document, completely clean — no text printed on it, paper has natural fiber texture and a subtle crease where it bends from the roller; (3) 2–3 small decorative accent shapes in [{brand_accent}] floating around the machine — a tiny sparkle, a plus sign, a small dot trail — suggesting motion of the emerging paper; (4) one or two scattered "punched out" paper chads or dust particles in the air near the machine for authenticity; (5) soft overhead studio lighting with one warm side-light revealing texture on the machine and paper. The paper fills the center upper portion of the frame for text overlay. Sharp focus on machine and paper, soft drop shadow grounding the machine. Clean, elegant, nostalgic editorial product aesthetic. No text on the paper, no text anywhere in the frame.
```

**FULL_AI text pattern:**
```
The paper emerging from the machine shows these exact words typed in classic typewriter monospace font, in black ink on white paper: "{HEADLINE}". The text is centered on the visible portion of the page, naturally typed with subtle ink imperfection and slight character variation, clearly legible. Spell every letter exactly as written. No other text, no marks elsewhere.
```

---

### 06 — Typographic Interlock Portrait

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` (upgradable to `HYBRID_REAL` for personal brand) |
| Model | GPT (portrait quality and moody lighting) |

**Composition prompt:**
```
Premium editorial fashion magazine cover composition, vertical 4:5. Dark deep-charcoal [{brand_primary}] background with rich shadows. Layered elements: (1) single subject — a confident professional person matching the brand context (age, gender, ethnicity, styling appropriate to brand mood — from established authority figure to emerging creative, choose to fit) with expression appropriate to the post tone (calm intensity / quiet authority / introspective focus / warm assurance — pick one), positioned center-right or center-left at chest-up framing, wearing dark monochrome attire in a tone slightly darker than the background creating subtle separation, in a style fitting brand context (tailored blazer / casual knit / minimalist tee — choose); (2) dramatic Rembrandt split lighting from upper-side, creating one sharp lit side of the face and one deeply shadowed side; (3) a single warm or cool rim light catching hair edge and cheekbone (warm for friendly brands, cool for premium/tech brands); (4) the opposite 30-40% of the frame is in deep rich shadow fading to pure black at the edges — negative space for text overlay; (5) one small floating editorial accent in the upper opposite corner — any of: a thin horizontal hairline in [{brand_accent}], a small geometric mark, a tiny serif glyph silhouette — about 6–8% of frame width, suggesting magazine masthead; (6) extremely subtle film grain texture across the entire image; (7) faint vignette in corners + atmospheric color depth. Sharp focus on the face, extremely shallow depth of field. Photorealistic DSLR with 85mm portrait lens, visible skin texture preserved (no over-smoothing — natural pores, fine lines, authentic skin tone). The New Yorker / Vogue / Wallpaper editorial cover aesthetic. No text, no readable logos, no typography.
```

---

### 07 — Contrast Portal

| Field | Value |
|---|---|
| Image zone | `boxed-center` |
| Default mode | `HYBRID_AI` |
| Model | Gemini (atmospheric outdoor expansiveness) |

**Composition prompt:**
```
Premium agency-quality architectural photography composition, vertical 4:5. Layered elements: (1) strong dark foreground framing — inside a shadowy old stone room, dark hallway, or industrial space; rich textured dark walls in [{brand_primary}] or near-black charcoal, dark floor visible at the bottom, partial ceiling shadow at top; (2) the foreground takes up approximately 40% of the frame with deep cinematic shadows; (3) centered in the frame, an open window, doorway, or archway aperture roughly 50% of the canvas dimensions, with realistic frame detail (wooden window frame, stone arch, industrial doorway); (4) through the aperture: a brilliantly bright sunlit landscape — golden field with tall yellow grass, expansive ocean horizon, sunlit forest, or open blue sky with soft clouds — high exposure, vibrant warm colors, dreamy atmospheric depth; (5) a thin warm light edge spilling into the dark room from the aperture, with visible dust motes catching the light; (6) one small contextual silhouette element in or near the doorway — a bird mid-flight, a stray leaf — in [{brand_accent}] tonal area for color punctuation. Cinematic 24mm wide architectural lens, high dynamic range, the dark/light contrast is extreme and intentional. The bright inner aperture is the focal point where text will overlay. No people, no readable text, no signage, no logos.
```

---

### 08 — Asymmetrical Anchor

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (minimal composition control) |

**Composition prompt:**
```
Premium agency-quality minimalist editorial product composition, vertical 4:5. Layered elements: (1) muted desaturated solid background — light grey, warm cream, or soft [{brand_secondary}] — filling the full canvas with extremely generous negative space; (2) a single simple iconic conceptual object — a ceramic coffee cup, a lone wooden chair, a vintage brass key, a single coin, a small folded letter, a slim leather notebook — positioned aggressively off-center: pushed to the extreme left or right edge, cropped so only 30–50% of the object is visible at the frame edge; (3) the opposite 60–70% of the frame is completely empty, minimal, and distraction-free for text overlay; (4) a single thin shadow under the object grounding it to the surface, very subtle; (5) one tiny accent decorative element in [{brand_accent}] — a small dot, a 4-point sparkle, or a barely-visible horizontal hairline — placed in the empty negative space about a third of the way from the edge to add intentional asymmetric balance without filling the space; (6) extremely subtle film grain texture across the entire image. Flat studio lighting with a soft top-light, no harsh shadows. The cropped edge of the object creates compositional tension — magazine-cover quality minimalism, Kinfolk / Cereal / Apartamento editorial aesthetic. No text anywhere.
```

---

### 09 — Macro Archive Container

| Field | Value |
|---|---|
| Image zone | `boxed-center` |
| Default mode | `HYBRID_AI` (upgradable to `FULL_AI`) |
| Model | GPT (macro texture fidelity) |

**Composition prompt (HYBRID_AI):**
```
Premium agency-quality macro product photography composition, vertical 4:5. Layered elements: (1) extreme macro close-up of a retro physical archive medium filling the entire frame edge to edge — a 3.5-inch floppy disk with textured plastic shell and metallic slider, a cassette tape with visible reels and chrome screws, a manila shipping tag on a brown twine string, a Polaroid photo with thick white border, OR a vintage 5x3 index card with subtle fiber paper texture; (2) background visible at the edges of the object — solid [{brand_primary}] vibrant color or [{brand_secondary}] soft pastel — with subtle gradient or grain texture; (3) the label area, sticker surface, or white border of the object is completely blank and clean — no text, no writing, no stickers — with slightly worn aged paper texture, light age spots, subtle creases at the corners; (4) 2 small floating decorative accents in [{brand_accent}] — a small sparkle, a tiny 4-point star, a plus sign — scattered near the object suggesting authenticity-meets-design; (5) warm tungsten macro lighting from one side revealing fine surface texture, with a soft fall-off shadow on the opposite side; (6) tiny dust motes or paper particles in the air for tactile realism. DSLR 100mm macro lens, very shallow depth of field with sharp focus on the label area. No text, no labels, no markings anywhere in frame.
```

**FULL_AI text pattern:**
```
The label area of the archive object shows these exact words written in handwritten black permanent marker: "{HEADLINE}". The text is centered on the label, all caps, with the natural imperfection of marker ink on paper — slight bleed, hand-drawn letter variation, clearly legible against the cream label background. Spell every letter exactly as written. No other text, no stickers, no marks elsewhere on the object.
```

---

### 10 — Exaggerated Burden

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (precise surreal scale) |

**Composition prompt:**
```
Premium agency-quality surreal conceptual advertising composition, vertical 4:5. Vibrant solid [{brand_primary}] background with subtle grain texture, or split-color background with [{brand_secondary}] occupying about 15-25% of one corner as a soft blob. Layered elements: (1) a person matching the brand audience (age, gender, ethnicity, styling appropriate to brand context) in attire fitting brand mood (smart casual / corporate / creative — choose), in a typical workplace posture — seated at a minimal modern desk with a laptop OR standing in a professional context OR walking briskly mid-task (pick to match topic), with hunched, weary, or strained posture as if feeling invisible weight; (2) directly above the person's head or shoulders, floating or physically pressing down: a comically oversized massive element — any of: a giant rough granite boulder / an enormous dark storm cloud with visible volume / an absurdly huge pile of papers / a massive anvil / a giant ticking clock / an oversized backpack / a giant stack of bricks — that defies logical scale at 3–5× the size of the person (pick the element most relevant to the post topic); (3) the massive element has realistic gravity-correct lighting matching the scene, with dramatic cast shadow falling onto the person and surroundings; (4) 2–4 small floating decorative accents in [{brand_accent}] — pick from: small sweat-drop icons, tiny exclamation symbols, stress lines, motion arcs, micro-sparkles — positioned near the person's head; (5) the upper area above the massive element has subtle atmosphere — floating debris particles, dust motes, or stray confetti; (6) 1–2 small contextual props on the desk hinting at the topic (laptop screen with abstract dashboard bars, coffee cup, notebook, phone, scattered papers — pick what fits). The composition is centered with the massive element dominating the upper-center. No text, no labels, no readable typography anywhere. High-energy conceptual photography with vivid color contrast, sharp focus on both the person and the massive object.
```

---

### 11 — Overhead Environment Map

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | Gemini (aerial texture and complexity) |

**Composition prompt:**
```
Premium agency-quality aerial conceptual photography composition, vertical 4:5. Layered elements: (1) overhead drone-perspective or isometric bird's-eye view of a large complex repeating environment — a dense hedge maze in deep green, a crowded city grid from directly above with rooftops and tiny streets, a thick forest canopy with treetops, or an intricate market stall grid with colored stalls — the environment has dense repeating visual rhythm and texture filling the entire frame; (2) a tiny isolated human figure, small vehicle, or single navigating object visible somewhere in the environment — proportionally tiny against the vastness, creating dramatic scale contrast; (3) one subtle colored path or trail in [{brand_accent}] tracing through the environment toward or from the figure, hinting at the navigation theme; (4) 2–3 small floating overhead decorative elements — a tiny compass-rose silhouette in a corner, a small abstract pin marker, 2–3 sparkles — in [{brand_accent}]; (5) atmospheric depth with subtle haze, light vignette in the corners, fine grain across the image. Strong overhead natural daylight with realistic long shadows from the environment's vertical elements. The viewer's eye naturally lands on the tiny figure first. Cinematic aerial photography or polished isometric illustration aesthetic. No text, no labels, no readable arrows or signs anywhere.
```

---

### 12 — Elevated Artifact

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (studio product quality) |

**Composition prompt:**
```
Premium agency-quality studio product photography composition, vertical 4:5. Layered elements: (1) soft neutral studio background — light grey, warm cream, or muted [{brand_secondary}] — with very subtle radial vignette at the edges; (2) a clean geometric display pedestal in the lower-center of the frame — white marble, matte concrete, or [{brand_primary}]-colored painted plinth — with sharp clean edges and realistic surface texture; (3) resting perfectly centered on the pedestal: a single brightly-colored iconic object thematically relevant to the brand or concept — a vintage rotary phone, a single ripe apple, a cut gemstone, a slim hardcover book, a polished trophy, a glass perfume bottle — sharp, well-lit, hero-shot quality; (4) 2–3 small floating decorative accents in [{brand_accent}] — a 4-point sparkle, a small star, a thin horizontal accent line — placed around the pedestal in the negative space, sparse and intentional; (5) one soft cast shadow under the pedestal grounding it to the implied floor; (6) subtle dust motes catching the soft top-light for premium atmosphere. The upper half of the frame has generous negative space for text overlay above the artifact. Soft professional studio lighting from slightly above with one warm side-fill, no harsh shadows. Premium product photography, luxury editorial quality — Aesop, Apple, Hermès aesthetic. No text, no labels, no readable logos.
```

---

### 13 — Node Network Flow

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (technical diagram clarity) |

**Composition prompt:**
```
Premium agency-quality conceptual diagram composition, vertical 4:5. Layered elements: (1) clean professional background — [{brand_secondary}] light tone or very dark [{brand_primary}] — with extremely subtle grid texture or radial gradient suggesting depth; (2) in the center of the frame: a large foundational hero icon, central image element, or 3D-rendered glass orb at medium scale, in [{brand_primary}] color with depth and dimension; (3) radiating outward from this center: 5–6 thin curved circuit-like connection lines in [{brand_primary}] or [{brand_accent}] color, each ending in a smaller circular node element; (4) each satellite node is a clean circle containing a single simple abstract icon (geometric shape: triangle, plus sign, star, diamond, circle outline, dot) — no text, no labels; (5) 3 small floating decorative accents in [{brand_accent}] — sparkles, tiny dots, small star icons — scattered between the central element and the nodes; (6) atmospheric depth with subtle bokeh particles in the deep background. Smooth digital illustration style, isometric-adjacent perspective, clean and professional. The upper third has clear negative space for an eyebrow brand strip; the lower 30% has space for text overlay. Soft uniform digital lighting, no harsh shadows. Production-grade SaaS/ecosystem diagram aesthetic — Stripe Connect, Notion landing page, Linear. No text, no readable labels anywhere.
```

---

### 14 — Translucent Trust Interface

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` (upgradable to `HYBRID_REAL` for lifestyle photo) |
| Model | GPT (glassmorphism and UI quality) |

**Composition prompt:**
```
Premium agency-quality fintech/SaaS dual-zone composition, vertical 4:5. Layered elements: (1) left half of the canvas: a warm high-quality lifestyle photograph — a smiling professional at a desk, comfortable home office, hands working on a laptop, or a relaxed everyday scene — sharp and authentic, with soft natural light; (2) the photograph fades via soft horizontal gradient into the right half which transitions to a solid [{brand_primary}] color block filling the right 50%; (3) floating over the photographic left half and crossing the gradient seam: 3–4 semi-transparent frosted-glass UI cards with blurred backgrounds, subtle white borders, and crisp drop shadows (glassmorphism style); (4) each glass card contains a single simple bold icon only — a shield outline, a checkmark, a padlock, a graph line, a clock — in [{brand_primary}] or [{brand_accent}] color, no text inside the cards; (5) 2–3 small floating decorative accents in [{brand_accent}] — a 4-point sparkle, a tiny plus sign, a small dot — between the cards for visual rhythm; (6) atmospheric depth with subtle grain texture across the image. The right solid color half is completely empty for text overlay. Bright clean lighting on the photographic side, flat saturated color on the right. Production-grade fintech/SaaS aesthetic. No text, no readable typography labels, no UI text on cards.
```

---

### 15 — Cinematic Illumination

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | Gemini (cinematic night atmosphere) |

**Composition prompt:**
```
Premium agency-quality cinematic narrative composition, vertical 4:5. Layered elements: (1) dark moody low-key nighttime or deep interior setting filling the entire canvas — a dimly-lit bedroom, a late-night office, a quiet kitchen at midnight, or a balcony at dusk — rich shadowed [{brand_primary}] or near-black tones dominate the frame; (2) a person in the frame holding a glowing object close to their face or chest — a smartphone, small lantern, tablet, or candle — with the glow as the primary light source illuminating their face, hands, and surrounding edges against the surrounding darkness; (3) the localized glow creates warm-or-cool light on the subject (matching mood) and casts realistic light spill onto nearby surfaces; (4) background has soft out-of-focus bokeh — points of warm light from city windows, distant lamps, or fairy lights — in [{brand_accent}] color tones; (5) 1–2 small floating atmospheric elements — dust motes catching the glow, a tiny moth silhouette, fine particles — adding cinematic depth; (6) heavy film grain across the image, slight halation on the brightest highlights. The dark left or right side of the frame is available for text overlay. Arri Alexa cinematic aesthetic — chiaroscuro lighting, shallow depth of field, anamorphic-style flare. No readable text, no interface content visible on the glowing device, no logos.
```

---

### 16 — Illusionist Metaphor

| Field | Value |
|---|---|
| Image zone | `boxed-center` |
| Default mode | `HYBRID_AI` |
| Model | GPT (precise object placement) |

**Composition prompt:**
```
Premium agency-quality conceptual editorial composition, vertical 4:5. Layered elements: (1) vibrant solid [{brand_primary}] background filling the entire canvas with subtle grain texture, or split background with [{brand_secondary}] as a soft blob in one quadrant; (2) at the upper portion of the frame: a pair of realistic elegant human hands descending from above the frame edge, palms facing downward with fingers slightly spread as if performing a magic trick or conjuring — sharp photographic detail of skin, knuckles, fingernails; (3) below the hands in the lower portion: a classic black magician's top hat resting upside-down (mouth facing up) OR a wooden magic wand laying across the lower frame OR a thin scarf draped over a small platform; (4) the center of the frame between the hands and the prop is completely empty — open negative space where the "magic" appears, reserved for text overlay; (5) 4–5 small floating decorative accents in [{brand_accent}] — 4-point sparkles, tiny stars, small puffs of smoke — scattered between the hands and the prop suggesting the moment of magic; (6) clean studio lighting with one soft top-light, dramatic shadow under the hat. Minimalist bold graphic composition, no playing cards, no scarves, no other props beyond the listed. No readable text, no logos anywhere.
```

---

### 17 — Archive Filing System

| Field | Value |
|---|---|
| Image zone | `boxed-center` |
| Default mode | `HYBRID_AI` (upgradable to `FULL_AI`) |
| Model | GPT (paper texture and depth) |

**Composition prompt (HYBRID_AI):**
```
Premium agency-quality office product photography composition, vertical 4:5. Layered elements: (1) vibrant solid [{brand_primary}] background with one soft organic blob shape in [{brand_secondary}] in one corner about 20–25% of the canvas; (2) center frame: macro close-up slightly-angled overhead view of 4–5 colored manila folder tabs layered sequentially in a fanned stack, each offset slightly so all tabs are visible — colors range across complementary brand tones (cream, sage, dusty rose, soft blue) with the front folder always cream or off-white; (3) each folder has realistic textured paper surface with natural drop shadows between layers creating physical depth and weight; (4) the front-most folder is fully visible with a completely clean blank face — no text, no labels, no handwriting; (5) 3 small floating decorative accents in [{brand_accent}] — a 4-point sparkle, a small plus sign, a circle outline — scattered around the folder stack; (6) 1 small white abstract notification card floating beside the folders with avatar circle + 2 short UI bars + small checkmark, no readable text; (7) 1–2 tiny contextual icons in white circles — a bookmark shape, a small paperclip — suggesting organization theme. Warm office lighting from slightly above, selective sharp focus on the front folder, soft drop shadows. Production-grade office/organization editorial. No text, no readable labels anywhere.
```

**FULL_AI text pattern:**
```
The front folder face displays these exact words in a typewriter-stamped black ink style on the manila paper: "{HEADLINE}". The text is centered, with slight ink absorption into the paper texture, clearly legible. Spell every letter exactly as written. The other visible folder tabs remain completely blank — no text on them.
```

---

### 18 — High-Conflict Scene

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` (upgradable to `HYBRID_REAL` for emotional realism) |
| Model | Gemini (emotional photojournalism energy) |

**Composition prompt:**
```
Premium agency-quality editorial photojournalism composition, vertical 4:5. Layered elements: (1) cinematic emotional scene with two or more people in a visually intense, highly relatable moment — one person gesturing expressively or with frustrated body language, another looking away/down or with shocked expression, in a recognizable professional setting (modern office desk, open kitchen, living room, co-working space, conference room); (2) heavy cinematic color grading: desaturated palette with one accent color in [{brand_primary}] or [{brand_accent}] highlighted (a person's shirt, a colored cup, a notebook); (3) the action and emotion is centered in the mid-frame, with slightly out-of-focus dark edges on the left and right sides providing visual framing and clear space for text overlay; (4) authentic body language and micro-expressions — no posed-actor feeling, natural candid documentary moment; (5) the environment contains 2–3 small contextual props supporting the story (laptop with abstract dashboard bars on screen, scattered papers, a half-empty coffee mug, a phone laying screen-down); (6) subtle film grain, slight halation in highlights, photojournalistic motion blur on any gesturing hand. No direct eye contact with camera from any subject — third-party observer perspective. Cinematic 35mm or 50mm focal length, shallow depth of field with sharp focus on the most emotionally expressive face. Deeply relatable emotional scene — The New York Times Magazine photo essay quality. No readable text, no logos visible.
```

---

### 19 — Intimate Macro Detail

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (skin texture macro fidelity) |

**Composition prompt:**
```
Premium agency-quality intimate luxury macro composition, vertical 4:5. Layered elements: (1) extreme close-up macro photograph of human fingers — elegantly manicured with painted nails in neutral [{brand_secondary}] or [{brand_primary}] color, soft and recently moisturized — resting lightly near lips, against a cheekbone, near the jawline, or touching a chain necklace; (2) the crop is so tight the image becomes nearly abstract: filling the entire 4:5 canvas with skin texture, subtle natural color gradients, the fine detail of fingertip ridges, and barely-visible hair fuzz; (3) one ambient warm accent — a tiny gold pendant, a soft fabric edge in [{brand_accent}], or a hint of jewelry glint — adding compositional warmth; (4) softly defocused background entirely smooth with no detail — pure bokeh in [{brand_secondary}] tonal area; (5) very subtle skin imperfections preserved (no over-smoothing) — light freckles, fine pores, natural skin tone variation; (6) extremely subtle film grain across the image. Soft directional natural light revealing skin texture with one warm rim-light. Very shallow depth of field with the fingertip pad in sharpest focus. The image conveys intimacy, luxury, exclusivity, "whispered secret" quality. No face fully visible — abstract intimate cropping only. Vogue Beauty / Aesop / Le Labo editorial aesthetic. No text, no readable jewelry, no logos.
```

---

### 20 — Walking Canvas

| Field | Value |
|---|---|
| Image zone | `boxed-center` |
| Default mode | `HYBRID_AI` (upgradable to `FULL_AI`) |
| Model | GPT (clean blank canvas rendering) |

**Composition prompt (HYBRID_AI):**
```
Premium agency-quality conceptual portrait composition, vertical 4:5. Layered elements: (1) clean studio or neutral outdoor setting with soft warm gradient background — light grey, cream, or muted [{brand_secondary}]; (2) center frame: a person facing away from camera (back to viewer) OR with their face hidden behind or above the canvas frame, standing in a natural standing pose; (3) the person holds up a large oversized blank artist's canvas, white poster, protest sign, or rectangular foam board in front of their torso — the canvas fills approximately 50% of the frame, perfectly flat and unbent; (4) the canvas surface is completely blank, pure white, clean — no texture variation, no marks — with realistic slight thickness, visible edges, and natural drop shadow on the held side; (5) the person's hands and arms are clearly visible gripping the edges of the canvas; (6) the person wears [brand-tinted clothing] — solid colored shirt in a complementary brand color; (7) 2 small floating decorative accents in [{brand_accent}] — a tiny sparkle, a small dot — placed in the negative space around the canvas. Even flat studio lighting with no harsh shadows, slight warm tonal grade. The blank surface is the visual focus. Production-grade conceptual portrait. No drawings, nothing on the canvas, no text anywhere.
```

**FULL_AI text pattern:**
```
The held blank canvas displays these exact words in bold hand-painted black brush lettering: "{HEADLINE}". The text fills approximately 70% of the canvas surface, all caps, hand-drawn protest-poster aesthetic with slight brush stroke variation, high contrast against the white canvas. Spell every letter exactly as written. No other text anywhere in the frame.
```

---

### 21 — Urban Signal Metaphor

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | Gemini (dreamy sky atmosphere) |

**Composition prompt:**
```
Premium agency-quality surreal-urban composition, vertical 4:5. Layered elements: (1) background: a dreamy pastel gradient sky filling the entire frame — soft blue-pink-orange gradient OR soft [{brand_primary}]-tinted clouds, ethereal and expansive, painterly atmosphere; (2) center-left of the frame: a towering hyper-realistic traffic signal, pedestrian crossing light, or vintage railway signal structure, photographed from slightly below at a low-angle hero shot perspective, rising vertically through the frame; (3) the signal lights are lit — red, amber, or green — glowing naturally and casting subtle colored light onto the structure and surrounding air; (4) the right side of the frame has open dreamy sky space (reserved for text overlay); (5) 3–4 small floating decorative accents in [{brand_accent}] — a tiny bird silhouette, a 4-point sparkle, a small star, light particles — scattered across the sky for whimsy; (6) the structure shows realistic weathering — slight rust, peeling paint, age spots — grounding the surreal sky against industrial reality; (7) one subtle lens flare from the lit signal adding cinematic punctuation. Grounded realistic signal versus dreamy aspirational background — strong contrast between industrial mechanics and natural fantasy. Street photography meets editorial fantasy, Wes Anderson color palette aesthetic. No other signage, no urban clutter, no text, no readable labels.
```

---

### 22 — Identity Block

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (portrait quality + geometric overlay) |

**Composition prompt:**
```
Premium agency-quality conceptual portrait composition, vertical 4:5. Layered elements: (1) high-quality professional portrait photograph of a person in an office, studio, or neutral setting — chest-up framing, business casual attire, body and shoulders sharp and realistic with natural pose; (2) the subject's face is completely covered by a flat solid geometric rectangle or rounded-corner square in [{brand_primary}] or [{brand_accent}] color, placed directly over the face area — hard edges, perfectly flat (no gradient, no texture), covering the face fully from chin to forehead; (3) the rest of the portrait — clothing, shoulders, neck, body, hands — is photographically normal and sharp with realistic skin texture and clothing detail; (4) the geometric block has a very subtle drop shadow grounding it to the face area, creating a sense of physical placement; (5) studio or soft natural office lighting from the front, neutral color grading; (6) background is simple — softly out-of-focus office environment in [{brand_secondary}] tonal area, or a clean studio backdrop; (7) 1–2 small floating accent elements in [{brand_accent}] near the block — a tiny barcode-like pattern, a small ID-tag silhouette, or a thin horizontal line — punctuating the identity-loss theme. Psychologically unsettling and conceptually striking. DSLR portrait quality, sharp focus on the body and block edges. No text, no symbols on the block, no readable labels.
```

---

### 23 — Suspended Object

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` (upgradable to `FULL_AI`) |
| Model | GPT (minimal clean composition) |

**Composition prompt (HYBRID_AI):**
```
Premium agency-quality minimalist conceptual composition, vertical 4:5. Layered elements: (1) extremely minimal studio composition with a very clean plain background — pale [{brand_secondary}], pure soft white, or muted [{brand_primary}] tone — filling the entire canvas with extremely subtle gradient or grain texture; (2) in the absolute dead center of the frame: a single iconic small object hanging from a thin clearly-visible thread or string attached to the top of the frame — a classic pine tree car air freshener, a small white tag, a vintage brass key, a single Christmas ornament, a simple pendant, or a folded paper crane — perfectly centered horizontally and vertically; (3) the string is visible, thin, and naturally taught with a hint of gentle sway or rotation; (4) enormous negative space surrounds the object in all directions for breathing room and text overlay; (5) 2 small floating decorative accents in [{brand_accent}] — a tiny 4-point sparkle and a small dot — placed asymmetrically in the negative space about a third of the way from the center to the edge; (6) one soft circular shadow on the implied floor beneath the suspended object adding subtle grounding; (7) very subtle film grain across the entire image. Flat soft studio lighting with one warm key-light, no harsh shadows on the background. The object is the focal point — the suspended emptiness is the message. Editorial conceptual minimalism, Kinfolk / Apartamento aesthetic. No text, no branding, no readable labels.
```

**FULL_AI text pattern:**
```
The face of the suspended object displays these exact words printed in solid black sans-serif: "{HEADLINE}". The text is centered on the object, professionally printed with slight texture matching the object's material (cardboard, paper, or plastic), clearly legible at the camera framing distance. Spell every letter exactly as written. No other text or markings on the object or anywhere in the frame.
```

---

### 24 — Matrix Grid

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (geometric precision) |

**Composition prompt:**
```
Premium agency-quality graphic design composition, vertical 4:5. Layered elements: (1) bold solid [{brand_primary}] or deep dark charcoal background filling the entire canvas with subtle grain or noise texture; (2) center frame: a rigid high-contrast grid structure — 3×3, 4×4, or 5×5 periodic-table-style grid — with thick clean lines in [{brand_secondary}] or white at consistent stroke weight; (3) the grid is centered and fills approximately 70–80% of the frame; (4) cell contents are intentionally varied: about half the cells are completely empty (solid background showing through), and the other half each contain a single simple bold abstract icon or geometric shape — a triangle, plus sign, star, diamond, dot, circle outline, slash mark, x — in [{brand_secondary}] or [{brand_accent}] color, no text, no numbers, no readable labels; (5) 2–3 small floating decorative accents in [{brand_accent}] — tiny dots, micro-sparkles — placed outside the grid in the surrounding negative space (upper or lower margin); (6) the grid has very flat 2D design language — no 3D depth, no perspective, no shadows on cells; pure graphic design aesthetic. Extreme visual clarity and mathematical structure with intentional whitespace. Clean and bold flat-design typography-poster aesthetic — Pentagram / Massimo Vignelli / Swiss design. No text, no labels in cells, no readable numbers.
```

---

### 25 — Documented Reflection

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` (upgradable to `HYBRID_REAL` for authentic candid) |
| Model | Gemini (authentic candid photography) |

**Composition prompt:**
```
Premium agency-quality authentic social documentary composition, vertical 4:5. Layered elements: (1) authentic slightly-candid photograph — selfie-style in a mirror, hand-held by a friend, or natural reflection in a window — of a person in a real everyday environment: home office, café, gym, outdoor street, kitchen; (2) the image has authentic unpolished "real life" quality with slight motion blur, imperfect framing, natural color (not over-graded), visible mundane details; (3) the person is in casual attire, doing a natural activity (coffee, phone, working, walking), not posed for camera; (4) around the subject, 3–5 small floating polaroid-style photo frames, sticky-note rectangles, or speech-bubble UI cards are digitally placed at slight off-angle rotations, each pointing with a thin curved arrow line in [{brand_accent}] toward areas of the original photo; (5) the polaroid frames and notes are completely blank inside (no text), with realistic white borders, subtle drop shadows, and small slight color tints suggesting different categories; (6) 2–3 small floating decorative accents in [{brand_accent}] — a 4-point sparkle, a tiny doodle scribble, a small star — scattered around the photo-tag composition; (7) warm natural light from the environment (window, overhead café light, sunlight) with casual atmosphere. Authentic social documentary meets editorial annotation aesthetic. No text overlay content, no readable labels.
```

---

### 26 — Armor Interface

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` |
| Model | GPT (3D render precision) |

**Composition prompt:**
```
Premium agency-quality cybersecurity SaaS composition, vertical 4:5. Layered elements: (1) professional studio background — deep dark [{brand_primary}] or near-black charcoal — with subtle gradient or grid texture creating depth; (2) left half of the frame: a large centrally-positioned 3D-rendered security icon — a glowing [{brand_accent}] or electric-blue shield with volumetric edge-light, a heavy metallic padlock with realistic chrome reflections, or a closed bank-vault door with rotational hinges — clean high-resolution 3D render dominating the left half; (3) 2–3 small semi-transparent glassmorphism UI elements adjacent to the icon — abstract toggle switches in "on" position, minimal form fields with no visible text, abstract badges with simple shield-shape outlines — all with thin white borders and subtle drop shadows; (4) the right half of the frame is completely dark and empty for text overlay, with very subtle particle dust motes for atmosphere; (5) 3 small floating decorative accents in [{brand_accent}] — tiny sparkles, small dots, a thin laser-like horizontal line — scattered between the icon and the UI elements; (6) dramatic side-key lighting on the 3D icon creating sharp specular highlights and deep contact shadow; (7) atmospheric depth with subtle haze and one cinematic light flare from the icon's glow. Premium cybersecurity/fintech aesthetic — Auth0, 1Password, NordVPN. No readable text, no numbers, no interface text on UI elements.
```

---

### 27 — Command Center Dashboard

| Field | Value |
|---|---|
| Image zone | `background-blur` |
| Default mode | `HYBRID_AI` (upgradable to `HYBRID_REAL` for founder photo) |
| Model | GPT (UI stack clarity) |

**Composition prompt:**
```
Premium agency-quality SaaS/fintech showcase composition, vertical 4:5. Layered elements: (1) clean professional background — warm neutral [{brand_secondary}] tone with subtle radial gradient toward [{brand_primary}] accent — filling the entire canvas; (2) left half: a confident smiling person in their 30s in smart business-casual attire, photographed from waist-up at a slight three-quarter angle, looking toward the camera or slightly off-frame, clearly lit and sharp; (3) right half: cascading outward at slight perspective angles, 4–6 layered digital interface cards — dashboard screens with abstract analytics charts (bar graphs, line graphs, pie circles), product UI cards, digital credit-card mockups, notification cards — stacked and overlapping to create rich layered depth; (4) all interface cards show clean abstract data visualizations and UI chrome with [{brand_primary}] accent tones on borders and chart elements, but absolutely no readable text or numbers (use abstract bars and shapes only); (5) 3–4 small floating decorative accents in [{brand_accent}] — sparkles, tiny stars, small plus signs, a checkmark badge — scattered between the person and the interface stack; (6) clear depth-of-field layering: person sharp, interface cards getting progressively softer toward the right edge; (7) warm professional studio lighting on the person; cooler digital lighting on the interfaces creating mood contrast. Production-grade premium SaaS/fintech aesthetic — Stripe, Linear, Notion, Lattice. No text, no readable numbers, no interface labels.
```

---

## Known Pitfalls

- **Text in the image (HYBRID modes):** AI models tend to add text when placeholder labels or blank signs are in the scene. Always end the prompt with "No readable text, no logos, no typography labels" and add a brief negative: "blank [surface] with no markings."
- **Surreal archetypes (04, 10, 16):** Specify the scale contrast explicitly ("3–5× the size of the person"). Without this, the surreal element becomes normal-sized and loses impact.
- **Blank surfaces (05, 09, 20, 23):** State "completely blank — no text, no printing, no marks" twice in the prompt. For FULL_AI, override with the text-baking pattern only — never include both "blank" and "displays this text" instructions in the same prompt.
- **Atmospheric archetypes (03, 07, 21):** Gemini handles outdoor and sky compositions better. Switch to Gemini for HYBRID; switch back to GPT for FULL_AI when text fidelity matters.
- **Grid/minimal archetypes (08, 24):** GPT handles geometric precision better. Always state "flat 2D, no 3D depth" to prevent over-rendering.
- **Multi-element compositions (01, 13, 27):** Number every layered element explicitly in the prompt. Models drop unnumbered elements; numbering acts as a checklist the model follows.
- **Brand accent missing:** Always derive an accent if `brand_kit.accent` is null (yellow → pink-magenta; blue → orange; dark → bright). Don't leave `[{brand_accent}]` literal in the final prompt.
