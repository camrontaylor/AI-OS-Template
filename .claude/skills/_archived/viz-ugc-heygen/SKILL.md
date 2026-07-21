---
name: viz-ugc-heygen
description: >
  Create UGC-style avatar videos via HeyGen API. Use when: "create a video",
  "UGC video", "heygen video", "talking head video", "avatar video", "make a
  video about", "video script", "generate video". Two modes: Video Agent
  (prompt-driven, one-shot) and Precise (exact script, specific avatar look,
  specific voice). Loads brand voice for script writing. Polls for completion
  and returns download URL. Does NOT trigger for video editing, translation,
  dubbing, or live streaming.
allowed_tools:
  - mcp__heygen__*
  - WebFetch
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# viz-ugc-heygen — UGC Avatar Video Creation

Create talking-head UGC videos using HeyGen's cloned avatars and custom voices.

## Outcome

A generated MP4 video with branded captions, saved to `projects/viz-ugc-heygen/{YYYY-MM-DD}_{topic-slug}.mp4`, alongside a metadata file with the script, settings, and video URL. Always save output to disk. This is not optional.

## Context Needs

| Context | Usage |
|---------|-------|
| `voice-profile` | Full — script writing matches brand voice |
| `samples` | Tone refs — natural speech patterns |
| `icp` | Language section — speak to the right audience |
| `learnings` | `## viz-ugc-heygen` |

## Dependencies

| Skill | Required? | What it provides | Without it |
|-------|-----------|-----------------|------------|
| `tool-humanizer` | Optional | De-AI scripts before video gen | Scripts may sound robotic |

## Step 0: Auto-Setup & Preflight

1. Run `bash .claude/skills/viz-ugc-heygen/scripts/setup.sh` to ensure ffmpeg (with libass) is installed. Skip if already verified this session.
2. Check `HEYGEN_API_KEY` is available. If missing, tell the user:
   - "HeyGen API key needed for video generation"
   - Get it from https://app.heygen.com/settings?nav=API
   - Add to `.env` as `HEYGEN_API_KEY=your-key`
   - Stop here if no key.
3. Check HeyGen MCP tools are available (`mcp__heygen__*`). If not, fall back to direct API via WebFetch.
4. Read `context/learnings.md` → `## viz-ugc-heygen` section.
5. Load brand context per the Context Needs table above.

## Step 1: Understand the Brief

Ask (max 2 questions):
- **What's the video about?** Topic, key message, CTA
- **Where will it go?** Platform determines dimensions and duration

Auto-detect from context:
- Duration (default: 30-60s for social, 60-120s for YouTube)
- Orientation (portrait for TikTok/Reels/Shorts, landscape for YouTube/LinkedIn)
- Avatar look (if user has a preferred default, use it)

## Step 2: Select Avatar & Voice

1. **Read config** — load `references/avatar-config.md` for stored avatar looks, voice ID, default look, and rotation rules
2. **Look rotation** — if config has a look rotation list:
   - Check which look was used last (from the most recent file in `projects/viz-ugc-heygen/`)
   - Auto-select the next look in rotation
   - Tell the user which look was picked and why ("Rotating to Look 2 — {look name}")
   - User can override: "use look 3 instead" or "use the default"
3. **If no config** — fall back to discovery:
   - Call `mcp__heygen__get_avatar_groups` then `mcp__heygen__get_avatars_in_avatar_group` with group_id
   - Show available looks with preview image URLs
   - User picks a look
4. **Voice** — use stored voice ID from config, or discover via `mcp__heygen__get_voices`
5. Confirm avatar look + voice pairing

## Step 3: Write the Script

Follow `references/scripting-guide.md`:
- Write conversationally — 150 words/min at 1.0x speed
- Short sentences (10-20 words), contractions, no jargon
- Add `<break time="Xs"/>` for natural pauses
- Match brand voice from `voice-profile.md`
- Hook in first 3 seconds, CTA at end
- Show word count and estimated duration

Run through `tool-humanizer` (pipeline mode) if available.

Present script to user for approval before generating.

## Step 4: Choose Generation Mode

**Video Agent mode** (default for simple videos):
- Single avatar, straightforward delivery
- Call `mcp__heygen__generate_video_agent` with optimized prompt
- See `references/prompt-optimizer.md` for prompt structure

**Precise mode** (for exact control):
- Multi-scene, specific timing, custom backgrounds
- Build request body per `references/api-reference.md`
- Call `POST /v2/video/generate` via WebFetch or MCP

## Step 5: Configure & Generate

Based on platform from Step 1, set dimensions (see `references/platform-formats.md`):
- YouTube/LinkedIn: 1920x1080 (16:9)
- TikTok/Reels/Shorts: 1080x1920 (9:16)
- Instagram Feed: 1080x1080 (1:1)

Required (always set per `references/avatar-config.md`):
- Captions: **disabled** in API (`"caption": false`) — we burn branded captions with ffmpeg in Step 6
- Voice speed: from config defaults (e.g., 1.2)
- Voice pitch: from config defaults (e.g., 0)
- Voice emotion: from config defaults (e.g., "Friendly")
- ElevenLabs settings: from config defaults (stability, similarity_boost, style)

Optional enhancements:
- Background (color, image URL, or video URL)
- Test mode first if user wants to preview without burning credits

## Step 6: Poll & Deliver

1. Save `video_id` immediately
2. Poll status every 30s via `GET /v1/video_status.get` (use python3 urllib with API key from `.mcp.json`). Run polling in background.
3. On completion:
   - **Download the non-captioned MP4** (`video_url`) to `projects/viz-ugc-heygen/raw.mp4` — signed URLs expire
   - **Download the `.ass` subtitle file** (`caption_url`) to `projects/viz-ugc-heygen/captions.ass`
   - **Burn branded captions** onto the video using ffmpeg + libass:
     ```
     python3 .claude/skills/viz-ugc-heygen/scripts/burn-captions.py raw.mp4 captions.ass output.mp4 --restyle
     ```
     The `--restyle` flag auto-applies branded styles (Roboto-Bold, white text, brand blue outline) from `references/avatar-config.md`.
   - Save final MP4 to `projects/viz-ugc-heygen/{YYYY-MM-DD}_{topic-slug}.mp4`
   - Clean up intermediate files (raw.mp4, captions.ass)
   - Auto-open the final MP4: `open projects/viz-ugc-heygen/{YYYY-MM-DD}_{topic-slug}.mp4`
   - Show file path and duration to user
4. On failure: show error, suggest fixes

## Step 7: Save & Collect Feedback

1. Save video metadata to `projects/viz-ugc-heygen/`:
   - `{YYYY-MM-DD}_{topic-slug}.md` with: script, video URL, thumbnail, settings used, platform
2. Ask: "How did this land? Any adjustments for next time?"
3. Log feedback to `context/learnings.md` → `## viz-ugc-heygen`
   - Preferred avatar look, voice settings, script style notes

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user flags an issue — wrong avatar, bad pacing, script tone off — update the `## Rules` section immediately with the correction and today's date.

---

## Troubleshooting

- **No HeyGen API key**: This skill cannot fall back — video generation requires the API key and HeyGen plan credits.
- **MCP tools not available**: Fall back to direct API calls via WebFetch with the API key from `.env`.
- **Video generation fails**: Check credit balance with `mcp__heygen__get_remaining_credits`. Common issues: script too long, invalid avatar ID, dimension mismatch.
- **Captions look wrong**: Check the `.ass` style line matches `references/avatar-config.md`. Re-run `burn-captions.py` after fixing.
- **Signed URL expired**: Re-poll the video status to get a fresh download URL.
