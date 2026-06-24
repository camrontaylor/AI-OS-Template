# Ad Creative Suite

Three portable AI-OS skills for an ads operator who needs full creative batches, not one-off prompts. Each skill runs the same pipeline: first-use onboarding, brand lock, media-buying strategy, creative matrix, copy, generation or rendering, multi-size export, slate tracking, launch-readiness QA, performance readouts, and feedback.

This pack is in `skills-library/backlog/`, so it is inert until installed or moved through triage. That is intentional: it can be trialed without flooding the live skill picker.

## Which Skill To Use First

| Skill | Best first use | Needs |
|---|---|---|
| `viz-ad-creative-codex` | Best first-use/default path. Runs natively in Codex with built-in image generation and no model API key. | Codex with image generation |
| `viz-ad-creative-fal` | Best Claude automation engine when the campaign needs photoreal product shots, model choice, Recraft/Ideogram typography, or short video. | `FAL_KEY`, Node 18+ |
| `viz-ad-creative-figma` | Best Claude production engine for regulated, text-heavy, or brand-strict clients. Pixel-exact Figma export, Figma template/Buzz/Weave-style flow, or local HTML render; no AI image label. | `FIGMA_TOKEN` for Figma path, or Node + `npm install` for HTML path |

Default recommendation for your friend: start with `viz-ad-creative-codex` for the no-key subscription-style workflow. Add `viz-ad-creative-figma` for offer cards, carousels, strict brand systems, and deterministic exports. Add `viz-ad-creative-fal` when they want Claude to automate mixed model routing, photoreal product concepts, or video.

## Install Into Another AI-OS

From this folder:

```bash
bash scripts/smoke-check.sh
bash scripts/install-to-ai-os.sh /path/to/friends/AI-OS codex
```

Install all three:

```bash
bash scripts/install-to-ai-os.sh /path/to/friends/AI-OS all
```

If a skill already exists at the target, the installer stops. To replace it safely, it backs up the old folder first:

```bash
bash scripts/install-to-ai-os.sh /path/to/friends/AI-OS all --force
```

Then run the setup check inside the installed skill:

```bash
cd /path/to/friends/AI-OS/.claude/skills/viz-ad-creative-codex
python3 scripts/onboard.py --client "first-client"
bash scripts/setup.sh
```

Onboarding writes a reusable first-use profile to:

```text
projects/viz-ad-creative-codex/onboarding/{client}/onboarding-profile.json
projects/viz-ad-creative-fal/onboarding/{client}/onboarding-profile.json
projects/viz-ad-creative-figma/onboarding/{client}/onboarding-profile.json
```

The wizard captures the first success definition, offer, platforms, ratios, examples to imitate or avoid, compliance rules, approval workflow, media-buying defaults, budgets and pause thresholds, audience sources, performance-history patterns, naming and UTM conventions, conversion tracking status, and the current tool connection state. It never stores secret values; it only records whether required env vars and local tools are set.

## Env Blocks

`viz-ad-creative-codex` does not need a model API key. It uses Codex's native image generation capability. If native image generation is unavailable, it saves a prompt pack that can be run in ChatGPT Images, Adobe Firefly, Runway, Canva, or the sibling fal/Figma skills.

```bash
# Service: fal.ai (https://fal.ai/dashboard)
# Used by: viz-ad-creative-fal (multi-model image/video ad creative generation)
# Fallback: use viz-ad-creative-codex for no-key Codex stills, or viz-ad-creative-figma for deterministic templates
FAL_KEY=
```

```bash
# Service: Figma API (https://developers.figma.com/docs/rest-api/)
# Used by: viz-ad-creative-figma (export brand-locked Figma frames to PNG/JPG/SVG/PDF)
# Fallback: local HTML-to-image render with Node and node-html-to-image
FIGMA_TOKEN=
FIGMA_FILE_KEY=
```

## First Prompt To Try

Use this with the Codex skill first:

```text
Use viz-ad-creative-codex to make a 12-creative Meta test batch for [client].

Offer: [what is being sold]
Audience: [who buys it]
Landing page: [URL]
Platforms: Meta feed, Reels, Stories
Goal: lead form submissions
Assets: use the logo and product photos in brand_context/assets/

Build the brand-profile.json if missing, create the angle matrix, pause before generation, then use Codex-native image generation for 4:5, 1:1, and 9:16 exports with prompts/, slate.csv, and qa-report.md.
```

For Figma:

```text
Use viz-ad-creative-figma to make deterministic offer cards for [client]. Use the local HTML fallback if Figma is not configured. I need 6 concepts in 1:1 and 4:5, with no AI-generated imagery.
```

For fal:

```text
Use viz-ad-creative-fal to build a mixed-model creative test for [client]: photoreal product shots, one typography-heavy offer card, and one 6-second vertical video concept. Estimate cost before running generation.
```

## What The Skills Write

Each skill writes to its own project folder:

```text
projects/viz-ad-creative-codex/{client}/{YYYY-MM-DD}_{campaign}/
projects/viz-ad-creative-fal/{client}/{YYYY-MM-DD}_{campaign}/
projects/viz-ad-creative-figma/{client}/{YYYY-MM-DD}_{campaign}/
```

The campaign folder contains `brief.md`, `creative-matrix.csv`, `copy/`, `images/`, optional `video/`, `slate.csv`, `launch-readiness.md`, `qa-report.md`, and optional `performance-read.md` when ad results are provided later.

## Checked Sources

- Codex-native image generation path: no model API key required inside Codex; prompt-pack fallback documented in `viz-ad-creative-codex/references/engine-codex.md`
- fal.ai queue API: https://fal.ai/docs/documentation/model-apis/inference/queue
- Figma image export endpoint: https://developers.figma.com/docs/rest-api/file-endpoints/#get-image

Re-check live model names, prices, and platform ad specs before a client launch. The skill references mark drift-prone values clearly.
