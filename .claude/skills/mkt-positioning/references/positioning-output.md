# Positioning Output Format

Exact format for `brand_context/positioning.md`. All sections required.

---

```markdown
## Last Updated
{YYYY-MM-DD} by positioning skill

# {Brand/Product Name} — Positioning

## Primary Angle

**Name:** {Angle name, e.g., "The Capability Transfer"}
**Statement:** {One sentence positioning — clear, specific, differentiated}
**Psychology:** {Why this works with this audience at this market stage}
**Headline direction:** "{Example headline using this angle}"
**Best for:** {Market conditions and audience segments where this angle converts}

## Market Assessment

**Sophistication:** Stage {N} — {stage name}
**Transformation:** {What the customer's life looks like after — the core promise}
**Mechanism:** {The unique HOW — what makes the approach different}
**Primary alternative:** {What customers do instead of buying this}

## Competitive Landscape

**Competitors analyzed:**
- {Name} — "{their headline}"
- {Name} — "{their headline}"
- {Name} — "{their headline}"

**Saturated claims (avoid):**
- {Claim 1}
- {Claim 2}
- {Claim 3}

**White space identified:**
- {Gap 1 — what's missing in the market}
- {Gap 2}

## All Angles Explored

### Angle 1: {Name} ★ selected
- Statement: {one sentence}
- Psychology: {why it works}
- Headline: "{example}"
- Best for: {conditions}

### Angle 2: {Name}
- Statement: {one sentence}
- Psychology: {why it works}
- Headline: "{example}"
- Best for: {conditions}

### Angle 3: {Name}
- Statement: {one sentence}
- Psychology: {why it works}
- Headline: "{example}"
- Best for: {conditions}

{Continue for all angles generated — typically 3-5}

## Selection Rationale

{2-3 sentences explaining why the primary angle was chosen over alternatives.
Reference the competitive white space and market stage as supporting evidence.}
```

---

## Ad Testing Matrix (Optional)

If the user wants an ad testing matrix after selecting an angle, generate a 12-cell grid:

**4 rows (hooks derived from the selected angle):**
- H1: Direct statement hook (lead with the claim)
- H2: Question hook (lead with curiosity)
- H3: Proof hook (lead with evidence)
- H4: Contrarian hook (lead with a challenge)

**3 columns (ad formats):**
- Format A: Static image (single visual + headline)
- Format B: Video (talking head or motion + headline)
- Format C: Carousel (multi-slide story)

**Each cell contains:** Cell ID (e.g., H1-A), hook text tailored to format, visual concept (1 sentence), primary text (1-2 sentences), CTA text.

When built, the ad matrix schema will live at `projects/str-ad-matrix/00-schemas/ad-matrix.schema.json`.
