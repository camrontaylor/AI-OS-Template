---
name: tool-stitch
description: >
  Fetch UI designs from Google Stitch projects via MCP. Retrieve screen HTML/CSS,
  download screenshots, extract design DNA (fonts, colors, layouts), and generate
  full Astro site projects from Stitch screens. Used by viz-stitch-design and
  other skills as a design source. Triggers on: "fetch stitch design", "get stitch
  screens", "stitch project", "pull from stitch", "stitch code", "export stitch".
  Does NOT trigger for creating new designs in Stitch (use viz-stitch-design),
  or for non-Stitch design tools.
allowed_tools:
  - mcp__stitch__*
  - WebFetch
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

# Google Stitch Tool

Utility skill for pulling designs out of Google Stitch. Bridges your Stitch projects to your local codebase via MCP.

## Outcome

Screen HTML/CSS, screenshots, or full generated site projects saved to `projects/tool-stitch/{YYYY-MM-DD}_{project-name}/`. Always save output to disk.

## Context Needs

None. This skill doesn't read brand context.

| File | Load level | Purpose |
|------|-----------|---------|
| `context/learnings.md` | `## tool-stitch` section | Known issues, project quirks |

## Dependencies

None — this is a base utility. Other skills depend on this one.

| Service | Key | Required For | Without It |
|---------|-----|-------------|------------|
| Google Stitch (via gcloud) | gcloud auth | All operations | Skill cannot function — requires Google authentication |

## Step 0: Preflight

1. Check that Stitch MCP tools are available (`mcp__stitch__*`). If not:
   - Tell the user: "Stitch MCP isn't connected. Run `npx @_davideast/stitch-mcp init` to set up authentication."
   - Stop here.
2. Read `context/learnings.md` -> `## tool-stitch` for known issues.

## Step 1: Determine the Request

| Request | What to do |
|---------|------------|
| "Get screens from [project]" | List and fetch screen code (Step 2) |
| "Screenshot of [screen]" | Get screen image (Step 3) |
| "Build a site from [project]" | Generate full Astro project (Step 4) |
| "What's the design DNA?" | Extract fonts, colors, layout patterns (Step 5) |
| Another skill needs a design | Provide the appropriate output |

## Step 2: Fetch Screen Code

Use MCP to get HTML/CSS for specific screens.

1. Call `mcp__stitch__get_screen_code` with the project ID and screen name
2. Save the HTML/CSS to `projects/tool-stitch/{YYYY-MM-DD}_{project-name}/{screen-name}.html`
3. Report the file path

If the user doesn't know the screen name, list available screens first.

## Step 3: Get Screen Image

1. Call `mcp__stitch__get_screen_image` with the project ID and screen name
2. Decode base64 and save as PNG to `projects/tool-stitch/{YYYY-MM-DD}_{project-name}/{screen-name}.png`
3. Copy to `~/Downloads/` for easy access
4. Report the file path

## Step 4: Build Full Site

1. Call `mcp__stitch__build_site` with the project ID
2. This generates a full Astro project with routes mapped to screens
3. Save to `projects/tool-stitch/{YYYY-MM-DD}_{project-name}/site/`
4. Report the structure and how to run it (`npm install && npm run dev`)

## Step 5: Extract Design DNA

Analyze the fetched screens for design patterns:
- Fonts (families, sizes, weights)
- Colors (palette, usage patterns)
- Layout patterns (grid, flex, spacing)
- Component patterns (buttons, cards, forms)

Save as `projects/tool-stitch/{YYYY-MM-DD}_{project-name}/design-dna.md`

## Step 6: Save & Collect Feedback

1. Always save output to the projects folder
2. If used standalone, ask: "Got the design. Want to extract anything else from this project?"
3. Log feedback to `context/learnings.md` -> `## tool-stitch`

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user flags an issue — wrong screen, bad export, missing styles — update the `## Rules` section immediately with the correction and today's date.

---

## Troubleshooting

- **MCP not connected**: Run `npx @_davideast/stitch-mcp init` to set up auth and configuration.
- **Auth expired**: Run `gcloud auth application-default login` to refresh credentials.
- **Project not found**: The project ID may be wrong. Check the Stitch URL — the project ID is in the URL path.
- **Doctor check**: Run `npx @_davideast/stitch-mcp doctor --verbose` to diagnose connection issues.
- **Reset auth**: `npx @_davideast/stitch-mcp logout --force --clear-config` then re-run `init`.
