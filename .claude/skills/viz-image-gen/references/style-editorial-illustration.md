# Editorial Illustration Style

## When to Use

Opinion carousels, conceptual frameworks, abstract business ideas, thought-leadership content. Any topic that benefits from a visual metaphor — "creator trapped in AI habits," "swimming in unread emails," "climbing a mountain of feedback." Inspired by The New Yorker, The Atlantic, and editorial art directors like Victo Ngai, Malika Favre, and Christoph Niemann.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | A conceptual metaphor — person-as-object, oversized-vs-tiny scale juxtaposition, abstract idea made physical | Avoid literal illustrations; the wit is in the unexpected angle |
| Framing | 4:5 portrait, asymmetric composition with generous negative space, subject rarely centered | Like a magazine cover — the frame has breathing room |
| Lighting | Flat or very soft diffused light — no dramatic shadows, no 3D dimensionality | Light exists to serve color, not drama |
| Mood | Witty, conceptual, slightly ironic, idea-driven — never earnest or literal | The viewer should "get it" in under 2 seconds |
| Medium | Flat vector or gouache illustration — opaque color fills, matte finish, visible texture optional | Risograph / screenprint texture elevates the feel |
| Style | Christoph Niemann minimalist wit, Malika Favre bold flat vector, Victo Ngai rich symbolic, The New Yorker editorial cover | Pick one strong reference per image |

## Model Recommendation

**GPT Image 2** — better instruction-following for complex conceptual metaphors. Handles asymmetric composition and flat-style requests well.

**Gemini** — good for painterly gouache feel; can drift toward photorealistic if not anchored. Mini-test result: cartoon-style result, readable metaphor, slightly over-rendered.

**Best default:** GPT Image 2 for conceptual clarity. Gemini when a looser, painterly feel is acceptable.

## Example Breakdown

**Request:** "Visual metaphor — creator escaping generic AI voice"

```
Subject: Small black silhouetted person climbing out of a giant cream chat bubble; a second smaller bubble grows behind them
Framing: 4:5 portrait, figure in lower-center, large bubble fills most of frame, second bubble top-left
Lighting: Flat, no shadows
Mood: Witty, conceptual, slightly absurd — New Yorker editorial quality
Medium: Flat vector with subtle gouache texture, matte finish
Style: Christoph Niemann + Malika Favre combined — minimalist wit, bold negative space
---
Aspect Ratio: 4:5
Model: GPT Image 2
Key Details: Two-tone palette (black + crimson on cream), generous white space, no other elements
```

**Prompt (GPT):** Editorial illustration in the style of Christoph Niemann combined with Malika Favre. A small black silhouetted human figure is climbing out of the rim of a giant cream-colored speech bubble that fills the lower two-thirds of the frame. Behind them in the upper area, a second smaller speech bubble is growing again. Flat vector style with subtle gouache paper texture, matte finish. Muted cream off-white background. Single bold crimson red accent used on the climbing figure's outline only. Generous negative space above, balanced asymmetric composition. Witty visual metaphor about escaping generic AI output. The New Yorker editorial cover quality. Palette: black, crimson, cream only. No photorealism, no 3D, no gradients, no other elements.

## Known Pitfalls

- Models default to photorealistic illustration unless "flat vector" or "gouache" is repeated multiple times in the prompt
- "Editorial illustration" alone produces clipart — must specify artist/publication reference
- Overcrowded compositions: models try to fill every inch — emphasize "generous negative space" repeatedly
- Faces: if the figure has a visible face, models add realism that clashes with the flat style — use silhouettes or abstract shapes for people
- Color creep: models add extra colors unless you explicitly enumerate the exact palette (e.g., "palette: black, crimson, and cream only — no other colors")

## Comparison Notes (GPT vs Gemini)

- **GPT:** Stronger conceptual coherence, follows "flat style + specific palette" more reliably, better composition control
- **Gemini:** More organic brushwork feel, can over-render toward realistic illustration, good for gouache texture
- **Verdict:** GPT Image 2 for this preset — metaphor execution and style fidelity matter more than texture feel
