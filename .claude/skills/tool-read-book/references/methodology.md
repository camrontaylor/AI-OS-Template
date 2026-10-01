## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/tool-read-book/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/tool-read-book/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /tool-read-book — Extract structured notes from books and long PDFs

Sibling to `tool-watch-video`. Same content-consumption pattern: ingest → chunk → extract → preserve the source record in the dated project folder.

<a id="step-1--parse-input"></a>
## Step 1 — Parse input

Accept:
- **PDF**: file path (Claude reads PDFs natively in chunks via `Read pages:"X-Y"`)
- **EPUB / MOBI**: file path (needs `pandoc` or `ebook-convert` to extract — see `sources.md`)
- **Markdown / .txt**: file path (read directly)
- **Pasted text**: just use what was pasted
- **URL** to public-domain text: `WebFetch` (Project Gutenberg, archive.org, etc.)

Detect type from file extension. If ambiguous, ask.

<a id="step-2--parse-mode"></a>
## Step 2 — Parse mode

| Invocation | Mode | What you get |
|---|---|---|
| `/tool-read-book <input>` | **notes** (default) | Chapter-by-chapter: TL;DR + key concepts + quotes + action items + frameworks |
| `/tool-read-book <input> summary` | summary | Whole-book TL;DR (1 paragraph) + 3–5 key takeaways + who-it's-for |
| `/tool-read-book <input> quotes` | quotes | Pull-quote highlights only, with chapter context and page refs |
| `/tool-read-book <input> study` | study | Notes mode + 10–20 spaced-repetition Q&A cards |

If the book is long (>200 pages) and mode is unspecified, default to `notes` but warn it'll take many tool calls.

<a id="step-3--get-the-text--chunk"></a>
## Step 3 — Get the text + chunk

See `sources.md` for per-source ingestion. Output of this step: text content + a chunking plan.

**Chunking strategy** (hybrid, in priority order):

1. **By chapter** if a TOC exists (PDF with bookmarks, EPUB/MOBI converted via pandoc preserves chapter headers)
   - Use `pdfinfo <pdf> | grep "Pages"` for PDFs
   - Use `pdftotext -layout <pdf> | grep -i "^chapter\|^part"` for chapter detection, or read TOC from page 1–5
   - EPUB: after `pandoc <epub> -o tmp.md`, chunks are between `# Chapter X` headers

2. **By page count** for PDFs without TOC: 50 pages per chunk

3. **By character count** for text/markdown: 30,000 chars per chunk (~7,500 words)

Save the chunking plan as `projects/tool-read-book/{YYYY-MM-DD}_{name}/chunks.json`:

```json
{
  "source": "<path>",
  "title": "<book title>",
  "author": "<author>",
  "type": "pdf",
  "total_pages": 287,
  "chunking": "by-chapter",
  "chunks": [
    {"i": 0, "label": "Introduction", "pages": "1-12"},
    {"i": 1, "label": "Chapter 1: The Problem", "pages": "13-32"},
    ...
  ]
}
```

<a id="step-4--read-each-chunk"></a>
## Step 4 — Read each chunk

Loop:
1. Read chunk N (`Read` tool with `pages:` for PDF, full file for text/MD)
2. Extract per the chosen mode (see `output-modes.md` for templates)
3. Append the chunk's notes to `<dated-output-dir>/notes-<NNN>-<label-slug>.md`

For PDFs, **don't read the whole book in one call** — Claude's PDF tool maxes around 10 pages. Process chunks individually.

