---
name: viz-ad-creative-fal
description: >
  Generate consistent, on-brand paid ad creative batches in Claude using fal.ai
  as the image and video engine (FLUX, Recraft, Ideogram, nano-banana, Kling,
  Veo, Seedance). One skill runs first-use onboarding, brand lock, scratch or
  performance-data strategy, platform-limited copy, image/video generation with
  references and seed control, multi-size export, slate tracking, launch QA, and
  performance iteration. Use whenever the user wants Claude plus fal.ai for paid
  social ads, Meta/Google/TikTok ad sets, batch variations, creative matrices,
  photoreal product shots, typography models, or short video. Needs FAL_KEY.
  Use viz-ad-creative-codex for Codex-native no-key image generation and
  viz-ad-creative-figma for Figma/template production.
---

# Ad Creative Factory (fal.ai engine)

Make a full set of on-brand ad creatives for one client, end to end, with fal.ai doing the image and video generation. The point of this skill is consistency at scale: lock the brand once, then produce many creatives and sizes that all look like the same brand and can be tested cleanly.

This variant uses fal.ai because one API key reaches many models, so Claude can pick the best model per job (photoreal product, text-in-image, vector, short video) and still hold the brand steady with reference images and a fixed seed.

## Outcome

A campaign folder of ready-to-upload ad creatives plus the records that keep them consistent and testable. Saved to:

```
projects/viz-ad-creative-fal/{client}/{YYYY-MM-DD}_{campaign}/
  brief.md            concept, angles, hooks, the test plan
  creative-matrix.csv the media-buying test matrix and hypothesis ledger
  copy/               headlines and body copy per platform, within limits
  images/             generated stills, one folder per concept, all sizes
  video/              short video clips (if generated)
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
| `projects/viz-ad-creative-fal/onboarding/{client}/onboarding-profile.json` | full if present | First-use defaults, examples, approvals, measurement, and tool status |
| `context/learnings.md` | `## viz-ad-creative-fal` section | Apply past feedback before generating |

Load what exists. Missing brand context never blocks the work; Step 2 builds what is needed.

## Dependencies

| Dependency | Required? | What it provides | Without it |
|-----------|-----------|------------------|------------|
| `FAL_KEY` (env) | Required | The fal.ai engine for all generation | The skill cannot generate; it prints setup and exits |
| Python 3 | Recommended | Runs `scripts/onboard.py` for first-use context capture | Do the onboarding interview manually using `references/onboarding.md` |
| fal MCP server | Optional | In-session model discovery and runs | Falls back to the bundled `scripts/falgen.mjs` REST caller |
| `mkt-copywriting` | Optional | Stronger ad copy with scoring | Step 6 uses `references/ad-methodology.md` directly |
| `mkt-brand-voice` / `mkt-positioning` / `mkt-icp` | Optional | Prebuilt brand lock | Step 4 builds the brand-profile.json from a URL or a short interview |
| `tool-humanizer` | Optional | Removes AI tells from copy | Skip the humanizer gate, note it was skipped |

Run first-use onboarding once, then run `bash scripts/setup.sh` to check the key and tools.

## Skill Relationships

- Upstream: `mkt-brand-voice`, `mkt-positioning`, `mkt-icp` build the brand lock this skill reads.
- Sibling variants: `viz-ad-creative-codex` (Codex-native no-key image generation) and `viz-ad-creative-figma` (Claude plus Figma/template engine). Same pipeline, different generation step.
- Trigger conflicts: `viz-nano-banana` (single images, not ad sets) and `mkt-copywriting` (copy only). This skill wins when the user wants a full ad creative set with the fal engine.

## Before You Start

Confirm three things, then move: which client, what is being sold or offered, and the platforms (Meta, Google, TikTok, LinkedIn, YouTube). If the onboarding profile exists, load it before asking anything so you do not re-ask known preferences. Pick this fal variant when the operator is in Claude and wants automated generation, photoreal product shots, mixed model routing, or short video. If they want no-key generation inside Codex, route to `viz-ad-creative-codex`; if they need pixel-exact, regulated, or AI-label-free output, route to `viz-ad-creative-figma`.

