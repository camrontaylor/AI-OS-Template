# QA Checklist (post-export gate)

Run this gate after the export step and before you hand any ad to the user. If a check fails, fix it or stop. Never ship a broken asset. The point of this gate is simple: catch the wrong size, off-brand color, clipped text, over-limit copy, a duplicate, an unlogged cost, and a missing AI label before they reach a live campaign.

This file is shared by all three engines (`codex`, `fal`, `figma`). One check (the AI-content disclosure flag) applies only to the generative engines, not to `figma`. That difference is called out in its own section.

## Contents

- [How to run this gate](#how-to-run-this-gate)
- [1. Pixel dimensions match the target spec](#1-pixel-dimensions-match-the-target-spec)
- [2. Text fits inside the platform safe zone](#2-text-fits-inside-the-platform-safe-zone)
- [3. Brand lock: hex, logo, fonts](#3-brand-lock-hex-logo-fonts)
- [4. Copy within platform character limits](#4-copy-within-platform-character-limits)
- [5. Dedup check against the slate](#5-dedup-check-against-the-slate)
- [6. Per-batch cost estimate logged](#6-per-batch-cost-estimate-logged)
- [7. AI-content disclosure flag](#7-ai-content-disclosure-flag-codex--fal-only)
- [Never fail silently](#never-fail-silently)

## How to run this gate

Go through every exported file, one at a time, against every check below. Mark each file pass or fail. A file passes only when every check passes. Log the result per file so the user can see what was checked.

Why a hard gate: an ad that is one wrong size, has clipped text, or carries an off-brand color is a paid-media defect that costs real money once it runs. It is cheaper to block here than to pull a live campaign.

## 1. Pixel dimensions match the target spec

Read the real pixel size of each exported file and compare it to the size that file was supposed to be. Do not trust the filename or the generator's promise. Measure the actual file.

Pick whatever tool is on the machine:

```bash
# macOS, built in
sips -g pixelWidth -g pixelHeight ad_feed_1080x1350.png

# ImageMagick / GraphicsMagick
identify -format "%w %h" ad_feed_1080x1350.png

# Node, sharp
node -e "require('sharp')('ad.png').metadata().then(m=>console.log(m.width,m.height))"
```

Compare the measured width and height to the target from `references/ad-sizes.md`. Common targets (width 1080 is the universal base):

| Placement | Target px | Ratio |
|---|---|---|
| IG/FB Feed square | 1080x1080 | 1:1 |
| IG/FB Feed portrait (recommended default) | 1080x1350 | 4:5 |
| IG/FB Stories & Reels | 1080x1920 | 9:16 |
| FB link / image ad | 1200x628 | 1.91:1 |
| LinkedIn single image | 1200x627 | 1.91:1 |
| TikTok vertical | 1080x1920 | 9:16 |

Rule: the measured size must equal the target exactly. No off-by-a-few-pixels. If it does not match, the export scale was wrong (re-export at the right scale, for example artboard width times scale must equal target width), so fix and re-measure.

## 2. Text fits inside the platform safe zone

Platforms overlay their own UI (profile name, caption, buttons) on top of the ad. Anything you put under that UI gets hidden. Keep your headline, logo, and CTA out of those bands.

For Meta Stories and Reels (9:16, 1080x1920), keep all text, logo, and CTA clear of:

- the top about 14% (roughly 250 px from the top), and
- the bottom about 20% to 35% (roughly 340 px from the bottom).

These safe-zone numbers are an industry safe bet, not read off an official page. Re-verify in the live Ads Manager before a launch, since platforms move their UI.

How to check: inspect the design (or the source frame/HTML) and confirm no critical element sits inside those top and bottom bands. A good extra habit is to design all critical content inside the central 1080x1080 region, so the same creative survives 4:5 and 9:16 crops.

## 3. Brand lock: hex, logo, fonts

Check the exported pixels against `brand-lock.md`. The generative engines (`codex`, `fal`) can drift across a large batch, so do not assume the later images still match the first. Check each one against the locked reference set, not against each other.

Verify three things:

- **Brand hex within tolerance.** Sample the key brand color regions and confirm they match the locked hex from `brand-lock.md`. Allow a small tolerance for compression, but a clear off-brand color is a fail.
- **Logo present and unmodified.** The logo must be there, the right one, not stretched, recolored, cropped, or re-drawn. On the `figma` engine the logo is a locked layer, so this is structural. On `codex`/`fal` the generator can warp or invent a logo, so look closely.
- **Correct fonts.** The headline and body use the brand fonts named in `brand-lock.md`, not a model substitute.

Why per-file and not per-batch: stateless image models lose brand identity over many calls. The gate must check every file against the reference set.

## 4. Copy within platform character limits

Check the copy on and around each ad against the limits in `ad-methodology.md` and `ad-sizes.md`. Write to the recommended visible limit, not the technical max, because the platform truncates past the visible point.

Recommended visible limits to check against (from the specs; re-verify flagged values before launch):

| Platform | Field | Recommended limit | Note |
|---|---|---|---|
| Meta | Primary text | 125 | OFFICIAL. Technical max (63,206) is UNCONFIRMED, write to 125. |
| Meta | Headline | 40 | OFFICIAL |
| Meta | Description | 25 | OFFICIAL |
| Google RSA | Headline | 30 | OFFICIAL. CJK characters count double. |
| Google RSA | Description | 90 | OFFICIAL |
| Google Demand Gen | Headline | 40 | OFFICIAL |
| Google Demand Gen | Description | 90 | OFFICIAL |
| TikTok | Brand / display name | 2-20 | INDUSTRY. No emojis. |
| TikTok | Ad copy | UNCONFIRMED | Industry reports range 1-100. Confirm in Ads Manager. |
| LinkedIn | Introductory text | 150 recommended / 600 max | INDUSTRY |
| LinkedIn | Headline | 70 recommended / 200 max | INDUSTRY |
| LinkedIn | Description | 70 safe | INDUSTRY. Max cited as both 70 and 100, UNCONFIRMED. |
| YouTube (video action) | Headline | 15 | INDUSTRY |
| YouTube (video action) | CTA | 10 | INDUSTRY |

Rule: any field over its recommended limit is a fail. Trim the copy and re-check. Treat every UNCONFIRMED or INDUSTRY value as drift-prone and re-verify in the live UI before a campaign goes live.

## 5. Dedup check against the slate

The slate is the running list of every creative already made for this campaign. Before adding a new export, check it is not a near-duplicate of one already on the slate.

Why: a batch can produce two images that are effectively the same. Shipping both wastes spend and muddies the A/B read. The whole value of a variant test is that each one changes one thing.

How: compare each new export against the slate (same headline plus same image plus same size is a duplicate; a tiny visual difference with identical copy and size is also a duplicate). Flag duplicates, drop them, and keep one per distinct creative. Log what was dropped.

## 6. Per-batch cost estimate logged

Write a cost estimate for the whole batch into the batch record. The user needs to see what a run costs before it scales.

- **`codex` engine:** no model API key is used in this skill. Log the runtime as Codex native image generation and note that subscription/tool limits may apply.
- **`figma` engine:** no per-image generation cost (deterministic render/export). Log seat and any export notes instead, not a per-image price.
- **`fal` engine:** estimate from live pricing, do not hardcode. Resolve prices at run time via the fal MCP `get_pricing` tool. As a ballpark only, budget about $0.01 to $0.07 per still image and about $0.05 to $0.40 per second of video. Several per-image prices (Ideogram V3, nano-banana/edit) are UNCONFIRMED, so verify live.

Rule: every batch record carries a cost line. If the price could not be confirmed, log the estimate and mark it UNCONFIRMED rather than leaving it blank.

## 7. AI-content disclosure flag (codex + fal only)

Set an AI-content disclosure flag on the batch for the generative engines. The `figma` engine does not need this flag when it only renders a locked template and generates no AI imagery.

What to tell the client, plainly:

- **Meta, TikTok, and YouTube require labeling AI-generated or materially altered creative in 2026.** If the ad's imagery was generated or heavily changed by AI, it must be disclosed.
- **Codex-native and fal-generated images may need platform AI labels.** Check the current disclosure UI in Meta, TikTok, YouTube, and any regulated platform before launch.
- **The `codex` and `fal` engines need this flag.** They produce AI imagery, so disclosure applies.
- **The `figma` deterministic engine does not need it** when it generates nothing and only fills and exports a locked template. If the image slots are filled with AI-made assets from another tool, tag the source asset and apply the platform disclosure.

Rule: for any `codex` or `fal` batch, the QA record must carry the disclosure flag and a one-line note for the client that AI labeling may apply on Meta, TikTok, and YouTube. Do not let an AI-made ad go out without that flag set.

## Never fail silently

If a required key or tool is missing at any point in this gate, print clear setup instructions and exit. Never produce a broken or unchecked asset quietly.

- Missing measure tool (`sips`, `identify`, or `sharp`): print how to get one and stop. Do not skip the dimension check.
- Missing `FIGMA_TOKEN` or `FAL_KEY` for the active engine: print the exact env block to add (house format: `# Service`, `# Used by`, fallback note, `KEY=`) and stop. The `codex` engine should not ask for a model API key.
- Missing `brand-lock.md`, `ad-sizes.md`, or `ad-methodology.md`: say which file is missing and stop, since the gate cannot check against a spec it does not have.

The failure this rule prevents: a silent skip that ships an unchecked asset. A loud stop with setup steps is always better than a quiet broken ad.