If a chunk fails to extract anything useful (e.g., it's mostly diagrams or front-matter), log the skip and continue.

<a id="step-5--aggregate-into-final-notes-file"></a>
## Step 5 — Aggregate into final notes file

Combine all chunk notes into a single `<dated-output-dir>/notes.md` matching the mode's full-book template (see `output-modes.md`).

Top of the file always has the metadata block + the portable source metadata:

```markdown
source: <file path or URL>
captured: YYYY-MM-DD
type: book
book_title: <title>
author: <author>
mode: notes
chunks: <count>
chunking: <strategy>

# <title> by <author>

<a id="tldr"></a>
## TL;DR
<2–3 sentences>

<a id="key-takeaways"></a>
## Key takeaways
1. ...

<a id="chapter-notes"></a>
## Chapter notes
...

<a id="cross-references-suggested-for-wiki"></a>
## Cross-references (suggested for wiki)
- Could connect to [[Longevity Biomarkers]] (per Chapter 3 discussion of biomarkers)
- Could connect to [[Productivity & Systems]] (per Chapter 7 framework)
```

Cross-references are suggestions for future research. Link only to existing, user-approved project files; do not create or compile a separate knowledge store.

<a id="step-6--preserve-source-record"></a>
## Step 6 — Preserve source record

Keep the final notes, source metadata, chunk plan and links together in the dated project folder. The saved `notes.md` is the durable record; no additional knowledge store is required. If the user requests working-memory capture, pass only a short fact or report pointer to `meta-memory-write`.

<a id="step-7--report"></a>
## Step 7 — Report

In chat:
- One-line headline: `<title> · <author> · <total_pages or word count> · <mode> · <chunks processed>`
- Workdir path
- The TL;DR section
- For `notes` / `study` modes: brief list of top 3 takeaways
- For `quotes` mode: top 3 quotes
- Path to the final notes file

<a id="modes-quick-invocations"></a>
## Modes (quick invocations)

| Invocation | Mode | Behavior |
|---|---|---|
| `/tool-read-book <input>` | notes | Full pipeline, default mode |
| `/tool-read-book <input> summary` | summary | Just TL;DR + key takeaways (1 read pass for short books, sampled chapters for long) |
| `/tool-read-book <input> quotes` | quotes | Chapter-by-chapter, but only output quotes |
| `/tool-read-book <input> study` | study | Notes + Q&A spaced-rep cards |
| `/tool-read-book <input> --capture` | (any) | Preserve a standalone source record in the dated project folder |
| `/tool-read-book <input> --render pdf` | (any) | Also render the final `notes.md` to PDF via pandoc (uses `context/config/render.css`). See `output-modes.md`. |
| `/tool-read-book <input> --render html` | (any) | Same as above but HTML |

<a id="composes-with"></a>
## Composes with

- `str-deep-research` — when a research question turns up a book, `/tool-read-book` is the next step. Notes feed back into the research brief.
- `str-business-brainstorm` — when scoring an idea (e.g., business books on similar models), read-book provides the structured evidence.
- `str-decide` — when a decision hinges on what an authority has written (e.g., "should I take VC money?" → read Naval / Jason Cohen), `tool-read-book` extracts the relevant chapter.
- `viz-slide-deck` — book takeaways → talk material (book talk pattern).
- `tool-watch-video` — sibling skill, same content-consumption pattern. Audiobook? Use `watch-video transcript` mode.
- `nonfictionskills` / `fictionskills` — when researching to *write* a book, this skill reads the comp titles.

<a id="error-handling"></a>
## Error handling

| Failure | Response |
|---|---|
| EPUB/MOBI without pandoc / ebook-convert | Tell the user: `brew install pandoc` or `brew install calibre` (calibre includes `ebook-convert`) |
| PDF is scanned (no text layer) | Suggest OCR first: `brew install ocrmypdf && ocrmypdf <pdf> <pdf-ocr.pdf>` |
| PDF has no detectable TOC | Fall back to 50-page chunks. Note in the metadata. |
| Book is unusually long (>500 pages) | Warn cost / time, ask if the user wants summary mode instead of full notes |
| Chunk extraction empty | Skip the chunk, log, continue. Don't fail the whole run. |

<a id="notes-on-quality"></a>
## Notes on quality

- **Don't summarize beyond recognition.** A 30-page chapter should produce 8–15 lines of notes, not 3. Compression is good; flattening is bad.
- **Preserve specifics.** Names, numbers, dates, quotes — keep them. The whole point is later-the user can grep "what did Andy Wilkinson say about X" and find it.
- **Quotes are sacred.** When you flag a quote, copy it verbatim. Note the page if possible.
- **Action items are explicit.** If the book makes you think "I should do X," flag it explicitly. These are the highest-leverage outputs.
- **Frameworks deserve their own bullets.** When the author names a framework (e.g., "the 9-dimension filter," "Save the Cat beats"), call it out by name in the notes.
