> Runtime scope: the adjacent SKILL.md governs this reference. Team-connected runs use only the authoritative snapshot; local context/config/knowledge examples apply only to Solo mode. Generated files use the dated project directory and dated filenames. User task authorization controls external writes.

# PPT conversion reference

Convert a supplied PowerPoint deck through an explicitly configured existing renderer or standalone local HTML/Markdown fallback. Preserve extracted text—including tables and grouped shapes—structure, speaker notes, and images.

## Prerequisites

Use an available Python runtime containing `python-pptx`. Check the existing document runtime first; if unavailable, use the documented manual slide-text fallback or an explicitly scoped dependency setup.

## Step 1 — Extract content

Use the shipped `../scripts/extract_pptx.py` with a Python runtime containing python-pptx.
Pass the source PPTX, dated output directory, and user's local `--date`.
The script extracts real titles, text frames, table rows/cells, recursively grouped shapes, notes, image assets, dimensions, and a JSON manifest without modifying the source.

## Step 2 — Review extraction and conversion direction

Read `{YYYY-MM-DD}_extracted-slides.json` emitted by the helper. Present a one-line-per-slide summary:

```
Slide 1: "Title — Brand Name"
Slide 2: "Agenda" — 4 bullets
Slide 3: "Problem statement" — 2-paragraph body, 1 image
...
Slide 18: "Thank you" — speaker notes only
```

Sanity-check extraction against the supplied deck. Proceed with the already authorized conversion direction and renderer; ask only about missing or ambiguous facts that materially change conversion. Do not add an approval pause merely because the user requested conversion.

## Step 3 — Map to the selected renderer

When an explicitly configured React renderer provides these real components, choose a primitive composition based on the extracted shape. Otherwise preserve the same structural patterns in local HTML/Markdown; do not invent component imports.

| Extracted shape | React mapping |
|---|---|
| Title-only (no body) | Title slide pattern OR section divider |
| Title + 1 paragraph | `Heading + Body` |
| Title + bullet list (3–6 items) | `Heading + BulletList` |
| Title + 2 columns | `Heading + TwoCol` |
| Title + image, no body | `Heading + <img>` centered |
| Title + image + body | `TwoCol` with image on one side, body other |
| Big quote | Pull quote pattern (see `template.md`) |
| Final / thank-you slide | Close/CTA pattern |

## Step 4 — Generate renderer files or local fallback

For a configured existing React deck project, write to `${SLIDE_DECK_REPO:?Configure an existing deck project}/src/app/slides/<slug>/`:
- `layout.tsx` (use the deck title from slide 1)
- `page.tsx` (full Slide[] array)

For images:
1. Copy from `projects/viz-slide-deck/{YYYY-MM-DD}_{name}/conversion/assets/` to `${SLIDE_DECK_REPO:?Configure an existing deck project}/public/slide-assets/<slug>/`
2. Reference in slides via `<img src="/slide-assets/<slug>/<filename>" alt="..." className="max-h-[60vh] mx-auto" />`

Without a configured renderer, save `{YYYY-MM-DD}_deck.html` or `{YYYY-MM-DD}_deck.md` in the dated project folder and link extracted image assets locally.

## Step 5 — Speaker notes

Speaker notes in the PPTX → `notes` array on the corresponding Slide. Split notes on sentence boundaries or empty lines; aim for 3–5 lines per slide per the user's voice rules.

If a PPTX slide has no notes, generate 3 starter notes lines based on the slide's content. Mark these with a `// TODO: review` comment so the user can refine in their voice.

## Step 6 — Apply voice + density rules

The extracted content is in whatever voice the original deck had — likely corporate. After mapping to primitives, do a voice pass:

- Apply the user's anti-AI-slop rules (`narrative-and-voice.md`)
- Rewrite generic headings into specific, take-coded ones
- Trim wordy bullets — aim for 3–6 words each
- Honor the chosen density mode (speaker-led vs reading-first)

This is the most subjective step. When in doubt, show the user the original and proposed rewrite side by side and let them pick.

## Step 7 — Archive the conversion

Keep the original PPTX + extracted JSON forever. Never modify the source.

```
projects/viz-slide-deck/{YYYY-MM-DD}_{name}/conversion/
├── {YYYY-MM-DD}_original.pptx             # untouched optional copy
├── {YYYY-MM-DD}_extracted-slides.json     # actual helper manifest
├── assets/                               # actual helper image files
│   └── {YYYY-MM-DD}_slide-001-image-003.png
└── {YYYY-MM-DD}_conversion-notes.md    # any decisions made during mapping (the user-readable audit)
```

The audit lets future conversions of similar decks reuse the mapping decisions.
