# Editorial Collage Style

## When to Use

Agency-style attention hooks, brand commentary, disruptive visual essays, avant-garde carousel covers. Best when the message IS the chaos — "everything is broken," "old rules don't apply," "this is a new era." Inspired by ransom-note zines, vintage magazine photomontage, and risograph print culture.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Mismatched-scale juxtaposition — giant object next to tiny person, or torn mixed-media cutouts floating at wrong scales | Scale incongruity = instant visual interest |
| Framing | 4:5 portrait, centered stacked composition, multiple photographic cutouts at varying scales and tones | Like a poster layout, not a naturalistic photo |
| Lighting | Halftone/newsprint texture overlay, no consistent light source — the textures provide visual rhythm | Multiple "light sources" is part of the collage aesthetic |
| Mood | Surreal, urgent, slightly chaotic — vintage chaos with modern intentionality | Tension between old-media texture and current-era concepts |
| Medium | Mixed-media paper collage — torn edges, tape marks, rectangular cutouts, halftone newsprint texture | Physical imperfection is the style; smooth digital kills it |
| Style | 1970s magazine photomontage, ransom-note typography, risograph prints, Dada editorial posters | Reference decade + medium explicitly |

## Model Recommendation

**Gemini** — excels at multi-element blending and mixed-media layering. Mini-test confirmed: "NEW RULES" headline, torn paper textures, crimson palette — hit on first attempt.

**GPT Image 2** — can produce cleaner result but tends to over-polish the "worn" texture. Use if bold typography overlay legibility is critical.

**Best default:** Gemini for collage texture authenticity. GPT Image 2 when headline text must be pixel-perfect.

## Example Breakdown

**Request:** "Surreal collage about AI prompt traps — new rules hook"

```
Subject: Oversized vintage hand reaching out of a tiny doorway, surrounded by torn chat-bubble cutouts at mismatched scales
Framing: Vertical 4:5, centered stacked composition, headline in upper third
Lighting: Halftone newsprint texture overlay, no natural light source
Mood: Surreal, urgent, vintage chaos — "the old rules don't apply"
Medium: Paper collage — torn edges, mixed b/w and color photos, visible paper cuts
Style: 1970s magazine photomontage + risograph texture + bold sans-serif headline overlay
---
Aspect Ratio: 4:5
Model: Gemini
Key Details: Large display headline "NEW RULES" in solid black ink; crimson and cream palette; visible torn paper edges
```

**Prompt (Gemini):** Surreal editorial paper collage in vertical 4:5 orientation. An oversized vintage black-and-white photo cutout of a hand reaches out of a tiny doorway in the lower half. Around it, smaller torn chat-bubble cutouts in cream and crimson tones float at mismatched scales. Visible torn paper edges, halftone newsprint texture overlay, magazine cutout mixed media layered composition. Across the upper third, a large bold sans-serif headline reads "NEW RULES" in solid black ink. Crimson and cream color palette, layered rectangular photo cutouts of varying tone, centered stacked composition, editorial poster layout, vintage 1970s magazine spread feel, risograph print texture. No smooth digital rendering, no photo-realistic faces.

## Known Pitfalls

- "Collage" alone produces a Pinterest mood board, not the raw physical-imperfection look — must specify "torn paper edges," "visible cut marks," "halftone newsprint texture"
- Headline text accuracy varies: Gemini generally handles short bold headlines; for anything over 3 words, consider GPT Image 2
- Models add too many elements and lose the centered composition — say "centered stacked composition, 3–4 elements maximum"
- Color palette discipline: collages tend to sprawl in color — enumerate the palette explicitly ("crimson, cream, black only")
- The scale juxtaposition (giant vs tiny) must be stated with explicit size ratio — "oversized [X] next to tiny [Y]" not "interesting combination of [X] and [Y]"

## Comparison Notes (GPT vs Gemini)

- **GPT:** Better headline text rendering, over-polishes the collage texture, produces cleaner (but less authentic) result
- **Gemini:** Authentic mixed-media feel, strong multi-element blending, halftone/newsprint texture comes naturally; headline text can be imperfect
- **Verdict:** Gemini wins for collage — the imperfect texture IS the point; GPT makes it too clean
