---
name: mkt-visual-identity
version: 2.0.1
description: "Build and refine a brand's visual identity from any reference (PDFs, URLs, screenshots, posts, brand docs) incrementally: each new reference UPDATES the identity (merge tokens, append moves, regen outputs), conflicts surfaced for the user. Produces two synced outputs, machine-readable artifacts in `{brand_context}/visual-identity/` (tokens.json, identity.md, moves.md, fonts/, logos/, compositions/) for downstream visual skills, plus a `brand-book.pdf` brand bible. Modes: Extract, Import, Build, Auto-Scrape. Foundation skill, run before any skill that renders visuals (ssc-designer, ssc-image-generator, viz-image-gen, viz-excalidraw-diagram). Triggers on 'visual identity', 'brand identity', 'design tokens', 'extract visual', 'brand design', 'replicate this style', 'match this design', 'create brand bible'. Does NOT trigger for written voice (mkt-brand-voice), positioning, audience research, or text-only content."
---

# mkt-visual-identity

Build a brand's visual identity contract (typography tokens, color palette, layout rules, design moves) from reference materials. Exact values (hex, dimensions) come from scripts; composition understanding comes from reading the references directly.

## When NOT to use

- User wants written voice extraction → `mkt-brand-voice`
- User wants positioning/angle → `mkt-positioning`
- User wants ICP/audience → `mkt-icp`
- User wants to generate ONE image with AI (no template needed) → `viz-image-gen`

## Output contract

This skill produces two co-located outputs that always stay in sync:

**(A) Machine-readable artifacts** under `{brand_context}/visual-identity/`:

1. **`tokens.json`** — JSON tokens (fonts, weights, type scale, colors, spacing, canvas). Consumed by `render_template.py` (via `--brand-kit`), `ssc-designer`, `ssc-image-generator`, and any other visual skill.
2. **`identity.md`** — human-readable narrative of the brand's visual identity (one-paragraph summary + per-section moves). Updated incrementally as new references arrive.
3. **`moves.md`** — per-brand catalog of design moves (paper-texture, oversized-numeral, accent-bar, etc.) that implement the 10 universal principles in `references/design-principles.md`. Each move section carries inline structured metadata in a `<!--meta ... -->` HTML comment block (fields: `name` kebab-case slug, `image_bearing` bool, `required_zone_types` list when image_bearing:true, optional `keywords`). Consumed by the brand-book PDF generator AND by `validate_brand.py` (gates G2 + G4). No separate moves.yaml — the meta block IS the contract.
4. **`compositions.manifest.json`** — machine-readable index of brand-specific composition primitives.
5. **`fonts/`**, **`logos/`**, **`compositions/`** — actual font files, logo variants, and reusable composition snippets.
6. **`_analysis/`** — per-reference extraction logs (audit trail).

Plus **(B)** a structured `brand-book.pdf` brand bible at the same location, produced by `scripts/generate_brand_bible_pdf.py` after the machine-readable artifacts settle (see Phase 6 below). **The PDF must regenerate on ANY change to a visual-identity artifact** — not just `tokens.json`. The trigger fires for any of:

