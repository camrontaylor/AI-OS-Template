# Hyperreal Portrait Style

## When to Use

Fantasy character art, book covers, game character portraits, DnD/RPG character visualization, concept art for fantastical beings, high-detail portrait commissions, mythological figures, armored warriors, magical beings.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Fantastical character with extreme surface detail — gemstones, engraved armor, organic hair, deep expressive eyes, intricate jewelry, skin imperfections alongside otherworldly beauty | Every surface tells a story |
| Framing | Close-up to medium close-up, slight low angle for heroism, centered or golden ratio placement, shallow DOF isolating face from background | Portrait-tight to showcase detail |
| Lighting | Warm/cool split lighting (gold from one side, blue/silver from other), dramatic but detailed shadow areas, catchlights in eyes showing environment reflection | Split lighting creates dimension on detailed surfaces |
| Mood | Epic, noble, mysterious, ancient, powerful — always larger-than-life | Characters should feel like they have a thousand-year backstory |
| Medium | Photorealistic digital painting, ultra-high-resolution rendering, painterly but with photographic detail level | The uncanny valley between photo and painting — intentionally |
| Style | Fantasy realism — Craig Mullins, Karla Ortiz, Greg Rutkowski, Donato Giancola | Fine art meets concept art meets impossible photography |

## Model Recommendation

**GPT clear winner** — organic hair rendering, deep eye detail with proper iris texture, engraved armor with consistent pattern logic, gemstone refraction.

**Evidence from shootout:**
- GPT produced forensic-level detail: individual hair strands with natural light interaction, iris striations visible, armor engravings that follow consistent artistic patterns
- Gemini smoothed over fine details, particularly in hair (clumped rather than individual strands) and armor (patterns less logically consistent)
- Eye rendering: GPT shows corneal reflection, iris depth, lash separation; Gemini produces flatter, less dimensional eyes

## Example Breakdown

**Request:** "Fantasy elf warrior queen portrait"

```
Subject: Elven warrior queen, angular features with high cheekbones, silver-white hair in intricate braids threaded with thin gold chains, pointed ears with delicate gold ear cuffs, deep amber eyes with vertical pupils, faint luminous freckles across cheeks and nose, ornate dark metal armor with gold inlay depicting forest scenes, a thin scar across left eyebrow
Framing: Close-up portrait, slight low angle, centered composition, extremely shallow DOF with only face and front armor in focus, dark atmospheric background
Lighting: Warm golden light from upper left creating strong cheekbone shadows, cool blue-silver fill from lower right, bright catchlights in eyes reflecting a window or doorway shape, subsurface scattering on ear tips
Mood: Ancient nobility, quiet power, the weight of centuries of rule, wisdom mixed with weariness
Medium: Photorealistic digital painting, hyperreal detail level surpassing photography, painterly edge treatment on hair wisps
Style: Fantasy realism — Karla Ortiz character design meets Annie Leibovitz portrait lighting, Donato Giancola surface detail
---
Aspect Ratio: 3:4
Model: GPT (superior organic detail — hair, eyes, engraved metal)
Key Details: Individual hair strands catching light differently, armor inlay depicting tiny recognizable forest scenes, luminous freckles with subtle glow, scar tissue texture on eyebrow
```

**Prompt:** An elven warrior queen rendered in hyperreal fantasy portrait, extreme close-up from slight low angle in 3:4 format with shallow depth of field. Angular features with razor-sharp cheekbones, silver-white hair in intricate braids threaded with thin gold chains, each strand individually rendered catching golden light differently. Pointed ears adorned with delicate gold ear cuffs, the ear tips showing subtle subsurface scattering where the warm light passes through. Deep amber eyes with vertical pupils show visible iris striations and corneal reflections of an arched window, surrounded by dark lashes with individual separation. Faint luminous freckles scatter across her cheeks and nose bridge with a subtle ethereal glow. Ornate dark metal armor visible at chest and shoulders features gold inlay depicting intricate forest scenes — tiny trees and flowing streams etched with impossible precision. A thin pale scar crosses her left eyebrow, the tissue texture distinct from surrounding skin. Warm golden light from upper left creates dramatic cheekbone shadows while cool blue-silver fill from lower right adds dimension. The mood conveys ancient nobility and quiet power — centuries of wisdom behind those amber eyes. Background dissolves into dark atmospheric blur. Style merges Karla Ortiz fantasy character design with Annie Leibovitz portrait mastery.

## Known Pitfalls

- Hair is the #1 differentiator — "flowing hair" produces clumps. Specify "individual strands catching light, natural flyaways, visible scalp at part line"
- Eyes must be explicitly detailed — without specification, AI defaults to flat iris rendering
- Armor patterns: specify they should be "logically consistent" and "following the contour of the metal" or you get random noise
- Gemini over-smooths everything in this style — loses the forensic detail that makes hyperreal work
- Without specific imperfections (scars, freckles, pores), results look like plastic dolls

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** Clear winner. Organic hair with individual strand behavior, deep dimensional eyes, armor engravings that follow logical patterns, skin texture with pores and imperfections
- **Gemini:** Smoother, more painterly result — works for stylized illustration but fails at "hyperreal" specifically. Hair clumps, eyes flatten, armor detail becomes suggestive rather than precise
- **Verdict:** GPT dominant — this style's entire value proposition is extreme detail, which is GPT's strength
