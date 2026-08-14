# Craft Principles

The complete design system for building interfaces that feel crafted, not assembled. Read this before writing any component code.

## Table of Contents

1. Surface & Token Architecture
2. Spacing System
3. Depth & Elevation
4. Card Layouts
5. Controls & Form Elements
6. Typography
7. Iconography
8. Animation & Transitions
9. Navigation Context
10. Dark Mode
11. Things to Avoid

---

## 1. Surface & Token Architecture

Design tokens aren't just CSS variables — they're the vocabulary of the interface. Name them so they carry domain meaning alongside their function.

### Primitives

Every interface needs these semantic layers:

- **Foreground tokens** — text at multiple emphasis levels (primary, secondary, tertiary, muted)
- **Background tokens** — surface colors at each elevation level
- **Border tokens** — with a progression from subtle to strong (default, subtle, strong, stronger)
- **Brand tokens** — primary action color, hover/active states, and text-on-brand
- **Semantic tokens** — success, warning, error, info — each with background, border, and text variants

### Elevation Hierarchy (5 levels)

```
Level 0: Page canvas (deepest background)
Level 1: Primary content surfaces (cards, panels)
Level 2: Raised elements (dropdowns, popovers)
Level 3: Overlays (modals, command palettes)
Level 4: System-level (toasts, alerts)
```

Each level shifts lightness by only a few percentage points. The jump from Level 0 to Level 1 should be barely perceptible — you notice the grouping, not the color change.

### Text Hierarchy

Build hierarchy through weight, tracking, and opacity — not just size:

```css
--text-primary: rgba(foreground, 0.95);    /* Main content */
--text-secondary: rgba(foreground, 0.70);  /* Supporting info */
--text-tertiary: rgba(foreground, 0.50);   /* Labels, captions */
--text-muted: rgba(foreground, 0.35);      /* Disabled, hints */
```

### Border Progression

```css
--border-default: rgba(foreground, 0.08);   /* Card edges */
--border-subtle: rgba(foreground, 0.05);    /* Sidebar dividers */
--border-strong: rgba(foreground, 0.15);    /* Input borders */
--border-stronger: rgba(foreground, 0.25);  /* Focus rings */
```

### Control Tokens

Form elements need dedicated tokens separate from content surfaces:

```css
--control-bg: /* slightly darker than parent surface */
--control-bg-hover: /* one step lighter */
--control-bg-active: /* matches hover or slightly darker */
--control-border: /* matches --border-strong */
--control-border-focus: /* brand color at reduced opacity */
```

---

## 2. Spacing System

Pick a base unit (4px for dense interfaces, 8px for spacious ones) and build everything from its multiples.

### Scale

| Context | Multiple | Example (4px base) |
|---------|----------|-------------------|
| Micro | 1x | 4px — icon-to-label gap |
| Tight | 2x | 8px — within components |
| Component | 3x | 12px — component padding |
| Comfortable | 4x | 16px — between components |
| Section | 6x | 24px — section margins |
| Major | 8x | 32px — page-level spacing |
| Landmark | 12x+ | 48px+ — hero sections, major breaks |

### Rules

- **Symmetrical padding** — if horizontal padding is 16px, vertical should be 12px or 16px, not 7px
- **Consistent gaps** — pick one gap size per context (all cards use the same gap, all form fields use the same gap)
- **Padding mirrors hierarchy** — more important containers get more breathing room
- **Never eyeball it** — every spacing value should be a multiple of the base unit

---

## 3. Depth & Elevation

Choose ONE approach and commit to it across the entire interface. Mixing strategies (shadows here, borders there, color shifts elsewhere) creates visual noise.

### Strategy A: Borders Only (Flat / Technical)

Best for: developer tools, terminals, code-heavy interfaces.

```css
.surface-1 {
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
}
.surface-2 {
  background: var(--bg-primary);
  border: 1px solid var(--border-strong);
}
```

No shadows. Hierarchy comes from border weight and background tint.

### Strategy B: Subtle Shadows (Approachable)

Best for: SaaS products, admin panels, dashboards.

```css
.surface-1 {
  background: var(--bg-elevated);
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.surface-2 {
  background: var(--bg-elevated);
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
```

Shadows are barely visible — you feel the depth without seeing the shadow.

### Strategy C: Layered Shadows (Premium)

Best for: design tools, creative platforms, high-end products.

```css
.surface-1 {
  box-shadow:
    0 1px 1px rgba(0,0,0,0.02),
    0 2px 4px rgba(0,0,0,0.03);
}
.surface-2 {
  box-shadow:
    0 1px 2px rgba(0,0,0,0.03),
    0 4px 12px rgba(0,0,0,0.05),
    0 8px 24px rgba(0,0,0,0.03);
}
```

Multiple shadow layers create a more realistic depth perception.

### Strategy D: Surface Color Shifts (Minimal)

Best for: content-focused interfaces, reading apps, minimal UIs.

```css
.surface-0 { background: hsl(220, 10%, 96%); }
.surface-1 { background: hsl(220, 10%, 98%); }
.surface-2 { background: hsl(220, 10%, 100%); }
```

No borders, no shadows. Hierarchy comes purely from background lightness shifts.

---

## 4. Card Layouts

Cards are the building block of dashboards, but they become generic fast. Prevent this by giving each card type its own internal structure while maintaining consistent surface treatment.

### Metric Cards

- Value is the hero — largest text, highest contrast
- Label is secondary — smaller, muted
- Trend indicator (if present) uses semantic color, not brand color
- Internal padding matches the spacing scale
- Don't put an icon just because there's space

### Data Cards (tables, lists)

- Header row is structurally distinct (border-bottom, slight weight increase)
- Row hover uses a subtle background shift, not a border or shadow
- Active/selected row uses brand color at very low opacity as background
- Actions (edit, delete) appear on hover, not always visible
- Monospace with `font-variant-numeric: tabular-nums` for numeric columns