- `tokens.json` (colors, fonts, type scale, spacing, chrome)
- `identity.md` (narrative)
- `moves.md` (design moves catalog)
- `composition-primitives.json` (extracted composition primitives)
- `logos/`, `fonts/`, `headshots/` (any new asset added)
- `visual_refs/` (when a new reference is added that's reflected in the bible)

After EVERY phase that mutates any of these (Phase 2/3 token consolidation, Phase 4.7 brand-book v1, Phase 6 regen, asset uploads), the orchestrator MUST call `scripts/generate_brand_bible_pdf.py` as the final step, so the shareable view never drifts from the machine-readable sources. If the script fails (font missing, etc.) the orchestrator surfaces the error but keeps the artifacts — the PDF is the DERIVED view; sources of truth stay machine-readable. Also re-runnable on demand ("regenerate the brand bible PDF").


### Scope and constraints (v1)

- **Faithful capture.** When extracting compositions from references, record every visible element as it appears, each with its subtype: photo → `image` (`ai-photo`/`real-photo`), icon → `vector svg-icon`, illustration or sketch annotation → `vector ai-illustration`, photographic backdrop → `background ai-photo`/`real-photo`, code → `text code`. Cost, rendering difficulty, or a cleaner look are not reasons to drop an element; the brand's identity is the sum of its elements, and simplifying is the user's call, not the skill's. If unsure whether something is load-bearing, capture it and ask. Applies in Phase 1, Phase 2 and Phase 2.5.
- **Single brand per project.** One `brand_context/` per project root. No multi-tenant model yet.
- **No versioning yet.** Updates overwrite in place; the skill warns the user before mutating an existing identity.
- **Manual user input always wins over extraction.** If the user types `primary is #FF0000` after the extractor read `#FF1010` from a screenshot, the user's value is stored as a locked field in `tokens.json` and never overwritten on subsequent extractions.
- **Default identity fallback (explicit only, never silent).** When the user genuinely has nothing to start from AND they confirm via the "nothing to upload" option in the guided intake, `defaults/neutral-identity/` is copied into `{brand_context}/visual-identity/` and flagged as `default — please refine when ready`. The skill MUST NOT fall through to defaults silently when the user skips a step or dismisses a popup — it announces the fallback explicitly ("I'll seed neutral-identity for you; nothing's locked, every value can be refined later") and asks for confirmation.
- **Guided intake (NOT agnostic dump).** The skill walks the user step-by-step through a conversation: required brand name first → style references → logo → headshot → "anything else". The 5 technical paths (A=URL, B=PDF, C=images, D=folder, E=Figma) still exist as the underlying handlers, but they are wrapped by the conversation flow defined in `references/intake-procedures.md` "Guided conversation". Asking the brand name first matters because every template signs with it.

## Before You Start

**Check if `{brand_context}/visual-identity/tokens.json` exists at the project root.** If it does → **Update mode**: show a one-paragraph summary of the existing identity and ask via `AskUserQuestion` what to refine. Don't rebuild from scratch.

**Invocation context:** when this skill is invoked by a parent orchestrator (e.g. `00-social-content` Phase 1 brand-context guard), do NOT print a "welcome" or "to start, run /mkt-visual-identity" message. Jump straight to the guided intake — the parent already confirmed the user wants to configure visual identity.

### Step 0 — Brand name (REQUIRED first question, blocking)

Before any mode selection, before any folder suggestion, before any reference upload — ask for the brand name. Plain text question (NOT `AskUserQuestion`, because there are no enumerable options to pick from):

```
First things first: what's your brand name? It can be your personal name,
your company name, the handle you use on social — whatever you want to appear
on the posts (signature, byline, cover). Without it I can't generate any template.
```

**Rules for this step:**
- Wait for an explicit answer. Do NOT proceed with a placeholder, the user's OS username, or any other default.
- If the user says "leave it blank / no name / skip", confirm explicitly ("you prefer posts WITHOUT a byline? I can generate them, but the cover ends up unsigned — confirm?") — never assume.
- Store the answer immediately into `{brand_context}/visual-identity/tokens.json > brand` as a `locked_field`. Once stored, the extractor never overwrites it.
- If brand name contains characters that break HTML rendering (`<`, `>`, `&`), escape on render time, not at storage.
- This step cannot be skipped: every template needs a real brand name for the byline and cover.

After the brand name is stored, continue to masthead capture.

### Step 0.3 — Brand masthead labels (REQUIRED for editorial chrome)

Editorial-style carousel refs commonly carry a 3-slot masthead row at the top edge — e.g., `MAY ©2026  /  <brand-handle>  /  creative strategist`. The renderer's chrome auto-inject (`build_chrome_elements` in `primitive_to_template.py`) reads these from `tokens.json > chrome.masthead.labels[]` and prepends them as `kicker` text elements at `top-edge-{left,center,right}`. Without this step, every generated template lacks the editorial-magazine signature.

Use `AskUserQuestion` to capture the 3 labels:

```
AskUserQuestion({
  questions: [{
    question: "Editorial refs usually carry a masthead — 3 micro-labels at the top, like `MAY ©2026 / @brand / role`. Which labels do you want in your masthead? (You can use dynamic variables: {{date}}, {{month_year}}.)",
    header: "Masthead",
    multiSelect: false,
    options: [
      { label: "{{month_year}} / @{handle} / {role}",
        description: "Recommended — auto date + handle + short role/tagline." },
      { label: "@{handle} / {role}",
        description: "2 slots — no date, cleaner. The middle slot stays empty." },
      { label: "No masthead",
        description: "I don't want a masthead. Templates ship without the editorial top row. Can be enabled later." }
    ]
  }]
})
```

For the chosen pattern, ask 1-2 follow-up plain-text questions (NOT `AskUserQuestion` — these are free-form):
- "What's the @handle?" (e.g., `@<brand-handle>`)
- "Short role/tagline?" (e.g., `founder, ai ai` or `creative strategist`)

Persist into `tokens.json > chrome.masthead.labels[]` as a 3-element array. Variables like `{{month_year}}` are resolved at slide-render time. If the user picks "No masthead", store `chrome.masthead: { labels: [], enabled: false }`.

After labels stored, ask one more question about pagination:

```
AskUserQuestion({
  questions: [{
    question: "Carousel dots in the footer to indicate progress between slides?",
    header: "Pagination",
    multiSelect: false,
    options: [
      { label: "Yes — subtle dots",
        description: "Adds a row of dots at the `bottom-edge`. Color follows tokens.text_on_dark/light." },
      { label: "No — no dots",
        description: "Bottom edge stays free. Some brands use a tagline-row instead of dots." }
    ]
  }]
})
```

Persist as `chrome.pagination: { subtype: "css-shape", count: 7, active: 1 }` if yes (count gets reset per-carousel at slide-gen time), or `chrome.pagination: null` if no.

After the brand name + masthead + pagination are stored, continue to asset classification.

### Step 0.4 — Per-file asset classification (BLOCKING when files are provided)

When the user provides files (drag-drop, path list, folder), the orchestrator MUST classify each file before routing, because a logo treated as a template ref (and vice-versa) is a silent failure mode. Two categories with very different downstream paths:

- **Brand asset** — owned by the user's brand. Logo, headshot, existing posts they made. Goes to `brand_context/visual-identity/{logos|headshots|posts-archive}/`. NOT a composition reference; the renderer treats these as content to be EMBEDDED.
- **Template reference** — inspiration the user wants to copy. Other brands, magazine spreads, screenshots from accounts they admire. Goes to `brand_context/visual_refs/`. The composition is extracted by the Pass 2b vision classification (Phase 2).

These two routes are non-fungible. A logo treated as a template ref produces "extract composition primitives from this 1cm × 1cm svg" garbage. A template ref treated as a brand asset gets baked into output as if it were the user's own image.

**Use `AskUserQuestion` with multiSelect to classify EVERY file the user provided.** One option per file:

```python
AskUserQuestion({
  questions: [{
    question: "Before extracting, I need you to mark what's what. For each file below, what's its role?",
    header: "Classify files",
    multiSelect: true,
    options: [
      # Each file the user provided becomes ONE option labelled with the filename + sniffed category.
      # The user toggles BRAND vs REFERENCE per file via multiSelect — by default all are unchecked
      # (so the orchestrator never auto-routes); user must check ONLY the brand-asset ones.
      # Naming convention: "[BRAND] filename.ext" means brand asset; unchecked = template reference (default).
      { label: "logo-your-brand.jpg → MY brand (logo)",
        description: "This is my brand's OFFICIAL logo. Goes to visual-identity/logos/." },
      { label: "headshot.jpg → MY brand (founder photo)",
        description: "Original photo. Goes to visual-identity/headshots/." },
      { label: "ref-style-01.png → MY brand (existing post)",
        description: "A post from my brand that already shipped. I can copy my own visual voice." },
      # ... more options, one per file
    ]
  }]
})
```

**Heuristics to seed sensible defaults** (orchestrator pre-checks options before showing the popup, user adjusts):

| File pattern | Default category |
|---|---|
| filename contains `logo`, transparent PNG/SVG, < 200KB, square or wide | BRAND (logo) |
| filename contains `headshot|portrait|founder|me`, photo aspect, faces detected | BRAND (headshot) |
| 1080×1350 or 1080×1080 or similar carousel-canvas dimensions | TEMPLATE-REF (default) |
| comes from `~/Pictures/Screenshots/` | TEMPLATE-REF |
| comes from a user-named `my-posts/` or `archive/` folder | BRAND (own posts) |
| anything ambiguous | TEMPLATE-REF (safer default — user can toggle to BRAND in popup) |

**Routing after the popup:**

| Selected category | Destination |
|---|---|
| BRAND (logo) | `brand_context/visual-identity/logos/<slug>.png` + run `intake_logo.py` for bg cleanup |
| BRAND (headshot) | `brand_context/visual-identity/headshots/<slug>.jpg` |
| BRAND (own post / archive) | `brand_context/visual-identity/posts-archive/<slug>.png` (NOT extracted; informs voice/style only) |
| TEMPLATE-REF (default for everything unchecked) | `brand_context/visual_refs/<slug>.png` → Phase 2 Pass 2b extraction |

**Rules:**
- The popup is blocking. Don't proceed to Step 0.5 until the user has confirmed the classification.
- If the user doesn't toggle any, ALL files default to TEMPLATE-REF — safer than guessing brand ownership.
- After routing, surface a one-line summary: `Routed: 1 logo / 1 headshot / 4 template refs → Pass 2b will classify the 4 refs.`

After classification settles, continue to multi-brand disambiguation.

### Step 0.5 — Multi-brand disambiguation (BLOCKING when 2+ asset sets detected)

Before proceeding to mode selection, scan the user's provided material (folder contents, URLs, PDFs, attached images) for **distinct brand identities**. Signals that suggest more than one brand:

- Multiple logo files with different visual identity (not just light/dark variants of the same mark — actually different brands)
- Multiple sets of style references that don't share a visual language (different color palettes, different typographic systems, different chrome)
- Filenames/folders that name different brands (e.g., `logo-acme.svg` + `logo-zenith.svg`)
- Different `brand:` declarations across multiple uploaded tokens.json files
- The user explicitly says "here are refs from X and from Y"

**If 2+ distinct sets detected → open `AskUserQuestion` popup, never a text "type 1/2/3" fallback, because it gives the user real options to click:**

```
AskUserQuestion({
  questions: [{
    question: "I detected {N} distinct brands/visual sets in the material you sent: {brand-set-A}, {brand-set-B}{, brand-set-C, ...}. Which is the PRIMARY BRAND — the one that gets the brand_context and the production templates?",
    header: "Primary brand",
    multiSelect: false,
    options: [
      { label: "{brand-set-A}", description: "This becomes the production brand. The others become references or siblings." },
      { label: "{brand-set-B}", description: "This becomes the production brand. The others become references or siblings." }
      // ...one option per detected set
    ]
  }]
})
```

After the user picks the primary, for EACH non-primary set, open a follow-up popup:

```
AskUserQuestion({
  questions: [{
    question: "And {brand-set-X} — what is it?",
    header: "{brand-set-X}",
    multiSelect: false,
    options: [
      { label: "Reference / inspiration only",
        description: "I use it visually as a mood/style reference to extract composition patterns, but I do NOT create a separate brand_context for this brand. The files go to visual_refs/inspiration/." },
      { label: "Sibling production brand",
        description: "I create a SEPARATE brand_context for this brand (at another path). Templates, tokens, voice — all parallel. It generates posts too." },
      { label: "Ignore — don't use",
        description: "Discard. It enters neither as inspiration nor as a sibling." }
    ]
  }]
})
```

**Resulting routing:**

| User answer | Action |
|---|---|
| primary = X, non-primary = "reference" | X's files go to `visual_refs/`. The others' files go to `visual_refs/inspiration/{brand-slug}/` and are consumed as a style reference by the extractions, without becoming a brand identity |
| primary = X, non-primary = "sibling" | Creates `{decoupled_base}/../{sibling-slug}/brand_context/` as a parallel project. Warn the user of the path and proceed with primary only in this run |
| primary = X, non-primary = "ignore" | Move the files to `_analysis/_discarded/{brand-slug}/` (kept for audit, not consumed) |

**Rules:**
- This step is BLOCKING when 2+ brand sets are detected. Don't continue without disambiguation.
- If only 1 brand detected (or material is too sparse to tell), SKIP this step entirely.
- Log the disambiguation decision in `_analysis/extraction-log.md` with timestamp + brand classifications.
- If the user dismisses both popups: default to "everything is reference for primary". Never silent-create siblings without confirmation.

### Step 1 — Mode selection

If tokens.json doesn't exist, ask for the mode with `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "How do you want to configure your visual identity?",
    header: "Mode",
    multiSelect: false,
    options: [
      { label: "Extract — I have visual refs",
        description: "Analysis of PDFs, screenshots, existing posts. Extracts palette, typography, layouts." },
      { label: "Import — I have a design system",
        description: "Imports already-declared tokens (brand book PDF, Figma export, Notion brand guide)." },
      { label: "Build — interview",
        description: "No refs yet. I ask about palette, typography mood, spacing rhythm, density." },
      { label: "Auto-Scrape — my URL",
        description: "Pass the URL and the skill investigates the site (Playwright + visual analysis)." }
    ]
  }]
})
```

If the user provides a URL or attaches/points to reference files in their first message, skip mode selection and route directly to the matching mode (Auto-Scrape or Extract). Otherwise, the popup is the entry point — no plain-text alternative.

## Modes

### Mode E — Extract (default when reference materials provided)

User provides PDFs, screenshots, or a web URL. Run the canonical flow below: Phase 1 (intake and PDF rasterization via `pdf_to_pages.py`), Phase 2 (pixel extraction on brand assets, vision classification on template refs), Phase 2.5 (capture summary), Phase 3 (fonts from the user), Phase 4.7 (brand bible v1 and approval), Phase 6, Phase 7. User-locked fields are preserved verbatim.

### Mode I — Import

User has existing brand guidelines (PDF/Figma/Notion). User pastes/uploads the document. Skill parses tokens directly from declared specs without measurement. Faster but trusts user input.

### Mode B — Build (interview)

No reference materials. Skill asks user about preferred palette, typography mood (geometric/humanist/serif), spacing rhythm, layout density. Generates a starter system.

### Mode A — Auto-Scrape (URL input)

User provides URL. Skill **does NOT screenshot by default**. The right action depends on what's at that URL:

1. **First step always: `WebFetch` the HTML** (cheap, no browser).
2. **Then decide based on what came back:**
   - URL is a text brand spec (Notion brand guide, blog post, design system in prose) → parse text for hex codes, declared fonts, size rules. Skip screenshot. Values from declarations are authoritative — no trace overlay needed for those fields.
   - URL has image references (`<img>` srcs to logo/hero/samples) → fetch those directly via curl. Prefer SVG > PNG > JPG.
   - URL has visual layout that can't be reconstructed from fetched assets → screenshot just that section with Playwright (`python -m playwright screenshot`).
   - Mix → do all of the above in parallel.

See `references/intake-procedures.md` "Path A" for the full decision tree.

**Anti-pattern:** screenshotting a URL whose tokens are already declared in writing on that page. Wastes a browser run and degrades precision (OCR vs literal hex string).

### Mode N — Neutral (explicit "nothing to upload" path)

Triggered when the user, after the guided intake walks them through every reference category, has uploaded NOTHING (no logo, no style refs, no headshot, no URL). The skill MUST announce this path before taking it, never silent, because silent defaults produced posts signed with a placeholder brand name nobody chose.

1. **Announce explicitly:**

   ```
   You didn't upload any reference. I'll seed `defaults/neutral-identity/` for your brand
   ({brand_name}) — neutral palette (off-white + near-black + a neon accent), Inter typography,
   default layouts. Nothing gets locked: every value can be refined whenever you want, just
   call me again with refs.
   ```

2. **Confirm via `AskUserQuestion`:**

   ```
   AskUserQuestion({
     questions: [{
       question: "Want to seed neutral-identity now? (You can change everything later.)",
       header: "Neutral identity",
       multiSelect: false,
       options: [
         { label: "Yes, seed neutral-identity",
           description: "Copies defaults/neutral-identity to brand_context/visual-identity/ with your brand name. You can refine it later." },
         { label: "Wait — I'll upload refs now",
           description: "Cancels the seed. Goes back to Step 1 (mode selection) — try Extract with the refs you upload." }
       ]
     }]
   })
   ```

3. On confirm → copy `defaults/neutral-identity/` to `{brand_context}/visual-identity/`, inject the brand name into `tokens.json > brand`, write `_analysis/extraction-log.md` noting "Mode N seeded — no references provided", run Phase 6 (brand bible PDF) so the user has something to look at.

4. **Critical:** never reach Mode N by accident. If the user dismissed a popup or said "go" without uploading, treat that as "they want to upload, but later" — bounce back to a clarifying question, not silent defaults.


## Step-by-step: Extract mode (the canonical flow)

### Phase 1 — Intake
- Read user input. If folder path → list contents. If single file → use directly.
- For each `.pdf`: rasterize all pages to PNGs in `{brand_context}/visual_refs/`.
- For each image: copy to `{brand_context}/visual_refs/` if not already there.
- Output: list of reference image paths.

### Phase 2 — Per-reference analysis

**TWO COMPLEMENTARY PASSES — but each runs on a DIFFERENT input set based on the Step 0.4 classification:**

| File category (set in Step 0.4) | Pass 2a (pixel extraction) | Pass 2b (vision composition) |
|---|---|---|
| BRAND assets (logo, headshot, posts-archive) | ✅ **RUNS** — these are the legitimate source for the brand's palette + canvas dimensions | ❌ skipped — not composition refs |
| TEMPLATE refs (other brands' work the user wants to copy) | ❌ **DO NOT RUN** — their palette is THEIR brand, not the user's | ✅ **RUNS** — composition primitives (where text sits, photo treatment, masthead) |

**Why this routing is non-fungible:** running k-means on a template-ref pulls in colors that belong to the OTHER brand (e.g., `<brand-handle>`'s orange becomes the user's "extracted accent" — wrong source of truth). Template refs contribute COMPOSITION ONLY (layout / hierarchy / chrome / typography ROLE). Typography exact families and palette exact hex come from the user's own brand assets OR explicit user input (Phase 3).

#### Pass 2a — Deterministic pixel extraction (`scripts/extract_tokens.py`) — **BRAND assets only**

For each file in `visual-identity/logos/`, `visual-identity/headshots/`, `visual-identity/posts-archive/`:

- **Colors**: k-means (k=6) on pixel histogram → top dominant colors with %. Save to `spec.json`.
- **Dimensions**: image size, aspect ratio.
- **Region brightness**: dark/light/mid percentages.
- **Texture detection**: sample noise variance to flag "textured" vs "flat" backgrounds.

The logo's dominant non-bg color usually wins as `colors.accent`. The headshot's bg color often informs `colors.bg_dark` or `colors.bg_light`. Posts-archive (if provided) confirms the existing brand palette. **Template refs are SKIPPED in Pass 2a** — they are processed in Pass 2b (composition only).

This handles things vision is imprecise about: exact hex codes, exact bbox pixels, color quantization.

**`colors.accent_secondary`: match the brand's real palette.** Set it when a second accent is designer-chosen and recurs with intent across refs (pill fill, kicker color, highlight on several slides); omit it otherwise. 3- and 4-color brands are equally valid and every consumer handles both. A k-means cluster is not a brand color if it is trace weight (under ~8% of its source's pixels), a photographic tone (skin, hair, sky, wood, desaturated rose or beige), or a near-neutral grey or taupe.

#### Pass 2b — Claude vision classification (PRIMARY, the orchestrator does this)

Claude (the LLM running this skill) **reads each rendered reference image directly** and classifies it. Vision is far more accurate than regex/text analysis for understanding visual composition. Regex on body copy cannot recover designer intent like "this slide uses a filing cabinet metaphor" — but vision can.

For each reference image, Claude examines and emits a JSON briefing like this (illustrative):

```json
{
  "page": "ref-pdf1-p4.png",
  "title": "3. Point, Don't Dump",
  "body": "Stop pasting your entire brand guide...",
  "visual_kind": "metaphor_illustration",
  "visual_evidence": "custom hand-drawn illustration of claude.md note card connected via red arrows to filing cabinet with 'Brand Voice' and 'Docs' labels. This is metaphor — claude.md is not literally a filing cabinet.",
  "has_screenshot": false,
  "has_code_block": false,
  "has_comparison": false,
  "has_sketch_overlay": false,
  "is_cover": false,
  "is_cta": false,
  "concrete_metaphor_objects": ["filing cabinet", "note card", "drawer"],
  "recommended_template": "body-illustration",
  "recommended_mode": "HYBRID_AI",
  "bg_treatment": "solid-color",
  "has_image_zone": true,
  "mode_reason": "solid-color bg but illustration image-zone → HYBRID_AI",
  "layers": [
    {"type": "background", "render": "css-solid", "hex": "#f4efe6"},
    {"type": "image-zone", "subject": "filing cabinet with note card"},
    {"type": "html-overlay", "items": ["Brand Voice", "Docs"]}
  ]
}
```

#### Output
Merge 2a + 2b → `{brand_context}/_analysis/{ref_name}.briefing.json`.

### Phase 2.5 — Capture summary (mandatory before advancing)

After completing the analysis of each reference, **present a structured summary** of what was captured and declare the execution plan. Do NOT advance to the font phase or trace overlay without this step.

**Summary format (free text + AskUserQuestion):**

First, write a chat message with the following template:

```
**Here's what I captured from your references:**

