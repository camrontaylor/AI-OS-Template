# Model Selection Guide

Choose the right backend based on the task. If both API keys are available, auto-select using this matrix. If only one key is set, use that backend.

---

## Decision Matrix

| Task Type | Best Backend | Confidence | Reasoning |
|-----------|-------------|------------|-----------|
| **Text-heavy designs** (posters, signage, infographics with labels) | GPT | High | GPT ~95%+ text accuracy on dense labels; Gemini 3 Pro Image improved to ~70-85% in 2026. GPT still preferred for 20+ label dense infographics. |
| **UI mockups & wireframes** | GPT | High | Understands UI vocabulary, coherent layouts, readable labels |
| **Brand-consistent batch assets** | GPT | High | Higher multi-run consistency |
| **Transparent backgrounds** | GPT | High | Native transparency support (Gemini doesn't support it) |
| **Technical diagrams with labels** | GPT | Medium | Better text rendering, but both handle structure well |
| **Atmospheric/environmental scenes** | Gemini | High | Stronger dramatic lighting, depth, natural atmospherics |
| **Lifestyle photography** | Gemini | High | More expressive, natural feel, less "cleaned up" |
| **Rapid iteration / exploration** | Gemini | Medium | Faster generation (5-10s vs 8-15s) |
| **Image editing / refinement** | Gemini | Medium | Conversational inpainting — modify areas without regenerating |
| **Character consistency across images** | Gemini | Medium | Built-in reference image support (up to 14 images) |
| **Budget-sensitive batch work** | Gemini | Medium | Generally cheaper per image via API |
| **Product photography (precision)** | GPT | Medium | Accurate representation, readable packaging labels |
| **Product photography (lifestyle)** | Gemini | Medium | Better atmospheric/lifestyle aesthetics |
| **Creative/artistic exploration** | Either | Low | GPT is consistent, Gemini is more variable/expressive |
| **Comic strips / storyboards** | Either | Low | Both handle well with the right prompt template |

---

## Quick Decision

Ask these questions in order:

1. **Does the image need readable text?** → GPT
2. **Does it need a transparent background?** → GPT
3. **Is it a UI/wireframe mockup?** → GPT
4. **Is it an atmospheric/environmental scene?** → Gemini
5. **Is it lifestyle or editorial photography?** → Gemini
6. **Is speed the priority?** → Gemini
7. **None of the above?** → Default to GPT (higher consistency)

---

## API Parameter Comparison

| Parameter | GPT | Gemini |
|-----------|-----|--------|
| **Sizes** | 1024x1024, 1536x1024, 1024x1536, auto | Any via aspect ratio |
| **Aspect ratios** | Via size parameter | 1:1, 4:3, 3:2, 16:9, 21:9, 3:4, 2:3, 9:16, 4:5, 5:4 |
| **Quality** | low, medium, high, auto | Via resolution: 1K, 2K, 4K |
| **Transparency** | Yes (background=transparent) | No |
| **Output formats** | png, jpeg, webp | png |
| **Multi-image input** | Up to 16 (editing) | Up to 14 |
| **Batch generation** | n=1-10 per request | 1 per request |
| **Text accuracy** | 95%+ | ~70-85% on Gemini 3 Pro Image (2026, improved); GPT preferred for dense text (20+ labels) |
| **Generation speed** | 8-15s | 5-10s |

---

## Model Strengths by Style (Shootout Evidence)

Based on direct comparison testing across 9 visual categories:

### GPT Wins (5/9 tests)

| Style | Why GPT Wins | Evidence |
|-------|-------------|----------|
| **Hyperreal Portrait** | Organic hair rendering, deep eye detail, engraved armor patterns | Individual hair strands with natural light interaction, iris striations, armor engravings following consistent logic |
| **Macro Close-Up** | Forensic detail without AI smoothing | Visible iris collagen fibers, individual lash roots, proper corneal catchlight, skin pores with depth |
| **Text / Typography** | 6/6 element accuracy, superior design hierarchy | 95%+ text accuracy, natural typographic spacing, multi-word rendering |
| **Technical Annotation** | Reliable text labels, two-layer visual separation | Clean base diagrams with accurate labels + distinct annotation layer |
| **Notebook Sketch** | Text label accuracy for sketchnotes (slight edge) | Readable bullet points and headers, controlled layout |

### Gemini Wins (2/9 tests)

| Style | Why Gemini Wins | Evidence |
|-------|----------------|----------|
| **Cinematic** | Artifact-free atmospheric scenes, natural neon reflections | Clean volumetric fog, proper color bleeding on wet surfaces, no wavy line artifacts |
| **Anime / Illustration** | Clean cel-shaded output, no rendering artifacts in flat color | Consistent quality across anime sub-styles, no ripple artifacts in flat areas |

### True Ties (2/9 tests)

| Style | Context | Evidence |
|-------|---------|----------|
| **UGC / Influencer** | GPT for product labels, Gemini for candid authenticity | GPT: legible packaging text. Gemini: raw, imperfect energy that feels real |
| **Product / Luxury** | GPT for catalog precision, Gemini for editorial mood | GPT: accurate material physics. Gemini: superior wet surfaces and dramatic shadows |

### Key Artifact Note

GPT's compositional superiority is sometimes undermined by **wavy line artifacts** — particularly visible in:
- Volumetric fog/haze areas
- Flat color cel-shaded regions
- Atmospheric/smoke effects

When atmosphere or flat color purity is critical, Gemini is the safer choice regardless of GPT's compositional advantage.

---

## Model Variants

### GPT

| Model | Best for | Notes |
|-------|----------|-------|
| `gpt-image-2` | Production quality, highest fidelity | Latest, recommended default |
| `gpt-image-1` | Good all-round, stable | Slight warm color bias |
| `gpt-image-1-mini` | Drafts, rapid ideation, batch variants | Lower quality, fastest |

### Gemini

| Model | Best for | Notes |
|-------|----------|-------|
| Gemini 3 Pro Image | Typography-heavy, complex compositions | Best text rendering in Gemini family |
| Gemini 2.5 Flash Image | Speed-optimized, rapid iteration | Lower ceiling on complex work |
