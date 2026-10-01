## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/tool-watch-video/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/tool-watch-video/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /tool-watch-video — Transcribe and analyze any video at the depth you choose

Replaces and broadens the prior `youtube-transcript` skill. YouTube is now one of many sources; depth is user-controlled.

<a id="step-1--parse-input"></a>
## Step 1 — Parse input

Accept:
- **YouTube**: full URL, `youtu.be/<id>`, `youtube.com/shorts/<id>`, raw 11-char ID
- **Loom**: `loom.com/share/<id>` or `loom.com/embed/<id>`
- **Vimeo**: `vimeo.com/<id>`
- **Riverside**: download URL or local file
- **Zoom**: local `.mp4` from a downloaded recording
- **X / IG / TikTok video**: URL — defers to `tool-social-fetch` for metadata, uses yt-dlp for the file
- **Local file**: any path to an `.mp4` / `.mov` / `.webm` / `.mkv`

Detect source from URL pattern or file extension. If ambiguous, ask.

<a id="step-2--parse-depth-mode"></a>
## Step 2 — Parse depth mode

| Invocation | Mode | What you get |
|---|---|---|
| `/tool-watch-video <url>` | **transcript** (default) | Clean text, metadata, optional chapters |
| `/tool-watch-video <url> transcript` | transcript | Same as default |
| `/tool-watch-video <url> visual` | visual | Transcript + frames at intervals + Claude vision pass identifying key moments |
| `/tool-watch-video <url> multimodal` | multimodal | Native video to Gemini (if `$GEMINI_API_KEY`), else dense Claude vision frame-by-frame |

If the depth isn't specified and the video is >10 minutes, ask before defaulting (visual/multimodal cost real money on long videos).

<a id="step-3--pull-metadata"></a>
## Step 3 — Pull metadata

For URL sources, use yt-dlp:

```bash
yt-dlp --print "%(title)s|%(uploader)s|%(duration_string)s|%(upload_date>%Y-%m-%d)s|%(description)s" \
  --print "%(chapters)j" --skip-download "<url>"
```

Capture: title, uploader/channel, duration, upload date, description (first paragraph), chapters (JSON or null).

For local files, use ffprobe:

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "<file>"
```

<a id="step-4--build-workdir"></a>
## Step 4 — Build workdir

```
projects/tool-watch-video/{YYYY-MM-DD}_{name}/
```

Where:
- `source`: `youtube` / `loom` / `vimeo` / `riverside` / `zoom` / `local`
- `slug`: kebab-case of title (first 4–6 words, max 50 chars)
- `date`: `YYYY-MM-DD`

<a id="step-5--get-the-transcript"></a>
## Step 5 — Get the transcript

**Backend selection** (in order):

1. **Platform-provided transcript** if it exists and looks complete:
   - YouTube: `yt-dlp --write-sub --write-auto-sub --skip-download --sub-lang en --sub-format vtt`
   - Loom: fetch via `https://www.loom.com/share/<id>` page metadata or Loom API if `$LOOM_API_KEY` set
   - Riverside: built-in transcripts available on the recording's share page
   - If platform transcript exists and has timestamps, use it. Skip Whisper.

2. **Local transcription** if an installed backend is available. Use `../scripts/transcribe.py` for MLX-Whisper; it writes valid returned JSON and text. MLX requires supported Apple Silicon. Another available Whisper backend or a supplied transcript is the fallback.

Download the video file first if it's a URL (use yt-dlp; Loom/Vimeo/YT all supported):

```bash
yt-dlp -f "bv*[height<=720]+ba/b[height<=720]" -o "<workdir>/video.%(ext)s" "<url>"
```

720p is plenty for transcription and frame analysis (smaller download, faster processing).

**Clean the transcript** (only needed for YouTube auto-subs which have rolling captions; Whisper output is already clean):

Use `../scripts/clean_vtt.py` for VTT subtitles; remove only overlapping rolling-caption text, preserving intentional repeated utterances.

Save final to `<workdir>/transcript.txt`.

<a id="step-6--if-transcript-mode-stop-here"></a>
## Step 6 — If `transcript` mode: stop here

Output:
- `transcript.txt`
- `metadata.json`
- One-line summary in chat: title, source, duration, word count
- Path to workdir
- (Optional) Step 9 — preserve the project source record

