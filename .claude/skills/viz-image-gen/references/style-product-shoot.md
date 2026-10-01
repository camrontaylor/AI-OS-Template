# Product Shoot Mode

## When to Use

Generating **multiple consistent product shots** from a single reference image. The user provides one product photo and wants a coordinated set of shots across different contexts — hero, detail, flat lay, lifestyle — all showing the same product faithfully.

This is NOT the same as the Product / Luxury preset (single premium shot). Product Shoot Mode is a **multi-image workflow** focused on product consistency across scene changes.

## Trigger Conditions

- User provides a product image + wants "multiple shots", "product shoot", "shot list", "all angles"
- User says "hero shot and lifestyle shot of this product"
- User wants consistent product across different backgrounds/contexts
- E-commerce product photography sets, social media content kits

## Product Shoot Workflow

### Phase 1: Product Analysis

Read the reference image and extract a **Product Lock Description** — a detailed paragraph that anchors every generation:

```
Product Lock: [Brand name if visible] [product type] — [color], [material/finish], [shape/form factor], [distinctive features: logo placement, label text, cap/lid style, texture, proportions]. [Packaging details: box, sleeve, bottle shape]. [Size reference if determinable].
```

Example:
> Product Lock: Aesop Resurrection Aromatique Hand Balm — matte cream tube with minimalist black sans-serif label, dark brown screw cap, pharmaceutical-grade aluminum tube with subtle matte texture, approximately 75ml size. Label reads "Resurrection Aromatique Hand Balm" in small uppercase Helvetica. Tube has slight curve at shoulder where cap meets body.

This paragraph is **prepended to every prompt** in the shoot to maintain consistency.

### Phase 2: Shot List

Present these standard product photography types. User picks which ones (or "all"):

| Shot Type | Description | Framing | Surface/Context | Best For |
|-----------|-------------|---------|-----------------|----------|
| **Hero** | Clean, centered, editorial — the "money shot" | Low angle, product fills 50%, negative space | Wet marble, brushed concrete, or dark slate | Homepage, ads, social hero |
| **Detail / Macro** | Texture close-up, ingredient detail, label clarity | Extreme close-up, shallow DOF | Tight on product surface | Product page, ingredient focus |
| **Flat Lay** | Top-down, styled with complementary props | Directly overhead, 1:1 or 4:5 | Linen, wood, or styled surface with 3-5 props | Instagram grid, lifestyle blogs |
| **Lifestyle** | Product in-use, environmental, with people or context | Medium shot, environmental | Kitchen counter, bathroom shelf, desk, hands holding | Social media, editorial features |
| **Group / Collection** | Multiple products or variants together | Wide, product family fills frame | Unified surface, editorial arrangement | Brand pages, collection launches |
| **Unboxing / Packaging** | Product with packaging, partially opened | Medium, slight angle | Clean surface, tissue paper, box visible | E-commerce, gifting campaigns |

### Phase 3: Generate Each Shot

For each selected shot type:

1. **Start with the Product Lock paragraph** as the first sentence of every prompt
2. Add the shot-specific framing, lighting, surface, and mood
3. Use the reference image as `--input-image` so the model can see the actual product
4. Generate individually (not batched) for maximum quality per shot

### Phase 4: Grid Composite (Optional)

Generate the grid as a **single image** — describe the full layout and what goes in each cell in one prompt. The model handles the grid natively, which gives consistent lighting, color temperature, and style across all cells. No separate generation + PIL compositing needed.

**Grid Prompt Construction:**
1. Start with the Product Lock paragraph (as always)
2. Describe the grid structure: "A [N]-panel product photography grid with thin white borders between panels"
3. Describe each cell by position: "Top-left (large): ...", "Top-right: ...", "Bottom row, left: ..."
4. Specify that the hero cell should be the largest
5. End with overall mood and style direction

**Grid Layout Patterns:**

| Shot Count | Layout Description in Prompt |
|------------|------------------------------|
| 4 panels | "2x2 grid with the top-left panel slightly larger than the others" |
| 6 panels | "Editorial grid: one large hero panel top-left spanning two rows, a detail close-up top-right, and three smaller lifestyle panels along the bottom" |
| 3 panels | "Horizontal triptych with the center panel wider than the flanking panels" |
| 5 panels | "One large hero panel on the left spanning full height, four smaller panels stacked 2x2 on the right" |

**Grid Prompt Rules:**
1. **No text labels** — the grid is a visual asset, not a diagram
2. **Describe each panel's scene** using the same Product Lock description + that panel's unique context
3. **Specify thin white borders** between panels (the model handles the gaps)
4. **Hero gets the most space** — describe it as "large" or "spanning" in the layout
5. **Use 1:1 or 4:5 aspect ratio** for the overall grid image
6. **One generation call** — the entire grid is a single image

