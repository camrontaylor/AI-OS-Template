# Text & Typography Style

## When to Use

Typographic posters, brand assets with text, motivational quotes, social media graphics with headlines, event announcements, title cards, any image where TEXT is the primary visual element and must be perfectly rendered.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | The text itself IS the subject — headline, quote, brand name, event title. Supporting graphic elements are secondary. | Specify exact text, font style, hierarchy, and layout |
| Framing | Centered or grid-based composition, balanced whitespace, clear visual hierarchy (headline > subhead > body), designed negative space | Typography is architecture — structure matters |
| Lighting | Flat, even illumination OR dramatic directional for 3D text effects (cast shadows, bevels). No complex lighting that competes with readability | Light serves legibility first |
| Mood | Depends on content — bold and urgent for announcements, elegant for luxury, playful for casual | Mood comes from type choice + color more than lighting |
| Medium | Digital graphic design, clean vector rendering, precise edges. Can reference print (letterpress texture, screen print registration) for character | Clean is default — texture is intentional choice |
| Style | Swiss/International (Helvetica, grid), editorial magazine (Vogue, Kinfolk), street poster (bold, layered), retro (wood type, vintage print) | Name the typographic tradition |

## Model Recommendation

**GPT dominant** — 6/6 element accuracy in testing, superior design hierarchy, near-perfect text rendering.

**Evidence from shootout:**
- GPT rendered text with 95%+ accuracy even for multi-word headlines and body copy
- GPT understood typographic hierarchy — naturally sizes, weights, and spaces text elements correctly
- Gemini 3 Pro Image (2026): ~70-85% accuracy on shorter strings — improved from the earlier ~60-70%; GPT still leads on hierarchy and dense (20+ label) compositions
- For ANY image where text legibility is critical: GPT is the only viable choice

## Example Breakdown

**Request:** "Motivational poster with the quote 'Build things that matter'"

```
Subject: Large bold headline "BUILD THINGS THAT MATTER" as the primary element, smaller attribution "— daily reminder" below, geometric accent shapes (circles, lines) as supporting elements
Framing: Centered vertical composition (9:16 for phone wallpaper), headline in upper 60% of frame, generous margins, attribution anchored to bottom third, geometric accents in corners and margins
Lighting: Flat — no lighting effects, pure graphic design. Solid background color.
Mood: Bold confidence, startup energy, morning motivation — punchy not preachy
Medium: Clean digital graphic design, vector-sharp edges, solid colors, no textures or gradients
Style: Swiss International typography — bold sans-serif (Helvetica Neue or similar weight), strict grid alignment, limited color palette (2-3 colors max), modernist geometric accents
---
Aspect Ratio: 9:16
Model: GPT (text accuracy critical — headline must be perfect)
Key Details: "BUILD THINGS THAT MATTER" must be rendered EXACTLY with no misspellings, strong weight contrast between headline and attribution, geometric accents don't compete with text
```

**Prompt:** A bold typographic poster in 9:16 vertical format with a solid deep navy (#1a1a2e) background. The headline "BUILD THINGS THAT MATTER" is rendered in large white bold sans-serif type (Helvetica Neue Black style), all caps, centered in the upper 60% of the composition with generous letter-spacing. Include ONLY this text verbatim for the headline: "BUILD THINGS THAT MATTER". Below it, "— daily reminder" appears in thin weight lowercase at one-fifth the headline size, providing typographic contrast. Minimal geometric accents — a thin coral (#ff6b6b) horizontal line above the headline, small circle in the same coral at bottom-left corner, and a single diagonal line element in the top-right. Swiss International design principles — strict grid alignment, exactly two colors (white and coral) on navy, vector-sharp edges throughout, no textures, no gradients, no photography. The mood is bold startup confidence, punchy and direct. Clean modernist graphic design with strong weight hierarchy between elements.

## Known Pitfalls

- For dense infographics with 20+ labels, GPT Image remains the preferred choice. The absolute "NEVER use Gemini" no longer applies to Gemini 3 Pro Image (~70-85% on shorter strings, 2026), but GPT is still recommended for text-critical dense compositions
- For GPT: spell out difficult words letter-by-letter in the prompt for unusual/brand names
- Always use "Include ONLY this text (verbatim): 'X'" format to prevent GPT from adding extra text
- Specify "all caps" or "lowercase" explicitly — models will make random capitalization choices
- Font weight/style must be described (not named) — "bold geometric sans-serif" not "use Futura Bold"
- More than 20 words of text in one image risks errors even on GPT — split into separate elements if needed

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** Dominant. 6/6 element accuracy, understands typographic hierarchy naturally, spaces elements with design intent, renders multi-word text nearly perfectly
- **Gemini:** Fails at this style. Misspells words, merges characters, makes poor spacing/sizing decisions, cannot maintain design hierarchy
- **Verdict:** GPT only — this style is entirely dependent on text accuracy which Gemini cannot deliver
