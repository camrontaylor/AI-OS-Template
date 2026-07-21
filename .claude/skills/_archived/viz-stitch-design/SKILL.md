---
name: viz-stitch-design
description: >
  Design and iterate on UI screens using Google Stitch. Text-to-UI generation,
  sketch-to-UI conversion, interactive prototyping, and code export. Use when:
  "design a UI", "create a screen", "stitch design", "UI mockup", "app design",
  "landing page design", "mobile screen", "web layout", "wireframe to UI",
  "design this page", "UI for", "screen design". Pairs with tool-stitch for
  fetching existing designs and frontend-design for implementation.
  Does NOT trigger for standalone image generation, diagrams
  (use viz-excalidraw-diagram), or implementing code from designs.
allowed_tools:
  - mcp__stitch__*
  - WebFetch
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# viz-stitch-design — UI Design with Google Stitch

Design high-fidelity UI screens using Google Stitch's AI-powered design platform. Generate screens from text descriptions or sketches, iterate on them, and export production-ready HTML/CSS.

## Outcome

UI designs created in Stitch and exported locally as HTML/CSS + screenshots, saved to `projects/viz-stitch-design/{YYYY-MM-DD}_{design-name}/`. Always save output to disk.

## Context Needs

| Context | Usage |
|---------|-------|
| `voice-profile` | Tone only — UI copy matches brand voice |
| `positioning` | Summary — design reinforces brand positioning |
| `icp` | Language section — UI speaks to the right audience |
| `learnings` | `## viz-stitch-design` |

## Dependencies

| Skill | Required? | What it provides | Without it |
|-------|-----------|-----------------|------------|
| `tool-stitch` | Required | MCP bridge to Google Stitch | Cannot fetch designs or export code |
| `frontend-design` | Optional | Implementation from exported designs | Manual implementation needed |

## Step 0: Preflight

1. Check Stitch MCP tools are available (`mcp__stitch__*`). If not:
   - "Stitch MCP isn't connected. Run `npx @_davideast/stitch-mcp init` to set up."
   - Stop here.
2. Read `context/learnings.md` -> `## viz-stitch-design` for previous feedback.
3. Load brand context per the Context Needs table (skip if missing — graceful degradation).

## Step 1: Understand the Design Brief

Ask (max 3 questions if unclear):
- **What screen/page?** Homepage, dashboard, settings, onboarding, etc.
- **Platform?** Web, mobile (iOS/Android), tablet, responsive
- **Style direction?** Minimal, bold, corporate, playful, dark mode, etc.

Auto-detect from context:
- If brand context exists, match the visual identity
- If ICP exists, design for that audience's expectations
- Default: clean, modern, accessible

## Step 2: Design Approach

Choose the appropriate Stitch workflow:

| Input | Approach |
|-------|----------|
| Text description only | Text-to-UI — describe the screen in detail |
| Rough sketch/wireframe | Sketch-to-UI — upload and refine |
| Existing design to iterate | Fetch via tool-stitch, then modify |
| Multi-screen flow | Design individual screens, then link as prototype |

## Step 3: Craft the Stitch Prompt

Write a detailed design prompt for Stitch. Include:
- **Screen type and purpose** (e.g., "SaaS dashboard for project management")
- **Key UI elements** (nav, sidebar, cards, tables, forms, CTAs)
- **Content** — use real copy from brand voice, not lorem ipsum
- **Visual direction** — colors, typography feel, spacing density
- **Platform constraints** — mobile-first, responsive breakpoints, etc.

Present the prompt to the user for approval before sending to Stitch.

## Step 4: Generate in Stitch

1. Direct the user to create/open the design in Stitch (stitch.withgoogle.com)
2. Guide them through the Stitch interface:
   - Paste the crafted prompt
   - Select Gemini model (2.5 Pro for quality, 2.5 Flash for speed)
   - Generate and iterate within Stitch's canvas
3. Once the user is satisfied with the design, proceed to export

## Step 5: Export & Save

Use `tool-stitch` to pull the design locally:

1. **Get screen code** — fetch HTML/CSS via MCP
2. **Get screenshot** — save a visual reference as PNG
3. **Extract design DNA** — document fonts, colors, spacing for implementation

Save everything to `projects/viz-stitch-design/{YYYY-MM-DD}_{design-name}/`:
```
{YYYY-MM-DD}_{design-name}/
  screen.html          <- exported HTML/CSS
  screenshot.png       <- visual reference
  design-dna.md        <- extracted design tokens
  brief.md             <- original prompt + design decisions
```

Copy screenshots to `~/Downloads/` for easy access.

## Step 6: Implementation Bridge (optional)

If the user wants to implement the design:
- If `frontend-design` skill is installed, hand off the exported HTML/CSS + design DNA
- Otherwise, provide the HTML/CSS as a starting point and guide manual implementation
- Note any responsive considerations from the Stitch export

## Step 7: Feedback

Ask: "How does the design look? Want to iterate on anything or move to implementation?"

Log feedback to `context/learnings.md` -> `## viz-stitch-design`:
- Style preferences that worked
- Prompt patterns that produced good results
- Platform-specific notes

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user flags an issue — wrong style, missed elements, bad export — update the `## Rules` section immediately with the correction and today's date.

---

## Troubleshooting

- **Stitch MCP not connected**: Run `npx @_davideast/stitch-mcp init` for setup.
- **Can't fetch screens**: Check project ID — it's in the Stitch URL.
- **Export missing styles**: Some Stitch designs use embedded fonts. Check `design-dna.md` for font references and add them manually if needed.
- **Design doesn't match brand**: Load brand context files and explicitly reference colors/fonts in the Stitch prompt.
- **Stitch is free**: No API key needed — just Google account auth via gcloud.
