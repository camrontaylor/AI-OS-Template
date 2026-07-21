---
name: coreyhaines-skills-read-book
description: "Reads a book or long PDF (PDF, EPUB, MOBI, markdown, txt, pasted text, or public-domain URL) and extracts structured notes: per-chapter TL;DR, key concepts, quotes, action items, frameworks; modes for notes, summary, quotes, study. Not for short articles (str-resources) or videos (tool-youtube)."
when_to_use: 'Invoke when the request sounds like: "read this book", "extract notes from this PDF", "summarize this ebook", "pull quotes from this"'
---

# /read-book - Extract structured notes from books and long PDFs

AI-OS book/long-PDF analog of `tool-youtube`. Same content-consumption pattern: ingest → chunk → extract → optionally save into the AI-OS workspace.

## Context Needs

| File | Load level | Why |
|---|---|---|
| Active scope `context/learnings.md` | `## coreyhaines-skills-read-book` | Preferred note shape and ingestion lessons |

No brand context is needed unless the user asks for a branded derivative.

## Step 1 - Parse input

Accept:
- **PDF**: file path (Claude reads PDFs natively in chunks via `Read pages:"X-Y"`)
- **EPUB / MOBI**: file path (needs `pandoc` or `ebook-convert` to extract - see `references/sources.md`)
- **Markdown / .txt**: file path (read directly)
- **Pasted text**: just use what was pasted
- **URL** to public-domain text: `WebFetch` (Project Gutenberg, archive.org, etc.)

Detect type from file extension. If ambiguous, ask.

## Step 2 - Parse mode

| Invocation | Mode | What you get |
|---|---|---|
| `/read-book <input>` | **notes** (default) | Chapter-by-chapter: TL;DR + key concepts + quotes + action items + frameworks |
| `/read-book <input> summary` | summary | Whole-book TL;DR (1 paragraph) + 3-5 key takeaways + who-it's-for |
| `/read-book <input> quotes` | quotes | Pull-quote highlights only, with chapter context and page refs |
| `/read-book <input> study` | study | Notes mode + 10-20 spaced-repetition Q&A cards |

If the book is long (>200 pages) and mode is unspecified, default to `notes` but warn it'll take many tool calls.

## Step 3 - Get the text + chunk

See `references/sources.md` for per-source ingestion. Output of this step: text content + a chunking plan.

**Chunking strategy** (hybrid, in priority order):

1. **By chapter** if a TOC exists (PDF with bookmarks, EPUB/MOBI converted via pandoc preserves chapter headers)
   - Use `pdfinfo <pdf> | grep "Pages"` for PDFs
   - Use `pdftotext -layout <pdf> | grep -i "^chapter\|^part"` for chapter detection, or read TOC from page 1-5
   - EPUB: after `pandoc <epub> -o tmp.md`, chunks are between `# Chapter X` headers

2. **By page count** for PDFs without TOC: 50 pages per chunk

3. **By character count** for text/markdown: 30,000 chars per chunk (~7,500 words)

Save the chunking plan as `~/Documents/books/<author>-<title-slug>-<YYYY-MM-DD>/chunks.json`:

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

## Step 4 - Read each chunk

Loop:
1. Read chunk N (`Read` tool with `pages:` for PDF, full file for text/MD)
2. Extract per the chosen mode (see `references/output-modes.md` for templates)
3. Append the chunk's notes to `~/Documents/books/<workdir>/notes-<NNN>-<label-slug>.md`

For PDFs, **don't read the whole book in one call** - Claude's PDF tool maxes around 10 pages. Process chunks individually.