<a id="step-7--if-visual-mode-extract-frames--vision-pass"></a>
## Step 7 — If `visual` mode: extract frames + vision pass

<a id="frame-extraction-ffmpeg"></a>
### Frame extraction (ffmpeg)

Cadence by source heuristic:

| Source type | Frame cadence |
|---|---|
| Screen-share / Loom / demo | 1 frame per **5s** (UI changes fast) |
| Talking head / podcast | 1 frame per **30s** (slow change) |
| Slide presentation | 1 frame per **10s** + force a frame on each detected scene change |
| Default if unsure | 1 frame per **15s** |

```bash
mkdir -p "<workdir>/frames"
ffmpeg -i "<workdir>/video.mp4" -vf "fps=1/15" "<workdir>/frames/frame-%04d.png" -y
```

For scene-change detection (slide decks especially):

```bash
ffmpeg -i "<workdir>/video.mp4" -vf "select='gt(scene,0.3)',showinfo" -vsync vfr "<workdir>/frames/scene-%04d.png" 2> "<workdir>/scene-detection.log"
```

<a id="vision-pass"></a>
### Vision pass

Pair each frame with the transcript chunk for the same timestamp window. Then batch-send to Claude vision for synthesis.

**Per-frame batch prompt** (up to ~10 frames per call):

> Here are N frames from a video at timestamps T1..TN. For each frame, describe what's on screen in 1–2 sentences. Flag: (a) UI changes from previous frame, (b) text visible on screen, (c) any moment that looks like a decision, action, or notable event. Also note the transcript text spoken during this window.

Save the output as `<workdir>/moments.md`:

```markdown
# Key moments — <title>

<a id="000015-frame-001png"></a>
## 00:00:15 (frame-001.png)
**On screen**: Login form, email field focused
**Transcript**: "So you just open it up and..."
**Note**: Beginning of UI demo

<a id="000045-frame-002png"></a>
## 00:00:45 (frame-002.png)
**On screen**: Dashboard with 4 cards
**Transcript**: "And here's where you see all your projects."
**Note**: Major view change — first time the dashboard appears
```

<a id="generate-summary"></a>
### Generate summary

After moments are identified, synthesize the whole video into `<workdir>/summary.md`:

```markdown
# Summary — <title>

**Source:** <source URL / file>
**Duration:** <hh:mm:ss>
**Watched at:** <date>
**Mode:** visual

<a id="tldr"></a>
## TL;DR
<2–4 sentences>

<a id="key-moments"></a>
## Key moments
- 00:00:15 — <one-line>
- 00:00:45 — <one-line>

<a id="action-items-flagged"></a>
## Action items flagged
- <item> [timestamp]

<a id="decisions-flagged"></a>
## Decisions flagged
- <decision> [timestamp] — consider routing to /str-decide

<a id="quotes-worth-keeping"></a>
## Quotes worth keeping
- "..." [timestamp]

<a id="open-questions"></a>
## Open questions
- <question raised but not answered>
```