## Step 1: First-Run Onboarding

Read `references/onboarding.md`. If `projects/viz-ad-creative-fal/onboarding/{client}/onboarding-profile.json` is missing, partial, or stale, run:

```bash
python3 scripts/onboard.py --client "{client}"
```

This captures the operator's defaults, first success definition, examples to imitate or avoid, platform and size preferences, approval workflow, measurement conventions, performance-history patterns, compliance rules, and current tool connection status. Load the saved profile before strategy and use it as defaults for every later step. If Python is unavailable, ask the same questions manually from `references/onboarding.md` and save the profile from `assets/onboarding-profile.template.json`.

## Step 2: Check Setup

Run `bash scripts/setup.sh`. It checks `FAL_KEY`, Node (for `scripts/falgen.mjs`), and whether the fal MCP server is connected. If `FAL_KEY` is missing, tell the user: get a key at https://fal.ai/dashboard, add `FAL_KEY=...` to `.env`, and optionally add the fal MCP server (the command is in `references/engine-fal.md`). Never generate without the key; print setup and stop.

## Step 3: Read Learnings

Read `context/learnings.md` for the `## viz-ad-creative-fal` section. Apply any past notes on models, prompt patterns, or brand issues before you generate.

## Step 4: Brand Lock

Read `references/brand-lock.md`. The single source of truth is `brand_context/brand-profile.json`. If it exists, load it. If not, build it: pull from `brand_context/voice-profile.md`, `positioning.md`, and `icp.md` when present; otherwise extract from the client URL (use `tool-firecrawl-scraper` if available) or ask a short interview. Save the locked reference images (logo, 1 to 3 product shots, 1 to 2 style anchors, color swatch sheet) under `brand_context/assets/`. These exact images and exact hex values go into every generation call, which is what holds the look steady.

## Step 5: Strategy, Angles, and Matrix

Read `references/ad-methodology.md`, `references/creative-testing.md`, and `references/media-buying-workflow.md`. Decide whether this is Mode 1 (generate from scratch) or Mode 2 (iterate from performance data). Pick the campaign angle from positioning and the onboarding profile. List 3 to 5 buyer problems, then build hook families per problem. Plan the test matrix in waves: Phase 1 hooks, Phase 2 angles, Phase 3 CTA or offer. For every hook structure, make at least two production executions so you do not kill a strong structure because of one weak execution. Define the primary decision metric, the controlled variable, the control creative, and the minimum evidence threshold before judging. Score weak concepts with the creative scorecard before generation. Write `brief.md` and `creative-matrix.csv` from `assets/creative-matrix.template.csv`, then pause for the user to approve the angle and matrix before generating; this is a direction call they own.

## Step 6: Copy

Write the ad copy for each concept and platform. Use the frameworks in `references/ad-methodology.md`: PAS, AIDA, problem-solution, offer frames, hook structures, UGC beats for video, batch waves, and performance-data iteration rules. Keep every line within the platform limits in `references/ad-sizes.md`. If `mkt-copywriting` is installed, use it for the copy and scoring. Run the copy through `tool-humanizer` before saving if it is installed.

## Step 7: Generate Creatives (fal.ai)

Read `references/engine-fal.md` for the full model routing, the consistency levers, and exact calls. The rules that keep the set on-brand:

- Route the model to the job: photoreal product (FLUX.2), text or typography in the image (Recraft, Ideogram), reference compositing (nano-banana edit), scene edits that keep the product (FLUX.1 Kontext), short video (Kling, Veo, Seedance).
- Pass the locked reference images as `image_urls` and use a fixed `seed` so variants stay controlled, not random re-rolls.
- For a Recraft brand style, train a `style_id` once and reuse it, and pass the brand `colors`.
- Generate per the approved matrix: vary one element at a time so each creative is a clean test.

