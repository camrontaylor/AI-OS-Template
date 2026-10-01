---
name: tool-watch-video
description: >
  Extract transcripts and optional visual observations from supplied video URLs or local recordings. Use for "transcribe this video", "watch this recording", "key moments", or "analyze this demo". Modes are transcript, visual, and multimodal. Prefers platform transcripts, supports checked local tools, and saves dated transcript, metadata, and moments. Does not assume a cloud key or model and does not fetch private material without access.
---

# Watch Video

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

Dated transcript text, structured metadata, and requested timestamped moments/summary.
Save deliverables to `projects/tool-watch-video/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## tool-watch-video` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/tool-watch-video/` | Relevant files if present | User-owned settings |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `tool-social-fetch` | Optional | Fetch social-video metadata | Use video metadata or supplied text |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/tool-watch-video/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Parse input and depth

Accept supported public URLs or local video/audio paths. Choose transcript by default; visual adds frames, multimodal requires a configured supported backend. Establish duration and requested coverage. Do not increase depth or incur unapproved cloud spend automatically.
Read [the detailed method](references/methodology.md#step-2--parse-depth-mode) for this step’s mechanics and output shape.

## Step 3: Get metadata and the best transcript

Use available platform subtitles first. Check yt-dlp, ffprobe, and local transcription backends via scripts/setup.sh. For Apple Silicon MLX-Whisper, scripts/transcribe.py serializes the returned object as real JSON and writes transcript text. Pass media path, dated output directory, and explicit `--date YYYY-MM-DD` in the user’s timezone. Otherwise use an available whisper backend or ask for a supplied transcript. Keep repeated utterances; only remove rolling-caption duplication.
Read [the detailed method](references/methodology.md#step-5--get-the-transcript) for this step’s mechanics and output shape.

## Step 4: Analyze visual moments when requested

Use 720p where adequate. Extract screen demos about every 5 seconds, talks 30 seconds, slides 10 seconds plus scene changes, or 15 seconds as a default. Pair observed frames with matching transcript windows. Use actual available image-inspection capabilities; distinguish observation from inference. Dense multimodal sampling is optional and bounded.
Read [the detailed method](references/methodology.md#step-7--if-visual-mode-extract-frames--vision-pass) for this step’s mechanics and output shape.

## Step 5: Synthesize and route useful outcomes

Write timestamped moments and a summary with source, duration, coverage, takeaways, action items, decisions, quotes, and gaps. Native-video cloud ingestion requires explicit access and use authorization, current provider docs, bounded polling, and a configured model. Local frames/transcript are the fallback. Offer personal/company knowledge capture without sending or publishing.
Read [the detailed method](references/methodology.md#step-9--preserve-source-record) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/tool-watch-video/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## tool-watch-video` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- A transcript is not evidence of visual details; label actual coverage.
- Use supplied local media when the runtime disallows downloading remote media.
- Never hardcode unverified model availability, pricing, or benchmark claims.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## tool-watch-video` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing binary: resolve `scripts/setup.sh` inside this installed skill package and run it only for the required missing tools; inspect its result before proceeding.
- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
