---
name: tool-read-book
description: >
  Read a supplied book or long document in chunks and produce notes, summary, quotes, or study cards. Use for "read this book", "summarize this ebook", "extract notes", or "study this PDF". Supports accessible PDF, EPUB, MOBI, Markdown, text, and public-domain URLs with checked conversion tools. Saves dated chunk plans and sourced notes; short ad hoc document questions need not run the full workflow.
---

# Read Book

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A dated chunk plan, per-chapter notes, final mode-specific report, and optional rendered copy.
Save deliverables to `projects/tool-read-book/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## tool-read-book` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/tool-read-book/` | Relevant files if present | User-owned settings |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/tool-read-book/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Choose input and mode

Determine notes, whole-book summary, quote highlights, or study mode. Check file type and readable access; use references/sources.md for ingestion. Use supplied lawful content or public-domain text; do not assume a platform PDF tool supports an arbitrary page count.
Read [the detailed method](references/methodology.md#step-2--parse-mode) for this step’s mechanics and output shape.

## Step 3: Plan and extract chunks

Prefer chapter boundaries from bookmarks/TOC. Otherwise use manageable page blocks or about 30,000 characters; split further to the actual reader’s limit. Check pandoc/pdftotext/ebook-convert only as required. Save dated chunks.json with source, title, author, type, coverage, and chunk ranges.
Read [the detailed method](references/methodology.md#step-3--get-the-text--chunk) for this step’s mechanics and output shape.

## Step 4: Read and attribute each chunk

Use references/output-modes.md. Record chapter takeaway, concepts, useful short quotations with location, action items, and frameworks. Quotes mode does not invent quotations. Study mode adds 10–20 source-grounded Q&A cards. Record failed/OCR-dependent or diagram-heavy chunks as gaps.
Read [the detailed method](references/methodology.md#step-4--read-each-chunk) for this step’s mechanics and output shape.

## Step 5: Aggregate and audit coverage

Combine chapter outputs into metadata, overall takeaway, concepts, chapter notes, cited quotes, applications, and suggested cross-connections. Distinguish source claims from application suggestions. Optional HTML/PDF rendering uses actual installed tools and CSS only if present; Markdown always remains usable.
Read [the detailed method](references/methodology.md#step-5--aggregate-into-final-notes-file) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/tool-read-book/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## tool-read-book` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Report partial coverage rather than claim an unread book was fully processed.
- Keep excerpts proportionate and respect applicable quotation limits.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## tool-read-book` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing binary: resolve `scripts/setup.sh` inside this installed skill package and run it only for the required missing tools; inspect its result before proceeding.
- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
