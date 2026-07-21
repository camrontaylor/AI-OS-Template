---
name: viz-ad-creative-figma
description: >
  Generate consistent, on-brand paid ad creative batches in Claude with a
  deterministic Figma, Figma MCP, Figma Buzz/Weave-style, or local HTML template
  engine. Use for paid social ads, Meta/Google/TikTok ad sets, batch variations,
  regulated categories, text-heavy offer cards, carousels, and any job needing
  exact brand control or no AI-content label. Runs first-use onboarding, brand
  lock, scratch or performance-data strategy, platform-limited copy, template
  fill, multi-size export, slate tracking, launch QA, and performance iteration.
  Use viz-ad-creative-codex for Codex-native image generation and
  viz-ad-creative-fal for Claude plus fal.ai generated imagery/video.
---

# Ad Creative Factory (Figma / template engine)

Make a full set of on-brand ad creatives for one client, end to end, with a deterministic engine in Claude. Instead of generating images with AI, this variant fills a locked template (a Figma design-system file, Figma MCP/Buzz/Weave-style template flow, or a local HTML and CSS template) and exports exact pixels. The brand cannot drift because nothing is generated; the agent only fills text and image slots.

Pick this variant when the look must be exact every time (regulated ads, strict brand systems), when the ad is text-heavy (offer cards, carousels), or when the client wants creatives that carry no AI-content label.

## Outcome

A campaign folder of ready-to-upload ad creatives plus the records that keep them consistent and testable. Saved to:

```
projects/viz-ad-creative-figma/{client}/{YYYY-MM-DD}_{campaign}/
  brief.md            concept, angles, hooks, the test plan
  creative-matrix.csv the media-buying test matrix and hypothesis ledger
  copy/               headlines and body copy per platform, within limits
  images/             exported stills, one folder per concept, all sizes
  slate.csv           the variation ledger (what exists, what was tested)
  qa-report.md        the pass/fail checks before delivery
  launch-readiness.md tracking, UTM, naming, budget, approval, and compliance gaps
  performance-read.md optional readout when performance data is provided later
```

Always save to disk. This is not optional. After saving, show the full absolute path so the user can click it.

## Context Needs

| File | Load level | Purpose |
|------|-----------|---------|
| `brand_context/voice-profile.md` | full | Tone and vocabulary for all copy |
| `brand_context/positioning.md` | angle only | The chosen angle drives every hook |
| `brand_context/icp.md` | full | Who the ad speaks to: pains, language, objections |
| `brand_context/brand-profile.json` | full | The machine-readable brand lock (build it in Step 4 if missing) |
| `projects/viz-ad-creative-figma/onboarding/{client}/onboarding-profile.json` | full if present | First-use defaults, examples, approvals, measurement, and tool status |
| `context/learnings.md` | `## viz-ad-creative-figma` section | Apply past feedback before generating |

Load what exists. Missing brand context never blocks the work; Step 2 builds what is needed.

## Dependencies

| Dependency | Required? | What it provides | Without it |
|-----------|-----------|------------------|------------|
| `FIGMA_TOKEN` (env) + a brand template file | Preferred | Pixel-exact export via the Figma REST API | Falls back to the local HTML-to-image path |
| Node + Chromium | Required for the fallback | Local deterministic render with `scripts/render-ad.mjs` | If neither path is available, the skill prints setup and exits |
| Python 3 | Recommended | Runs `scripts/onboard.py` for first-use context capture | Do the onboarding interview manually using `references/onboarding.md` |
| Figma MCP server | Optional | Writes frames to the canvas with no human click | Use the Buzz plugin plus one click, or the HTML fallback |
| `mkt-copywriting` | Optional | Stronger ad copy with scoring | Step 6 uses `references/ad-methodology.md` directly |
| `mkt-brand-voice` / `mkt-positioning` / `mkt-icp` | Optional | Prebuilt brand lock | Step 4 builds the brand-profile.json from a URL or interview |
| `tool-humanizer` | Optional | Removes AI tells from copy | Skip the humanizer gate, note it was skipped |

Run first-use onboarding once, then run `bash scripts/setup.sh` to check which path is available.

## Skill Relationships

