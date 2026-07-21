---
name: viz-interface-design
description: >
  Design distinctive, craft-driven interfaces for dashboards, admin panels, SaaS tools, and interactive products.
  Use this skill whenever the user wants to build a dashboard, design an admin panel, create a data-heavy interface,
  build a settings page, design a SaaS product UI, or create any interactive tool interface. Also trigger when
  the user mentions metrics displays, data tables, control panels, monitoring UIs, or analytics views — even if
  they don't say "dashboard" explicitly. This is for functional product interfaces, NOT marketing pages, landing
  pages, or static content sites. NOT for diagrams (use viz-excalidraw-diagram), NOT for static mockups in Stitch
  (use viz-stitch-design), NOT for standalone image generation.
---

# Interface Design

Design interfaces where every choice is traceable to a specific reason. Generic output happens because training data patterns are strong — the antidote is intent-first design where sameness is failure. If another AI given similar context would produce the same output, you have failed.

## Outcome

Production-ready HTML/CSS/JS interfaces with:
- A design token system rooted in the product's domain
- Intentional surface hierarchy using subtle layering
- Components that feel crafted, not assembled from defaults
- Optional: saved pattern system in `.interface-design/system.md` for cross-session reuse

Output path: `projects/viz-interface-design/{YYYY-MM-DD}_{project-name}/`

## Context Needs

| File | Load level | Purpose |
|------|-----------|---------|
| `brand_context/voice-profile.md` | tone only | Match brand personality in UI tone |
| `brand_context/positioning.md` | summary | Inform visual hierarchy priorities |
| `brand_context/icp.md` | language section | Understand who uses this interface |
| `context/learnings.md` | `## viz-interface-design` | Apply lessons from previous runs |

## Dependencies

| Skill | Required? | What it provides | Without it |
|-------|-----------|-----------------|------------|
| `mkt-brand-voice` | Optional | Brand personality for UI tone | Use product domain to derive tone |
| `mkt-icp` | Optional | User context for design decisions | Ask the user directly |

## Skill Relationships

**Upstream:** `mkt-brand-voice` (tone), `mkt-icp` (audience), `mkt-positioning` (hierarchy priorities)
**Downstream:** Any frontend implementation workflow, `tool-humanizer` (for UI copy within interfaces)
**Trigger boundaries:** This skill handles functional product interfaces. `viz-stitch-design` handles static mockups in Google Stitch. `viz-excalidraw-diagram` handles conceptual diagrams. `mkt-copywriting` handles marketing page copy.

## Before You Start

Check if the project has `.interface-design/system.md`. If it exists, read it — design decisions are already made. Apply them and skip the exploration phase. If not, run the full workflow starting from Step 1.

Also read `context/learnings.md` section `## viz-interface-design` for patterns from previous runs.

## Step 1: Understand the Human

Before touching a single pixel, answer three questions. These aren't optional warm-up — they're the foundation every design choice traces back to. Ask the user if the answers aren't obvious from context.

1. **Who is this human?** Not "a user" — a specific person. A DevOps engineer at 2am checking alerts. A CFO glancing at quarterly numbers between meetings. A support agent handling 40 tickets an hour. The specificity matters because it determines information density, scan patterns, and interaction speed.

2. **What must they accomplish?** The verb, not the noun. Not "see metrics" but "spot anomalies in the last hour." Not "manage users" but "find and disable a compromised account in under 30 seconds." The task shapes the hierarchy.

3. **What should this feel like?** Not "clean" or "modern" — those are defaults, not intentions. Specific sensory and emotional qualities: "Calm authority, like a well-organized cockpit." "Quiet confidence — information is there when needed, invisible when not." "Dense but breathable, like a Bloomberg terminal that went to design school."

## Step 2: Explore the Product Domain

This is mandatory before proposing any direction. Generate all four outputs:

**Domain concepts** — Find 5+ concepts, metaphors, or vocabulary from the product's world. A logistics dashboard lives in a world of routes, waypoints, cargo, manifests. A healthcare admin panel exists among vitals, rounds, charts, triage. These concepts should influence naming, layout metaphors, and interaction patterns.

**Color world** — Find 5+ colors that naturally exist in the product's domain. Not "pick a nice blue" — where does color live in this product's physical or conceptual world? Agricultural tools: soil browns, crop greens, harvest golds, irrigation blues. Security dashboards: the amber of caution lights, the green of safe states, the red-black of threat levels. The palette should feel like it came FROM somewhere, not was applied TO something.

**Signature element** — Identify one element unique to THIS product that no generic dashboard would have. A specific data visualization type. An unconventional navigation pattern that serves the workflow. A status indicator that borrows from the domain's real-world signaling. This is the thing someone would point to and say "that's clever."

**Default rejections** — Name 3 obvious choices you're explicitly NOT making, and why. "I'm not using a left sidebar because this workflow is linear, not hierarchical." "I'm not using card grids because the data relationships matter more than individual metrics." "I'm not using blue as primary because every competing tool already does." Rejecting defaults forces intentional alternatives.

## Step 3: Propose Direction

Present your design direction to the user, referencing all four exploration outputs. Structure it as:

**Intent statement** — one sentence connecting the human, their task, and the feeling.

**Palette** — specific colors with WHY each was chosen (traced to domain exploration).

