# Intake Procedures

What to do when the user gives the skill reference materials. The intake is a **guided conversation** wrapped around five technical paths. The conversation flow asks for the brand name first, then walks through reference categories in sequence — it never offers "dump everything in a folder, I'll figure it out".

## Guided conversation flow (the wrapper around the 5 technical paths)

The `mkt-visual-identity` skill walks the user through this exact sequence on first invocation. The paths in the next section (A/B/C/D/E) are the underlying handlers — picked automatically based on what the user uploads at each step. The user never reads the path letters; they see the conversation.

```
Step 0 — Brand name (BLOCKING)
  Question:  "First things first: what's your brand name?"
  Wait:      explicit text answer
  Store:     tokens.json > brand (locked_field)
  No proceed without an answer.

Step 1 — Style references
  Prompt:    "Upload 3-5 visual style references you admire..."
  Examples:  carousels (PDFs), screenshots, URLs, brand books
  Skip:      user says "skip style refs" → log + proceed
  Dispatch:  whatever they upload → routes to Path A/B/C/D/E below

Step 2 — Logo
  Prompt:    "Do you have a logo?"
  Examples:  SVG (preferred), PNG, JPG
  Skip:      "no logo" → log + proceed (wordmark only)
  Dispatch:  Path C (image) for raster; svg_to_tokens.py for SVG

Step 3 — Headshot (personal-brand contexts only)
  Prompt:    "Will you appear in the posts? Upload a headshot..."
  Examples:  portrait photo
  Skip:      "no headshot" → log + proceed (no person slot reserved)
  Dispatch:  Path C (image)

Step 4 — Anything else
  Prompt:    "Anything left? Fonts (.ttf), brand book PDF, Figma palette..."
  Examples:  any of the 5 paths
  Done:      user says "go" → run extraction on what was gathered

Decision (after Step 4):
  any refs uploaded         → Mode E (Extract) on the bundle
  only a URL given          → Mode A (Auto-Scrape) — Path A
  brand spec doc uploaded   → Mode I (Import) — Path B (text PDF) or A (text URL)
  NOTHING across all steps  → Mode N (Neutral) — EXPLICIT confirmation required;
                               NEVER silent fallback to defaults.
```

**Rules for the guided flow:**
- The brand name question is the entry point. Do NOT route to mode selection or path detection before it is answered.
- Each category prompt is a single message. Wait for the user's response before sending the next one — don't dump all 4 prompts at once.
- "Skip" / "no logo" / "no headshot" are first-class answers — log them, never re-ask.
- If the user uploads MULTIPLE categories at once ("here's my logo and 3 carousel PDFs"), accept all, advance past those steps, only ask for what's still missing.
- After Step 4, if nothing was uploaded across all categories: bounce to Mode N (see SKILL.md "Mode N — Neutral"). Never silently seed defaults.
- The "drop everything in a folder, I'll figure it out" pattern is **removed**. It was the failure mode that produced a hardcoded placeholder `brand_name` because the brand name was never asked.

The technical paths below are the dispatch table — when an upload arrives at any step, the path detection runs on that upload alone.

## The 5 intake paths

```
Input type             →  Normalization               →  Common pipeline
───────────────────────────────────────────────────────────────────────
Website URL           →  Playwright screenshot       ┐
PDF (one or many)     →  pdf_to_pages.py             ├→  visual_refs/*.png
Images (PNG/JPG/SVG)  →  normalize_image.py          │   ↓
Folder (mixed)        →  intake.py (dispatches above)│   per-image analysis
Figma exports         →  Path E (PDF/SVG/CSS/DTCG)   ┘   ↓
                                                      visual-identity/tokens.json
                                                      visual-identity/identity.md
                                                      visual-identity/moves.md
                                                      templates/{output_format}/
```

## Path A — Website URL

User says: *"replicate the visual identity of acme.com"* or pastes a URL.

**Don't screenshot by default.** Many URLs are text-heavy (brand guidelines in prose, Notion docs, Medium articles describing design) where the visual we need is already declared in writing. Screenshotting those and then OCR'ing wastes work and accuracy. Decide what to fetch based on what's actually there.

### Decision tree

