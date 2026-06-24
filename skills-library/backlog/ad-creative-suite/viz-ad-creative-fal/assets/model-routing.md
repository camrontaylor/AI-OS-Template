# fal.ai Model Routing (crib sheet)

The full table with prices, IDs, and consistency levers lives in
`references/engine-fal.md`. This crib is the quick lookup the skill
reads during the GENERATE step. Re-verify pricing live with the fal MCP
`get_pricing` tool before any client launch.

## Pick the model from the job

| The ad needs | Model ID | Why |
|---|---|---|
| Photoreal product shot, no baked text | `fal-ai/flux-2-pro` | Newest photoreal, zero config, multi-ref via `/edit` variant |
| Photoreal + headline baked in the image | `fal-ai/flux-2-flex` | Better text rendering, up to 10 references |
| Cheap many-variant batch from one base creative | `fal-ai/flux/dev/image-to-image` | Workhorse img2img, lock seed and re-feed reference |
| Keep product, change the scene | `fal-ai/flux-pro/kontext` | FLUX.1 Kontext in-context edit |
| Logo, vector, or typographic ad | `fal-ai/recraft/v3/text-to-image` | Recraft V3, plus `colors` and `style_id` |
| Brand-style lock (train once, reuse) | `fal-ai/recraft/v3/create-style` | Returns a `style_id`. Reuse it on every later call |
| Headline poster, sharp typography | `fal-ai/ideogram/v3` | Strongest in-image text accuracy |
| Combine brand assets with natural-language edits | `fal-ai/nano-banana/edit` | Up to 14 refs, Gemini-class subject lock |
| Strong character / face consistency | `fal-ai/nano-banana-pro/edit` | Up to 14 refs, 4 variations per call |
| Short ad clip, budget | `fal-ai/kling-video/...` | Cheapest solid image-to-video |
| Short ad clip, premium | Veo 3 / 3.1 on fal | Highest fidelity, highest cost |
| Multi-shot or reference-to-video | `bytedance/seedance-2.0/reference-to-video` | Up to 15s, multi-input |

## Consistency levers (stack them on every call in a batch)

1. Pass the locked references as `image_url` (one) or `image_urls` (many).
2. Lock `seed` to a fixed integer per concept. Same seed plus same prompt gives
   a reproducible base; vary one input for clean A/B variants.
3. For Recraft, train a `style_id` once from 3 to 5 brand images and pass it
   on every call; pass the brand `colors` array too.
4. For FLUX img2img, drop `strength` below 0.7 to stay close to the base.
5. Render every aspect ratio from the same input by looping `image_size` /
   `aspect_ratio` over the spec set (`square_hd` 1:1, `portrait_4_3` 4:5,
   `vertical_9_16` 9:16, `landscape_16_9` 1.91:1).

## The agent path versus the script path

- Inside Claude Code (one-off, exploratory): use the fal MCP server. Discovery
  tools (`search_models`, `recommend_model`, `get_model_schema`, `get_pricing`)
  matter most here because model IDs and prices drift.
- Scripted batch (the slate): use `scripts/falgen.mjs`. No SDK, queue-based,
  Node 18+ global fetch. Pass `--input req.json` for any non-trivial call.

## Submit-then-webhook pattern (batch runs)

For ad batches, prefer the async queue plus a webhook over polling.

```bash
curl -X POST "https://queue.fal.run/fal-ai/flux/dev?fal_webhook=https://your.app/api/fal/webhook" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d @req.json
```

Verify the webhook signature against the ED25519 keys at
`https://rest.alpha.fal.ai/.well-known/jwks.json` before trusting a payload.
Key each slate row by the returned `request_id`.

## Deprecation handling

Do NOT hardcode a model ID for the long term. fal retires and renames models.
When a call 404s, resolve a current ID via MCP `search_models` or
`recommend_model`, then use what they return. Log the swap in the slate so
the next run knows the new ID.
