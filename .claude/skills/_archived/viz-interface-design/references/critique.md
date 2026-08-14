# Design Review Framework

Use this framework when reviewing a built interface — either your own work (Step 5 of the methodology) or when asked to critique an existing design. The framework distinguishes between "correct" (it works) and "crafted" (someone cared about every pixel).

---

## Four Dimensions

### 1. Composition

**What to check:**
- Does the layout have rhythm? Repeating elements should create a visual cadence, not a monotone grid.
- Are proportions purposeful? The sidebar width, the content area ratio, the header height — each should serve the content, not match a template.
- Is there a clear focal point? One element should draw the eye first. In a dashboard, it's usually the primary metric or the most actionable status.
- Does whitespace serve the hierarchy? More space around important elements, tighter grouping for related items.

**Correct vs. Crafted:**
- Correct: Elements align to a grid, spacing is consistent
- Crafted: The grid itself was chosen to serve this specific content. Spacing variations create intentional rhythm. The eye follows a natural path through the information.

### 2. Craft

**What to check:**
- Is spacing on a consistent grid? Every value should be a multiple of the base unit. Use browser dev tools — if you see 13px, 17px, 22px, the grid is broken.
- Does typography hierarchy work through weight, tracking, and opacity — not just size? A design with 5 font sizes and 1 weight is less sophisticated than one with 3 sizes and 3 weights.
- Do surfaces whisper hierarchy through tonal shifts? Check the lightness values — the jump between elevation levels should be 2-4%, not 10-15%.
- Are interaction states complete? Every clickable element needs hover, focus, active, and disabled states. Missing states feel unfinished.
- Are borders and shadows consistent with the chosen depth strategy? No mixing approaches within the same interface.

**Correct vs. Crafted:**
- Correct: Elements are styled, colors are applied, layout works
- Crafted: Every pixel-level decision has a reason. Hover states feel like a natural extension, not an afterthought. The depth strategy is cohesive — you can't point to an inconsistency.

### 3. Content

**What to check:**
- Does every screen tell one coherent story? A dashboard showing revenue, user signups, and server health is three stories fighting for attention. Group by narrative, not by data type.
- Is the data plausible? Numbers should tell a realistic story — growth patterns, seasonal variation, expected ratios. "1,234,567" is obviously fake. "$847,293" with a 12.3% increase from last quarter is believable.
- Are empty states handled? What does this screen look like with zero data? With one item? With thousands? Each state should feel designed, not broken.
- Are labels and descriptions helpful? "Revenue" is a label. "Monthly recurring revenue, updated hourly" is helpful context. But don't over-explain — "Click here to view details" is noise.

**Correct vs. Crafted:**
- Correct: Real words are used, data appears in the right places
- Crafted: The content itself guides the user through a narrative. Empty states feel like an invitation, not an error. Every label earns its space.

### 4. Structure

**What to check (if reviewing code):**
- Is CSS clean? No negative margin hacks. No `calc()` workarounds for things the grid should handle. No absolute positioning escapes.
- Are components properly scoped? Styles shouldn't leak between components.
- Is the token system used consistently? Check for hard-coded colors, font sizes, or spacing values that should be tokens.
- Is the HTML semantic? Buttons are `<button>`, links are `<a>`, headings are `<h1>`–`<h6>`. Accessibility isn't a feature — it's correctness.

**Correct vs. Crafted:**
- Correct: Code works, renders properly, no bugs
- Crafted: Another developer reading this code would understand the design system through the code alone. Tokens tell a story. Component structure mirrors visual hierarchy.

---

## The Closing Question

After reviewing against all four dimensions, ask yourself:

> "If a designer with extremely high standards said this lacks craft, what would they point to?"

Whatever you just thought of — fix that thing. Then ask again. When you can't think of anything, the review is complete.
