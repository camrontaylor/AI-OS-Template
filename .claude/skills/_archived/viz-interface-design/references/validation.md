# Pattern Persistence & Validation

How to manage `.interface-design/system.md` — the file that carries design decisions across sessions.

---

## When to Save Patterns

Save a pattern when:
- A component has been used **2+ times** in the project
- The pattern is **reusable across different screens** of the same project
- Specific measurements (padding, radius, height) are **worth remembering** exactly
- A **design decision was made** that should apply to all future work on this project (e.g., "we use borders-only depth strategy" or "primary color is traced to agricultural soil tones")

Don't save:
- **One-off components** that won't appear elsewhere
- **Temporary experiments** the user hasn't confirmed
- **Prop-handled variations** (e.g., "small button" vs "large button" — these are props, not patterns)
- **Generic patterns** that any project would have (e.g., "use consistent spacing" — too obvious to be useful)

---

## What to Save

The `system.md` file should contain:

### 1. Design Direction (from Step 3)

```markdown
## Direction

**Intent:** [The one-sentence intent statement]
**Domain:** [The product domain and key concepts]
**Signature:** [The unique element]

### Palette
- `--brand-primary: hsl(...)` — [why, traced to domain]
- `--brand-secondary: hsl(...)` — [why]
- [semantic colors with rationale]

### Depth Strategy
[Which strategy was chosen and why]

### Typography
- Headings: [typeface, why]
- Body: [typeface, why]
- Data: [typeface, why]

### Spacing
- Base unit: [4px/8px, why]
```

### 2. Confirmed Patterns

```markdown
## Patterns

### Metric Card
- Height: 120px
- Padding: 20px
- Border-radius: 8px
- Value: 32px / 600 weight
- Label: 12px / 500 weight / uppercase / 0.04em tracking

### Data Table Row
- Height: 48px
- Padding: 0 16px
- Hover: rgba(var(--brand-rgb), 0.04)
- [etc.]
```

### 3. Rejected Defaults

```markdown
## Rejected Defaults
- No left sidebar — workflow is linear (use top nav instead)
- No card grid for metrics — relationships matter more than individual numbers
- No blue primary — traced color to [domain element] instead
```

This section is valuable because it prevents future sessions from re-defaulting to things that were already consciously rejected.

---

## Consistency Checks

When reading `system.md` at the start of a new session, verify:

1. **Spacing is on grid** — all saved values are multiples of the base unit
2. **Depth uses the declared strategy** — no mixing shadows and borders if "borders-only" was chosen
3. **Colors are from the palette** — no hard-coded values that bypass the token system
4. **Documented patterns are actually reused** — if a "confirmed pattern" only appears once in the current codebase, it's a candidate for removal

---

## Updating system.md

- **Add patterns** after they've been confirmed by the user and used 2+ times
- **Update patterns** when the user requests a change that affects a saved pattern
- **Remove patterns** when they're no longer relevant (project pivot, design refresh)
- **Always ask before updating** — "I'd like to save these patterns to your system file for next time. OK?"
- **Keep it concise** — system.md should be scannable in 30 seconds. If it's growing past ~100 lines, consolidate or remove stale entries.
