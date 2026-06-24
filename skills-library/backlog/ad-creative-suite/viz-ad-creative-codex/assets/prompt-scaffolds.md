# Codex Native Prompt Scaffolds (ad creative)

These are prompt skeletons for the Codex-native image generation path. Fill them per approved concept, save each final prompt to `prompts/`, then generate via Codex image generation.

The single rule that keeps a batch useful: reuse the same brand-lock block and vary only one element across the batch.

## Scaffold 1: Static Paid Social Ad

Use for Meta, LinkedIn, TikTok image, or Google Demand Gen stills.

```text
Create a {ASPECT_RATIO} paid social ad image for {PLATFORM_PLACEMENT}, target size {PIXELS}.

Campaign goal: {CONVERSION_GOAL}.
Audience: {ICP_SEGMENT} who feel {BUYER_PROBLEM}.
Hook hypothesis: {HOOK_STRUCTURE} - {HOOK_LINE}.

Brand lock:
- Brand: {BRAND_NAME}
- Colors: {PRIMARY_HEX}, {SECONDARY_HEX}, {NEUTRALS}
- Typography feel: {FONT_STYLE}
- Logo rule: {LOGO_RULE}
- Visual style: {IMAGERY_STYLE}
- Product/reference rule: {PRODUCT_REFERENCE_RULE}

Composition:
{SUBJECT_AND_SCENE}. Keep the focal subject inside the center safe zone.
Leave enough negative space for platform UI overlays.

Exact in-image text: "{IN_IMAGE_TEXT}".
CTA text: "{CTA_TEXT}".

Avoid: generic stock ad look, distorted hands, unreadable UI labels, invented logos, off-brand colors, extra claims, fake scarcity, prohibited before/after claims.
```

## Scaffold 2: Textless Visual for Template Finish

Use when exact typography matters and the final headline should be layered in Figma/HTML after generation.

```text
Create a {ASPECT_RATIO} ad background image for {PLATFORM_PLACEMENT}, target size {PIXELS}.

Brand: {BRAND_NAME}. Use {COLORS}, {LIGHTING}, {IMAGERY_STYLE}.
Scene: {SCENE} showing {PRODUCT_OR_OUTCOME} for {AUDIENCE}.
Composition: strong focal point, open negative space in the {TOP_OR_LEFT_OR_CENTER} for headline and CTA overlay.
No baked-in text. No logo. No UI gibberish.

Avoid: generic stock imagery, extra brand marks, text rendering, distorted product, off-brand colors, exaggerated claims.
```

## Scaffold 3: UGC First Frame

Use for a static first frame or thumbnail that can become a vertical video concept later.

```text
Create a 9:16 vertical ad first-frame image for TikTok/Reels/Shorts.

UGC hook: "{HOOK_LINE}"
First-frame scene: {CREATOR_OR_CUSTOMER_CONTEXT}, natural phone-shot composition, believable lighting, authentic buying moment.
Product/offer visible: {PRODUCT_OR_OFFER_VISUAL}.
Brand cues: {COLORS}, subtle {LOGO_RULE}, no over-polished studio look.
Safe zones: keep headline inside center 60%, leave top and bottom UI overlay space.

Exact overlay text: "{SHORT_OVERLAY_TEXT}"
Avoid: fake influencer polish, unrealistic reaction, unreadable text, extra hands/fingers, policy-risk claims.
```

## Variation Rules

- One element per variant: hook, scene, proof, offer, or CTA.
- Two executions per hook structure.
- Save the prompt before generation.
- If text rendering fails twice, switch to Scaffold 2 and finish typography through `viz-ad-creative-figma`.
