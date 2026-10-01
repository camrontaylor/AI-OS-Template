# Changelog — mkt-visual-identity

All notable changes to this skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [2.0.1] — 2026-07-15

### Changed
- Condensed the SKILL.md frontmatter description to fit the repository's 1024-character cap for skill frontmatter. Triggers, modes, output contract, and behaviour are unchanged; this is a metadata-only edit that keeps CI green.

## [2.0.0] — 2026-06-16

The visual-identity engine is now a focused brand-identity skill, applied consistently across every system that uses your brand look.

### Improved
- **Brand book regenerates only when your identity actually changes** — no more duplicate PDF backups piling up on every run.
- More reliable brand colour, token, and font handling when building templates.
- Cleaner text-measurement and layout checks for better-looking results.

## [1.1.0] — 2026-05-26

### Added
- Template Factory **style grouping** (Phase 4.97): groups the clustered template families into 1-N coherent brand *styles* (a curated cross-role subset — hero(s) + bodies + cta — sharing an aesthetic), with a per-style role-completeness check and an always-on user confirmation of the grouping. Records a `styles:` section in `template-families.yaml`.
- Emits `templates/{pool}/styles.json` (Phase 5.6) when ≥2 styles are approved — the per-carousel style contract consumed downstream. Self-contained; single-look brands get no `styles.json` (flat pool, unchanged).

## [1.0.0] — 2026-05-26

### Added
- Initial release. Foundation skill that builds and incrementally refines a brand's
  visual identity from reference material (PDFs, URLs, screenshots, existing posts,
  brand docs). Runs before any execution skill that renders visuals.
- Six modes: Extract (analyze refs), Import (existing design system), Build
  (interview), Auto-Scrape (URL), Neutral (explicit no-refs fallback), and
  Template Factory (per-output-format HTML template variation generator).
- Dual synced output contract: machine-readable artifacts
  (`tokens.json`, `identity.md`, `moves.md`, `fonts/`, `logos/`, `compositions/`)
  plus a `brand-book.pdf` brand bible.
- Guided intake flow with required brand-name capture, per-file asset
  classification (brand asset vs template reference), and multi-brand
  disambiguation.
- Deterministic, open-source toolchain: PyMuPDF + Pillow for PDF rasterization,
  Playwright (Chromium) + Pillow for brand-bible PDF generation, and a
  stdlib-only Google Fonts resolver for font fetching. No proprietary PDF skill,
  no bundled fonts.
- Helper scripts for token extraction, font fetch, logo background cleanup,
  measurement validation, brand validation, and preview rendering.
- `linkedin-carousel` template pool (3 hero + 10 body + 3 cta) as the v1 output
  format.
- Bundled `references/canva-magiclayers-guide.md` — the carousel preview links to
  it ("Editing in Canva? Open the Magic Layers guide") for users who want to tweak
  slides in Canva after generation. Embedded in the preview; not copied into each
  run folder.