- Upstream: `mkt-brand-voice`, `mkt-positioning`, `mkt-icp` build the brand lock this skill reads.
- Sibling variants: `viz-ad-creative-codex` (Codex-native no-key image generation) and `viz-ad-creative-fal` (Claude plus fal.ai image/video generation). Same pipeline, different generation step.
- Related AI-OS skills: `viz-stitch-design` and `viz-interface-design` for HTML and CSS design output; the `figma` plugin skills for driving Figma.
- Trigger conflicts: the two generative variants. This skill wins when the user wants pixel-exact, brand-locked, or AI-label-free output.

## Before You Start

Confirm three things, then move: which client, what is being sold or offered, and the platforms. If the onboarding profile exists, load it before asking anything so you do not re-ask known preferences. Pick this Figma/template variant when the operator is in Claude and the output must be exact and brand-safe, the ad is text-heavy, the client wants no AI label, or a repeatable Figma/Buzz/Weave-style production flow matters more than image novelty. If they want no-key generated imagery inside Codex, route to `viz-ad-creative-codex`; if they want photoreal or generated video in Claude, route to `viz-ad-creative-fal`.

## Step 1: First-Run Onboarding

Read `references/onboarding.md`. If `projects/viz-ad-creative-figma/onboarding/{client}/onboarding-profile.json` is missing, partial, or stale, run:

```bash
python3 scripts/onboard.py --client "{client}"
```

This captures the operator's defaults, first success definition, examples to imitate or avoid, platform and size preferences, approval workflow, measurement conventions, performance-history patterns, compliance rules, and current tool connection status. Load the saved profile before strategy and use it as defaults for every later step. If Python is unavailable, ask the same questions manually from `references/onboarding.md` and save the profile from `assets/onboarding-profile.template.json`.

## Step 2: Check Setup

Run `bash scripts/setup.sh`. It checks for `FIGMA_TOKEN` (and a template file key) and for Node and Chromium for the local fallback. Pick the path: Figma if the token and a brand template file exist, otherwise the local HTML render. If neither is available, tell the user how to set one up (token at Figma Settings then Personal Access Tokens, or `npm install` from this skill folder for the local path) and stop.

## Step 3: Read Learnings

Read `context/learnings.md` for the `## viz-ad-creative-figma` section. Apply any past notes before you build.

## Step 4: Brand Lock

Read `references/brand-lock.md`. The single source of truth is `brand_context/brand-profile.json`. If it exists, load it. If not, build it from `brand_context/voice-profile.md`, `positioning.md`, and `icp.md` when present; otherwise extract from the client URL (use `tool-firecrawl-scraper` if available) or ask a short interview. For this engine the brand lock is literal: in Figma it is locked layers, bound variables, and component instances; in the HTML path it is a locked CSS layer with the exact hex, fonts, and logo. The agent only fills text and image slots, never restyles.

## Step 5: Strategy, Angles, and Matrix

Read `references/ad-methodology.md`, `references/creative-testing.md`, and `references/media-buying-workflow.md`. Decide whether this is Mode 1 (generate from scratch) or Mode 2 (iterate from performance data). Pick the campaign angle from positioning and the onboarding profile. List 3 to 5 buyer problems, then build hook families per problem. Plan the test matrix in waves: Phase 1 hooks, Phase 2 angles, Phase 3 CTA or offer. For every hook structure, make at least two production executions so you do not kill a strong structure because of one weak execution. Define the primary decision metric, the controlled variable, the control creative, and the minimum evidence threshold before judging. Score weak concepts with the creative scorecard before building. Write `brief.md` and `creative-matrix.csv` from `assets/creative-matrix.template.csv`, then pause for the user to approve the angle and matrix before building; this is a direction call they own.

## Step 6: Copy

Write the ad copy for each concept and platform. Use the frameworks in `references/ad-methodology.md`: PAS, AIDA, problem-solution, offer frames, hook structures, batch waves, and performance-data iteration rules. Keep every line within the platform limits in `references/ad-sizes.md`. Because this engine prints copy as real text, character fit matters exactly; the QA step rejects overflow. If `mkt-copywriting` is installed, use it. Run the copy through `tool-humanizer` before saving if it is installed.

## Step 7: Generate Creatives (template fill)

Read `references/engine-figma.md` for the full setup, the two Figma fill paths, the export call, and the local fallback.