```
URL input
  ↓
WebFetch (the HTML — cheap, no browser needed)
  ↓
What did we get?
  ├─ Text declares tokens (hex codes, font names, type rules)
  │    → parse text directly. Skip screenshot. (see "Text-only URL" below)
  │
  ├─ Image URLs in the HTML (logo, hero asset, downloadable SVG)
  │    → curl/fetch those images directly. They land in visual_refs/.
  │      Skip screenshot for those assets.
  │
  ├─ Visual layout matters AND can't be reconstructed from fetched assets
  │    → screenshot just that section with Playwright (`python -m playwright screenshot`).
  │
  └─ Mix of the above
       → do all three in parallel.
```

### Text-only URL (brand guideline in prose)

If the HTML body contains the brand spec written out:
1. Parse text for hex codes (regex `#[0-9a-fA-F]{6}` is fine — color claims don't need vision)
2. Parse text for declared font names ("we use Inter Bold", "headlines in Geist Black")
3. Parse text for declared spacing/size rules ("titles are 48px bold", "8px grid")
4. Build a partial token sketch for visual-identity/tokens.json from these declarations
5. Note in `_analysis/extraction-log.md` which fields came from text vs from inferred defaults
6. → **skip the trace-overlay phase** entirely for text-declared values. They're already authoritative.

### Image-bearing URL (e.g., brand page with logo + sample posts)

1. `WebFetch` the HTML
2. Extract `<img>` srcs that look brand-relevant (logo, hero, examples)
3. Direct-download those via `curl -o brand_context/visual_refs/{slug}.png`
4. Prefer SVG > PNG > JPG when multiple available (vector preserves precision)
5. → continue at "Common pipeline" with the fetched assets

### Screenshot-needed URL (visual that resists fetching)

Only when the layout itself is the reference AND can't be reconstructed from assets:
1. A Playwright screenshot (`python -m playwright screenshot --full-page`)
2. Optional: mobile viewport (375-wide) for responsive brands
3. Save to: `brand_context/visual_refs/web-{domain}-{page}.png`
4. → continue at "Common pipeline"

### When to ask the user

- *"Is this URL describing the brand (text spec) or showing it (visual)?"*
- *"Should I fetch their downloadable logo/assets, or just analyze what's on screen?"*
- *"Is there a brand guideline page I should look at instead of the homepage?"*

**Tip:** If the brand has a published design system (e.g., `acme.com/brand`, Figma public file URL, Notion brand guide), that's usually the right URL — it'll have explicit declarations and downloadable assets, skipping screenshot entirely.

## Path B — PDF (one or multiple)

User drops one or more PDFs in a folder.

```
1. Detect PDF type:
   python -c "import fitz; print(any(p.get_text().strip() for p in fitz.open('ref.pdf')))"
   - True  → text-bearing (rare for design carousels): use page.get_text("dict") for direct font/position
   - False → image-only (canonical case): rasterize required
2. Rasterize all pages to canvas size:
   python scripts/pdf_to_pages.py ref.pdf brand_context/visual_refs/ --prefix sample
   → produces sample-p1.png ... sample-pN.png
3. For multiple PDFs, prefix each with the PDF name to avoid collision
4. → continue at "Common pipeline"
```

**Tip:** if PDFs are LinkedIn carousels, they're usually 4:5 (1080×1350). Twitter is 16:9. Always check aspect ratio and pass via `--width / --height`.

## Path C — Images (PNG/JPG/SVG/WEBP)

User provides image files directly.

```
1. Copy to brand_context/visual_refs/ preserving filenames
2. Resize/pad to canvas dimensions if needed (NEW: scripts/normalize_image.py, see Gaps below)
3. SVG inputs: rasterize via cairosvg or Inkscape CLI to PNG first
4. → continue at "Common pipeline"
```

**Tip:** SVGs from a brand guideline are GOLD — they preserve exact paths, colors, and dimensions. Use those for logos directly without re-rendering.

## Path E — Figma (no API, no token, no auth)

User exported designs from Figma. The Figma API is paid + token-gated, so this path leans on **what Figma can produce for free**: PDF exports, PNG/SVG exports, CSS snippets ("Copy as code → CSS"), and Tokens Studio / DTCG JSON exports.

### Why this path exists separately

Even though every Figma export ultimately reduces to one of the other paths (PDF/PNG/SVG/text), Figma-origin materials have stronger signals than ad-hoc dumps:

- A Figma frame export is **pixel-exact** — k-means colors on it produce the canonical brand palette, not a re-quantized approximation.
- An SVG export preserves the *literal* `fill="#xxx"` and `font-family="…"` declared in the file — there is no need to OCR or guess.
- A CSS snippet from "Copy as code" is **authoritative** for any property the user copied — no measurement needed.
- A Tokens Studio export ships the brand's *internal* token names (`colors.brand.primary` rather than "k-means cluster #3"), so the merged `tokens.json` can preserve those names.

### Detection heuristics (used by `intake.py` to auto-route Figma material)

The intake walker decides "this came from Figma" if ANY signal fires:

1. **User flag** — user said "this is from Figma", "Figma export", etc. Always wins.
2. **Filename pattern** — `*figma*.*`, `Frame N.*`, `Frame N — *.png`, `Group N.*` (Figma's default export naming).
3. **PDF metadata** — for PDFs, read via PyMuPDF: `fitz.open(path).metadata.get("producer")` containing `Figma`.
4. **SVG metadata** — for SVGs, the file's first 200 bytes contain `<!-- Generator: Figma -->` or `data-figma-`.

When a Figma signal fires, the intake walker dispatches to one of the four sub-paths below, then continues on the common pipeline with a `source: figma` tag on every per-reference spec.

### Sub-path E.1 — Multi-page PDF export

The 2-click case: `File → Export frames to PDF` produces one PDF with all the frames the user selected.

```
1. → reuses Path B (pdf_to_pages.py rasterizes each page)
2. extract_tokens.py picks up the per-page color/text/bbox specs
3. Tag every spec with `source_origin: "figma-pdf"`
```

No new code. 100% of existing pipeline works.

### Sub-path E.2 — PNG / SVG frame exports

User exported individual frames as PNGs or SVGs from Figma's right-panel export.

```
PNG → Path C (copy + normalize)
SVG → first run scripts/svg_to_tokens.py for an authoritative token sketch,
       then ALSO rasterize the SVG to a PNG and run extract_tokens.py for
       texture/contour analysis (the deterministic side).
```

`svg_to_tokens.py` (~80 LOC) walks `<rect fill>`, `<text font-family>`, and inline `style="..."` to surface declared colors + fonts. Output gets merged with the raster spec by Phase 4's `merge_extraction.py` (deferred).

### Sub-path E.3 — Pasted CSS snippets

User used Figma's "Copy as code → CSS" and pasted into a `.txt` / `.md` / `.css` file in the inbox. Looks like:

```css
background: #14130f;
font-family: 'Fraunces', serif;
font-size: 48px;
line-height: 1.05;
letter-spacing: -0.025em;
```

```
1. scripts/css_snippet_parser.py reads the file and returns a partial token sketch
   {colors: [...], fonts: [...], font_sizes: [...], font_weights: [...]}.
2. Sketch is merged into visual-identity/tokens.json with `source_origin: "figma-css"`.
3. Values here are AUTHORITATIVE — no trace overlay needed.
```

This is the single highest-precision intake we support after manual user input.

### Sub-path E.4 — Tokens Studio / W3C DTCG JSON

User installed the (free) Tokens Studio plugin in Figma, exported their design tokens, and dropped the JSON into the inbox. Looks like:

```json
{ "colors": { "primary": { "$value": "#0a0a0a", "$type": "color" } }, ... }
```

```
1. scripts/dtcg_loader.py walks the DTCG tree and returns {colors, fonts, sizes, weights, spacing}.
2. Output preserves the brand's INTERNAL token paths (e.g., colors.brand.primary)
   so the consolidated tokens.json can keep them.
3. Tag with `source_origin: "figma-dtcg"`.
```

### When to ask the user

If a single Figma signal fires but the input is ambiguous (e.g., a `.png` in a folder also named `references/figma-frames/`), confirm:

- *"This looks like a Figma export — should I treat it as a pixel-exact frame, or as inspiration?"*
- *"Do you also have the CSS / Tokens Studio export? Those give us authoritative values we can't get from the rendered frame."*

### Total new code for Path E

About 90 lines across 3 small parsers:
- `scripts/svg_to_tokens.py` (~80 LOC)
- `scripts/css_snippet_parser.py` (~70 LOC)
- `scripts/dtcg_loader.py` (~70 LOC)

No API key, no Figma plugin, no auth required. Reuses 100% of the PDF/PNG pipeline.

---

## Path D — Folder (mixed content)

User points to a folder containing a mix of PDFs, images, maybe a text file with notes.

```
1. Walk the folder, dispatch by extension:
   .pdf       → Path B (rasterize)
   .png/.jpg  → Path C (copy)
   .svg       → Path C with rasterization
   .url/.html → Path A (open + screenshot)
   .md/.txt   → read as side-notes (user brand brief)
2. Aggregate all in brand_context/visual_refs/
3. → continue at "Common pipeline"
```

## Common pipeline (runs on all visual_refs/*.png)

### Step 1: Per-image deterministic extraction (brand assets only)
Run `extract_tokens.py` only on files classified as BRAND in SKILL.md Step 0.4 (logos, headshots, posts-archive). Template refs skip this step and go straight to Step 2, because their palette belongs to another brand.

### Step 2 — Per-image Claude vision classification
Claude reads each image directly and emits `{ref}.briefing.json` with:
- `visual_kind` (cover_hook | screenshot_real | code_mock | comparison | metaphor_illustration | concept_diagram | cta_typographic)
- `mode` (PURE_CSS | HYBRID_AI | FULL_AI)
- `recommended_template`
- `visual_evidence` (what Claude actually saw — required for audit trail)

The visual checklist lives in SKILL.md, Phase 2 Pass 2b.

### Step 3 — Font confirmation (user-driven, NEVER from template refs)

Fonts belong to the user's brand, not to the template references they uploaded. Even when vision can identify the font on a ref (e.g., "this is Fraunces"), copying it onto the user's brand makes the user's brand look like the ref's brand. Wrong.

**Source priority:**

1. **Brand-book / Figma export declares `font-family`** → use that (already parsed in Step 1 if the user uploaded a brand book).
2. **Posts-archive available (user's own previous posts marked BRAND in Step 0.4)** → show the user one of their own posts cropped to headline area and ASK them to name the font (don't guess; even visual ID can be wrong by family).
3. **No brand evidence** → `AskUserQuestion` popup with 4 curated free-font pairings (see SKILL.md Phase 3 — the canonical popup copy lives there).

After the user picks, download font files via `scripts/fetch_font.py` (Google Fonts CSS2 resolver, stdlib-only, no API key) to `{brand_context}/visual-identity/fonts/`, and persist `tokens.json > fonts.{display,body}` + add to `locked_fields`. The script emits one `.woff2` per (weight, style) — `latin` subset by default, which covers EN/PT-BR/ES accents. Example: `uv run scripts/fetch_font.py --family "Fraunces" --weights 400,900 --italic --output-dir <fonts dir>`.

**Never** crop headlines from template refs to identify their font. Templates contribute COMPOSITION (where text sits, what hierarchy, what chrome) — never typography family.

### Step 5: Token consolidation
Merge per-image specs into visual-identity/tokens.json, identity.md and moves.md (see SKILL.md Output contract), preserving locked_fields.

## Decision tree — quick reference

```
USER GIVES                    →  CALL FIRST
URL                          →  WebFetch (then decide: parse text, fetch assets, screenshot, or mix)
PDF                          →  scripts/pdf_to_pages.py
Image                        →  copy + scripts/normalize_image.py (TODO)
Folder                       →  scripts/intake.py (TODO) — dispatches per extension
"Use my Figma file"          →  Path E — accept PDF/PNG/SVG export OR pasted CSS OR Tokens Studio JSON (no Figma API needed)
"Just like Apple's site"     →  Path A — try /design or /brand first
"This brand book"            →  Path D (folder)
```

**For URLs specifically — what to call:**

```
URL content type              →  Action
text spec / brand guide      →  WebFetch + parse text. NO screenshot.
declared hex/font/rules      →  regex extract → typography-tokens.json
fetchable logo (img/svg)     →  curl + save to visual_refs/. NO screenshot.
visual layout                →  Playwright screenshot
unclear                      →  WebFetch first, then decide
```

## Scripts

Existing: `pdf_to_pages.py`, `extract_tokens.py`, `svg_to_tokens.py`, `css_snippet_parser.py`, `dtcg_loader.py`, `fetch_font.py`, `intake_logo.py`, `generate_brand_bible_pdf.py`, `validate_brand.py`.
Not built: an image normalizer, a folder dispatcher, and a token merger. Handle those steps by hand: resize with Pillow, route files by extension, and merge into tokens.json while honoring `locked_fields`.
Font identification from template refs is intentionally absent: fonts come from the user's own brand (SKILL.md Phase 3).

The conversational order and all user-facing questions live in SKILL.md (Before You Start, Phase 2.5, Phase 3). This file covers only the per-upload technical paths.