If a chunk fails to extract anything useful (e.g., it's mostly diagrams or front-matter), log the skip and continue.

## Step 5 - Aggregate into final notes file

Combine all chunk notes into a single `~/Documents/books/<workdir>/notes.md` matching the mode's full-book template (see `references/output-modes.md`).

Top of the file always has the metadata block + a portable frontmatter:

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

## TL;DR
<2-3 sentences>

## Key takeaways
1. ...

## Chapter notes
...

## Cross-references (suggested for wiki)
- Could connect to [[Longevity Biomarkers]] (per Chapter 3 discussion of biomarkers)
- Could connect to [[Productivity & Systems]] (per Chapter 7 framework)
```

The cross-reference suggestions are advisory - conceptual links you can act on later, not auto-applied.

## Step 6 - Offer to save into the AI-OS workspace

The workdir under `~/Documents/books/<workdir>/notes.md` always has the full notes. Then ask whether to also file it into AI-OS:

> *"Want me to save these notes into AI-OS? I'll copy them to `projects/coreyhaines-skills-read-book/<author>-<title-slug>_<YYYY-MM-DD>.md`."*

Default is **ask**, never auto-write. If yes:
1. Copy the final `notes.md` into `projects/coreyhaines-skills-read-book/<author>-<title-slug>_<YYYY-MM-DD>.md` (the AI-OS output convention; create the folder on first use).
2. Show the full absolute path.
3. If this book is a durable reference the user will want to recall later, offer to also route it through `str-resources` (which indexes it into the AI-OS resource system and Notion). For a one-off read, the `projects/` copy is enough.

If the user skips saving, the workdir still has everything - they can grab it later.

## Step 7 - Report

In chat:
- One-line headline: `<title> · <author> · <total_pages or word count> · <mode> · <chunks processed>`
- Workdir path
- The TL;DR section
- For `notes` / `study` modes: brief list of top 3 takeaways
- For `quotes` mode: top 3 quotes
- If saved into AI-OS: that `projects/coreyhaines-skills-read-book/` path too

## Modes (quick invocations)

| Invocation | Mode | Behavior |
|---|---|---|
| `/read-book <input>` | notes | Full pipeline, default mode |
| `/read-book <input> summary` | summary | Just TL;DR + key takeaways (1 read pass for short books, sampled chapters for long) |
| `/read-book <input> quotes` | quotes | Chapter-by-chapter, but only output quotes |
| `/read-book <input> study` | study | Notes + Q&A spaced-rep cards |
| `/read-book <input> --capture` | (any) | Skip the ask step, auto-save into `projects/coreyhaines-skills-read-book/` |
| `/read-book <input> --render pdf` | (any) | Also render the final `notes.md` to PDF via pandoc (uses a default stylesheet; see `references/output-modes.md`). |
| `/read-book <input> --render html` | (any) | Same as above but HTML |

## Composes with (AI-OS)

- `str-resources` - the durable home: when a book is a lasting reference, route the notes through str-resources to index them into the AI-OS resource system + Notion.
- `q-question` - when a research question turns up a book, `coreyhaines-skills-read-book` is the next step; notes feed back into the answer.
- `tool-youtube` - the video sibling; same ingest → chunk → extract → save pattern for a different medium.
- `str-trending-research` - when scoring an idea, book notes provide structured evidence alongside trend research.
- `coreyhaines-skills-slide-deck` - book takeaways to talk material (book talk pattern).
- `tool-youtube` - AI-OS's YouTube-native sibling, same content-consumption pattern. Audiobook or author talk? Use `tool-youtube` for the audio/video version.
- When researching to *write* a book, this skill reads the comp titles (pair it with your own book-writing skills if you have them).

## Error handling

| Failure | Response |
|---|---|
| EPUB/MOBI without pandoc / ebook-convert | Tell the user: `brew install pandoc` or `brew install calibre` (calibre includes `ebook-convert`) |
| PDF is scanned (no text layer) | Suggest OCR first: `brew install ocrmypdf && ocrmypdf <pdf> <pdf-ocr.pdf>` |
| PDF has no detectable TOC | Fall back to 50-page chunks. Note in the metadata. |
| Book is unusually long (>500 pages) | Warn cost / time, ask if the user wants summary mode instead of full notes |
| Chunk extraction empty | Skip the chunk, log, continue. Don't fail the whole run. |

## Notes on quality

- **Don't summarize beyond recognition.** A 30-page chapter should produce 8-15 lines of notes, not 3. Compression is good; flattening is bad.
- **Preserve specifics.** Names, numbers, dates, quotes - keep them. The whole point is later-the user can grep "what did Andy Wilkinson say about X" and find it.
- **Quotes are sacred.** When you flag a quote, copy it verbatim. Note the page if possible.
- **Action items are explicit.** If the book makes you think "I should do X," flag it explicitly. These are the highest-leverage outputs.
- **Frameworks deserve their own bullets.** When the author names a framework (e.g., "the 9-dimension filter," "Save the Cat beats"), call it out by name in the notes.
