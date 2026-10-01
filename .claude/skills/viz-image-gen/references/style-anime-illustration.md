# Anime / Illustration Style

## When to Use

Ghibli-inspired scenes, Shinkai sky/weather effects, manga panels, light novel covers, cel-shaded character art, painterly Japanese illustration, anime key visuals, webtoon panels.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Characters with expressive features (large eyes, dynamic hair), environmental storytelling through nature/weather, emotional body language over realistic anatomy | Hair and eyes carry most expression |
| Framing | Dynamic angles — extreme low for power, bird's eye for vulnerability, medium shots for character focus, ultra-wide for landscape establishing shots | Anime uses more dramatic angles than live action |
| Lighting | Painterly light (soft gradients, rim lighting as color halos, golden hour with exaggerated warm tones), god rays through clouds, dappled forest light | Light is stylized — serves emotion over physics |
| Mood | Nostalgic wonder, bittersweet, hopeful melancholy, quiet contemplation, youthful determination | Anime excels at mixing contradictory emotions |
| Medium | Cel animation (flat color with hard shadow edges), digital painting (soft blended), ink wash (flowing organic), watercolor (delicate translucent) | Specify which anime medium — they're very different |
| Style | Studio Ghibli (warmth, nature), Makoto Shinkai (photorealistic skies, weather), Takeshi Obata (detailed realism), MAPPA (dynamic action), Ufotable (light effects) | Name the studio/creator for precision |

## Model Recommendation

**Gemini wins** — clean artifact-free output, particularly for cel-shaded and ink wash styles.

**Evidence from shootout:**
- Gemini produced clean, consistent anime output without rendering artifacts
- GPT had stunning composition and particularly beautiful sky rendering but introduced visible ripple/wavy artifacts in flat color areas
- For sky-focused Shinkai-style: GPT worth trying (spectacular skies) but inspect for artifacts
- For cel-shaded or ink wash: Gemini clearly superior

## Example Breakdown

**Request:** "Anime girl looking at cherry blossoms"

```
Subject: Young woman in school uniform (navy sailor top, pleated skirt), reaching up with one hand toward a low cherry blossom branch, hair caught by wind revealing her profile, petals swirling around her
Framing: Low angle looking up, medium-full shot, cherry tree canopy filling upper frame, sky visible through gaps in blossoms, 3:4 portrait orientation
Lighting: Late afternoon golden hour, warm light filtering through translucent petals creating pink-gold dappled light on her face, soft rim light on hair from behind
Mood: Bittersweet transience (mono no aware), the beauty of a fleeting moment, nostalgic even while happening
Medium: Digital cel animation, clean line art with flat color fills and soft gradient shadows, Shinkai-level sky detail in background
Style: Makoto Shinkai meets Studio Ghibli — photorealistic cloud detail in the sky, warm nostalgic color grading, meticulous environmental detail
---
Aspect Ratio: 3:4
Model: Gemini (clean cel-shaded output, artifact-free flat colors)
Key Details: Individual petal detail in the swirling blossoms, translucent petal edges catching light, hair strands individually rendered by wind, cloud detail in sky gaps
```

**Prompt:** A young woman in a navy sailor-top school uniform and pleated skirt reaches up with one hand toward a low cherry blossom branch, her long dark hair caught by wind revealing her profile in three-quarter view. Shot from low angle looking up in 3:4 portrait orientation, the cherry tree's canopy fills the upper frame with clusters of pale pink blossoms while gaps reveal a detailed sky with layered cumulus clouds. Late afternoon golden hour light filters through translucent petal edges creating dappled pink-gold illumination across her face and uniform. Cherry blossom petals swirl around her in the wind, each individually detailed with visible translucent edges catching the warm backlight. Soft rim lighting from behind creates a golden halo on her windswept hair strands. The mood captures mono no aware — bittersweet beauty of a transient moment, nostalgic even as it happens. Rendered in clean digital cel animation style with precise line art, flat color fills, and soft gradient shadows on the character, combined with Makoto Shinkai-level photorealistic sky and cloud detail in the background. Warm nostalgic color grading throughout with slightly lifted shadows.

## Known Pitfalls

- "Anime style" alone produces generic result — MUST specify which anime aesthetic (Ghibli vs Shinkai vs MAPPA are wildly different)
- Flat color areas are where artifacts appear most visibly — inspect cel-shaded output carefully
- Eyes are the key differentiator — specify eye style (large Ghibli-round vs sharp Obata-detailed vs standard shonen)
- Hair physics in wind: both models struggle with natural anime hair flow — be very specific about direction and volume
- Sky detail: GPT produces more spectacular Shinkai-style skies but at risk of artifacts elsewhere

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** Stunning composition, beautiful sky rendering, superior "key visual" quality, but introduces ripple artifacts in flat color cel-shaded areas
- **Gemini:** Clean, artifact-free output across all anime sub-styles, consistent quality, slightly less spectacular individual compositions
- **Verdict:** Gemini wins overall for anime — artifact-free flat color rendering is non-negotiable for this style. Exception: one-off hero compositions where GPT's sky work is worth the artifact risk
