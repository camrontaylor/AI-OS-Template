# Engine: fal.ai (generation guide)

This is the fal.ai variant of the ad-creative engine. It tells you how to set up
fal.ai, which model to pick, how to keep creatives on-brand, and how to call the
queue from a script. Use it when the shared pipeline reaches the GENERATE step.

Prices and model IDs drift. Re-verify any price or ID before a real launch. Pull
the live number with the MCP `get_pricing` tool or from `fal.ai/pricing`.

## Contents

- [Setup](#setup)
- [Two ways to call fal](#two-ways-to-call-fal)
- [Model routing table](#model-routing-table)
- [Consistency levers](#consistency-levers)
- [REST queue flow](#rest-queue-flow)
- [JS example: gen from a reference image with a fixed seed](#js-example-gen-from-a-reference-image-with-a-fixed-seed)
- [Wiring into the shared pipeline](#wiring-into-the-shared-pipeline)
- [Helper script: scripts/falgen.mjs](#helper-script-scriptsfalgenmjs)
- [Model deprecation fallback](#model-deprecation-fallback)

## Setup

Set one env var. All fal SDKs and the CLI read it on their own.

```bash
export FAL_KEY=your-api-key
```

The auth prefix is NOT the same in both paths. This trips people up:

- MCP server: `Authorization: Bearer YOUR_FAL_KEY`
- REST queue: `Authorization: Key $FAL_KEY`

WHY it matters: copy the wrong prefix and you get a 401 that looks like a bad key
when the key is fine.

### Add the official fal MCP server (agent path)

For an agent inside Claude Code, the MCP server is the easy path. It lets the
agent find a model, read its input schema, check the price, upload a reference
image, and run a job without hardcoding anything.

- URL: `https://mcp.fal.ai/mcp`
- Transport: Streamable HTTP (stateless)
- Auth: Bearer token in the `Authorization` header, sent per request, never stored

Add it:

```bash
claude mcp add --transport http fal-ai \
  https://mcp.fal.ai/mcp \
  --header "Authorization: Bearer YOUR_FAL_KEY"
```

Config JSON form:

```json
{
  "mcpServers": {
    "fal-ai": {
      "url": "https://mcp.fal.ai/mcp",
      "headers": { "Authorization": "Bearer YOUR_FAL_KEY" }
    }
  }
}
```

The 9 MCP tools:

| Group | Tools |
|-------|-------|
| Discovery | `search_models`, `get_model_schema`, `get_pricing`, `search_docs` |
| Execution | `run_model`, `submit_job`, `check_job` |
| Utility | `upload_file`, `recommend_model` |

## Two ways to call fal

- Agent path: use the MCP server above. Good for one-off gen inside a session.
- Script and batch path: use the REST queue (below) or the bundled
  `scripts/falgen.mjs`. Good for scheduled jobs and big batches. No SDK needed.

There is also a JS SDK (`@fal-ai/client`) and a Python SDK (`fal-client`) if you
want them, but the queue path covers batch work with no install.

## Model routing table

Route by the job, not by habit. Exact fal model IDs below.

| Use | Model ID | Price | Notes |
|-----|----------|-------|-------|
| Photoreal product, newest, zero-config | `fal-ai/flux-2-pro` | $0.03/MP | FLUX.2 pro. Edit variant: `fal-ai/flux-2-pro/edit` (multi-reference) |
| Photoreal + text control + up to 10 refs | `fal-ai/flux-2-flex` | $0.06/MP | FLUX.2 flex. Stronger text rendering. Edit: `fal-ai/flux-2-flex/edit` |
| Cheap proven image-to-image | `fal-ai/flux/dev/image-to-image` | $0.03/MP | FLUX.1 dev img2img. The workhorse for ref-conditioned variants |
| Scene edit, keep product change scene | `fal-ai/flux-pro/kontext` | $0.04/image | FLUX.1 Kontext pro. Best for in-context edits |
| Vector, logo, long text, brand style | `fal-ai/recraft/v3/text-to-image` | $0.04/image ($0.08 vector) | Recraft V3. Img2img: `fal-ai/recraft/v3/image-to-image` |
| Train a reusable brand style | `fal-ai/recraft/v3/create-style` | (see pricing page) | Train a `style_id` from up to 5 brand images |
| Typographic posters, headlines in image | `fal-ai/ideogram/v3` | per-image price UNCONFIRMED | Ideogram V3, ~90-95% text accuracy. Also `/edit`, `/replace-background`, `/layerize-text` |
| Reference compositing | `fal-ai/nano-banana/edit` | $0.0398/MP (per pricing page); per-image for `/edit` UNCONFIRMED | Gemini 2.5 Flash Image edit, natural-language edits from refs |
| nano-banana Pro, strong character lock | `fal-ai/nano-banana-pro/edit` | UNCONFIRMED | Gemini 3 Pro Image. Up to 14 refs, 4 variations at once |
| Short video, budget | `fal-ai/kling-video/...` (Kling 2.5 Turbo Pro / 3.0) | ~$0.07/s (Kling 2.5 Turbo Pro); Kling 3.0 ~$0.029/s UNCONFIRMED | Cheapest solid image-to-video / text-to-video for ad clips |
| Short video, premium | Veo 3 / 3.1 (Google) on fal | $0.40/s (Veo 3); Veo 3.1 Lite ~$0.05/s UNCONFIRMED | Highest fidelity, highest cost |
| Short video, reference/multi-shot | `bytedance/seedance-2.0/reference-to-video` (also `/text-to-video`, `/image-to-video`) | Seedance 2.0 ~$0.30/s UNCONFIRMED | Up to 15s, multi-shot, up to 9 images / 3 videos / 3 audio, native audio |

Other prices seen on the fal pricing page, June 2026: FLUX.2 dev $0.012/MP,
FLUX.2 max $0.07/MP, Seedream V4 $0.03/image, Qwen $0.02/MP, Wan 2.5 $0.05/s,
Ovi $0.20/video.

Rough budget: about $0.01 to $0.07 per still image, about $0.05 to $0.40 per
second of video. A 30-creative batch in 3 sizes (90 stills) on FLUX.2 pro at
about 1MP each is roughly $2.70.

FLUX.2 launched Nov 25, 2025 (pro/dev/flex/max). The `/edit` endpoints and the
`/image-to-image`, `image_urls`, and Kontext endpoints are the reference-image
and style entry points.

## Consistency levers

These are how you keep a batch on-brand. Stack them.

1. Image-to-image. Use `.../image-to-image` with `image_url` plus `strength`
   (0 to 1, default 0.95). Lower strength stays closer to the base. Keep the
   layout from a base creative and just restyle the copy or season.
2. Reference images. Pass an `image_urls` array (nano-banana/edit; FLUX.2 flex
   up to 10 refs; nano-banana-pro up to 14; Seedance multi-input). Locks the
   product, the model, or the scene.
3. In-context edit. FLUX.1 Kontext and FLUX.2 edit change one element and hold
   the rest. fal calls this differential-diffusion control over what changes
   versus stays constant across variants.
4. Trained brand style. Recraft `create-style` gives a reusable `style_id` you
   apply to every gen.
5. Brand colors. Recraft `colors` param forces exact brand hex values.
6. Seed locking. The `seed` param (FLUX, Recraft, nano-banana, Ideogram) makes a
   reproducible base. Same seed and prompt = same base; vary one input for clean
   A/B variants.
7. Aspect ratio and size presets. `image_size` / `aspect_ratio` presets like
   `landscape_16_9`, `1:1`, `9:16`, `4:5`. One render config per ad placement
   drives the multi-size export.

## REST queue flow

Use the async queue for batch ad runs. Submit, then get the result by webhook.
Polling works but webhooks are better for batches.

| Step | Call |
|------|------|
| Submit (async) | `POST https://queue.fal.run/{model-id}` returns `request_id`, `status_url`, `response_url` |
| Status | `GET https://queue.fal.run/{model-id}/requests/{request_id}/status` |
| Result | `GET https://queue.fal.run/{model-id}/requests/{request_id}` (the `response_url`) |
| Sync (short jobs) | `POST https://fal.run/{model-id}` returns the result directly |
| Webhook | Append `?fal_webhook=https://your.app/api/fal/webhook` to the submit URL |

Webhooks: fal POSTs the result when the job finishes. Verify the signature with
ED25519 public keys from `https://rest.alpha.fal.ai/.well-known/jwks.json`. Use
webhooks (not polling) for batch ad runs, and key each row by `request_id`.

curl submit example:

```bash
curl -X POST "https://queue.fal.run/fal-ai/flux/dev" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"..."}'
```

## JS example: gen from a reference image with a fixed seed

This conditions on a base creative and locks the seed so you get repeatable
variants. `FAL_KEY` is read from the environment.

```javascript
import { fal } from "@fal-ai/client"; // FAL_KEY read from environment

const result = await fal.subscribe("fal-ai/flux/dev/image-to-image", {
  input: {
    image_url: "https://your-cdn.com/brand/base-creative.png", // reference image
    prompt: "Same product hero shot, holiday red-and-gold scene, bold sale headline space top-left",
    strength: 0.65,        // lower = stay closer to the reference
    guidance_scale: 3.5,
    num_inference_steps: 40,
    seed: 12345,           // lock for reproducible variants
    image_size: "square_hd",
    num_images: 4,
    output_format: "png"
  },
  logs: true,
  onQueueUpdate: (u) => {
    if (u.status === "IN_PROGRESS") u.logs.forEach(l => console.log(l.message));
  },
});
console.log(result.data.images.map(i => i.url));
```

For multi-reference brand compositing, swap to `fal-ai/nano-banana/edit` with
`image_urls: [url1, url2]` and a `prompt`, or `fal-ai/flux-2-flex/edit` (up to
10 refs).

## Wiring into the shared pipeline

How the GENERATE step and multi-size export use this engine:

- Brand lock. Upload brand assets with MCP `upload_file`. Train
  `fal-ai/recraft/v3/create-style` and store the `style_id` and brand `colors`
  in `brand_context`.
- Creative gen. Route by need: FLUX.2 pro/flex for product photoreal,
  Recraft or Ideogram for text-heavy, nano-banana/edit for ref compositing,
  Kontext for scene edits.
- Consistency. Hold the same `seed` + `style_id` + `colors` + reference
  `image_urls` across the whole batch.
- Multi-size export. Loop the same input over `image_size` / `aspect_ratio`
  presets (1:1, 4:5, 9:16, 16:9). One render config per placement.
- Batch tracking. Use queue `submit` + `fal_webhook`, key rows by `request_id`.
- QA. Re-run nano-banana-pro or a vision check to confirm the brand colors and
  logo are present before publish.

## Helper script: scripts/falgen.mjs

The pack bundles `scripts/falgen.mjs`, a small Node caller for the REST queue. No
SDK install needed. Use it for scripted and batch gen.

What it does:

- Reads `FAL_KEY` from the environment.
- POSTs to `https://queue.fal.run/{model-id}` with the REST `Authorization: Key`
  prefix.
- Polls the status URL, then fetches the result, or registers a webhook for
  batch runs.
- Returns the image URLs.

Pass it the model ID and the input JSON. When you need a base image, set
`image_url` and `seed` in the input the same way as the JS example above.

## Model deprecation fallback

Do NOT hardcode a model ID for the long term. fal retires and renames models.

When a model is gone or a call 404s, resolve a current ID at run time with the
MCP tools `search_models` or `recommend_model`, then use the ID they return.
Prefer this over guessing a replacement string.

If the MCP server is not available, drop to the REST queue with
`Authorization: Key $FAL_KEY`.
