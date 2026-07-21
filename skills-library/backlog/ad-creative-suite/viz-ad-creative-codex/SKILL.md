---
name: viz-ad-creative-codex
description: >
  Generate consistent, on-brand paid ad creative batches natively in Codex using
  Codex's built-in image generation, with no Gemini, fal, or other model API key.
  Use for Meta, Google, TikTok, LinkedIn, YouTube, creative matrices, first-use
  onboarding, platform-limited copy, image prompt packs, generated still ads,
  multi-size exports, launch QA, and performance iteration. Use viz-ad-creative-fal
  for Claude plus fal.ai image/video automation, and viz-ad-creative-figma for
  Claude plus Figma/template production.
---

# Ad Creative Factory (Codex-native engine)

Make a full set of on-brand paid ad creatives for one client, end to end, inside Codex. This variant uses Codex's native image generation capability for the visual generation step, so the operator can run the whole workflow from a Codex subscription without setting up a model API key.

Pick this variant first when the user wants the lowest-friction path: onboarding, strategy, copy, prompt packs, generated still creatives, QA, and performance iteration in one Codex run.

## Outcome

A campaign folder of ready-to-upload ad creatives plus the records that keep them consistent and testable. Saved to:

```
projects/viz-ad-creative-codex/{client}/{YYYY-MM-DD}_{campaign}/
  brief.md            concept, angles, hooks, the test plan
  creative-matrix.csv the media-buying test matrix and hypothesis ledger
  copy/               headlines and body copy per platform, within limits
  prompts/            image prompts, reference notes, and rejected prompt variants
  images/             generated stills, one folder per concept, all sizes
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
| `projects/viz-ad-creative-codex/onboarding/{client}/onboarding-profile.json` | full if present | First-use defaults, examples, approvals, measurement, and tool status |
| `context/learnings.md` | `## viz-ad-creative-codex` section | Apply past feedback before generating |

Load what exists. Missing brand context never blocks the work; Step 4 builds what is needed.

## Dependencies

| Dependency | Required? | What it provides | Without it |
|-----------|-----------|------------------|------------|
| Codex with native image generation | Required for image output | The visual generation engine, with no model API key | Produce the brief, copy, and prompt pack; route image generation to `viz-ad-creative-fal` or `viz-ad-creative-figma` |
| Python 3 | Recommended | Runs `scripts/onboard.py` for first-use context capture | Do the onboarding interview manually using `references/onboarding.md` |
| `imagegen` system skill/tool | Required inside Codex | Generates and edits the still ad images | Stop before generation and save prompts for manual/subscription generation |
| `mkt-copywriting` | Optional | Stronger ad copy with scoring | Step 6 uses `references/ad-methodology.md` directly |
| `mkt-brand-voice` / `mkt-positioning` / `mkt-icp` | Optional | Prebuilt brand lock | Step 4 builds `brand-profile.json` from a URL or a short interview |
| `tool-humanizer` | Optional | Removes AI tells from copy | Skip the humanizer gate, note it was skipped |

Run first-use onboarding once, then run `bash scripts/setup.sh` to confirm this no-key Codex path and local onboarding support.

## Skill Relationships

- Upstream: `mkt-brand-voice`, `mkt-positioning`, and `mkt-icp` build the brand lock this skill reads.
- Sibling variants: `viz-ad-creative-fal` runs in Claude with fal.ai for automated model routing, image, and video; `viz-ad-creative-figma` runs in Claude with Figma/template production for pixel-exact outputs.
- Related: `imagegen` is the native Codex generation tool this skill calls during Step 7.
- Trigger conflicts: `viz-nano-banana` is for one-off Gemini images, not this ad batch workflow. This skill wins when the user wants a Codex-native, no-API-key ad creative batch.

## Before You Start

Confirm three things, then move: which client, what is being sold or offered, and the platforms. If the onboarding profile exists, load it before asking anything so you do not re-ask known preferences.

