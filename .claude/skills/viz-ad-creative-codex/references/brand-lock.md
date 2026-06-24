# Brand Lock

The brand lock is the single file that keeps every ad on-brand on the first try, across all three image engines. It is structured data the agent reads and pushes into every copy prompt and every image prompt.

These specs drift (model params, platform safe zones, fonts). Re-verify before any launch.

## Contents

- [Why JSON, not a PDF guide](#why-json-not-a-pdf-guide)
- [The brand-profile.json schema](#the-brand-profilejson-schema)
- [Voice-to-style mapping table](#voice-to-style-mapping-table)
- [The locked reference-image set](#the-locked-reference-image-set)
- [AI-OS adapter note](#ai-os-adapter-note)
- [How the QA gate uses this file](#how-the-qa-gate-uses-this-file)

## Why JSON, not a PDF guide

A PDF brand guide is invisible to a generation model. The model cannot read it. So a PDF cannot shape the output.

Make the brand lock structured data instead (JSON). The agent reads it and injects the exact values into every copy and image prompt. Five reasons this works:

1. **Structured** - fields, not prose, so the agent can pull exact values.
2. **Parsable** - the agent reads it directly, no human in the loop.
3. **Standardized** - same schema every time, so every skill reads it the same way.
4. **Accessible** - it is a local file the agent always has.
5. **Version-controlled** - changes are tracked, so you can roll back.

Schema-building rules (keep these in mind when you fill the file):

- **Be specific.** Vague input gives inconsistent output.
- **Define what you are AND what you are NOT.** Include rejected examples, not just approved ones.
- **Structure per context.** Social tone is not legal tone. Give each context its own block.
- **Version-control it.** Bump `version` and `updated` on every change.
- **AI learns from examples better than from adjectives.** Show a good line and a bad line, do not just say "friendly".

Note: the same pattern can be served over MCP so any agent queries the brand live. For AI-OS, the local JSON is the source of truth and lives under `brand_context/`. Do not over-build this into a service.

## The brand-profile.json schema

This merges two source schemas: the claude-ads voice-axes block (numeric 1-to-10 voice scores that drive the style mapping below) plus the visual, messaging, and reference_set fields. Drop the skeleton in `assets/` and fill it per client.

Voice axes use **1 = extreme left pole, 10 = extreme right pole**. Those scores feed the voice-to-style table to build the visual part of every image prompt.

```json
{
  "schema_version": "1.0",
  "brand_name": "",
  "tagline": "",
  "mission": "",
  "positioning": "",
  "website_url": "",
  "extracted_at": "ISO-8601",
  "voice": {
    "formal_casual": "1-10",
    "rational_emotional": "1-10",
    "playful_serious": "1-10",
    "bold_subtle": "1-10",
    "traditional_innovative": "1-10",
    "expert_accessible": "1-10",
    "friendly_authoritative": "1-10",
    "descriptors": ["3-5 strings"],
    "perspective": "second person (you/your)",
    "avoid": ["corporate jargon", "passive voice"],
    "tone_examples": [
      {
        "attribute": "conversational",
        "description": "Write like explaining to a colleague over coffee",
        "example_approved": "Here's how this works.",
        "example_rejected": "The operational methodology functions thusly."
      }
    ]
  },
  "messaging": {
    "value_props": ["", "", ""],
    "key_phrases": ["", ""],
    "boilerplate": "",
    "banned_claims": ["", ""]
  },
  "audience": {
    "personas": [
      {
        "name": "",
        "age_range": "",
        "profession": "",
        "pains": ["", ""],
        "desires": ["", ""],
        "language_they_use": ["", ""]
      }
    ]
  },
  "visual": {
    "colors": {
      "primary": "#______",
      "secondary": "#______",
      "accent": "#______",
      "background": "#______",
      "text": "#______",
      "forbidden": ["#______"]
    },
    "typography": {
      "heading_font": "",
      "body_font": "",
      "weights": ["", ""],
      "pairing_descriptor": ""
    },
    "logo": {
      "primary_file": "assets/brand/logo.svg",
      "clearspace": "",
      "min_size_px": 0,
      "usage_rules": ["never recolor", "never stretch"],
      "safe_backgrounds": ["light", "dark"]
    },
    "imagery_style": {
      "look": ["", ""],
      "lighting": "",
      "composition": "",
      "subjects": [],
      "do": ["", ""],
      "dont": ["", ""]
    },
    "aesthetic": {
      "mood_keywords": [],
      "texture": "",
      "negative_space": ""
    }
  },
  "contexts": {
    "paid_social_static": { "tone": ["", ""], "aspect_ratios": ["1:1", "4:5"] },
    "paid_social_video":  { "tone": ["", ""], "aspect_ratios": ["9:16", "4:5"] },
    "google_rsa":         { "tone": ["", ""], "headline_max": 30, "description_max": 90 }
  },
  "reference_set": {
    "logo_lockups": ["assets/brand/lockup-1.png"],
    "approved_product_shots": ["assets/brand/product-1.png"],
    "style_anchors": ["assets/brand/style-anchor-1.png"],
    "color_swatch_sheet": "assets/brand/swatches.png"
  },
  "version": "1.0.0",
  "updated": "YYYY-MM-DD"
}
```

## Voice-to-style mapping table

This table turns each voice axis score into concrete image-prompt words. This is what keeps the look the same across every engine. Read the brand's score on each axis, pick the matching descriptor, and add those words to the style part of the image prompt.

Score band: **low = 1-3**, **mid = 4-6**, **high = 7-10**.

| Voice axis | Low (1-3) | Mid (4-6) | High (7-10) |
|---|---|---|---|
| formal_casual | Clean lines, symmetrical, muted palette, serif type | Balanced layout, neutral tones, modern sans-serif | Organic shapes, warm palette, hand-drawn elements |
| rational_emotional | Data overlays, charts, structured grids, cool tones | Infographic style, balanced data and imagery | Expressive color, human faces, dynamic motion blur |
| bold_subtle | Soft focus, pastel tones, whitespace, thin strokes | Medium contrast, standard weight type, clear hierarchy | High contrast, saturated color, heavy type, full bleed |
| traditional_innovative | Classic compositions, heritage textures, earth tones | Contemporary layouts | Futuristic gradients, 3D renders, neon accents, glass |
| friendly_authoritative | Rounded shapes, illustration style, bright accents | Photography plus illustration | Editorial photography, dark backgrounds, gold accents |
| playful_serious | Whimsical patterns, cartoon elements, candy colors | Lifestyle photography, natural color grading | Cinematic lighting, desaturated palette, minimal decor |

How to use it: feed the brand-profile voice scores through this table, build the visual-style portion of every image prompt from the matched cells, and you get the same brand look no matter which engine generates the image.

## The locked reference-image set

Image models are stateless. They do not remember a brand, a face, or a product shape between calls. Left alone, the look drifts (wrong color, wrong logo, wrong product). The fix is a small, fixed set of approved images passed into every generation call.

Lock these images and pass them in every time:

| Reference | How many | What it anchors |
|---|---|---|
| Logo lockup | 1 | The exact logo, so it is never redrawn |
| Product shots | 1 to 3 | The real product shape, from canonical angles |
| Style anchors | 1 to 2 | The overall look and mood |
| Color swatch sheet | 1 | The exact brand hex colors |

Store the paths in the `reference_set` block of `brand-profile.json` (above) so every engine reads the same set.

The per-engine consistency lever (how each engine actually accepts these references, for example reference-image conditioning, character reference, image-to-image inputs, fixed seed) differs by engine and is covered in the engine reference file, not here. Verify the exact current params per engine at build time.

Two extra locks that ride alongside the reference images:

- Write the **exact hex codes and font names** from the JSON straight into the prompt text.
- Use a **fixed seed** where the engine supports it.

For the deterministic Figma or template engine, the brand lock is literal: components, design tokens (colors and type as variables), and locked text and asset frames. There is no drift because it is template substitution, not generation.

## AI-OS adapter note

Before extracting brand data from a URL or interview, check AI-OS first. AI-OS already stores brand memory under `brand_context/`. Build on it, do not duplicate it.

Read these if they exist and map them into `brand-profile.json`:

| AI-OS file | Maps into |
|---|---|
| `brand_context/voice-profile.md` | `voice` (tone, perspective, avoid, descriptors, tone_examples) |
| `brand_context/positioning.md` | `positioning`, `tagline`, `mission`, `messaging.value_props`, `messaging.key_phrases` |
| `brand_context/icp.md` | `audience.personas` (pains, desires, language_they_use) |

If those files do not exist, fall back to extracting from the client URL or a short interview, then offer to save the result back into `brand_context/` so the next run starts richer.

## How the QA gate uses this file

After an asset is generated, the QA gate checks it against this file and the locked reference set before the asset can ship. Check each of these:

| Check | Pass condition |
|---|---|
| Color | Every brand hex is present and within tolerance (no off-brand recolor) |
| Logo | Logo is present and unmodified (not recolored, not stretched, not redrawn) |
| Fonts | Heading and body fonts match the `typography` block |
| Safe zones | Text and logos stay out of the platform overlay safe zones |

If any check fails, do not ship the asset. Regenerate or fix, then re-run the gate. The gate never fails silently: it reports what failed and why.
