---
name: viz-excalidraw-diagram
description: >
  Generate Excalidraw diagram JSON files that make visual arguments — not
  just labelled boxes. Workflows, architectures, concepts, protocols,
  system designs. Triggers on: "excalidraw diagram", "draw a diagram",
  "visualize this workflow", "architecture diagram", "system diagram",
  "diagram this", "excalidraw", "create a diagram of". Builds
  section-by-section for large diagrams, renders to PNG via Playwright,
  and validates in a loop until the output is clean. Brand colors
  configurable via color-palette.md. Does NOT trigger for inline SVG
  diagrams, charts/graphs, or slide decks.
---

# Excalidraw Diagrams

A diagram should argue, not decorate. Every shape mirrors the behaviour of the concept it represents — fan-outs for one-to-many, timelines for sequences, convergence for aggregation. If you strip the text and the structure alone still communicates the idea, the diagram is doing its job.

## Outcome

`.excalidraw` JSON files saved to `projects/viz-excalidraw-diagram/{diagram-name}/`, rendered to PNG for validation.

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/voice-profile.md` | — | Not used |
| `brand_context/positioning.md` | — | Not used |
| `brand_context/icp.md` | — | Not used |
| `context/learnings.md` | `## viz-excalidraw-diagram` section | Apply previous feedback before starting |

Colour customisation lives in `references/color-palette.md` — edit that file to match any brand.

---

## Step 0: Ensure Renderer is Ready

Before anything else, check if the render pipeline is set up. Run:

```bash
cd .claude/skills/viz-excalidraw-diagram/references && test -d .venv && uv run python -c "from playwright.sync_api import sync_playwright; print('ready')" 2>/dev/null
```

If that doesn't print "ready", run the full setup silently:

```bash
cd .claude/skills/viz-excalidraw-diagram/references && uv sync && uv run playwright install chromium
```

Do this every time the skill is invoked — it's fast if already installed and prevents render failures later. Don't mention it to the user unless it fails.

## Step 1: Assess Depth

Before designing, decide which level the diagram needs:

**Simple / Conceptual** — abstract shapes, labels, relationships. Use when explaining mental models, philosophies, or high-level overviews where the audience already knows the details.

**Comprehensive / Technical** — concrete examples, real data formats, actual event names. Use when diagramming real systems, teaching how things work, or when the diagram itself needs to be educational. These require evidence artifacts (code snippets, JSON payloads, real API names). Read `references/evidence-and-depth.md` for the full protocol.

## Step 2: Research (Technical Diagrams Only)

For anything technical, look up the actual specs before drawing. Real event names, real JSON formats, real API endpoints. A diagram that uses placeholder labels like "Event 1" or "Input" when concrete alternatives exist is a missed opportunity.

## Step 3: Design the Visual Argument

Read `references/visual-patterns.md` for the full pattern library, shape vocabulary, and layout rules. Work out what each concept *does* (its relationships and core transformation), give each major concept a different visual pattern, keep text free floating unless the shape carries meaning (aim for fewer than 30% of text elements in containers), and make the diagram read as one path from entry to exit.

For comprehensive diagrams, also read `references/evidence-and-depth.md` for evidence artifacts and multi-zoom layering.

## Step 4: Generate JSON

Pull colours from `references/color-palette.md`. Use templates from `references/element-templates.md`. Refer to `references/json-schema.md` for the full schema.

**For large diagrams, build section by section** so each edit stays small enough to check IDs, bindings and spacing as you go.

### Section-by-section workflow

1. **Create the base file** with the JSON wrapper (`type`, `version`, `appState`, `files`) and the first section of elements.
2. **Add one section per edit.** Use descriptive string IDs (`"trigger_rect"`, `"arrow_fan_left"`) and namespace seeds by section (100xxx, 200xxx, etc.).
3. **Update cross-section bindings** as you go — when an arrow connects to an element from a previous section, update that element's `boundElements` array.
4. **After all sections are placed**, read through the complete JSON checking that all IDs and bindings reference elements that exist, and that spacing is balanced.

### Key JSON rules

- `text` property contains ONLY readable words — no formatting codes
- `fontFamily: 3` (monospace) for all text
- `roughness: 0` for clean/modern (unless hand-drawn style requested)
- `opacity: 100` for all elements — use colour, size, and stroke for hierarchy instead

## Step 5: Render and Validate

This is mandatory. You cannot judge a diagram from JSON alone.

```bash
cd .claude/skills/viz-excalidraw-diagram/references && uv run python render_excalidraw.py <absolute-path-to-file.excalidraw>
```

Then **Read the output PNG** to actually view it.

### The validation loop

1. **Render and view** — run the script, Read the PNG
2. **Compare to your design** — does the visual structure match what you planned? Does the eye flow correctly? Is the hierarchy right?
3. **Check for defects** — text clipping or overflow, overlapping elements, arrows crossing through shapes, uneven spacing, unreadable text, lopsided composition
4. **Fix** — edit the JSON (widen containers, adjust coordinates, reroute arrows, rebalance spacing)
5. **Re-render and re-view** — repeat until it passes both the design check and defect check

Stop when the render passes both the design check and the defect check.

## Step 6: Save

Save to `projects/viz-excalidraw-diagram/{diagram-name}/`:
- `{YYYY-MM-DD}_{descriptive-name}.excalidraw` — the source JSON
- `{YYYY-MM-DD}_{descriptive-name}.png` — the rendered output

Show the user the rendered PNG after saving.

## Step 7: Collect Feedback

Ask: "Does this capture the concept? Anything to adjust — layout, detail level, emphasis?"

Log feedback to `context/learnings.md` → `## viz-excalidraw-diagram`.

---

## Renderer Setup

Step 0 handles this automatically on every run. If something breaks, the manual commands are:

```bash
cd .claude/skills/viz-excalidraw-diagram/references
uv sync
uv run playwright install chromium
```

---

## Quality Checklist

**Conceptual**: Does each shape mirror its concept's behaviour? Does the diagram show something text alone couldn't? Does each major concept use a different visual pattern?

**Container discipline**: Could any boxed element work as free-floating text? Are timelines/trees using lines + text rather than boxes? Is font size and colour creating hierarchy without containers?

**Technical (if applicable)**: Evidence artifacts present? Real specs researched? Multi-zoom layers (summary + sections + detail)?

**Visual (post-render)**: No text overflow? No overlapping? Even spacing? Arrows land correctly? Readable at export size? Balanced composition?

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user flags an issue with the output, add a dated entry under `## Rules` in this skill's `SKILL.local.md` (create it if missing) and log it to `context/learnings.md` under `## viz-excalidraw-diagram`. Write the general rule the correction implies, not the one-off fix.
