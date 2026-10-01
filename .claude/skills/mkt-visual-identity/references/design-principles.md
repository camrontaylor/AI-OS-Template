# Design Principles (Universal)

Brand-agnostic principles that apply to ANY carousel/post the skill generates. The audit in `ssc-designer` checks these on every slide. The specific MOVES that implement each principle are per-brand (see `composition-extraction-method.md`).

Think of it as: **principles are the laws of physics; moves are how a particular building obeys them.**

---

## The 10 principles

### 1. Visual hierarchy
The eye should find ONE element first, a second one second, a third one third. Not three things competing.

**Check programmatically:**
- At least 3 distinct typographic sizes used on the slide (display, secondary, body)
- Largest text occupies ≥6% of canvas height (≥80px at 1080×1350)
- Color saturation drop between primary and supporting elements (primary accent is full saturation, secondary text is muted)

**Audit fail:** all text is the same size · no clear lead element · two elements compete for "loudest"

---

### 2. Anchor element
Every slide needs ONE dominant element that the eye lands on first. Without it, the slide is a list, not a composition.

**Check programmatically:**
- One element (text block, image, illustration, or oversized graphic) occupies ≥30% of canvas area
- That element has the highest visual weight (largest size OR strongest contrast OR most saturated color)

**Audit fail:** slide is just headline + body in upper third, bottom 60% empty · all elements roughly equal in weight

---

### 3. Intentional whitespace
Empty space must be a CHOICE, not an accident. A breathing slide and an empty slide look different.

**Check programmatically:**
- Whitespace ratio between 30% and 65% of canvas (less = cramped, more = vacant)
- Whitespace is distributed: at least 2 "breath zones" around content, not all the empty pixels piled at the bottom
- Canvas margins consistent (e.g., 60-100px on all four sides)

**Audit fail:** ≥70% of canvas is single uniform empty region · content all top-aligned with no balancing element below

---

### 4. Layering / depth
At least two visual planes — background and foreground — distinguishable by some signal (color shift, texture, shadow, scale).

**Check programmatically:**
- ≥2 z-index layers used in the HTML
- At least one of: background texture (noise/gradient), decorative element behind text, overlapping shape, soft shadow on a card
- Without layering: slide is "PowerPoint flat" — instant tell for AI-generated

**Audit fail:** every element on same z-index with no background treatment

---

### 5. Contrast (multi-axis)
Contrast must work on ≥2 axes from this list: size, weight, color, case (lower vs UPPER), style (serif vs sans, italic vs roman), texture (smooth vs grainy).

**Check programmatically:**
- At least 2 axes of contrast present between headline and body
- E.g., headline (large + bold + lowercase) vs body (small + regular + ALL CAPS eyebrow tag) = 3 axes

**Audit fail:** only size contrast (everything else identical) · no contrast at all

---

### 6. Repetition (cross-slide pattern)
Some moves repeat across every slide of the carousel → reads as a "series". Without repetition, slides feel disconnected.

**Check programmatically:** (this audit runs across all slides, not per slide)
- ≥2 design moves from the brand catalog appear on EVERY content slide
- Consistent canvas margins across all slides
- Consistent page indicator position
- Consistent treatment of the brand mark / logo

**Audit fail:** each slide has a totally different vibe · margins/positions vary randomly

---

### 7. Alignment (sharp edges)
Elements align to a shared grid — not floating wherever. Misalignment of even 4px reads as careless.

**Check programmatically:**
- All major elements snap to a baseline grid (e.g., 8px or 16px units)
- Body text left edge aligns with headline left edge (or has intentional indent)
- Right edges align consistently (page number right edge, swipe pill right edge)

**Audit fail:** body text 23px from left edge while headline is 80px · accent bar positioned at arbitrary y

---

### 8. Proximity (related = close, unrelated = apart)
Related items are visually grouped via proximity. The "Layer 01" eyebrow sits ON the headline it labels, not floating 200px away.