Use the fal MCP server in-session, or the bundled `scripts/falgen.mjs` for scripted and batch runs. If a model ID has been deprecated, resolve a current one with the MCP `search_models` or `recommend_model` tool rather than guessing.

## Step 8: Multi-Size Export

For each approved concept, render every size the campaign needs. Loop the same input over the `aspect_ratio` or `image_size` presets in `references/ad-sizes.md` (start with 9:16, 1:1, 4:5, and 1.91:1, which cover most delivery). Keep the key subject inside the central safe region so crops survive.

## Step 9: Update the Slate

Read `references/slate.md`. Before generating any new creative, check `slate.csv` for the combination tuple `buyer_problem | hook_structure | copy_angle | format | aspect_ratio`. If it already exists, make a new combination instead of a duplicate. After generating, add one row per creative with the naming convention, the engine, and the test phase. Start from `assets/slate.template.csv`.

## Step 10: QA and Launch Readiness

Read `references/qa-checklist.md` and `references/media-buying-workflow.md`, then run both gates. Check that each exported file matches its target pixels, text sits inside the safe zone, the brand hex and logo and fonts are correct against `brand-profile.json`, copy is within limits, and the slate has no duplicates. Then write `launch-readiness.md` from `assets/launch-readiness.template.md`: tracking status, landing-page message match, UTM and naming convention, budget or spend caps, exclusions, compliance, approval owner, and open gaps. Flag the AI-content disclosure: fal-generated creative may need an AI label on Meta, TikTok, and YouTube, so note this for the client. Write `qa-report.md`. If a check fails, fix and re-run; never ship a failing asset quietly.

## Step 11: Save and Report

Save everything to the campaign folder above. Create folders as needed. Copy final image and video files to `~/Downloads/` per AI-OS Output Standards. Show the user the full absolute paths and a short summary: how many concepts, variants, sizes, and the estimated fal cost for the batch.

## Step 12: Performance Loop and Feedback

If the user provides live ad results now or later, read `references/media-buying-workflow.md`, use `assets/performance-read.template.csv`, and write `performance-read.md`. Diagnose the funnel stage before making new creative: hook problem, click-intent problem, post-click problem, fatigue, CPM/audience issue, or delivery artifact. Recommend the next matrix with one controlled variable and one preserved control. Then ask: "Does this set hold the brand and the angle? Which hook or concept should we push, cut, or turn into the next test?" Log the answer to `context/learnings.md` under `## viz-ad-creative-fal`. If the user flags a recurring problem (wrong model for a job, drift, off-brand color), add it to `## Rules` below right away.

## Rules

*Read before every run. Updated when the user flags an issue.*

- Never hardcode a fal model ID as the only option. If a call fails because a model was deprecated, resolve a current ID via the fal MCP `search_models` or `recommend_model` and note the swap.
- Always pass the locked reference set and a fixed seed on every call in a batch. Stateless models drift without them.
- Treat any price or model ID marked UNCONFIRMED in `references/engine-fal.md` as a thing to check live (MCP `get_pricing`) before quoting a cost.

## Self-Update

If the user flags an issue with the output (wrong model, drift, off-brand, bad size), update the `## Rules` section in this file right away with the correction and today's date. Do not just log it to learnings; fix the skill so it does not repeat.

## Troubleshooting

- **`FAL_KEY` missing**: print setup, stop. Do not attempt generation.
- **Brand drifts across the batch**: re-feed the same reference images and a fixed seed; add a style anchor line to the prompt; for a strict brand look, train a Recraft `style_id`.
- **A model ID errors**: it was likely deprecated. Use the MCP `search_models` / `recommend_model` to get a current ID.
- **Cost surprise**: estimate before the batch using `references/engine-fal.md` prices or the MCP `get_pricing` tool; log the estimate in the QA report.
- **No brand context at all**: build a minimal `brand-profile.json` from the client URL and one short interview; note what would sharpen it.