- **Figma path**: fill the brand-locked template (via the Figma MCP write tools for a no-click flow, or a Buzz plugin plus a CSV and one human click), then export with `scripts/figma-export.mjs`, which calls `GET /v1/images/:file_key` with all node IDs batched into one request, downloads the temporary URLs, and saves PNGs. Choose `scale` so the artboard times scale equals the target pixels.
- **Local fallback**: fill `assets/ad-template.html` (Handlebars slots like headline, cta, image) and render with `scripts/render-ad.mjs`, which uses node-html-to-image with the root fixed to the exact pixels and a device scale factor for retina. This needs only Node and Chromium and produces identical pixels every run.

Generate per the approved matrix: vary one element at a time so each creative is a clean test.

## Step 8: Multi-Size Export

For each approved concept, produce every size the campaign needs from `references/ad-sizes.md` (start with 9:16, 1:1, 4:5, and 1.91:1). In Figma, set each frame to the exact pixels or use a sized component. In the HTML path, render the template once per size with the matching root dimensions.

## Step 9: Update the Slate

Read `references/slate.md`. Before building any new creative, check `slate.csv` for the tuple `buyer_problem | hook_structure | copy_angle | format | aspect_ratio`. If it already exists, make a new combination instead of a duplicate. After building, add one row per creative with the naming convention, the engine, and the test phase. Start from `assets/slate.template.csv`.

## Step 10: QA and Launch Readiness

Read `references/qa-checklist.md` and `references/media-buying-workflow.md`, then run both gates. Check that each exported file matches its target pixels exactly, no text overflows or clips, the brand hex and logo and fonts are correct against `brand-profile.json`, copy is within limits, and the slate has no duplicates. Then write `launch-readiness.md` from `assets/launch-readiness.template.md`: tracking status, landing-page message match, UTM and naming convention, budget or spend caps, exclusions, compliance, approval owner, and open gaps. This engine generates nothing, so there is no AI-content label to flag, which is one of its main advantages. Write `qa-report.md`. If a check fails, fix and re-run; never ship a failing asset quietly.

## Step 11: Save and Report

Save everything to the campaign folder above. Create folders as needed. Copy final files to `~/Downloads/` per AI-OS Output Standards. Show the user the full absolute paths and a short summary: how many concepts, variants, and sizes, and which path was used (Figma or local HTML).

## Step 12: Performance Loop and Feedback

If the user provides live ad results now or later, read `references/media-buying-workflow.md`, use `assets/performance-read.template.csv`, and write `performance-read.md`. Diagnose the funnel stage before making new creative: hook problem, click-intent problem, post-click problem, fatigue, CPM/audience issue, or delivery artifact. Recommend the next matrix with one controlled variable and one preserved control. Then ask: "Does this set hold the brand and the angle? Which hook or concept should we push, cut, or turn into the next test?" Log the answer to `context/learnings.md` under `## viz-ad-creative-figma`. If the user flags a recurring problem, add it to `## Rules` below right away.

## Rules

*Read before every run. Updated when the user flags an issue.*

- The agent fills only text and image slots. Never restyle a locked template; that is the whole point of this engine.
- Batch all Figma node IDs into one `/v1/images` request. Figma rate limits are strict on free and Starter files, so this variant assumes a paid Full or Dev seat for the Figma path.
- The Figma MCP write tools and the figma.buzz plugin API are in active beta and may change. Re-check the dev docs if a call fails.

## Self-Update

If the user flags an issue with the output (overflow, wrong size, off-brand, broken export), update the `## Rules` section in this file right away with the correction and today's date. Do not just log it to learnings; fix the skill so it does not repeat.

## Troubleshooting

- **No Figma token and no Node**: print setup, stop. One of the two paths must exist.
- **Figma export returns 429**: you hit the rate limit. Batch all node IDs into one request and respect the Retry-After header; a paid seat is needed for real volume.
- **Text overflows the box**: shorten the copy in Step 4 to the platform limit, or set the text layer to auto-fit; the QA gate must reject overflow.
- **Export URL is dead**: Figma image URLs are temporary (about 30 days). Download right after the export call.
- **No brand context at all**: build a minimal `brand-profile.json` from the client URL and one short interview; note what would sharpen it.