### Settings Cards

- Group related controls under a single surface
- Label+description left, control right (or label above, control below for complex inputs)
- Dividers between groups use the subtle border token
- Save/cancel actions at the card level, not per-field

---

## 5. Controls & Form Elements

Never use unstyled native form elements in a designed interface. Build custom controls that match the token system.

### Inputs

```css
input {
  background: var(--control-bg);        /* darker than parent — "type here" signal */
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
input:focus {
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 2px rgba(var(--brand-rgb), 0.15);
  outline: none;
}
```

### Selects / Dropdowns

- Custom trigger button styled as an input
- Dropdown panel sits one elevation above its parent
- Selected option shows a subtle checkmark, not a background change
- Keyboard navigation is not optional

### Checkboxes / Toggles

- Custom-drawn, not styled native checkboxes
- Check animation: 150ms, ease-out
- Disabled state uses muted opacity, not a different color

### Buttons

```
Primary: brand background, white text, subtle shadow on hover
Secondary: transparent background, brand text, border on hover
Ghost: transparent background, muted text, background tint on hover
Destructive: red palette, same hierarchy as primary/secondary
```

All buttons: consistent height (matches input height), consistent padding, 150ms hover transition.

---

## 6. Typography

### Hierarchy through multiple properties

Don't rely on size alone. Combine size, weight, letter-spacing, and opacity:

```css
.heading-1   { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
.heading-2   { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
.body         { font-size: 14px; font-weight: 400; letter-spacing: 0; }
.label        { font-size: 12px; font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase; }
.caption      { font-size: 12px; font-weight: 400; color: var(--text-tertiary); }
```

### Data typography

- Use `font-variant-numeric: tabular-nums` for any numeric data in tables or metrics
- Monospace for IDs, codes, hashes, timestamps
- Right-align numeric columns in tables

### Line height

- Headings: 1.2–1.3
- Body text: 1.5–1.6
- UI labels: 1 (single line, vertically centered)

---

## 7. Iconography

- **Clarify, not decorate.** Every icon must answer "what does this do?" or "what does this mean?" If removing the icon doesn't reduce comprehension, remove it.
- **One consistent set.** Don't mix Lucide, Heroicons, and custom SVGs. Pick one library and stay with it.
- **Size consistency.** 16px for inline/compact, 20px for standard UI, 24px for featured.
- **Stroke icons** for navigation/actions, **filled icons** for active/selected states.
- **Icon-only buttons** need a tooltip. No exceptions.

---

## 8. Animation & Transitions

### Timing

| Context | Duration | Example |
|---------|----------|---------|
| Micro-interaction | 100–150ms | Button hover, checkbox check |
| Component transition | 200–250ms | Dropdown open, panel slide |
| Page transition | 300–400ms | View switch, modal enter |

### Easing

- **Deceleration** (`ease-out` / `cubic-bezier(0.0, 0.0, 0.2, 1)`) for elements entering
- **Acceleration** (`ease-in` / `cubic-bezier(0.4, 0.0, 1, 1)`) for elements leaving
- **Standard** (`ease-in-out`) for position changes
- **Never** use `linear` for UI animations
- **Never** use spring/bounce in professional interfaces — it undermines authority

### What to animate

- State changes (hover, focus, active, disabled)
- Entry/exit of overlays (fade + slight translate)
- Expansion/collapse (height with overflow hidden)
- Loading states (skeleton pulse or spinner)

### What NOT to animate

- Color theme changes (instant)
- Data updates in tables (instant, highlight briefly if needed)
- Scroll position
- Layout reflows caused by content loading

---

## 9. Navigation Context

Every screen needs grounding — the user should always know where they are and how they got here.

- **Persistent nav** (sidebar or top bar) shows the current location with an active state
- **Breadcrumbs** for deep hierarchies (3+ levels)
- **Page title** matches the nav item text exactly
- **Sidebar** uses the same background as the content canvas, separated by a subtle border — not a dramatically different color
- **Active nav item** uses brand color at low opacity as background, not a solid block
- **User context** (avatar, name, role) visible in nav for multi-user systems

---

## 10. Dark Mode

If building a dark mode variant:

- **Borders over shadows** — shadows are nearly invisible on dark backgrounds
- **Desaturate semantic colors** — full-saturation red/green/yellow are harsh on dark backgrounds. Reduce saturation by 15–25%.
- **Same hierarchy system, inverted values** — Level 0 is darkest, Level 4 is lightest (but still dark)
- **Background range:** `hsl(220, 10%, 8%)` (canvas) to `hsl(220, 10%, 18%)` (elevated)
- **Text:** `rgba(255,255,255, 0.87)` for primary, stepping down to `0.38` for muted
- **Never use pure black** (`#000`) as a background — it creates too much contrast with text

---

## 11. Things to Avoid

These are signals of unintentional design — defaults that crept in because no one actively chose otherwise:

- Harsh borders (1px solid with high-contrast colors)
- Dramatic surface jumps (white cards on gray background)
- Inconsistent spacing (mixing pixel values that aren't on the grid)
- Mixed depth strategies (shadows on some cards, borders on others)
- Missing interaction states (no hover, no focus, no active)
- Dramatic drop shadows (`box-shadow: 0 4px 20px rgba(0,0,0,0.2)`)
- Pure white cards on colored backgrounds (creates a "floating paper" look)
- Gradients for decoration (gradients should serve a purpose — progress, heat maps, depth)
- Multiple accent colors competing for attention
- Default border-radius on everything (`rounded-lg` everywhere is a default, not a choice)
- Using blue as primary "because it's professional" (it's a default, trace your color to domain)