**Example 6-panel grid prompt:**
> [Product Lock paragraph]. A 6-panel editorial product photography grid with thin white borders between panels. Top-left panel (large, spanning two-thirds width): the product on white Carrara marble, low angle hero shot with dramatic shadow. Top-right panel (tall, spanning two rows): extreme close-up of the label text and packaging texture, shallow depth of field. Middle-left: overhead flat lay with the product surrounded by complementary props. Middle-center: hands holding the product, scooping from inside. Bottom-left (wide): the product on a minimal shelf next to a plant. Bottom-right: the product beside a freshly made latte on a kitchen counter, morning light. All panels share warm natural lighting and a cohesive blush-and-green color palette. Editorial product photography style.

## Framework Element Presets (Per Shot Type)

### Hero Shot

| Element | Preset |
|---------|--------|
| Subject | [Product Lock description], hero positioning, single product as sculpture |
| Framing | Low angle at product height, 40-60% fill, negative space for editorial context, 4:5 or 16:9 |
| Lighting | Hard key light from upper-left, long dramatic shadow, rim light from behind |
| Mood | Premium, aspirational, quiet confidence |
| Medium | Medium format (Hasselblad), 100mm macro, f/8, tack-sharp |
| Style | Apple product photography meets luxury fragrance campaign |

### Detail / Macro

| Element | Preset |
|---------|--------|
| Subject | [Product Lock description], extreme close-up on texture/label/material |
| Framing | Extreme macro, product detail fills 80%+ of frame, ultra-shallow DOF |
| Lighting | Soft directional to reveal texture, side lighting for embossing/engraving |
| Mood | Intimate discovery, tactile quality |
| Medium | 100mm macro lens, f/2.8, narrow focal plane |
| Style | Scientific beauty, material study |

### Flat Lay

| Element | Preset |
|---------|--------|
| Subject | [Product Lock description] centered, surrounded by 3-5 complementary props (ingredients, tools, lifestyle objects) |
| Framing | Directly overhead (top-down), 1:1 or 4:5, balanced composition with intentional negative space |
| Lighting | Soft even overhead light, minimal shadows, clean and bright |
| Mood | Curated, editorial, lifestyle |
| Medium | Digital, clean color science, even exposure |
| Style | Instagram flat lay, editorial still life, Kinfolk magazine |

### Lifestyle

| Element | Preset |
|---------|--------|
| Subject | [Product Lock description] in natural use context — hands holding, on a shelf, in a room |
| Framing | Medium shot, environmental context visible, product at 30-40% of frame |
| Lighting | Natural window light or warm interior ambient, soft and realistic |
| Mood | Authentic, aspirational but attainable, warm |
| Medium | DSLR or mirrorless, 35-50mm, natural depth of field |
| Style | Editorial lifestyle photography, Cereal Magazine, Kinfolk |

## Model Recommendation

- **GPT** for Hero and Detail shots — superior material accuracy, label text clarity, surface physics
- **Gemini** for Lifestyle and Flat Lay — better atmosphere, more natural environmental integration
- **Either** for Group shots — depends on whether precision or mood matters more
- When in doubt, use GPT for the full shoot for maximum product consistency across shots

## Product Lock Consistency Techniques

1. **Same description every time** — the Product Lock paragraph must be identical across all prompts (copy-paste, never paraphrase)
2. **Reference image on every call** — always pass the original product image as `--input-image`
3. **Explicit preservation language** — include "The product must appear exactly as shown in the reference image" in every prompt
4. **Color anchoring** — specify exact colors from the reference ("matte cream #F5F0E8 tube body, dark brown #3E2723 cap")
5. **Proportional consistency** — describe the product's proportions explicitly ("tube is approximately 4:1 height-to-width ratio")

## Known Pitfalls

- Generating all shots in one prompt produces inconsistent products — always generate individually
- Without a Product Lock paragraph, the model will drift between shots (different label text, wrong proportions)
- Lifestyle shots without specifying product size lead to scale errors — anchor with "product held in one hand" or "product on a bathroom shelf next to a standard soap dispenser"
- Flat lay props should complement but not overpower — specify "product is the clear focal point, props are secondary"
- Grid composites may show color temperature differences between shots — note this to the user as a limitation

## Example Product Lock + Hero Prompt

**Product Lock:** Matte black cylindrical candle with minimal white sans-serif label reading "NOIR 04", brushed aluminum lid with knurled edge, approximately 10cm tall, 8cm diameter, subtle wax texture visible at the top surface.

**Hero Prompt:** Matte black cylindrical candle with minimal white sans-serif label reading "NOIR 04" and a brushed aluminum lid with knurled edge sits on a slab of wet dark marble. The product must appear exactly as shown in the reference image — same proportions, same label typography, same matte black finish. Shot at product height from slight low angle, the candle occupies 50% of the frame with editorial negative space in the upper right. A hard key light from upper-left creates a dramatic long shadow stretching across the marble. The brushed aluminum lid catches a precise rim highlight. Shot on Hasselblad medium format with 100mm macro at f/8, the entire candle is tack-sharp while the marble softens at edges. The mood is quiet luxury — museum-quality stillness. Style references Byredo product campaigns crossed with Aesop minimalism.
