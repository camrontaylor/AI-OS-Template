# Technical Annotation Style

(Upgraded version of the original "technical" preset)

## When to Use

Architecture diagrams, workflow annotations, code review markup, CTO schematics, system design documents, infrastructure diagrams, red-lined UI reviews, annotated screenshots, API flow diagrams.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Technical system or UI rendered with high fidelity, overlaid with hand-drawn annotation layer — circles, arrows, handwritten notes in marker | Two layers: precise base + loose annotations |
| Framing | Full diagram view, generous padding for annotation space, clean grid alignment of base elements, annotations breaking the grid intentionally | Grid for the system, gestural for the commentary |
| Lighting | Flat, even — technical diagrams have no lighting. Clean white or subtle grid background | Any shadow/lighting competes with information |
| Mood | Professional authority, "senior engineer explaining" clarity, technical confidence with human warmth of handwriting | Authoritative but approachable |
| Medium | Digital rendering (base layer) + hand-drawn marker/pen (annotation layer). Base: crisp vector. Annotations: single high-contrast color (red marker default) | The dual-layer nature is the signature |
| Style | "The CTO's marked-up schematics" — engineering whiteboard + digital precision | Think: senior dev reviewing a PR on a whiteboard |

## Model Recommendation

**GPT preferred** — better text rendering for labels, more coherent layout logic, cleaner technical diagram structure.

**Evidence:**
- Technical diagrams require both readable text labels AND structural accuracy
- GPT handles the dual-layer concept (clean base + loose annotations) more reliably
- Gemini can produce the style but text labels are less reliable, annotations sometimes merge with base layer

## Example Breakdown

**Request:** "Annotated API architecture diagram"

```
Subject: Microservices architecture with 4 services (Auth, Users, Orders, Payments) connected by arrows, each service as a rounded rectangle with an icon, overlaid with red marker annotations circling the "Auth" service and arrows pointing to notes saying "rate limit here" and "new JWT flow"
Framing: Full diagram centered, 16:9 landscape, generous margins for annotations to spill into, services arranged in a logical grid
Lighting: Flat, none — clean white background with subtle dot grid
Mood: Technical authority with human commentary — a senior architect explaining decisions
Medium: Base layer: clean vector rendering with crisp edges, solid fills, readable labels. Annotation layer: red marker pen, slightly uneven line weight, gestural circles and arrows, handwritten-style text
Style: Engineering whiteboard — digital diagram precision with hand-drawn review markup, tech startup documentation aesthetic
---
Aspect Ratio: 16:9
Model: GPT (text labels must be accurate on both base and annotation layers)
Key Details: Clear visual separation between the "polished" base layer and "rough" annotation layer, annotations feel spontaneous not designed, red marker color consistent throughout
```

**Prompt:** A microservices architecture diagram on a clean white background with subtle dot grid, rendered in 16:9 landscape format. The base layer shows four services as rounded rectangles arranged in a 2x2 grid — "Auth" (lock icon), "Users" (person icon), "Orders" (cart icon), and "Payments" (card icon) — each with crisp vector edges, light gray fills, and bold black labels. Connecting arrows between services show API relationships with clean solid lines. Overlaid on this precise digital diagram is a red marker annotation layer — a gestural circle drawn around the Auth service with slightly uneven line weight, an arrow pointing to handwritten text reading "rate limit here", and another annotation near the Auth-to-Users connection reading "new JWT flow" with an underline. The annotations feel spontaneous and hand-drawn, contrasting with the precision of the base diagram. The overall feel is a senior architect reviewing system design on a whiteboard — technical authority with human warmth. Include ONLY the text shown: "Auth", "Users", "Orders", "Payments", "rate limit here", "new JWT flow" — no additional labels.

## Known Pitfalls

- Both layers must be visually distinct — specify "crisp vector base, loose hand-drawn annotations"
- Red marker must be a single consistent color — models sometimes use multiple annotation colors
- Handwritten annotation text is harder to render — keep annotation labels to 2-4 words max
- Without explicit "dot grid background" specification, models produce solid white (less technical feeling)
- The base diagram must be simple enough that annotations are readable — don't overcrowd

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** Cleaner label text, better structural layout, maintains two-layer separation more reliably
- **Gemini:** Can produce the style but annotations sometimes merge with base layer, text labels less accurate
- **Verdict:** GPT preferred — the style depends on text accuracy in both layers and clear visual hierarchy
