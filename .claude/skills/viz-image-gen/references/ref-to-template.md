# Reference → Template — Guided Extraction Flow

Converts a user-uploaded reference (a slide they made, a Stripe/Notion/Dribbble screenshot, anyone's carousel) into a **custom template** in their pool. The user keeps their brand_kit (colors, fonts, tokens); the reference contributes **only the visual layer** (layout/composition/ornaments OR scene/style/mood).

**Read this when:** user says "extract a template from this ref", "make a template like this", "save this layout", "I want to use this structure", or attaches an image during brandbook setup and asks for a template.

The flow is **fully conversational** — Claude looks at the image, classifies it, asks pointed questions, shows a diff, and only writes after the user confirms.

> **Companion doc:** `extraction-schemas.md` defines the structured field-sets Claude fills when looking at the ref (Schema A for HTML layout, Schema B for AI prompt, Schema C for hybrid). This doc is the FLOW; that doc is the SCHEMAS.

---

## Inputs

- 1 image (or PDF/HTML) uploaded by the user
- Optional: text describing what they like ("the headline rhythm", "the way the eyebrow stacks", etc.)

## Outputs (depending on case classification in Phase 0)

| Case | Files written |
|---|---|
| **A — Layout** | `templates/<pool>/<role>/custom-<slug>.html` + manifest entry (`render_mode: TEMPLATE`) |
| **B — AI prompt** | `templates/<pool>/<role>/custom-<slug>.prompt.md` + manifest entry (`render_mode: FULL_AI`) |
| **C — Hybrid** | Both `.html` + `.prompt.md` side by side + manifest entry (`render_mode: HYBRID_AI`) |

In any case, optional: accent color appended to `brand_context/assets.md` if user wanted the ref's colors.

## The flow — 6 phases

### Phase 0 — Classify the reference

Claude opens the image and decides which case applies:

- **A — Layout** if the ref is predominantly text + boxes + clean geometry (Stripe carousel, magazine page, Notion shot)
- **B — AI prompt** if it's predominantly photo / illustration / 3D / artistic scene
- **C — Hybrid** if it has a strong image background + text or UI overlaid on top

Then Claude tells the user the call + confirms:

> "I looked at the ref. I see it's a **photographic** composition — to reproduce that atmosphere you need AI generating the image (not HTML). I'll save it as an AI prompt template. Sound good?"

User confirms or forces a different case. Don't proceed without alignment.

### Phase 1 — What did you like about this reference?

Options depend on the case classified in Phase 0.

**Case A (Layout)** — use `AskUserQuestion` multiSelect:

```
question: "I looked at your ref. So I don't copy too much, tell me what caught your attention:"
header: "Extract A"
options:
  - composition — structure/hierarchy/proportions (header, body, footer, image zones)
  - colors — colors specific to this ref (added as an accent to your palette)
  - typography — sizes, weights, contrast (Light + Black, italic on a keyword)
  - image style — full-bleed / framed / split / overlay
  - ornaments — lines, dots, badges, decorative geometry
```

**Case B (AI prompt)** — Claude fills in Schema B by observing the ref, then presents it as a draft and asks what to adjust:

> "I'll fill in the prompt fields based on what I see. Do you confirm each one or adjust?"
>
> ```
> subject:       Person at a wooden desk with a laptop, hands visible
> environment:   Sunlit home office, plants in soft focus
> composition:   medium
> lighting:      natural morning, soft from window left
> style:         photographic
> mood:          [focused, calm, intentional, warm]
> palette:       ["#e8dcc4", "#3a2a1a", "#7a8b4d"]
> texture:       matte paper, glass screen, polished wood
> camera:        35mm, shallow DoF, slight grain
> constraints:   [no faces visible, no readable text on screen, no logos]
> ```
>
> "Any field to swap out? Or do we start from this draft?"

Full schema in `extraction-schemas.md → Schema B`.

**Case C (Hybrid)** — the two questions above in sequence (first A for the overlay, then B for the background).

Special handling in any case:
- If **colors** comes in (A) or `palette` has a strong color outside the brand (B) → Claude asks: *"Does this color come in as Accent N in your palette, or do we ignore it?"*
- If the ref uses a font the user doesn't have (A) → offer to add it to `brand_context/fonts/` first
- If any Schema B field is left empty → Claude proposes a conservative default

### Phase 2 — Where will this template live?

Two `AskUserQuestion` in batch:

```
question 1: "What kind of output is this template for?"
header: "Pool"
options:
  - linkedin-carousel
  - instagram-carousel
  - youtube-slideshow
  - ebook (page)
  - one-pager
  - other (type it in)

question 2: "What role does it serve?"
header: "Role"
options:
  - hero — opening slide (1st)
  - body — middle slide (context, insight, proof)
  - cta — closing slide (last)
```

Then plain text:

> "I suggest the id `custom-<slug>`. Want a better name? (short, kebab-case, no spaces. E.g.: `stripe-hero-bold`, `editorial-quote-frame`)"

Validate: id must not collide with existing manifest entries.

### Phase 3 — The plan (transparency gate)

**Before writing anything**, render a clear diff. Show:

```
I'll create / modify:

NEW   .claude/skills/viz-image-gen/references/templates/<pool>/<role>s/<id>.html
      └─ Template HTML mimicking the reference's <composition>, using your brand tokens
         via CSS variables (so your colors/fonts always win).

MODIFY .claude/skills/viz-image-gen/references/templates/<pool>/manifest.json
      └─ Add new entry:
         {
           "id": "<id>",
           "file": "<role>s/<id>.html",
           "role": "<role>",
           "status": "ready",
           "tone": ["user-uploaded"],
           "image_zone": "<inferred>",
           "render_mode": "<TEMPLATE | HYBRID_REAL | ...>",
           "needs": ["HEADLINE", ...],
           "optional": ["EYEBROW", ...],
           "fits": ["<inferred from copy patterns>"],
           "summary": "<one-liner describing the layout>"
         }
```

If **colors** was checked in Phase 1, also show:

```
MODIFY <project_root>/brand_context/assets.md
      └─ Append under "## Colors" → "Optional additional palette colors":
         - **Accent N:** `#<hex>` — extracted from reference (will be available as
           var(--brand-accent-N) in templates)