<a id="multimodal-observations"></a>
## Multimodal observations
- **Body language / delivery**: <observations on talking-head video>
- **Pacing**: <fast/slow/uneven>
- **Visual style**: <brand audit, ad review, design observations>
- **Audio quality / atmosphere**: <music, silence, background>
```

Exact extra sections depend on the use case (brand audit, ad review, talk delivery review, client-call read). Use case is inferred from the source + the user's verbal framing when invoking.

<a id="step-9--preserve-source-record"></a>
## Step 9 — Preserve source record

Save a concise source record beside the transcript and summary in the dated project folder: source URL or filename, date, summary, and relative links to the full transcript and any visual observations. Use `call-`, `meeting-`, `note-`, or `resource-` to describe the source. No separate vault or compilation skill is needed. On an explicit memory request, use `meta-memory-write` for a brief fact or report pointer only.

<a id="step-10--report"></a>
## Step 10 — Report

In chat:

- One-line headline: `<source> · <title> · <duration> · <mode> · <word count> words`
- Workdir path
- For `visual` / `multimodal`: brief list of top 3 key moments
- For all modes: any action items / decisions flagged for triage
- Path to the source record

<a id="sources-reference"></a>
## Sources reference

| Source | Download | Built-in transcript | Notes |
|---|---|---|---|
| YouTube | `yt-dlp` | Auto-subs (`--write-auto-sub`) | Same as the prior youtube-transcript skill |
| Loom | `yt-dlp` (Loom supported) | Yes — fetch via embed metadata or Loom API | Async screenshare focus — prime use case |
| Vimeo | `yt-dlp` | Sometimes | Marketing/embed videos |
| Riverside | Direct URL from export, or local file | Yes — Riverside generates them | Podcast episodes |
| Zoom | Local `.mp4` (downloaded recordings) | Sometimes (Zoom audio transcript file) | Client calls |
| X / IG / TikTok | Defer to `tool-social-fetch` for metadata, yt-dlp for file | No | Short-form |
| Local file | n/a | n/a | Drop a path |

<a id="composes-with"></a>
## Composes with

- `tool-social-fetch` — for X/IG/TikTok URL metadata (engagement, author, replies) before video processing
- `str-decide` — when a video contains a flagged decision, route to `/str-decide` for structured capture
- `ops-project-management` — action items flagged in summary can be triaged to project boards
- `viz-slide-deck` — talk recordings → outline extraction → deck draft (loop)
- `mkt-jab-hook` — quotes + clip-worthy moments from podcast/talk videos feed BIP/promo posts
- **`skillify from-video`** — primary use case for `visual` mode on process recordings. the user records themselves doing a workflow (Loom/screen-share), this skill extracts transcript + key visual moments, then `meta-skillify` synthesizes the workflow into a SKILL.md. "Record once, AI converts to skill."

<a id="error-handling"></a>
## Error handling

| Failure | Response |
|---|---|
| Video unavailable / private / region-locked | Report and stop |
| No subtitles + Whisper not installed | Tell the user: `pip install mlx-whisper` (Mac) |
| ffmpeg missing (for visual/multimodal) | Tell the user: `brew install ffmpeg` |
| Vision pass returns empty / unclear | Lower the frame count, retry, or fall back to transcript-only with a note |
| Multimodal requested but no `$GEMINI_API_KEY` and >30min video | Warn cost, offer to fall back to visual mode |
| `yt-dlp` binary missing | `brew install yt-dlp` |

<a id="notes-on-quality"></a>
## Notes on quality

- **User picks depth, not the skill.** Transcript / visual / multimodal are 3 different cost + latency profiles. Long videos (>10 min) always confirm before spending on visual/multimodal.
- **Platform transcript first, Whisper second.** YouTube auto-subs, Loom transcripts, Riverside built-in transcripts — all free + instant when they exist. Fall back to MLX-Whisper local only when nothing platform-provided works.
- **MLX-Whisper local is the fast path on Mac.** M-series machines transcribe faster than real-time. Cloud Whisper is a distant second choice — costs money, network dependency, worse latency on typical durations.
- **Frame cadence by source type.** Screen-share / demos need 1 frame per 5s (UI changes fast); talking-head podcasts need 1 per 30s (slow change). Default 15s if unsure. Wrong cadence = missed key moments OR wasted vision-pass cost.
- **720p is plenty.** Downloading 1080p / 4K for transcription + frame analysis wastes bandwidth + storage. `yt-dlp -f "bv*[height<=720]+ba/b[height<=720]"` is the default.
- **Scene-change detection catches slide transitions.** When the video is a slide presentation, add `ffmpeg -vf "select='gt(scene,0.3)'"` to force a frame on each detected slide change — more reliable than pure time-based sampling.
- **Multimodal cost warning is non-optional.** Gemini multimodal on a 60-min video is meaningfully expensive. Warn before running; offer transcript-only as fallback if the user isn't sure.
- **Summary format includes routing hints.** `## Decisions flagged` + `## Action items flagged` sections signal `/str-decide` and `/ops-project-management` follow-ups. Downstream composability lives in the summary structure.

<a id="multimodal-backend"></a>
## Multimodal backend

Use an explicitly configured supported provider or available dense frame analysis. Verify current official model and upload documentation. Avoid hardcoded pricing/model claims; polling must have a timeout and recognize failed processing. Local transcript/frames are the fallback.
