---
name: tool-youtube
description: "YouTube skill, three modes: Capture (paste a URL to transcribe, extract frameworks, and save to Notion and workspaces), Channel (list recent uploads), Watch (paste a URL with a question for visual analysis). Not for content creation or repurposing."
when_to_use: 'Invoke when the request sounds like: "/youtube", "watch this video", "transcribe this", "save this video", "get transcript", "latest youtube video", "what did they post"'
argument-hint: "<youtube-url-or-@channel> [question]"
allowed-tools: Bash, Read, AskUserQuestion
user-invocable: true
---

# /youtube — YouTube capture and transcript skill

Three modes based on what the user provides:

| Input | Mode | What happens |
|-------|------|-------------|
| YouTube URL only | **Capture Mode** | Full automated save workflow |
| `@channel` handle | **Channel Mode** | List recent uploads |
| URL + specific question | **Watch Mode** | Frame analysis + transcript |

## Context Needs

| File | Load level | Why |
|---|---|---|
| Active scope `context/learnings.md` | `## tool-youtube` | Transcript, routing, and output lessons |
| Active client `context/current-state.md` | summary, when present | Decide whether captured material belongs to that client |

No brand context is needed for capture or analysis. Load it only for a separate
published-content request.

---

## Resolve SKILL_DIR (do this first, before any command)

Set `SKILL_DIR` to the **absolute path of the directory containing this SKILL.md you
just Read**. The scripts are always at `${SKILL_DIR}/scripts/`. Verify once:

```bash
SKILL_DIR="<absolute path of the folder containing this SKILL.md>"
if [ ! -f "${SKILL_DIR}/scripts/watch.py" ]; then
  echo "ERROR: scripts/watch.py not found. Re-check SKILL_DIR." >&2
  exit 1
fi
```

---

## Step 0 — Preflight (silent on success)

```bash
python3 "${SKILL_DIR}/scripts/setup.py" --check
```

- **Exit 0** — ready, proceed silently.
- **Exit 2 or 4** (missing ffmpeg/ffprobe) — Capture Mode still works (transcript
  only needs yt-dlp, not ffmpeg). Proceed for Capture Mode. Tell the user Watch Mode
  requires ffmpeg: `brew install ffmpeg`.
- **Exit 3 or 4** (no Whisper key) — YouTube captions are the primary source; Whisper
  is only the fallback. Proceed without flagging this unless captions are absent.

---

## Capture Mode (default for YouTube URLs)

Caption-first. Native YouTube captions are free and fast (2 seconds). Whisper API is
the fallback only when a video has no captions.

### Step 1 — Get transcript

```bash
python3 "${SKILL_DIR}/scripts/watch.py" "<url>" --detail transcript
```

This pulls native captions first via yt-dlp. If none exist, it falls back to Whisper
API (requires `GROQ_API_KEY` or `OPENAI_API_KEY` in `~/.config/watch/.env`). Output
is a timestamped transcript in the working directory.

### Step 2 — Extract all value

From the full transcript, pull out:
- Core framework or mental model (if any)
- Key processes or step-by-step methodologies
- Actionable insights and concrete tactics
- Quotable lines that capture the idea precisely
- Chapter structure (if described)
- Content type: framework, case study, tactic, opinion, tutorial

### Step 3 — Save to AI-OS

Create `projects/str-resources/YYYY-MM-DD_{slug}.md` with:
- Full framework breakdown
- Chapter map with timestamps
- Application table (how to use each insight)
- Critical analysis (what holds up, what needs context)

### Step 4 — Save to Notion Notes database

First fetch `collection://19ec6192-c266-8046-8e22-000ba054e4ea` to verify the
connector can access the Notes data source. If it returns `object_not_found` or is
not visible, do NOT create a standalone page. Continue the AI-OS save, then report:
"Notion Notes database is not accessible to this connector" with the data source ID.

If accessible, use `notion-create-pages` with data_source_id
`19ec6192-c266-8046-8e22-000ba054e4ea`:
- **Name**: video title, **Context Type**: Resource, **URL**: source URL
- **Description**: one sentence, **Key Insights**: top 4-5
- **Action Items**: concrete next steps, **Content Type**: Actionable or Reference
- **Date**: today, **Status**: Ready

### Step 5 — Save to client workspaces

- **A client** (`clients/{slug}/context/reference/`): if content relates to that
  client's methodology, service model, or positioning
- **Personal** (`clients/personal/context/resources.md`): always add a pointer entry

### Step 6 — Update learnings

Add a note to `context/learnings.md` under `## Resource Capture`: what the resource
was, key framework name, whether it changes any skill behavior.

---

## Channel Mode (@handle or "latest from X")

```bash
uv run "${SKILL_DIR}/scripts/digest.py" --channels "@handle" --hours 48 --max-videos 5
```

Needs `YOUTUBE_API_KEY` in the active environment or `~/.config/watch/.env`. Without
it: ask for a direct video URL.

---

## Watch Mode (URL + specific question)

For visual analysis of a specific moment or to answer a question with frames.
Requires ffmpeg (`brew install ffmpeg`).

### Step 1 — Run watch script

```bash
python3 "${SKILL_DIR}/scripts/watch.py" "<url>" [--detail balanced] [--start T] [--end T] [--max-frames N]
```

Detail options:
- `transcript` — captions only, no frames (fastest)
- `efficient` — keyframes, cap 50
- `balanced` — scene-aware frames, cap 100 (default)
- `token-burner` — scene-aware, uncapped

For a specific section: `--start MM:SS --end MM:SS`

### Step 2 — Read frames

Use parallel `Read` calls on all frame paths listed in the output. Frames are in
chronological order with `t=MM:SS` timestamps.

### Step 3 — Answer

Combine frames + transcript to answer with timestamp citations.

### Step 4 — Clean up

The script prints a working directory at the end. If no follow-ups expected:
`rm -rf <dir>`

---

## Transcription backends (priority order)

1. Native YouTube captions via yt-dlp — free, 2 seconds, preferred
2. Groq Whisper API — `GROQ_API_KEY` in `~/.config/watch/.env`
3. OpenAI Whisper API — `OPENAI_API_KEY` as fallback

Keys are stored in `~/.config/watch/.env`. Neither key is required when YouTube
captions are available (which they are for most YouTube videos).

---

## Failure modes

- **yt-dlp not found**: `pip3 install --user yt-dlp`
- **ffmpeg not found** (Watch Mode only): `brew install ffmpeg`
- **SABR blocked**: Android client arg is applied automatically in download.py
- **No captions + no Whisper key**: report this clearly. Add a Groq key to
  `~/.config/watch/.env` for Whisper fallback
- **No transcript, no audio**: recover from video description and metadata instead

---

## Rules

*Updated automatically when the user flags issues.*