```

Ask: **"Confirm this plan? (yes / adjust X)"**

If the user says adjust, loop back to the specific field. Don't proceed without explicit confirmation.

### Phase 4 — Write the file(s)

Depends on the case. **In every case, NEVER hardcode hex colors or px outside the token scale** — always `var(--brand-*)` or `var(--space-*)` or `var(--type-*)`.

**Case A — HTML template:**
Schema A (from `extraction-schemas.md`) → maps to HTML:
- `zones` become divs with height via flex/grid + `height_pct`
- `type_hierarchy` become classes (`.display`, `.h2`, `.body-l`) already defined in `_shared/styles.css`
- `ornaments` become divs/spans with CSS using `var(--brand-accent)` etc.
- `image_zone` defines the `{{IMAGE_HTML}}` slot
- `spacing_rhythm` controls which `var(--space-*)` to use in the paddings
- Text becomes Mustache placeholders: `{{HEADLINE}}`, `{{EYEBROW}}`, `{{BODY}}`, `{{LIST_ITEMS}}`, with `{{#X}}…{{/X}}` for the optional ones

Output: `templates/<pool>/<role>s/custom-<slug>.html`

**Case B — AI prompt template:**
Schema B (from `extraction-schemas.md`) → maps to the `.prompt.md`:
- YAML frontmatter with `id`, `role`, `render_mode: FULL_AI`, `ai_style`, `recommended_model`, `source_ref`
- Prompt body using the canonical template (see `extraction-schemas.md → Schema B → Template`):
  ```
  {{BRAND_MOOD_BLOCK}}

  {subject}. {environment}. {composition} framing. {lighting} lighting.
  {style} aesthetic. Mood: {mood}.
  ...
  Negative: {constraints}
  ```
- `{{BRAND_MOOD_BLOCK}}`, `{{BRAND_ACCENT}}` stay as placeholders — the renderer substitutes them at runtime
- Per-slide dynamic variables (e.g.: `{{TOPIC}}`, `{{TOPIC_ARTIFACT}}`) are documented in the `## Variables` section

Output: `templates/<pool>/<role>s/custom-<slug>.prompt.md`

**Case C — Hybrid:**
Writes BOTH files (from Case A and Case B). The manifest entry has `render_mode: HYBRID_AI` + two fields: `file` (HTML) and `ai_prompt` (.prompt.md).

**In every case:**
1. Update `<pool>/manifest.json` — append entry, preserve JSON formatting
2. Update `brand_context/assets.md` if the user asked to add an accent

### Phase 5 — Validate visually

Renders the new template with **dummy data** (just to fill the placeholders; the content is throwaway):

**Case A:**
```bash
uv run .claude/skills/viz-image-gen/scripts/render_template.py \
  --template-pool <pool> \
  --template-id <id> \
  --output projects/_ref-to-template-preview/<id>.png \
  --data '<filler headline/eyebrow/body>'
```

**Case B:**
```bash
uv run .claude/skills/viz-image-gen/scripts/render_template.py \
  --template-pool <pool> \
  --template-id <id> \
  --output projects/_ref-to-template-preview/<id>.png \
  --data '{"TOPIC": "AI tooling", "TOPIC_ARTIFACT": "a Figma board"}'
# renderer detects .prompt.md, calls AI image gen, saves PNG
```

**Case C:** same call — the renderer generates the AI image first, then composes it with the HTML overlay.

Show the PNG to the user:

> "Rendered to `projects/_ref-to-template-preview/<id>.png`. **Visually**, did it come out the way you wanted? (yes / what to adjust)"

The dummy copy isn't the point — it's just to see whether the visual structure matches the ref. If the user asks for a tweak, iterate on the HTML / `.prompt.md` (max 3 rounds; after that, suggest starting over with another ref).

Once confirmed, delete the preview PNG (throwaway) and keep only the template + manifest entry.

---

## Edge cases

- **User uploads a non-image file (PDF, HTML).** PDF: pdf2image first page or treat as image. HTML: read source directly — you can use the actual HTML/CSS as a starting point instead of inferring.
- **Reference colors are too close to user's brand.** Don't add accent. Note in `fits` that this template was extracted but no new color was needed.
- **Reference uses a font the user hasn't uploaded.** Don't write the font into the template. Use `var(--font-display)` / `var(--font-body)` — user's fonts apply. Note in `summary`: "originally used Söhne in the reference; uses your brand fonts."
- **Reference has multiple "components" in one slide (header + 3 cards + footer).** Ask: "which part do you want in the template?" Don't try to recreate everything.
- **User wants a one-off / disposable template.** Use prefix `oneoff-<slug>` instead of `custom-<slug>` and set `status: planned` in manifest so it's not auto-picked by the designer. User can manually invoke it.

---

## Manifest entry shapes (per case)

**Case A — HTML template:**
```json
{
  "id": "custom-stripe-hero",
  "file": "heroes/custom-stripe-hero.html",
  "role": "hook",
  "status": "ready",
  "tone": ["user-uploaded", "editorial"],
  "image_zone": "none",
  "render_mode": "TEMPLATE",
  "needs": ["HEADLINE"],
  "optional": ["EYEBROW", "SUPPORT"],
  "fits": ["product reveal", "case study opener", "stripe-style hero"],
  "summary": "Hero with top-bar + giant headline + left-rail accent + bottom author chip.",
  "source_ref": "brand_context/visual_refs/stripe-2026-04.png"
}
```

**Case B — AI prompt template:**
```json
{
  "id": "custom-desk-scene-hero",
  "file": "heroes/custom-desk-scene-hero.prompt.md",
  "role": "hook",
  "status": "ready",
  "tone": ["user-uploaded", "photographic"],
  "image_zone": "full-bleed",
  "render_mode": "FULL_AI",
  "ai_style": "editorial-photo",
  "recommended_model": "gemini",
  "fits": ["atmosphere hook", "scene-setting opener"],
  "summary": "Person at desk, natural morning light, photographic editorial mood.",
  "source_ref": "brand_context/visual_refs/desk-scene-2026-04.png"
}
```

**Case C — Hybrid:**
```json
{
  "id": "custom-hybrid-hero",
  "file": "heroes/custom-hybrid-hero.html",
  "ai_prompt": "heroes/custom-hybrid-hero.prompt.md",
  "role": "hook",
  "status": "ready",
  "tone": ["user-uploaded"],
  "image_zone": "full-bleed",
  "render_mode": "HYBRID_AI",
  "summary": "Photo background + text overlay. Recreates Anthropic-style hero.",
  "source_ref": "brand_context/visual_refs/anthropic-hero-2026-04.png"
}
```

`source_ref` is optional but recommended — points back to the file the user uploaded, for future debugging/iteration.

---

## After extraction

Designer (`ssc-designer`) treats custom templates EXACTLY like curated ones — filters by role / image_zone / render_mode same way. Tone bias: when the user's `tokens.md → tone` matches a custom template's `tone` list, it gets prioritized over curated.

This means: the more refs the user extracts over time, the more their pool reflects THEIR taste. The system literally learns "your style".
