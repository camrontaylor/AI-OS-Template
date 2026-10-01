# Style Presets — Quick Reference Index

Presets are **shortcuts into the 6-Element Framework** — not a separate system. Each preset pre-fills all 6 framework elements with tested configurations. You can use a preset as-is or as a starting point and override individual elements.

For the full framework: see `visual-framework.md`

---

## Preset Index

| Preset | Style File | Model Rec | Best For |
|--------|-----------|-----------|----------|
| UGC / Influencer | `style-ugc-influencer.md` | Tie (GPT for labels, Gemini for candid) | Product-in-hand, social content, authentic selfie |
| Cinematic | `style-cinematic.md` | Gemini | Film stills, atmospheric scenes, neon noir |
| Anime / Illustration | `style-anime-illustration.md` | Gemini | Ghibli, Shinkai, cel-shading, ink wash |
| Hyperreal Portrait | `style-hyperreal-portrait.md` | GPT | Fantasy characters, extreme detail, RPG art |
| Macro Close-Up | `style-macro-closeup.md` | GPT | Eye detail, skin texture, forensic beauty |
| Product / Luxury | `style-product-luxury.md` | Tie (GPT for catalog, Gemini for editorial) | Premium product photography |
| Text / Typography | `style-text-typography.md` | GPT | Posters, brand assets, text-primary graphics |
| Technical Annotation | `style-technical-annotation.md` | GPT | Architecture diagrams, red-lined schematics |
| Notebook Sketch | `style-notebook-sketch.md` | GPT (slight edge) | Sketchnotes, educational summaries |
| Comic / Storyboard | `style-comic-storyboard.md` | Tie (GPT for consistency, Gemini for energy) | Sequential panels, step-by-step stories |
| Product Shoot | `style-product-shoot.md` | GPT (consistency) / Gemini (lifestyle) | Multi-shot product photography from one reference image |
| **Carousel presets (AI-only content images)** ||||
| Isometric | `style-isometric.md` | Gemini / GPT (labels) | SaaS/tech stacks, agent architecture, floating card diagrams |
| Editorial Illustration | `style-editorial-illustration.md` | GPT | Opinion carousels, visual metaphors, The New Yorker feel |
| Editorial Collage | `style-editorial-collage.md` | Gemini | Agency hooks, disruptive essays, torn-paper surreal style |
| **Social Design** | `style-social-design.md` | Per archetype | Agency-quality social ad compositions — 27 design archetypes (billboard, megaphone, surreal substitution, editorial portrait, etc.) |

---

## Framework Element Choices at a Glance

| Preset | Subject | Framing | Lighting | Mood | Medium | Style |
|--------|---------|---------|----------|------|--------|-------|
| UGC | Person + product, real skin | Selfie angle, 4:5 | Ring light / window | Energetic, authentic | iPhone, no beauty mode | Instagram influencer |
| Cinematic | Secondary to atmosphere | Anamorphic 2.39:1, wide | Volumetric, neon, practical | Melancholic, tense, epic | Arri Alexa, anamorphic lens | Blade Runner, Deakins |
| Anime | Expressive characters, nature | Dynamic angles, extreme | Painterly gradients, god rays | Nostalgic wonder, bittersweet | Cel animation / digital paint | Ghibli, Shinkai, MAPPA |
| Hyperreal | Fantasy character, extreme detail | Close-up, low angle | Warm/cool split | Epic, noble, ancient | Photorealistic digital painting | Mullins, Ortiz, Rutkowski |
| Macro | Single surface/texture | Extreme macro, thin DOF | Directional to reveal texture | Intimate discovery | 100mm macro, DSLR | Scientific beauty |
| Product | Hero product on premium surface | Low angle, 40-60% fill | Hard key, controlled fill | Premium, aspirational | Medium format (Hasselblad) | Apple, Aesop, luxury ads |
| Text | Text IS the subject | Centered/grid, hierarchy | Flat or 3D text effects | From type + color | Digital graphic design | Swiss, editorial, street |
| Technical | System + hand-drawn annotations | Full diagram, generous margins | Flat, no lighting | Professional authority | Vector base + marker overlay | CTO whiteboard |
| Notebook | Ideas as visual sketchnotes | Open notebook page | Soft overhead, cafe light | Studious warmth | Dot-grid paper, pen, highlighter | Mike Rohde sketchnotes |
| Comic | Characters in sequential panels | Multi-panel grid | Flat or noir contrast | Varies with story | Black ink on white paper | Newspaper strip, indie, manga |
| Product Shoot | Product from reference image | Per shot type | Per shot type | Premium, consistent | Medium format / DSLR | Multi-shot product photography |

---

## Auto-Selection Triggers

When the user doesn't specify a style, match their keywords to a preset:

| User keywords | Suggested preset |
|---------------|-----------------|
| "selfie", "influencer", "product in hand", "UGC", "social post" | UGC / Influencer |
| "cinematic", "film still", "Blade Runner", "neon", "atmospheric", "noir" | Cinematic |
| "anime", "Ghibli", "Shinkai", "cel-shaded", "manga", "illustration" | Anime / Illustration |
| "fantasy", "character portrait", "RPG", "warrior", "detailed face" | Hyperreal Portrait |
| "macro", "close-up", "eye detail", "texture", "pores" | Macro Close-Up |
| "product shot", "luxury", "perfume", "watch", "minimal product" | Product / Luxury |
| "poster", "typography", "quote graphic", "text design", "brand asset" | Text / Typography |
| "workflow", "architecture diagram", "annotate", "schematic", "red-line" | Technical Annotation |
| "notes", "summary", "explain", "sketchnote", "learn", "educational" | Notebook Sketch |
| "story", "steps", "before/after", "journey", "sequence", "panels" | Comic / Storyboard |
| "product shoot", "shot list", "multiple product shots", "hero and lifestyle", "all angles", "product photography set" | Product Shoot |

---

## Using Presets with the Framework

1. **Identify the preset** from user keywords or explicit request
2. **Load the style file** (`references/style-{name}.md`) for full detail
3. **Start with preset element values** in the Visual Breakdown
4. **Override elements** based on the user's specific request
5. **Adjust model recommendation** if user has a preference or only one backend is available

Presets save time but never restrict creativity. Any element can be overridden.
