# Ad Creative Platform Specs (verified June 2026)

> This file is the single registry. Both the export step and the QA dimension check read it. Any value marked UNCONFIRMED below must be re-checked in the live Ads Manager / Campaign Manager UI before a launch.

## Contents

- [Source legend](#source-legend)
- [Two rules to bake in](#two-rules-to-bake-in)
- [Universal export set](#universal-export-set-covers-90-of-delivery)
- [Meta (Facebook + Instagram)](#meta-facebook--instagram---as-of-2026-06)
- [Google Ads](#google-ads)
- [TikTok Ads](#tiktok-ads---as-of-2026-06)
- [LinkedIn Ads](#linkedin-ads---as-of-2026-06)
- [YouTube](#youtube---as-of-2026-06)

## Source legend

- **[OFFICIAL]** = read off a platform help/support doc.
- **[INDUSTRY]** = corroborated across multiple current 2026 trade references because the official page is JS-gated.
- **UNCONFIRMED** = verify in the live Ads Manager / Campaign Manager UI before launch.

All values as-of 2026-06. These specs shift often, so re-verify before each campaign.

## Two rules to bake in

1. Design vertical-first. 9:16 (1080x1920) plus 1:1 (1080x1080) covers most mobile placements. 4:5 (1080x1350) is the strongest single feed ratio on Meta and LinkedIn.
2. Write copy to the *recommended visible* limit, not the technical max.

## Universal export set (covers ~90% of delivery)

| Ratio | Pixels | Primary use |
|---|---|---|
| 9:16 | 1080x1920 | Stories / Reels / TikTok / Shorts |
| 1:1 | 1080x1080 | Feed square (universal) |
| 4:5 | 1080x1350 | Feed portrait (recommended default; ~20-30% more mobile real estate than 1:1) |
| 1.91:1 | 1200x628 | FB/LinkedIn link ad, PMax/DemandGen landscape |

## Meta (Facebook + Instagram) - as of 2026-06

| Placement | Image px (ratio) | Video px (ratio) | Length | Max file |
|---|---|---|---|---|
| Feed | 1080x1080 (1:1) or 1080x1350 (4:5) | same | 1s-241min | img 30MB / vid 4GB |
| Stories | 1080x1920 (9:16) | 1080x1920 | up to 60s/card | img 30MB / vid 4GB |
| Reels | 1080x1920 (9:16) | 1080x1920 | 15-60s practical | img 30MB / vid 4GB |
| Carousel card | 1080x1080 (1:1) | 1080x1080 | per-card | img 30MB / vid 4GB |
| Right column | 1200x1200 (1:1) | n/a | n/a | 30MB |

**Text [OFFICIAL** - facebook.com/business/help/223409425500940**]:** Primary text **125** / Headline **40** / Description **25** (recommended visible). Technical maxes (primary 63,206, headline 255) are **UNCONFIRMED / industry-cited only** - write to the recommended limits.

**Video:** H.264, square pixels, fixed frame rate, stereo AAC 128kbps+, MP4/MOV/GIF. Under 1GB processes more reliably.

**Safe zones (9:16) [INDUSTRY safe-bet]:** keep text/logo/CTA out of the top ~14% (~250px) and the bottom ~20-35% (~340px). The 20% text-overlay rule is officially retired, but heavy text still appears deprioritized.

## Google Ads

### Responsive Search Ads (RSA)

**[OFFICIAL** - support.google.com/google-ads/answer/7684791**]:** Headline **30 chars** (up to 15, min 3) / Description **90 chars** (up to 4, min 2) / Path **15 chars** (2) / Final URL 2,048 / Business name 25. Max 3 RSAs per ad group. CJK chars count double. Each asset must stand alone (shown in any order). Pinning one position can cut testable combos ~75% and drop Ad Strength, so pin only for legal/brand, and pin multiple variants per slot.

### Performance Max (PMax)

**Text [INDUSTRY + API docs]:** Headline 30 (3-15, at least 1 under 15), Long headline 90 (1-5), Description 90 (2-5, at least 1 under 60), Business name 25, Display path 15.

**Images [INDUSTRY]** (JPG/PNG, 5MB max, up to 20 per type):

| Type | Ratio | Pixels | Min size |
|---|---|---|---|
| Landscape | 1.91:1 | 1200x628 | 600x314 |
| Square | 1:1 | 1200x1200 | 300x300 |
| Portrait | 4:5 | 960x1200 | 480x600 |
| Logo square | 1:1 | 1200x1200 | 128x128 |
| Logo landscape | 4:1 | 1200x300 | - |

**Video [OFFICIAL** - answer/14528532**]:** 16:9 + 1:1 + 9:16, each at least 10s, at least one vertical 10-60s for Shorts eligibility, up to 15 videos, MPG, YouTube-hosted.

### Demand Gen

**[OFFICIAL** - support.google.com/google-ads/answer/13704860**]:** Headline 40 (up to 5) / Description 90 (up to 5) / Business name 25 / CTA max 10 chars.

**Images** (JPG/PNG/static GIF, 5MB, up to 20): Horizontal 1.91:1 1200x628, Square 1:1 1200x1200, Portrait 4:5 960x1200, Vertical 9:16 1080x1920, square logo 1200x1200.

**Video:** 16:9 (1920x1080), 1:1 (1080x1080), 4:5 (1080x1350), 9:16 (1080x1920). Min 5s; under 10s won't serve on YouTube In-stream. .MPG, file <=256GB.

## TikTok Ads - as of 2026-06

Values **[INDUSTRY]** unless noted.

| Format | Ratio | Resolution | Length | File |
|---|---|---|---|---|
| In-Feed (non-Spark) | 9:16 (also 1:1, 16:9) | 1080x1920 (min 540x960) | 5s up to 10 min (9-15s best) | MP4/MOV/MPEG/AVI, <=500MB web / 287.6MB mobile |
| Spark Ads | 9:16 | 1080x1920 | inherits organic post | - |
| TopView | 9:16 | 1080x1920 | 5-60s | <=500MB |
| Carousel (image) | 1:1 | min 800x800 | n/a | JPG/PNG, 20MB/card |

In-Feed extended to up to 10 min per TikTok's July 2025 docs (older guides quote 5-60s), so **confirm in Ads Manager**. Codec H.264/H.265, audio AAC/MP3, 23-60fps. Brand/display name 2-20 chars, no emojis. Ad-copy character cap **UNCONFIRMED** (industry reports range 1-100). Spark organic caption up to 2,200 (visible ~150).

## LinkedIn Ads - as of 2026-06

Values **[INDUSTRY]**, official pages JS-gated.

- **Single image:** 1200x1200 (1:1) or 1200x628 (1.91:1); vertical 4:5 (720x900) mobile-only. JPG/PNG/static GIF, 5MB max.
- **Video:** MP4 H.264, AAC/MP3, **200MB max**; 16:9 (1920x1080), 1:1 (1080x1080), 4:5 (1080x1350), 9:16 (1080x1920 mobile-only); 3s-30min (15-30s best); up to 30fps; thumbnail JPG/PNG <=2MB.
- **Carousel:** 2-10 cards at 1080x1080; card headline 45 chars (with link) / 30 (without).
- **Text:** Introductory text 150 recommended / 600 max; Headline 70 recommended / 200 max; Description up to 70-100 (treat **70** as safe; max is cited as both 70 and 100, so **UNCONFIRMED**). CTA is a fixed picklist, no custom button text.

## YouTube - as of 2026-06

**Video ad formats [OFFICIAL** - support.google.com/youtube/answer/2467968**]:** Skippable in-stream (skip after 5s), Non-skippable 15 or 20s (30s on TV only), Bumper up to 6s, Shorts ads swipeable.

**Asset ratios [INDUSTRY + DemandGen official]:** 16:9 (1920x1080), 9:16 (1080x1920), 1:1 (1080x1080), 4:5 (1080x1350). Companion banner 300x60 <150KB (no animated GIF). Thumbnail 16:9 <2MB.

**Video-action text [INDUSTRY]:** Headline 15, Long headline 90, Description 15-35/line, CTA 10. For Demand Gen-routed YouTube creative, use the Demand Gen limits above (Headline 40 / Description 90).
