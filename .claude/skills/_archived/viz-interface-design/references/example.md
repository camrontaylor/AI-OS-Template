# Subtle Layering — Concrete Examples

This reference demonstrates the subtle layering principle with specific implementation decisions. Use these patterns as a starting point, not a template — adapt the specific values to your product's domain and chosen depth strategy.

---

## Surface Elevation in Practice

Each elevation jump is only a few percentage points of lightness. The eye registers grouping without processing a color change.

### Light Mode

```css
:root {
  /* Canvas — the deepest background */
  --bg-canvas: hsl(220, 14%, 96%);

  /* Level 1 — cards, primary panels */
  --bg-surface: hsl(220, 14%, 99%);

  /* Level 2 — dropdowns, popovers */
  --bg-elevated: hsl(0, 0%, 100%);

  /* Level 3 — modals, command palette */
  --bg-overlay: hsl(0, 0%, 100%);
  --overlay-backdrop: rgba(0, 0, 0, 0.3);
}
```

### Dark Mode

In dark mode, higher elevation = slightly lighter (opposite of light mode):

```css
:root[data-theme="dark"] {
  --bg-canvas: hsl(220, 12%, 8%);
  --bg-surface: hsl(220, 12%, 11%);
  --bg-elevated: hsl(220, 12%, 14%);
  --bg-overlay: hsl(220, 12%, 16%);
  --overlay-backdrop: rgba(0, 0, 0, 0.5);
}
```

---

## Border Technique

Use `rgba` — not solid hex — so borders blend with whatever background they sit on. The border should be felt, not seen.

```css
:root {
  --border-subtle: rgba(0, 0, 0, 0.05);    /* Barely there — sidebar edges */
  --border-default: rgba(0, 0, 0, 0.08);   /* Standard — card edges */
  --border-emphasis: rgba(0, 0, 0, 0.12);  /* Noticeable — input borders */
}

/* Dark mode: use white-based rgba instead */
:root[data-theme="dark"] {
  --border-subtle: rgba(255, 255, 255, 0.05);
  --border-default: rgba(255, 255, 255, 0.08);
  --border-emphasis: rgba(255, 255, 255, 0.12);
}
```

The key insight: because the border color is semi-transparent, it automatically adapts to any background it sits on. A card on the canvas and a card inside a modal both get borders that look "right" without separate tokens.

---

## Sidebar Pattern

The sidebar uses the **same background as the canvas**, not a contrasting color. Separation comes from a single subtle border on the right edge.

```css
.sidebar {
  background: var(--bg-canvas);           /* Same as page background */
  border-right: 1px solid var(--border-subtle);
  width: 240px;
}

/* Active nav item — brand color at very low opacity */
.nav-item.active {
  background: rgba(var(--brand-rgb), 0.08);
  color: var(--brand-primary);
  border-radius: var(--radius-sm);
}

/* Hover — even lower opacity */
.nav-item:hover:not(.active) {
  background: rgba(var(--brand-rgb), 0.04);
}
```

Why this works: The interface reads as one continuous surface with logical regions, rather than two competing color blocks fighting for attention. Vercel and Supabase dashboards demonstrate this pattern well.

---

## Dropdown / Popover

Dropdowns sit one elevation level above their parent. The shadow is minimal — just enough to suggest "this is above the surface."

```css
.dropdown {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  padding: var(--space-1);
}

.dropdown-item {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  transition: background 100ms ease;
}

.dropdown-item:hover {
  background: rgba(var(--brand-rgb), 0.06);
}
```

---

## Form Inputs

Inputs use a slightly darker background than their parent surface. This creates an "inset" visual signal — "this is a place to type."

```css
.input {
  background: var(--control-bg);                  /* Darker than card surface */
  border: 1px solid var(--border-emphasis);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text-primary);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.input:hover {
  border-color: var(--border-strong);
}

.input:focus {
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 2px rgba(var(--brand-rgb), 0.12);
  outline: none;
}

.input::placeholder {
  color: var(--text-muted);
}
```

---

## The Squint Test

After building a component or view, apply this validation:

1. **Blur your eyes** (or zoom out to 25%) — can you still perceive the hierarchy? You should see regions, levels, and groupings without reading any text.

2. **Check for harshness** — nothing should jump out as a hard edge or dramatic contrast. If a border or shadow catches your eye before the content does, it's too strong.

3. **Check for flatness** — conversely, if everything blurs into one undifferentiated surface, the elevation differences are too subtle. Increase by 1-2 percentage points.

4. **Regions should be distinguishable** — sidebar, header, content area, and any panels should read as separate zones through tonal shifts alone.

The goal: hierarchy is visible, nothing is harsh, everything breathes.
