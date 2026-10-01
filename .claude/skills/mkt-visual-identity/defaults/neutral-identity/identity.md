# {{ brand_name }} — Visual Identity

> **This is the neutral default identity.** It was copied here because the user had no reference materials at onboarding time. It is intentionally generic — black, off-white, and a coral accent. Refine it by adding any references (PDFs, screenshots, URLs, Figma exports) and re-running `mkt-visual-identity` in Extract mode.

## One-paragraph summary

{{ brand_name }} writes like a practitioner who builds things. The visual identity should match: confident, restrained, editorial. No corporate stock photography. No gradient overlays. The default palette is near-black on warm off-white with a single coral accent for the one bold move per slide. Typography is Geist — a precise neo-grotesque sans that reads as modern without being trendy.

## Where this identity sits

- **Closer to** Stripe Press, *Monocle*, Notion's brand guidelines — restrained, type-led, photographic when used at all.
- **Further from** SaaS-template gradients, AI-default neon, illustration-heavy "playful" brands.

## When to override which fields

- **Colors** — if {{ brand_name }} is a sports team or a brand with crest colors, replace `accent` and (probably) `primary`. Keep `bg_light` neutral unless the brand explicitly uses a colored canvas.
- **Fonts** — Geist works as a placeholder. If the brand has a wordmark or display font, switch `display` to it. Body usually stays close to a neutral neo-grotesque (Inter, Geist, Söhne).
- **Type scale** — sized for a 1080×1350 LinkedIn carousel. Adjust the display size if the brand prefers smaller headlines; rarely adjust body downward.

## Universal moves this identity ships with

See `moves.md`. These three are brand-agnostic and apply to any default-mode post:

1. **Canvas margins** — 80px on all four sides. Reads as "considered, not full-bleed".
2. **Page indicator** — small mono caption bottom-right (`02 · 06`), Geist Mono.
3. **Accent bar** — 6px thick band in `accent` color, used once per slide to mark the one bold move.

When the user adds references, brand-specific moves replace these and the post starts looking like *their* brand.