🎨 **Palette** — [N colors identified]
  • Primary: #XXXXXX (tone: dark/light/vibrant)
  • Accent: #XXXXXX
  • Background: #XXXXXX
  • [remaining colors with %, e.g.: "occupies 34% of the pixels"]

🔤 **Typography**
  • Display: [name or "not identified — best match: Geist Black"] — weight [W]
  • Body: [name or match] — weight [W]
  • Typographic style: [e.g.: "condensed and heavy", "clean geometric", "editorial serif"]

✏️ **Visual style**
  • Content density: [light / medium / dense]
  • Visual tone: [e.g.: "monochrome minimalist", "bold editorial with a warm accent", "technical with a dark background"]
  • Background texture: [flat / grainy / papery]
  • Decorative elements: [e.g.: "lateral accent bar", "slide-number pill", "none"]

📐 **Layouts identified (per slide/reference)**
  | Ref | Role | Visual kind | Render mode |
  |-----|------|-------------|----------------|
  | p1  | cover | cover_hook  | PURE_CSS       |
  | p2  | body  | code_mock   | PURE_CSS       |
  | p3  | body  | metaphor_illustration | HYBRID_AI |
  | p4  | cta   | cta_typographic | PURE_CSS   |

**What I'll do with this:**
1. Confirm the font (font identification phase)
2. Build [N] templates via trace overlay — one per unique role above
3. Consolidate everything into `brand_context/visual-identity/tokens.json` + `identity.md` + `moves.md`
```

Then ask via `AskUserQuestion`:

```
AskUserQuestion({
  questions: [{
    question: "Anything look wrong or want to fix before I build the templates?",
    header: "Review capture",
    multiSelect: false,
    options: [
      { label: "All good — proceed",
        description: "Continues to font identification and template construction." },
      { label: "I want to fix colors",
        description: "Give me the correct hex codes and I lock those fields." },
      { label: "I want to fix typography",
        description: "Tell me the font name and I use that locked value." },
      { label: "I want to fix layouts",
        description: "Point out which slide has the wrong role/mode." }
    ]
  }]
})
```

**Rules for this step:**
- If the user picks "All good", advance immediately to Phase 3.
- If they correct any field, write the value as a `locked_field` in `tokens.json` before continuing.
- If no reference produced font data (image with no legible text), omit the typography section and flag: "I didn't detect text in the refs — I need you to confirm the font before advancing."
- Never skip this step even if the references are few or simple — the user needs to validate the capture before the costly trace-overlay iteration.

### Phase 3 — Font confirmation *(user input — NEVER from template refs)*

Fonts belong to the user's BRAND, not to the template references. Even if vision can guess the font family used by `<brand-handle>`, that's <brand-handle>'s font, not the user's. Phase 3 asks the user, with sensible defaults derived from the visual MOOD of the refs (sharp vs literary vs editorial vs technical).

**Source priority (in order):**

1. **Brand-book / Figma export already declared the font** → if `visual-identity/_brand-book/*.{json,css,figma.json}` parses cleanly with declared `font-family`, use that. Lock `fonts` as `locked_field`. SKIP popup.
2. **Posts-archive shows a consistent font** → if user uploaded their own existing posts (BRAND category in Step 0.4), prefer asking them to NAME it explicitly rather than guessing. Show one of their posts cropped to the headline area as visual aid in the popup.
3. **No brand evidence** → AskUserQuestion popup with 4 curated free-font pairings, mood-tagged from the style of the template refs.

**The popup (case #3, most common):**

```python
AskUserQuestion({
  questions: [{
    question: "Which font pair do you want for your brand? Editorial templates usually use a display sans + a body sans. (I can download Google Fonts automatically — no manual install.)",
    header: "Brand fonts",
    multiSelect: false,
    options: [
      { label: "Inter Tight 900 + Inter — sharp, digital, neutral",
        description: "Condensed heavy display, legible body. Inspired by refs like Bloomberg, <brand-handle>, Stripe." },
      { label: "Fraunces italic + Inter — literary editorial",
        description: "Serif display with axes (ital, opsz, wght). Inspired by refs like The Atlantic, magazine cover hero." },
      { label: "Geist Black + Geist — clean technical",
        description: "Modern minimalist pairing. Use when the refs are clean and constructivist." },
      { label: "Custom — I'll send the .ttf/.woff2 file",
        description: "You upload the font files and I use them. I need the display + body separately." }
    ]
  }]
})
```

**After the user picks:**

- For Google Fonts pairings, download to `{brand_context}/visual-identity/fonts/` via `fetch_font.py` (stdlib-only Google Fonts CSS2 resolver, no API key). Emits one `.woff2` per weight/style (`latin` subset; covers PT-BR/ES accents). Example: `uv run .claude/skills/mkt-visual-identity/scripts/fetch_font.py --family "Inter Tight" --weights 900 --family "Inter" --weights 400,500,700 --output-dir brand_context/visual-identity/fonts`.
- For Custom, prompt the user to upload the .ttf/.woff2 files. Store in same fonts/ folder.
- Persist as `tokens.json > fonts.{display,body}` AND mark in `tokens.json > locked_fields: ["fonts.display", "fonts.body"]` — the extractor never overwrites user-confirmed fonts on re-run.

**Mood-derived defaults:** the orchestrator may pre-select the option that best matches the template refs' visual mood, but the user always confirms. Never silent-pick.

Never derive fonts from template refs: their font is the other brand's font.

### Phase 4.7 — Brand bible v1 + identity approval gate

Before deriving any templates from the brand identity, generate a v1 brand bible PDF and get the user's explicit approval of the identity. This catches errors in tokens/fonts/colors/moves BEFORE they propagate to 5+ templates.

```bash
uv run --with playwright --with pillow python .claude/skills/mkt-visual-identity/scripts/generate_brand_bible_pdf.py \
    --brand-context brand_context/ \
    --output brand_context/visual-identity/brand-book.pdf
```

The script naturally produces a slimmer PDF in v1 (no `templates/{pool}/_preview/` files exist yet → template-gallery page is skipped automatically — there's no opt-out flag needed). The PDF will contain:
1. Cover with brand name
2. Tokens (colors, fonts, type scale)
3. Typography samples
4. Layout / canvas / spacing
5. Design moves (one page per move from `moves.md`)
6. (skipped — no templates yet)
7. What we stand against (anti-patterns)

After the PDF generates, open an `AskUserQuestion` popup:

```python
AskUserQuestion({
  questions: [{
    question: f"Brand bible v1 generated: {brand_book_path}\n\nReview tokens (palette, typography, moves) BEFORE the templates are derived. OK to proceed?",
    header: "Approve identity",
    multiSelect: False,
    options: [
      { label: "Approved — identity complete",
        description: "Identity locked. Brand bible v1 is ready. Template-building is handled by the downstream orchestrator." },
      { label: "Refine tokens first",
        description: "Goes back to Phase 3 (fonts) or Phase 2.5 (palette and layout corrections). You say what to adjust." },
      { label: "Refine moves first",
        description: "I edit moves.md with the adjustments you indicate, regenerate the PDF, show it again." }
    ]
  }]
})
```

Loop until the user picks "Approved". ONLY after explicit approval, advance to Phase 6.

**Why this gate exists:** token errors caught here don't propagate into every downstream template. Downstream skills rely on tokens.json and moves.md being final.


### Phase 6: Brand bible PDF regen (runs after Phase 4.7 approval)

After identity approval in Phase 4.7, regenerate the brand bible to capture any token/move refinements made during the approval loop. The script produces the definitive brand-only PDF — no template gallery at this stage (template-building is orchestrated by the downstream pack). Run the script as the next action after Phase 4.7 approval so the user never has to ask whether the brand book is current.

```bash
uv run --with playwright --with pillow python .claude/skills/mkt-visual-identity/scripts/generate_brand_bible_pdf.py
```

Writes `brand_context/visual-identity/brand-book.pdf` (20 pages, A4 landscape), **overwriting in place**. The regen is **idempotent**: the script hashes its inputs (`tokens.json`, `identity.md`, `moves.md`, `voice-profile.md`, and the `logos/`/`fonts/` asset dirs) to a sidecar (`.brand-book.hash`); if nothing changed and `brand-book.pdf` already exists, it prints `[skip] brand book unchanged` and returns 0 without re-rendering. So calling it on every phase is safe — when nothing changed it's a no-op. Pass `--force` to re-render regardless. Versioned `.vN` backups are **opt-in** via `--backup` (the prior `brand-book.pdf` is archived to `brand-book.v{N}.pdf`); by default no history is kept. The legacy `visual-identity.pdf` is migrated to `brand-book.pdf` once via a one-time rename. (The dirty-check keys on inputs, not the rendered PDF, because Chromium's PDF output is non-deterministic.)

**After the script returns, surface the outcome in the phase summary message** — the absolute PDF path on a render, or the skip line when the inputs were unchanged (and the backup path only if `--backup` was passed):**

```
[ok] brand_context/visual-identity/brand-book.pdf  (20 pages, ~480 KB)
# …or, when nothing changed:
[skip] brand book unchanged
```

**If PDF generation fails** (Playwright missing, font network fetch broken, layout exception), log the error to `_analysis/extraction-log.md`, surface a one-line warning in the phase summary, but DO NOT block the rest of the pipeline — the machine-readable artifacts (tokens.json, identity.md, moves.md) are the contract; the PDF is a derivative artifact.

Page structure:

1. **Cover** — brand name + tagline + logo (rendered with the brand's own display font)
2. **Identity** — one-paragraph summary extracted from `identity.md`
3. **Palette** — color swatches with hex + per-role usage notes (consumes `tokens.json > colors`)
4. **Typography** — display + body samples using the brand's webfonts, plus the type-scale table
5. **Layout** — canvas + spacing + frame rules from `tokens.json`
6..N. **Design moves** — one page per move from `moves.md` ("what it is" + "when to apply" extracted)
N+2. **What we stand against** — anti-patterns extracted from `identity.md`
N+3. **Colophon** — source-of-truth pointers (which files to edit to update the PDF)

**When to run:**

- ✅ At the end of every Extract / Import / Build / Auto-Scrape / Folder Import that writes a new `tokens.json`
- ✅ On user request ("regenerate the brand book", "update the brand bible")
- ✅ Freely as the final step of any phase that may have touched the visual identity — the input dirty-check makes it a no-op when nothing changed, so there are no spurious overwrites. (This is what neutralizes the old double-generation: Phase 6 becomes a `[skip]` when the approval loop changed nothing.)

**Anti-patterns:**

- ❌ Skipping the PDF because "the user already has the markdown files" — markdown isn't shareable with designers/clients; the PDF is. This is the whole point of the brand bible.
- ❌ Hardcoding colors / fonts / sizes in the PDF script — every value must trace back to `tokens.json` so the PDF stays in sync forever.
- ❌ Producing a generic SaaS-styled PDF — it MUST look like the brand. The script applies paper-texture noise, the display font for headings, the accent color on hairlines, and renders the user's actual logo on the cover.

**Why this matters:** machine-readable artifacts alone are not shareable with designers or clients — the PDF is the single source of truth a non-engineer can open and review. Treating it as deferred leaves every brand with only raw JSON / markdown to hand around, which breaks the "single source of truth, shareable" promise. The PDF is part of the contract, not an optional extra.

### Phase 7 — CONFIG COMPLETE *(LOUD signal — boundary between config and content; FINAL phase of the skill)*

After Phase 6 brand bible regenerates, emit the boundary card:

```
═══════════════════════════════════════════════════════════
  CONFIGURATION COMPLETE — {brand_name}
═══════════════════════════════════════════════════════════

  Tokens:        palette {primary}/{accent}/{bg_light}/{bg_dark}
  Chrome:        masthead [{labels}] + {pagination ? "dots" : "no dots"}
  Brand bible:  brand_context/visual-identity/brand-book.pdf

  → Configuration locked. Ready to generate content. The next message
    is the post's topic/URL/material.

  ↻ RECOMMENDED: run /clear before generating your first post.
    Brand setup just consumed most of this session's context. Everything
    is saved to brand_context/ on disk — a fresh session loses nothing and
    reloads it automatically. /clear now means more room for the content run.
═══════════════════════════════════════════════════════════
```

After emitting, the skill EXITS. It does NOT ask "ready to generate content?" — that's the user's next action via `/00-social-content "topic"` (ideally after `/clear`).



## Scripts (all in `scripts/`)

| Script | Purpose | Inputs | Outputs |
|---|---|---|---|
| `pdf_to_pages.py` | Rasterize PDF → PNG per page | PDF path, target W×H | `{slug}-p{N}.png` |
| `extract_tokens.py` | Pixel analysis — **BRAND assets only** (logo, headshot, posts-archive); never template refs | PNG path | `spec.json` |

## Integration with other skills

**Called from `00-social-content` onboarding (Phase 1 intent disambiguation):**
- When `00-social-content` Phase 1 detects empty brand_context AND the user has provided reference material, it asks: BUILD brand_context first / use as INSPIRATION only / BOTH.
- On BUILD or BOTH → invoke `mkt-brand-voice` + `mkt-visual-identity` in parallel with the user-provided material.
- This skill scans for `brand_context/visual-identity/tokens.json`. If missing, runs Mode E (or Mode B if no refs).

**Consumed by:**
- `ssc-designer` reads `brand_context/visual-identity/moves.md` to apply the brand's design moves to each slide.
- `ssc-image-generator` reads `brand_context/visual-identity/tokens.json` + `brand_context/templates/{output_format}/*.html` to render slides. The renderer (`viz-image-gen/scripts/render_template.py`) resolves `brand_context/templates/{pool}/` first, with `viz-image-gen/references/templates/{pool}/` as fallback.
- `viz-image-gen` reads tokens to seed brand-aware AI prompts.

## Hybrid rendering modes

**Critical:** not every reference design can be reproduced in pure HTML/CSS. Some references include custom illustrations, hand-drawn sketches, or organic textures that resist code. This skill supports 3 rendering modes per template:

- **`PURE_CSS`** — fully deterministic HTML/CSS. Use for typography, code mocks, CTAs, geometric layouts.
- **`HYBRID_AI`** — HTML/CSS layout with an AI-generated image filling a designated slot. Use for slides with custom illustrations or diagrams.
- **`FULL_AI`** — entire slide is AI-generated. Rare. Use only when layout itself defies code.

Each template must declare its mode in the top comment. HYBRID_AI templates expose `{{ ai_image_src }}` (and optionally `{{ ai_image_prompt }}`) slots.

This taxonomy mirrors `ssc-image-generator`'s render modes (TEMPLATE / HYBRID_REAL / HYBRID_AI / FULL_AI) so downstream skills can route slides consistently.

### Layer decomposition rule

A slide is NEVER "one zone". It is a **stack of layers**, and each layer has its own render path. Decompose every ref into its layers and emit ONE entry per layer in the briefing's `layers[]` array. Never collapse layers into a single image-zone — that is the failure mode where HTML overlays get baked into an AI prompt, or text-in-a-surface is treated as a free-floating caption.

| Layer type | What it is | Render path |
|---|---|---|
| `background` | the backmost surface (see bg_treatment below) | CSS solid OR AI texture/scene |
| `image-zone` | an AI/real subject with a VARYING subject per slide — cutout figure, photo, illustration, scene | HYBRID_AI / HYBRID_REAL |
| `html-overlay` | pills, labels, badges, kickers, tags, callout chips drawn ON TOP — crisp vector edges, flat fills | HTML/CSS by default — do not bake into the AI image. **Exception:** a text-capable model (GPT Image, Gemini 3 Pro Image) using the FULL_AI `dense-infographic` archetype pattern bakes these labels into the image intentionally and verifies them; HTML overlay is then one option (use it when a word must be editable without regenerating, or the brand font must be locked exactly). |
| `physical-placeholder` | text/content composited INTO a surface depicted in the scene — a frame, canvas, screen, sign, sheet of paper | AI scene holds the surface; text is HTML registered to the surface bounds |
| `decorative-type` | oversized display words used as graphic elements ("setup", "system"), slide numerals, oversized punctuation | HTML/CSS type |

**Rules:**
- The 4 orange pills on a scene = `image-zone` (the scene) + `html-overlay` (the pills) — TWO layers, not one. The pills are crisp HTML, never part of the generated image.
- A quote that sits inside a white frame on a gallery wall = `image-zone` (the gallery scene incl. the empty frame) + `physical-placeholder` (the text registered to the frame's bounds). It is NOT a free-floating overlay.
- An oversized lowercase word anchored to a corner ("setup", "system") is a `decorative-type` layer and MUST be captured — never drop it as "just styling". This is the zero-omission rule applied to typography.

### bg_treatment rule

Classify ONLY the `background` layer here. bg_treatment sets a FLOOR; image-zone presence can PROMOTE the mode above that floor.

| What you see in the background | bg_treatment | Mode floor |
|---|---|---|
| Grain, texture, paper, concrete, noise, fabric, any non-flat surface | `textured-paint` | **HYBRID_AI** |
| Photo, figure, scene, person, environment behind everything | `scene-full-bleed` | **HYBRID_AI** (HYBRID_REAL if a real asset resolves) |
| 100% solid flat color, zero texture | `solid-color` | PURE_CSS |

**Two independent dimensions — never conflate them:**
1. `bg_treatment` (what the backmost layer is)
2. `has_image_zone` (whether a varying AI/real subject sits on top)

**Final render mode = the HIGHER of: bg floor, and image-zone requirement.**
- textured/scene bg → HYBRID_AI **regardless of image-zone**. NEVER classify visible texture as PURE_CSS. A typographic slide with no photo but a paper/concrete background is `textured-paint` → HYBRID_AI.
- `solid-color` bg → PURE_CSS **only if `has_image_zone` is also false**. If a cutout figure / photo / illustration sits on the solid color, the slide is **HYBRID_AI (or HYBRID_REAL)** — driven by the image-zone, NOT the background. Record `mode_reason` naming the layer that drove the decision (e.g. "solid-color bg but cutout men image-zone → HYBRID_AI").

This block overrides the `visual_kind` table below when they disagree.

### Observe, don't assume

When describing any decorative element (badge, shape, sunburst, divider, frame), **describe the shape and sample the color you actually see** — never pattern-match to the brand accent. A slide numeral badge is not "a coral circle" just because coral is the brand accent: look — it may be a **scalloped/starburst** shape in **dark navy/black**. Wrong-shape, wrong-color descriptions propagate into templates as the wrong chrome. Record actual shape + actual sampled hex in the briefing.

### Mode detection

Render mode = the highest of: the bg_treatment floor, the image-zone requirement, and this table's mode. The layer rule and bg_treatment rule above feed this table.

Before picking a template, classify the slide's visual_kind:

| visual_kind | Signals from briefing | Mode | Template |
|---|---|---|---|
| `screenshot_real` | "show the UI", "demo of", has actual UI URL | PURE_CSS + image, sketch overlay if has_sketch_overlay | `body-screenshot` |
| `code_mock` | tutorial step, command, config, terminal output | PURE_CSS | `body-screenshot` with code-frame variant |
| `comparison` | A vs B, before/after, this/that | PURE_CSS | `body-screenshot` with 2-col variant |
| `metaphor_illustration` | concept is abstract → needs object metaphor (filing cabinet for organization, brick wall for blocked, tower for instability) | **HYBRID_AI** | `body-illustration` |
| `concept_diagram` | flow, system, architecture with hand-drawn feel | **HYBRID_AI** | `body-illustration` |
| `decorative_hand_drawn` | brand has hand-drawn sketch overlays as standard | HYBRID_AI overlay on PURE_CSS | `body-screenshot` + sketch SVG |
| `cta_typographic` | ALL CAPS message, single statement | PURE_CSS | `cta-allcaps` |
| `cover_hook` | opening slide | PURE_CSS | `cover-dark` |

**Detection heuristic for `metaphor_illustration`:**
- The briefing's body_text contains a CONCRETE OBJECT NOUN that has no literal connection to the technical topic (claude.md is not a filing cabinet, but the concept of organization can be drawn as one).
- OR the body_text uses analogy phrasing ("think of it like", "imagine", "it's like").
- OR the title is a directive about ABSTRACT BEHAVIOR (don't dump, don't memorize, point not paste) that benefits from visual metaphor.

**When in doubt:** ask the user. Surface "this slide could be PURE_CSS (code/diagram) OR HYBRID_AI (metaphor illustration) — which fits the post tone?"

**Anti-pattern:** defaulting a whole carousel to PURE_CSS — including slides whose concepts (e.g., "kitchen-sink server vs neat servers") would benefit from HYBRID_AI metaphor illustrations — because PURE_CSS is easier, not because it's right. The skill must enforce mode-detection — the orchestrator should NOT default to PURE_CSS when the briefing clearly calls for metaphor.

## Anti-patterns to avoid

- ❌ Don't guess fonts/colors without measurement — always pixel-sample.
- ❌ Don't write generic templates — every template ties to a specific role validated against the reference.
- ❌ Don't store fonts as URL references — always download to `{brand_context}/visual-identity/fonts/`.
- ❌ **Don't try to brute-force pure CSS for custom illustrations** — escalate to HYBRID_AI when the reference has hand-drawn elements. Trying to reproduce a filing cabinet illustration in CSS produces ugly output.

## First-run checklist (guided intake — walk these in order)

First run follows Before You Start (Step 0 through Step 1). The category prompts below are the copy for the reference-upload part of that flow.

4. **Walk reference categories — one prompt per category, in this order:**

   **4a — Style references** (the most important — drives palette, typography, mood):

   ```
   Next: upload 3-5 visual style references you admire. They can be:
     · LinkedIn carousels from people you like (PDF or screenshots)
     · Instagram posts from brands with a strong identity
     · a website URL that has the right vibe
     · PDFs of brand books you enjoy
   The more, the better — I'll extract palette, typography, and moves from each.

   If you have nothing right now, say "skip style refs" — I note it and move on.
   ```

   Wait for the user's answer. If they upload, route through the right intake path (A/B/C/D/E) per `references/intake-procedures.md`. If they say "skip", record `_analysis/intake-log.md > style_refs: skipped` and proceed to 4b.

   **4b — Logo:**

   ```
   Do you have a logo? If so, upload the file (SVG ideal, PNG/JPG works, transparent
   background preferred). If you don't have one yet, say "no logo" — I'll just use the
   wordmark of your brand name in the templates.
   ```

   **On upload — single atomic command (copy + safe bg removal):**

   ```bash
   uv run .claude/skills/mkt-visual-identity/scripts/intake_logo.py \
     --input <user-upload-path> \
     --brand-context brand_context
   ```

   This is the ONLY allowed intake path. The script atomically:
   1. Normalizes the filename (`"My Logo.JPG"` → `my-logo.jpg`)
   2. Copies to `brand_context/visual-identity/logos/`
   3. Runs `clean_logo_bg.process_one()` in-process (same rembg session) with all per-logo validations
   4. Returns a JSON decision per file (stdout) + appends to `_bg_clean/_decisions.json`

   **Never do `cp` + `clean_logo_bg.py` as two separate steps** — that's the failure mode this atomic wrapper exists to prevent. Both happen or neither does.

   Decision outcomes (from `clean_logo_bg.process_one`):
   - **ok** — saved as `{name}-transparent.png` + comparison side-by-side
   - **skip `already-has-alpha`** — PNG already has transparency, nothing to do
   - **skip `bg-too-close-to-logo`** — logo's dominant color is < 60 RGB units from the bg; removal would destroy detail
   - **skip `barely-removed` / `over-removed`** — rembg ran but opaque_ratio is outside the safe range (0.02-0.95)
   - **svg-passthrough** — SVG copied without cleanup (vector already has alpha)

   A comparison PNG is always generated (even for skips) in `_bg_clean/` for visual audit. Use the stdout JSON for orchestration — if any decision is `skip`, surface the reason to the user and offer a manual override.

   **4c — Headshot** (only ask if relevant — personal brands, founder content):

   ```
   Will you appear in the posts (avatar, cover photo, photo on some body slide)?
   If so, upload a headshot (any photo where you look good on your own, a clean
   background helps). If not — say "no headshot" and I won't reserve a photo slot.
   ```

   Same handling pattern.

   **4d — Anything else:**

   ```
   Anything left you want to hand me before I run the extraction?
   Specific fonts (`.ttf` / `.otf`), a brand book PDF, a screenshot of your
   landing page, a Figma palette — send it now or say "go" to run with what
   I already have.
   ```

5. If nothing was uploaded in any category, go to Mode N (explicit confirmation). Otherwise use the mode chosen in Step 1.
6. **Check Python deps**: `pillow`, `pymupdf`, `numpy`, `playwright`. Install if missing.
7. **Check Playwright Chromium**: `python -m playwright install chromium`.


## Manual user input always wins

When a user provides explicit values (typed, pasted, or recorded in a brief), those values are written to `tokens.json` AND added to `tokens.locked_fields`. On every subsequent extraction run, locked fields are skipped — the extractor never overwrites a value the user typed. Examples:

- User says "primary is #FF0000" → `colors.primary = "#FF0000"`, `locked_fields += ["colors.primary"]`.
- User says "headline font is Inter Tight 900" → `fonts.display = {family: "Inter Tight", weight: 900}`, locked.
- User says nothing about spacing → extractor freely re-derives spacing from new references.
