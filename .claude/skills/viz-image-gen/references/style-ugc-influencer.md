# UGC / Influencer Style

## When to Use

Product-in-hand content, "authentic" social media posts, influencer partnerships, app screenshots in context, lifestyle brand content, talking-head thumbnails, before/after reveals.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Person holding/using product, authentic poses, real skin texture with pores visible, no beauty mode, no skin smoothing | Specify exact product placement — "held at 45 degrees showing label" |
| Framing | Selfie angle (slightly below or at eye level), medium close-up, iPhone front camera perspective | 4:5 for feed, 9:16 for stories/reels |
| Lighting | Ring light (circular catchlight in eyes) OR natural window light, soft and even | Avoid dramatic shadows — UGC is approachable |
| Mood | Energetic, authentic, relatable, "just discovered this" excitement | NOT polished commercial — imperfect is better |
| Medium | Smartphone photograph (iPhone 15 Pro), slight lens distortion, natural grain in shadows | Critical: specify NO beauty mode, NO skin smoothing |
| Style | Instagram influencer circa 2024, casual editorial, "shot on iPhone" aesthetic | Reference: everyday people, not models |

## Model Recommendation

**Tie — context dependent:**
- **GPT** wins on: product label rendering (text legible on packaging), skin pore detail, consistent multi-shot batches
- **Gemini** wins on: raw candid energy, natural imperfection, less "perfect" feeling output
- **For product-focused UGC:** Use GPT (label accuracy matters)
- **For lifestyle/vibe UGC:** Use Gemini (authenticity matters)

## Example Breakdown

**Request:** "Influencer holding a skincare bottle, morning routine vibe"

```
Subject: Woman in her mid-20s, messy bun, oversized white t-shirt, holding frosted glass serum bottle at 45 degrees showing label, other hand touching her cheek, genuine half-smile, visible skin texture and light freckles
Framing: Selfie angle from front camera, medium close-up chest-up, slightly below eye level, 4:5 crop
Lighting: Soft natural morning window light from the left, warm tone, circular ring light catchlight visible in both eyes
Mood: Fresh morning energy, "just woke up and already glowing" casual confidence
Medium: iPhone 15 Pro front camera, slight wide-angle distortion at edges, natural sensor grain in shadow areas, no beauty filter, no skin smoothing
Style: Instagram skincare influencer, authentic casual editorial, warm-toned feed aesthetic
---
Aspect Ratio: 4:5
Model: GPT (product label must be legible)
Key Details: Visible skin pores and texture, frosted glass bottle catching window light, messy hair strands framing face
```

**Prompt:** A woman in her mid-twenties with a messy bun and oversized white t-shirt holds a frosted glass serum bottle at 45 degrees, the product label clearly legible, while her other hand gently touches her cheek in a casual morning skincare moment. Shot on iPhone 15 Pro front camera with characteristic slight wide-angle distortion at the edges, medium close-up from slightly below eye level in 4:5 format. Soft natural morning window light streams from the left creating warm tones across her skin while a ring light adds circular catchlights in both eyes. Her skin shows real texture — visible pores, light freckles, no beauty filter or smoothing applied. A genuine half-smile and messy hair strands framing her face create authentic "just woke up glowing" energy. Natural sensor grain visible in the shadow areas. The frosted glass bottle catches and refracts the window light beautifully. Instagram skincare influencer aesthetic — warm, casual, relatable.

## Known Pitfalls

- AI models default to perfect skin — ALWAYS specify "no beauty mode, no skin smoothing, visible pores"
- Ring light catchlights get forgotten — specify "circular catchlight visible in eyes"
- Products often get the wrong number of fingers wrapped around them — be specific about hand position
- iPhone selfie perspective has slight wide-angle distortion — models often ignore this
- Background should be slightly messy/lived-in — not a studio

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** Superior product label text rendering, more controlled skin detail, slightly too "polished" for authentic UGC
- **Gemini:** Better at the imperfect, candid quality that makes UGC feel real, occasionally over-soft on product details
- **Verdict:** True tie depending on priority — product clarity (GPT) vs authentic feel (Gemini)