**Depth strategy** — how surfaces relate to each other and WHY this approach (read `references/principles.md` for the four depth strategies — pick ONE and commit).

**Surfaces** — how content is grouped and layered, and WHY this hierarchy.

**Typography** — typeface choices, scale, and WHY they serve this product.

**Spacing base unit** — the grid foundation (typically 4px or 8px) and WHY.

**Signature** — how the unique element manifests in the interface.

If you cannot explain WHY for each decision, you are defaulting. Go back to Step 2.

Wait for user confirmation before building. This is a human-in-the-loop checkpoint — the direction shapes everything that follows.

## Step 4: Build with Craft

Apply the confirmed direction. Read `references/principles.md` for the complete craft system and `references/example.md` for concrete implementation patterns.

Core craft principles to hold in mind while building:

**Subtle layering** — surfaces stack with whisper-quiet lightness shifts. Each elevation jump is only a few percentage points. Borders use low-opacity rgba so they blend with their background. Read `references/example.md` for the specific technique.

**Infinite expression** — no two interfaces should look identical. Same sidebar width + same card grid + same metric boxes = AI-generated signal. Find the layout that THIS product's workflow demands. Maybe the sidebar is narrow because the content needs width. Maybe there's no sidebar because the workflow is linear. Maybe the metrics aren't cards but inline indicators because the user needs to scan without stopping.

**Component intentionality** — before writing each component, state its intent, palette choices, depth strategy, surface treatment, typography, and spacing. Read `references/principles.md` for the token architecture, spacing system, card layouts, controls, typography, iconography, animation, and navigation patterns.

**Real data** — never use "Lorem ipsum" or obviously fake numbers. Use plausible data that tells a story. If it's a revenue dashboard, the numbers should show a realistic pattern. If it's a user management panel, the names and emails should feel real.

## Step 5: Validate via The Mandate

Run four checks on the built interface. Read `references/critique.md` for the full review framework, then apply these specific tests:

1. **Swap test** — would swapping the typeface for Inter, the layout for a standard sidebar+content, or the colors for generic blue change the perception? If not, the design isn't distinctive enough. Go back and strengthen the signature.

2. **Squint test** — blur your eyes (or describe what you'd see blurred). Can you perceive the hierarchy without reading text? Are regions distinguishable? Is anything too harsh or too flat? The hierarchy should be visible through tonal shifts alone.

3. **Signature test** — point to 5 specific elements where the product's signature appears. Not just the logo — the signature should thread through spacing rhythms, color usage, component shapes, interaction patterns. If you can only find it in 1-2 places, it's decoration, not identity.

4. **Token test** — read your CSS variables aloud. Do they belong to this product's world? `--surface-elevated` is generic. `--cockpit-panel` or `--triage-urgent` tells you what product you're in. Tokens should carry domain meaning.

If any check fails, fix it before presenting to the user. The mandate isn't a nice-to-have — it's the quality gate.

## Step 6: Save Output

Always save output to disk. This is not optional.

1. Create the output directory: `projects/viz-interface-design/{YYYY-MM-DD}_{project-name}/`
2. Save the main interface file(s) (HTML/CSS/JS)
3. Save a `design-decisions.md` documenting the exploration outputs and direction choices
4. After saving, show the user the full absolute file path so they can click it directly
5. Copy any binary outputs (screenshots, images) to `~/Downloads/`

## Step 7: Offer Pattern Persistence

After the interface is complete, offer to save reusable patterns to `.interface-design/system.md` at the project root. Read `references/validation.md` for what to save and what to skip.

Save patterns when:
- A component was used 2+ times
- The token system is reusable across the project
- Specific measurements are worth remembering

Don't save one-off experiments or temporary layouts.

This file becomes the starting point for future sessions — Step 0 reads it and skips exploration.

## Step 8: Collect Feedback

Ask: "How did this land? Any adjustments?"

Log feedback to `context/learnings.md` under the `## viz-interface-design` section with date and context. If the user flags an issue with the output — wrong approach, bad format, missing context, incorrect tone — update the `## Rules` section in this SKILL.md immediately with the correction. Don't just log it to learnings; fix the skill so it doesn't repeat the mistake.

## Rules

- 2026-03-28: Initial skill creation. No runtime corrections yet.

## Self-Update

If the user flags an issue with the output — wrong approach, bad format, missing context, incorrect tone — update the `## Rules` section in this SKILL.md immediately with the correction, dated `{YYYY-MM-DD}: {what was wrong and the rule to prevent it}`. Don't just log it to learnings; fix the skill so it doesn't repeat the mistake.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Output looks generic / "AI-generated" | Re-run Step 2 domain exploration. The signature element is probably weak or missing. Check the swap test — if swapping for defaults doesn't change perception, the design isn't distinctive. |
| Colors feel arbitrary | Trace each color back to domain exploration. If you can't explain where it comes from in the product's world, replace it with one you can. |
| Too many surface levels | Commit to ONE depth strategy (borders, shadows, color shifts, or layered shadows). Mixing strategies creates visual noise. |
| Interface feels cluttered | Check spacing consistency against the base unit. Look for places where information density can decrease without losing the user's task flow. |
| `.interface-design/system.md` conflicts with new direction | Ask the user: "Your saved patterns suggest X, but this new interface might need Y. Update the system file, or keep the existing patterns?" |