**Check programmatically:**
- Eyebrow tag within 30px above its headline (not floating)
- Caption text within 30px of the image it describes
- CTA button within 60px of the message it punctuates

**Audit fail:** eyebrow tag at top, headline at middle, no visual connection

---

### 9. One bold move per slide
Pick one element to be the "loud" one. Not three. Not zero.

**Check programmatically:**
- Exactly ONE element uses brand accent color (or saturated/bold form)
- OR exactly one element uses ALL CAPS
- OR exactly one element uses italic / underline / oversized treatment
- Multiple "loud" elements compete → confusion. Zero "loud" elements → flat.

**Audit fail:** every word in accent color · or no accent anywhere · or 3 different styles fighting

---

### 10. Functional decoration
Decorative elements (dot patterns, accent bars, corner marks) serve a purpose — anchor a corner, balance whitespace, signal brand. They are NOT random ornaments.

**Check programmatically:**
- Each decorative element has a justifiable position (anchors empty corner, separates sections, marks page)
- No "filler" decoration just to occupy space without purpose
- Decoration consistent with brand catalog (per-brand moves in `brand_context/visual-identity/moves.md`)

**Audit fail:** floating geometric shapes with no relationship to content · sparkles/stars unrelated to brand

---

## Audit thresholds summary (machine-checkable)

| Audit | Pass criteria | Source |
|---|---|---|
| `7.1_hierarchy` | ≥3 type sizes; lead text ≥6% canvas height | universal |
| `7.2_anchor` | One element ≥30% canvas area, highest visual weight | universal |
| `7.3_whitespace` | 30-65% empty ratio; distributed across ≥2 zones | universal |
| `7.4_layering` | ≥2 z-index used; ≥1 background treatment | universal |
| `7.5_contrast` | ≥2 contrast axes between H1 and body | universal |
| `7.6_repetition` (cross-slide) | ≥2 moves from brand catalog on every content slide | universal threshold + per-brand list |
| `7.7_alignment` | Major elements snap to grid; canvas margins consistent | universal |
| `7.8_proximity` | Related elements within proximity threshold | universal |
| `7.9_one_bold_move` | Exactly one "loud" element per slide | universal |
| `7.10_functional_decoration` | Decoration justifiable (position/purpose); from brand catalog | universal + per-brand |

---

## How brand specificity plugs in

These principles are constants. What changes per brand is **WHICH MOVES** the brand uses to implement them.

For a hypothetical editorial-tech brand:
- Layering → paper/concrete texture overlay
- Anchor → oversized illustration OR big bold headline
- One bold move → single orange word per slide
- Functional decoration → dot pattern top-right + accent bar

For a hypothetical sport-media brand:
- Layering → photo bg + dark gradient overlay
- Anchor → action photo bleed-edge
- One bold move → score number gigantic
- Functional decoration → team crest corner, score divider

Same principles. Different moves. The audit checks the principles (universal). The brand catalog (extracted by `mkt-visual-identity`) lists the available moves.

This is what scales: **principles fixed, moves variable, both consumed by one audit**.

---

## Anti-patterns the audit flags

Independent of brand:

1. **PowerPoint-flat slide** — all elements on one z-index, no texture, no shadow → fail `7.4_layering`
2. **Vacant slide** — 70%+ of canvas empty in one region → fail `7.3_whitespace`
3. **Floating elements** — accent bar bottom-left with no grid alignment → fail `7.7_alignment`
4. **Rainbow slide** — 4+ saturated colors competing → fail `7.9_one_bold_move`
5. **Decorative-for-decorative-sake** — stars/sparkles/gradients not in brand catalog → fail `7.10_functional_decoration`
6. **Carousel with no thread** — slides have no consistent margin/position/move → fail `7.6_repetition`
7. **Same-size monotone** — only one type size used → fail `7.1_hierarchy`

These should be loud failures, not warnings. Generic-looking slides are almost always one of these seven.
