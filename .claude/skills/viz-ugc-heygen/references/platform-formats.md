# Platform Video Formats

## Dimension Quick Reference

| Platform | Aspect | Resolution | Orientation |
|----------|--------|-----------|-------------|
| YouTube | 16:9 | 1920x1080 | landscape |
| YouTube Shorts | 9:16 | 1080x1920 | portrait |
| TikTok | 9:16 | 1080x1920 | portrait |
| Instagram Reels | 9:16 | 1080x1920 | portrait |
| Instagram Feed | 1:1 | 1080x1080 | square |
| Instagram Feed (alt) | 4:5 | 864x1080 | portrait |
| LinkedIn | 16:9 | 1920x1080 | landscape |
| LinkedIn (alt) | 1:1 | 1080x1080 | square |
| Twitter/X | 16:9 | 1280x720 | landscape |

## Dimension Constraints

- Minimum: 128px on any side
- Maximum: 4096px on any side
- Must be even numbers (divisible by 2)
- Use 720p for drafts/tests, 1080p for final (720p = ~1 credit/min, 1080p = ~1.5x)

## Duration Guidelines

| Platform | Sweet spot | Max |
|----------|-----------|-----|
| TikTok | 15-60s | 10 min |
| Instagram Reels | 15-60s | 90s |
| YouTube Shorts | 30-60s | 60s |
| YouTube | 2-5 min | 300s (API limit) |
| LinkedIn | 30-90s | 10 min |
| Twitter/X | 15-45s | 2 min 20s |

## Caption Positioning by Platform

| Platform | Position | Why |
|----------|----------|-----|
| TikTok | Top or center | Bottom UI covers captions |
| Instagram Reels | Top or center | Same — bottom has UI elements |
| YouTube Shorts | Center | Bottom has subscribe/like buttons |
| YouTube | Bottom (standard) | Traditional placement |
| LinkedIn | Bottom | Standard — "many watch without sound" |

## Avatar Style Recommendations

| Platform | Avatar style | Why |
|----------|-------------|-----|
| TikTok/Reels | `normal` or `closeUp` | Personal, direct-to-camera energy |
| YouTube | `normal` | Full body, professional |
| LinkedIn | `normal` or `closeUp` | Professional presence |
| PIP overlay | `circle` | Clean floating head over content |

## Background Recommendations

- **Social UGC:** Solid neutral (#1a1a2e, #f5f5f5) or branded color
- **Professional:** Office/studio image background
- **Green screen:** `#00FF00` — for post-production compositing
- **Transparent:** Use WebM format via `/v1/video.webm` endpoint (only normal/closeUp styles)

## Multi-Platform Strategy

When creating for multiple platforms from one script:
1. Write the script once (for the longest format)
2. Generate landscape version first (YouTube/LinkedIn)
3. Generate portrait version with same script (TikTok/Reels)
4. Adjust hook timing for short-form if needed
5. Each generation is a separate API call with different dimensions

## Credit Optimization

- Draft in test mode (`"test": true`) — no credits, has watermark
- Draft at 720p, final at 1080p
- Shorter videos cost fewer credits
- Multi-scene doesn't multiply cost — it's total duration that counts
