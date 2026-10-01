# Macro / Extreme Close-Up Style

## When to Use

Eye detail shots, skin texture studies, product texture detail, nature macro (insects, water drops, flowers), material close-ups, jewelry detail, food texture, fabric weave, scientific documentation.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Extreme detail of a single surface/element — iris striations, individual skin pores, lash roots, water droplets on petals, fabric thread count, metal grain | The subject IS the texture |
| Framing | Extreme macro, 1:1 to 5:1 magnification ratio, razor-thin focal plane (millimeters of focus), 100mm macro lens perspective | Only a sliver is in focus — this is intentional |
| Lighting | Soft diffused with one strong directional key to reveal surface texture, ring flash for even detail illumination, catchlights showing detailed environment reflection | Light must reveal texture, not flatten it |
| Mood | Intimate discovery, forensic beauty, finding the extraordinary in the ordinary | Macro makes familiar things alien and beautiful |
| Medium | DSLR/mirrorless macro photography, 100mm f/2.8 macro lens, razor-thin DOF, visible color fringing at out-of-focus edges | Technical precision of real macro photography |
| Style | Scientific beauty — Thomas Shahan (insect macro), eye photography specialists, beauty photography detail shots | Where science meets art |

## Model Recommendation

**GPT dominant** — forensic detail without AI smoothing. Gemini over-smooths at this scale.

**Evidence from shootout:**
- GPT produced: visible iris striations with color variation, individual lash roots with skin texture surrounding, proper corneal catchlight with environmental reflection detail, skin pores with natural depth
- Gemini: smoothed iris (lost striations), grouped lashes (lost individual root detail), simplified catchlight, softened skin texture
- At macro scale, any smoothing is immediately visible and destroys the style's purpose

## Example Breakdown

**Request:** "Extreme close-up of a human eye"

```
Subject: Single human eye in extreme macro — visible iris striations in blue-green with gold flecks near pupil, individual collagen fibers in iris, dilated pupil with sharp edge, individual lash roots emerging from lid margin, visible meibomian gland openings on lid edge
Framing: Extreme macro filling entire frame, 5:1 magnification, razor-thin focal plane on the iris surface (pupil edge and lash tips slightly soft), 1:1 square crop
Lighting: Soft ring light creating circular catchlight in cornea, slight directional key from upper left revealing iris surface texture, catchlight reflects a window with curtain detail
Mood: Intimate forensic beauty, the universe hidden in an eye, alienating in its detail
Medium: 100mm f/2.8 macro lens on full-frame sensor, razor-thin DOF (perhaps 2mm of sharp focus), slight chromatic aberration at extreme edges, shot at high ISO with fine grain in shadow areas
Style: Medical photography meets fine art — forensic precision with aesthetic composition, eye photography like Suren Manvelyan's "Your Beautiful Eyes" series
---
Aspect Ratio: 1:1
Model: GPT (forensic detail, no AI smoothing)
Key Details: Iris collagen fibers visible as radial lines, gold flecks with actual depth not just color, corneal catchlight showing environmental detail, lash separation at root level
```

**Prompt:** An extreme macro photograph of a single human eye filling the entire square frame at 5:1 magnification, shot on a 100mm f/2.8 macro lens with a razor-thin focal plane of approximately 2mm centered on the iris surface. The iris reveals extraordinary detail — visible collagen fibers radiating outward as fine lines, blue-green base color with distinct gold flecks near the pupil that show actual dimensional depth, not just color variation. The pupil edge is razor-sharp with a crisp transition to iris texture. Individual eyelash roots emerge from the lid margin with visible skin pores surrounding each follicle, while the lash tips fall slightly out of focus. Meibomian gland openings are visible along the lid edge as tiny pale dots. A circular catchlight from a ring light dominates the corneal surface, with a secondary reflection showing window detail with curtain folds. Soft directional light from upper left reveals the iris surface topology through subtle shadowing. Fine sensor grain visible in the darker iris areas. Slight chromatic aberration appears at the extreme corners. The style merges Suren Manvelyan's forensic eye photography with fine art composition — intimate, alienating, impossibly detailed.

## Known Pitfalls

- AI models default to "beauty retouching" which destroys macro detail — explicitly state "no smoothing, no retouching, forensic detail"
- Depth of field MUST be razor-thin — without specification, models render everything sharp which looks fake at macro scale
- Chromatic aberration and sensor grain add realism at this scale — include them explicitly
- Iris detail: "blue eyes" produces flat color. Must specify "striations, collagen fibers, color variation, depth"
- Gemini's smoothing algorithm is particularly destructive at macro scale — avoid for this style

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** Dominant. Forensic-level detail preservation, proper macro photography characteristics (thin DOF, chromatic aberration), no AI smoothing applied
- **Gemini:** Over-smooths everything — iris becomes painterly rather than photographic, skin pores disappear, lashes group together. The smoothing that helps in other styles actively destroys macro photography
- **Verdict:** GPT dominant — macro photography IS detail, and GPT preserves detail while Gemini smooths it away
