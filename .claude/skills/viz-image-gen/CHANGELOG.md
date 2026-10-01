# Changelog — viz-image-gen

All notable changes to this skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [2.1.6] — 2026-06-27

### Added
- **Path resolution now works without the installer.** Previously the skill expected an installer-generated config file to tell it where the project's `.env`, brand assets, generated images, and project root live. When the skill runs inside a host that doesn't use the skill-systems installer, that file isn't present and path-dependent steps had nothing to fall back on. The skill now resolves those locations relative to the project root by default (`.env`, `brand_context/`, `projects/`, and the project root itself), so image generation works out of the box in any host.

## [2.1.5] — 2026-06-11

Masthead now renders from the brand token, not the per-template sample (run-02 L6 — half the templates signed `@yourbrand` pre-rebrand, half `@yourbrand`):

### Fixed
- **`chrome.masthead.labels` now drives `MASTHEAD_LEFT/CENTER/RIGHT` (TOKEN > SAMPLE).** The brand's masthead identity (`tokens.json > chrome.masthead.labels`) was loaded by `brand_kit_loader` but never mapped to the masthead slots — an orphan value. The masthead rendered from the per-template `instructions.md` `sample:` instead (merged in `main()` under `--use-sample-text` with "only fill what's missing"), so stale pre-rebrand samples signed templates `@yourbrand`. New `apply_masthead_tokens()` does an **unconditional** override of the 3 slots from the token, called in `main()` right after the sample merge so TOKEN wins over SAMPLE (inverts the BRAND-WINS-caller rule — done locally, not in `inject_brand_tokens_into_data`, whose "fill what's missing" semantics would let the stale sample win). Preserves the intentional empty center (`labels[1] == ""` written through), respects `chrome.masthead.enabled == False`, skips `None` labels (leaves any sample). 7/7 templates now sign `@yourbrand` / empty / `AI-OS` from the token.

### Added
- **`apply_masthead_tokens(data, brand_kit)`** in `render_template.py` — pure helper, set-direct (not `setdefault`).
- **`test_sample_text.py::TestMastheadTokenPrecedence`** (7 tests) — parity gate: token overrides stale sample, empty center preserved, disabled/absent-chrome no-op, `None` label keeps sample.

## [2.1.4] — 2026-06-09

Tolerant manifest reader in `resolve_pool_template` (AIOS-190 manifest seam):

- **`render_template.py` `resolve_pool_template`** matched the template id on `t.get("id")` and read `entry["file"]` with a hard subscript. The AI-first `ssc-template-builder` writes `slug`/`template_html`/`template_dir` (no `id`/`file`), so the renderer failed the id match and `KeyError`'d on `entry["file"]`. Now matches on the canonical id alias (`id|slug|name|dirname`) and derives `file` via the same alias rule (`file|template_html|template_dir+/template.html`, made pool-relative). Idempotent for canonical entries. Helpers (`_manifest_entry_id` / `_manifest_entry_file`) are duplicated verbatim from `00-social-content/content_studio.py` — the two readers live in different skills with no shared import path — and documented "keep in sync". New `test_manifest_alias.py` covers builder-native resolution + idempotency vs the canonical schema.

## [2.1.3] — 2026-06-09

SPEC-C plumbing — the decisive "brand `@font-face` never loads in the HTML bake" fix (test-09-06), plus the brand-font token alias and the font-resolved gate hook:

### Fixed
- **Shared `@font-face` now loads in the bake (C1).** `render_template.render()` baked via `page.set_content()` (base = `about:blank`) and injected the pool's `_shared/styles.css` via `add_style_tag(path=…)`. That sheet's `@font-face` `src: url('../../../visual-identity/fonts/anton-400.woff2')` refs are RELATIVE → they resolved against `about:blank` and failed silently, so every HTML headline fell back to system sans (gated r03–r06; proof: r07's AI-baked "CAROUSEL" was real Anton while r03/r06's HTML headlines at the same size were system-sans). New `_read_css_with_inlined_urls()` reads each shared sheet and inlines its `url(...)` refs to `data:font/woff2;base64,…` (resolved against the CSS file's OWN parent dir, reusing `_inline_relative_urls`), then injects via `add_style_tag(content=…)`. Applied to BOTH the pool-level and per-template shared sheets. Verified: `document.fonts.check('400 100px "Anton"')` → true on re-rendered r03/r04/r06.
- **`--brand-display` / `--brand-body` aliases now emitted (C2).** The token builder emitted `--font-display`/`--font-body`, but the pool templates' inline styles read `var(--brand-display, 'Anton'…)` → the brand-override font path was dead (only the literal `'Anton'` fallback rendered; verified r04). Now emits `--brand-display`/`--brand-body` aliases alongside, keeping the literal fallback in the chain.

### Added
- **Font-resolved check in the bake (C3).** After `document.fonts.ready`, `render()` parses the brand display family from the `--brand-display` token (`_brand_display_family()`) and evaluates `document.fonts.check`, writing the verdict to a sidecar `<output>.fontcheck.json` and printing `[font-check] ok|FALLBACK`. New `--require-font` flag hard-fails the bake (non-zero exit) on fallback, for the quality gate. Guards C1 from silently regressing.
- Unit tests `test_font_inlining.py` (`_read_css_with_inlined_urls` inlines a relative woff2 + leaves a missing file untouched; `_brand_display_family` parsing).

## [2.1.2] — 2026-06-09

Content Studio bg-recolor parity fix (AIOS-139):

- `_build_tweaks_css` emits `background: <color> !important` for a `bgColor` tweak. The synthetic root BACKGROUND layer (`_BG_LAYER_DIV`) carries an inline `background:inherit`; inline beats a plain stylesheet rule, so the recolor was silently dropped in the bake while the live editor (inline `el.style.background`) applied it → live↔bake divergence ("change bg color, remove the image on top, bg stays the old color"). `!important` lets the tweak win. Parity test strengthened to assert it.

## [2.1.1] — 2026-06-09

AIOS-190 Template Studio integration: `render_template.py` self-contained edit-slide emit, scale crop/square, raw-text bake; `generate_image_gpt.py` hardening + tests.

## [2.1.0] — 2026-06-06

Content Studio FASE 7 (AIOS-139 Addendum 8 #1) — `render_template.py --emit-edit-slide`.

### Added
- `--emit-edit-slide` flag + `emit_edit_slide()` / `_resolve_template_assets()`: after baking a
  templated slide (Case A/C), persist a self-contained `<run>/_slides/<slide-id>/` editing dir
  (`template.html` + `instructions.md` + `metadata.json` carrying the slide's REAL `--data`) and a
  once-copied `<run>/_slides/_shared/` (styles.css + brand fonts). No-op for full-AI (`.prompt.md`).
  This is the run-folder ↔ Content Studio contract: without it a real run holds only `slide-*.png`
  and templated slides fall back to a flat read-only image. +3 tests.

Content Studio FASE 6 (AIOS-139 Addendum 7) — bake support for a **stackable** BACKGROUND.

### Changed
- **`_tag_root_bg` now injects a dedicated inset:0 BACKGROUND child** (`background:inherit`,
  `z-index:0`) instead of tagging the root `.slide`. A container can't be z-indexed above
  its own children, so the old root-tag never stacked. The new child takes a real z-index
  (`_build_tweaks_css` → `position:relative; z-index`), so raising BACKGROUND overlaps the
  layers below — byte-identical to `preview_editor._tag_root_bg` (RNDR-04 parity; locked by
  a cross-module test). No-op when a real BACKGROUND element already exists.

Content Studio FASE 4 (AIOS-139 Addendum 5) — bake support for the per-slide
post-production texture overlay.

### Added
- **`_materialize_texture`** — injects a full-slide, `mix-blend-mode` texture overlay
  into `.slide` from the per-slide `__texture` tweak (`{tex, blend, intensity}`), the
  same element the editor renders client-side, so preview == baked PNG (RNDR-04). Blend
  is allowlisted; intensity clamped 0..1; no-op without `__texture` (RNDR-05 preserved).

### Changed
- `_build_tweaks_css` and `apply_tweaks` skip reserved `__`-prefixed keys (e.g.
  `__texture`) so non-slot metadata never leaks into zone CSS/text overrides.

Content Studio Remove-Asset — make the bake honor hidden/removed zones.

### Changed
- **`_build_tweaks_css` now honors removal.** A zone tweak with `removed: true`
  emits `display: none !important` (and skips all other props); a zone with
  `visible: false` (the per-layer eye) emits `display: none`. This closes the
  round-trip gap where eye-hidden or removed zones reappeared in the baked PNG —
  the live preview's `display:none` now matches the bake (RNDR-04). The no-tweaks
  and unrelated-tweaks paths are unchanged (RNDR-05).

### Tests
- +4 in `test_apply_tweaks.py` (`removed:true` → display:none !important + skips
  other props; `visible:false` → display:none; `visible:true`/absent does not
  hide) and +3 in `test_layer_bake_parity.py` (RNDR-04 client-vs-bake markup
  parity: the canonical `<img data-slot>` shape, STUDIO_JS injects it identically,
  x/y/w/h/tilt/opacity position layers the same in the bake).

Content Studio FASE 2 — layer-bake parity (RNDR-04, AIOS-139 Addendum 4).

### Added
- **`_materialize_layers(raw_html, slide_tweaks)` in `render_template.py`.**
  Before tweaks CSS is injected, any `LAYER_NN` slot entry that carries an
  `"img"` key (a data URI or URL for the decomposed layer PNG) is materialized
  as an absolutely-positioned `<img data-slot="LAYER_NN">` element inside the
  slide root. The existing `_build_tweaks_css` then positions it via the same
  `x/y/w/tilt` keys the canvas writes — no new tweaks schema needed.
  Called from `render()` only when `_slide_tweaks` is non-empty; no-op (raw
  HTML unchanged) when no layer entries are present, preserving the RNDR-05
  byte-identical guarantee for empty tweaks.
- **`test_layer_bake_parity.py`** — 10 tests (stdlib unittest, no Playwright
  in CI). Covers: layer `<img>` materialized in HTML, CSS rule keyed by
  data-slot handle, positioned by x/y/w/tilt, tilt emits rotate(), image src
  present in bake output, preview == bake (deterministic / RNDR-04), no new
  tweaks schema, `_materialize_layers({})` no-op (RNDR-05), non-layer tweaks
  unchanged, empty-tweaks full-render identical to baseline.

### Added
- **Root-background tagging (AIOS-139 Stage B).** New `_tag_root_bg` fallback inside `_tag_decor`: when no element carries the `BACKGROUND` handle (the background is on the slide root or a CSS rule, not a `div.bg`), the slide root (`.slide`, else `<body>`) is tagged `data-slot="BACKGROUND"` so the editor can edit it and a `bgColor` tweak rebakes. Mirrored verbatim in `preview_editor._tag_decor` → preview/bake parity (RNDR-04). No-op when a BACKGROUND already exists.

### Added
- **Per-zone `fontFamily` override (AIOS-139 Stage A).** `tweaks.json` can now set a font per zone; `_build_tweaks_css` emits `font-family` via the new `css_font_value` (quoted family + generic fallback). A curated web-font set (`CURATED_FONTS`: Inter, Geist, Manrope, DM Sans, Space Grotesk, Sora, Hanken Grotesk, Fraunces, Playfair Display, Archivo, JetBrains Mono) + `build_google_fonts_link()` are the **shared source of truth** with the editor, so a chosen font renders identically in preview and the rebaked PNG. The bake injects the Google Fonts `<link>` into the slide `<head>` **only when a `fontFamily` tweak is present**, keeping the no-tweaks path byte-identical (RNDR-05).

### Changed
- **CONS-01 relaxed for non-brand fonts (accepted trade-off).** Curated fonts load via the Google Fonts CDN at bake time (headless Chromium already awaits `document.fonts.ready`); brand/bundled `@font-face` fonts still render offline.

### Added
- `render_template.py` `_build_tweaks_css()` now honors the editor's richer per-zone overrides so the rebaked PNG matches the live preview (RNDR-04 parity): **text/SVG color** (`color`, plus child `svg [stroke]/[fill]` recolor rules), **background color** (`bgColor`), **stroke** (`strokeColor` + `strokeW` → border), **corner radius** (`radius` → border-radius + overflow:hidden), and **layer order** (`z` → position:relative + z-index). `test_apply_tweaks.py` +5 tests (29 total).
- `render_template.py` `_tag_decor()` — auto-tags untagged decorative elements (background rect, inline SVGs, logo, frame) with the SAME synthetic `data-slot` handles the editor uses, so tweaks keyed to those handles (e.g. a recolored background) apply on rebake too.

### Added
- `parse_slots_from_instructions()` — full `## Slots` schema parser (name, bbox, style, sample, max_chars, inferred zone type) that powers template introspection for the interactive editor (AIOS-139). Extends the proven `parse_sample_text_from_instructions` patterns without changing it.
- `render_template.py --tweaks <tweaks.json> --tweaks-slide <slide-id>` — consumes a per-zone overrides layer (text + x/y/w/fontSize/opacity/tilt, image scale) keyed by `data-slot`, plus a `global` scope (accent/fonts/masthead) patched into the brand kit before token CSS. Purely additive: absent or empty tweaks render byte-identically to current output. No AI regeneration on rebake. Image overrides carry `layers:[]` for the deferred Qwen track (CONS-02).

### Changed (AIOS-138)
- Model-aware text rules: `extraction-schemas.md` no longer forces "no readable text" for FULL_AI text-baking archetypes; `model-selection.md` + `style-text-typography.md` updated to 2026 GPT-vs-Gemini reality (Gemini 3 Pro Image ~70-85%; no absolute "NEVER use Gemini"). GPT still preferred for dense (20+ label) text-baking.

## [2.0.0] — 2026-05-26

### Added
- Template rendering engine `scripts/render_template.py` — renders per-brand template pools (`--template-pool`/`--template-id` via `manifest.json`) or a `--template-dir`, in TEMPLATE / FULL_AI / HYBRID_AI modes. Brand tokens (`visual-identity/tokens.json` fonts/colors/type-scale) drive the output; supports `.prompt.md` AI image slots with caching and WCAG auto-contrast text correction.
- `scripts/fetch_icon.py` — deterministic icon resolver: brand override → curated `commons/` → Simple Icons → Lobehub → Devicon CDN chain, cached to `brand_context/visual-identity/icons/`.
- `scripts/brand_kit_loader.py` — loads the brand kit from `visual-identity/tokens.json` (with legacy + defaults fallbacks).
- `preview/server.py` + `preview/index.html` — local LinkedIn-feed carousel preview with inline caption/slide editing and single-slide re-render.
- New references: `ref-to-template.md` (turn a user reference into a custom template), `extraction-schemas.md`, the `style-editorial-magazine.md` cover preset, and an `editorial/` icon category.
- New SKILL rules: transparent backgrounds require `gpt-image-1`; the icon resolver needs an exact filename; scripts don't auto-load `.env`; edit-mode drops `--background transparent`; recommended extract-from-reference (magenta key + rembg) workflow.

### Changed
- Default image model is now `gpt-image-2` (was `gpt-image-1`). For a transparent background, pass `--model gpt-image-1` explicitly.
- `generate_image_gpt.py` / `generate_image_gemini.py` now auto-load `.env` — API keys resolve without a manual export.
- `references/prompt-patterns-gpt.md` updated for GPT Image 2 (Anti-Text Directive, letter-by-letter brand spelling, 4-turn Layer Method).

## [1.0.0] — 2026-05-09

- Initial release.
