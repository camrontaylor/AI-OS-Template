# Engine: Figma + HTML Template (deterministic)

This is the build guide for the deterministic ad engine. It does NOT use AI to
make the image. It fills a fixed template with your text and pictures, then
exports the result. Same input, same pixels, every time.

These specs drift. The Figma write tools and the `figma.buzz` API are both in
active beta. Re-check every value before a launch.

## Contents

- [The core point](#the-core-point)
- [Setup](#setup)
- [The two fill paths](#the-two-fill-paths)
- [Export call](#export-call)
- [No-paid-tool fallback chain](#no-paid-tool-fallback-chain)
- [Bundled helper files](#bundled-helper-files)
- [Brand lock, how it stays on brand](#brand-lock-how-it-stays-on-brand)
- [Name confusion to avoid](#name-confusion-to-avoid)

## The core point

This engine does deterministic template substitution. It is not AI generation.
You build one locked template. The agent only fills text and image fields. It
never restyles anything.

Because of that:

- Brand lock is literal, not a guess. It comes from locked layers, edit
  restrictions, bound Variables for color and type tokens, and component
  instances. Not from a prompt.
- There is zero model drift. The same row of data always makes the same image.
- The output is not AI-generated content. That sidesteps the AI-content
  labeling that Meta, TikTok, and YouTube now require for AI creative. Use this
  engine when you want safe, regulator-friendly output (finance, health).

The cost: you need a designer or the agent to build the template once per size.

## Setup

You need a Figma personal access token to export.

| Item | Value |
|------|-------|
| Env var | `FIGMA_TOKEN` |
| Where to make it | Figma Settings -> Personal Access Tokens |
| Token shape | starts with `figd_...` |
| Scope needed | `file_content:read` |
| Auth header | `X-Figma-Token: $FIGMA_TOKEN` |
| File key | from the URL: `figma.com/:type/:file_key/...` |

Env block for `.env.example`:

```
# Service: Figma (https://www.figma.com/developers/api)
# Used by: viz-ad-factory-figma (render/export brand-locked ad frames to PNG/JPG/SVG/PDF)
# Fallback: node-html-to-image (local, no key) then HTML/CSS-to-Image MCP
FIGMA_TOKEN=
```

## The two fill paths

Both paths end with the same REST export. Pick by whether a human can click once.

### Path 1: headless (zero human clicks)

The remote Figma MCP server writes frames straight to the canvas. Per ad the
agent:

1. Clones the locked component.
2. Sets the text and the bound Variable values.
3. Sets the frame to the exact pixel size.

Repeat per ad, then export. This is the fully agentic path, no manual step.
WHY use it: when you want a hands-off batch with no person in the loop.

Note: this needs the remote Figma MCP server. The desktop server reads context
but the write-to-canvas tools need the remote one.

### Path 2: human-in-the-loop (one click)

The agent ships a Figma Buzz plugin plus a campaign CSV or XLSX (one row per
ad: headline, subhead, CTA, image URL). A person clicks once to run Bulk
Create, which fans the spreadsheet out to one on-brand asset per row.

The Buzz plugin uses the `figma.buzz.*` API. Manifest `editorType` is `['buzz']`.
Useful calls:

- `createFrame(row, col)`
- `createInstance(component, row, col)`
- `getTextContent(node)` / `getMediaContent(node)`
- `setBuzzAssetTypeForNode(node, BuzzAssetType)` (sets the platform format)
- `smartResize(node, w, h)`

**Honest limitation:** Buzz Bulk Create has no headless trigger. There is no
REST or API way to start Bulk Create or run a Buzz plugin from outside Figma.
The plugin runs inside the Figma app. A human, or a UI-automation layer, must
launch it. So the pure no-click route is Path 1, not this one.

## Export call

The export is the same for both fill paths. Batch ALL node IDs into ONE request.
WHY: the rate limits are punishing, and one call keeps you under them.

```
GET https://api.figma.com/v1/images/:file_key?ids=NODE1,NODE2&format=png&scale=2
X-Figma-Token: $FIGMA_TOKEN
```

| Param | Notes |
|-------|-------|
| `ids` | comma-separated node IDs, batch every frame into one call |
| `format` | `png`, `jpg`, `svg`, or `pdf` |
| `scale` | 0.01 to 4. Use `2` for retina, or set scale so artboard x scale = target px |

Key facts:

- Returns temporary S3 URLs. They are valid about 30 days. Download right away.
- Max image size is 32 MP. Anything bigger is auto-scaled down.
- Rate limits are harsh. Paid Full or Dev seat is about 20 per minute.
  Free or Starter files are capped to about 6 per month no matter the token.
  So this engine needs a paid seat to run a real batch.
- On a `429`, wait per the `Retry-After` header, then retry.

## No-paid-tool fallback chain

When the install has no Figma seat, render the ad from HTML and CSS instead.
This is still deterministic: same input, same pixels. Use this order:

1. **`node-html-to-image` (local, primary fallback).** `npm i node-html-to-image`.
   Renders PNG or JPEG from HTML with headless Chromium, and bundles Handlebars
   for templating. Pattern: one HTML/CSS template per platform size with
   `{{headline}}`, `{{cta}}`, `{{image}}` placeholders. Fix the root element to
   the exact pixels (for example `width:1080px;height:1350px`). Pass
   `deviceScaleFactor` for retina. Loop the campaign rows. Modeled on the
   open-carrusel pattern (GitHub `Hainrixz/open-carrusel`, MIT): Claude writes
   HTML/CSS, Puppeteer screenshots it to exact sizes, a brand config file is
   read before every render so output stays on brand. Latest 5.0.0, MIT.
2. **HTML/CSS to Image MCP.** Server URL `https://mcp.hcti.io` (OAuth). Needs an
   htmlcsstoimage.com account. Tool `create_batch_images` does up to 25 images
   per request, good for ad batches. Deterministic, it just renders your exact
   HTML in Chromium.
3. **Manual.** Ask the user to fill the template by hand.

Encode this chain in SKILL.md: Figma (if `FIGMA_TOKEN` and a template file are
present) -> node-html-to-image local (if Node and Chromium) -> HTML/CSS-to-Image
MCP (if API key) -> manual.

## Bundled helper files

| File | What it does |
|------|--------------|
| `scripts/figma-export.mjs` | Calls the export endpoint, batches IDs, downloads the temporary URLs |
| `scripts/render-ad.mjs` | Local HTML render via node-html-to-image with Handlebars placeholders |
| `assets/ad-template.html` | The HTML/CSS template, root fixed to exact px |

## Brand lock, how it stays on brand

- **Figma path:** locked layers, edit restrictions in the template, bound
  Variables for color and type tokens, component instances, and the right
  `BuzzAssetType` per platform. The agent fills only text and image fields.
- **HTML path:** a brand config (palette hex, fonts, logo, radius, spacing)
  injected into one locked CSS layer. The agent writes only the content layer,
  never the brand CSS. The root element is fixed to platform pixels with
  `deviceScaleFactor`.

## Name confusion to avoid

Two Figma product names get pulled into this engine by mistake. They do not
belong here:

- **Figma Weave** is the rebranded Weavy generative canvas (node-based AI image
  and video). It makes AI output, so it is not deterministic. It belongs with
  the fal variant, not this one.
- **Figma Make** is an app builder (prompt to code). It builds apps, not sized
  static ad images. Out of scope.