Use this Codex variant when the operator wants subscription-style generation and native Codex image output. Do not ask for `GEMINI_API_KEY`, `FAL_KEY`, or another image-model API key. If the user needs Claude automation, short video, or live model routing, route to `viz-ad-creative-fal`. If they need exact templates, no generative imagery, or Figma handoff, route to `viz-ad-creative-figma`.

## Step 1: First-Run Onboarding

Read `references/onboarding.md`. If `projects/viz-ad-creative-codex/onboarding/{client}/onboarding-profile.json` is missing, partial, or stale, run:

```bash
python3 scripts/onboard.py --client "{client}"
```

This captures the operator's defaults, first success definition, examples to imitate or avoid, platform and size preferences, approval workflow, measurement conventions, performance-history patterns, compliance rules, and current tool connection status. Load the saved profile before strategy and use it as defaults for every later step. If Python is unavailable, ask the same questions manually from `references/onboarding.md` and save the profile from `assets/onboarding-profile.template.json`.

## Step 2: Check Setup

Run `bash scripts/setup.sh`. It should confirm this is the no-key Codex path and that no Gemini or fal key is required. If native image generation is not available in the current runtime, continue through Step 6 and Step 7's prompt-pack output, then route actual generation to `viz-ad-creative-fal`, `viz-ad-creative-figma`, ChatGPT Images, Adobe Firefly, Runway, or another subscription UI the operator chooses.

## Step 3: Read Learnings

Read `context/learnings.md` for the `## viz-ad-creative-codex` section. Apply any past notes on prompt patterns, brand issues, visual drift, or output preferences before you generate.

## Step 4: Brand Lock

Read `references/brand-lock.md`. The single source of truth is `brand_context/brand-profile.json`. If it exists, load it. If not, build it from `brand_context/voice-profile.md`, `positioning.md`, and `icp.md` when present; otherwise extract from the client URL (use `tool-firecrawl-scraper` if available) or ask a short interview. Save the locked reference images (logo, 1 to 3 product shots, 1 to 2 style anchors, color swatch sheet) under `brand_context/assets/`.

For Codex-native generation, the brand lock becomes prompt discipline: every image prompt must restate the exact brand colors, typography feel, logo rules, product references, exclusions, and safe-zone constraints.

## Step 5: Strategy, Angles, and Matrix

Read `references/ad-methodology.md`, `references/creative-testing.md`, and `references/media-buying-workflow.md`. Decide whether this is Mode 1 (generate from scratch) or Mode 2 (iterate from performance data). Pick the campaign angle from positioning and the onboarding profile. List 3 to 5 buyer problems, then build hook families per problem.

Plan the test matrix in waves: Phase 1 hooks, Phase 2 angles, Phase 3 CTA or offer. For every hook structure, make at least two production executions so you do not kill a good structure because of one weak execution. Define the primary decision metric, the controlled variable, the control creative, and the minimum evidence threshold before judging. Score weak concepts with the creative scorecard before generation. Write `brief.md` and `creative-matrix.csv` from `assets/creative-matrix.template.csv`, then pause for the user to approve the angle and matrix before generating; this is a direction call they own.

## Step 6: Copy

Write the ad copy for each concept and platform. Use the frameworks in `references/ad-methodology.md`: PAS, AIDA, problem-solution, offer frames, hook structures, UGC beats, batch waves, and performance-data iteration rules. Keep every line within the platform limits in `references/ad-sizes.md`.

For each concept, save:

- Platform copy with character counts.
- Image text, if text should appear inside the creative.
- One short generation prompt and one detailed generation prompt.
- A negative prompt listing off-brand, noncompliant, or generic ad tropes to avoid.

If `mkt-copywriting` is installed, use it for the copy and scoring. Run the copy through `tool-humanizer` before saving if it is installed.

## Step 7: Generate Creatives (Codex Native)

Read `references/engine-codex.md` for the exact Codex-native generation pattern. Use Codex's built-in image generation for each approved prompt. Generate per the approved matrix and vary one element at a time so each creative is a clean test.

For each creative:

1. Save the final prompt to `prompts/{concept}/{variant}.md`.
2. Use the native `imagegen` / image-generation tool with the prompt, aspect ratio, reference notes, and any uploaded image references available in the current Codex context.
3. Save the generated image into `images/{concept}/{variant}_{ratio}.png` or the closest supported format.
4. Record the engine as `codex-native-imagegen` in `slate.csv`.

If the image-generation tool returns only an in-chat asset, download or copy it into the campaign folder before reporting completion. If the tool is unavailable, stop generation, save the prompt pack, and tell the user which subscription UI can run it manually.

## Step 8: Multi-Size Export

For each approved concept, generate every size the campaign needs from `references/ad-sizes.md` (start with 9:16, 1:1, 4:5, and 1.91:1). Keep the key subject and text inside the central safe region so crops survive. If the native generator cannot hit exact pixels, generate the closest ratio, then use the Figma/template variant or a deterministic resize pass for final trafficking assets.

## Step 9: Update the Slate

Read `references/slate.md`. Before generating any new creative, check `slate.csv` for the tuple `buyer_problem | hook_structure | copy_angle | format | aspect_ratio`. If it already exists, make a new combination instead of a duplicate. After generating, add one row per creative with the naming convention, engine, prompt file, and test phase. Start from `assets/slate.template.csv`.

## Step 10: QA and Launch Readiness

Read `references/qa-checklist.md` and `references/media-buying-workflow.md`, then run both gates. Check that each exported file matches or is ready to be resized to target pixels, text is legible and inside the safe zone, the brand colors/logo/product claims match `brand-profile.json`, copy is within limits, and the slate has no duplicates.

Then write `launch-readiness.md` from `assets/launch-readiness.template.md`: tracking status, landing-page message match, UTM and naming convention, budget or spend caps, exclusions, compliance, approval owner, and open gaps. Flag that generated images may need an AI-content label on platforms such as Meta, TikTok, and YouTube. Write `qa-report.md`. If a check fails, fix and re-run; never ship a failing asset quietly.

## Step 11: Save and Report

Save everything to the campaign folder above. Create folders as needed. Copy final images to `~/Downloads/` per AI-OS Output Standards. Show the user the full absolute paths and a short summary: how many concepts, variants, sizes, prompts, and images were produced.

## Step 12: Performance Loop and Feedback

If the user provides live ad results now or later, read `references/media-buying-workflow.md`, use `assets/performance-read.template.csv`, and write `performance-read.md`. Diagnose the funnel stage before making new creative: hook problem, click-intent problem, post-click problem, fatigue, CPM/audience issue, or delivery artifact. Recommend the next matrix with one controlled variable and one preserved control. Then ask: "Does this set hold the brand and the angle? Which hook or concept should we push, cut, or turn into the next test?" Log the answer to `context/learnings.md` under `## viz-ad-creative-codex`. If the user flags a recurring problem, add it to `## Rules` below right away.

## Rules

*Read before every run. Updated when the user flags an issue.*

- Never ask for Gemini, fal, or other image-model API keys in this variant. This is the Codex-native, subscription-style path.
- Every generated image must have a saved prompt, a slate row, and a QA status. Do not rely on chat history as the source of truth.
- If exact pixel export or text layout matters more than image generation quality, route final trafficking assets through `viz-ad-creative-figma`.

## Self-Update

If the user flags an issue with the output (wrong runtime, off-brand image, missing prompt, bad size, unreadable text), update the `## Rules` section in this file right away with the correction and today's date. Do not just log it to learnings; fix the skill so it does not repeat.

## Troubleshooting

- **Image generation tool unavailable**: save the prompt pack and route to `viz-ad-creative-fal`, `viz-ad-creative-figma`, or a subscription UI such as ChatGPT Images, Adobe Firefly, or Runway.
- **Text in the image is unreliable**: shorten the text, put exact words in quotes, generate at the largest supported size, or move final typography to the Figma/template skill.
- **Brand drifts across the batch**: reuse the same prompt scaffold, exact colors, logo rules, product reference notes, and negative prompt each time.
- **No brand context at all**: build a minimal `brand-profile.json` from the client URL and one short interview; note what would sharpen it.
