---
name: YouTube Newsletter
time: '09:00'
days: daily
active: 'false'
model: opus
timeout: 15m
notify: on_finish
description: >-
  Check @yourbrand for new videos and generate a newsletter from the
  transcript
---
You are running as a scheduled cron job for AI-OS.

## Task

Check the YouTube channel @yourbrand for any new video uploads. If a new video is found, generate a newsletter from the transcript and save it.

## Step 1: Check for New Videos

Run the YouTube digest script with the seen file to detect only new uploads:

```bash
uv run .claude/skills/tool-youtube/scripts/digest.py --channels "@yourbrand" --hours 48 --max-videos 3 --seen-file cron/status/youtube-newsletter-seen.txt
```

If the output shows no new videos, output `[SILENT]` and stop. No newsletter needed.

## Step 2: Get the Transcript

For each new video found, extract the full transcript:

```bash
python .claude/skills/tool-youtube/scripts/transcript.py "VIDEO_URL" --output-dir /tmp
```

Read the transcript file from /tmp.

## Step 3: Generate the Newsletter

Write a newsletter from the transcript following this structure:

1. **Opening hook** — one punchy paragraph that tells the reader why this video matters and whether it's worth their time. Direct, conversational, no fluff.
2. **What You'll Learn** — 4-6 bullet points covering the main takeaways. Each bullet should be specific enough to be useful on its own.
3. **Full Summary** — break the video into its logical sections (use H3 headings). Write each section as 1-2 paragraphs in the speaker's voice — not a dry recap, but the actual insights and examples they shared. Keep the energy of the original.
4. **Key Quotes** — 2-3 standout lines from the video, formatted as blockquotes. Pick lines that are punchy, quotable, and capture the video's core message.
5. **Watch link** — link to the full video at the end.

### Voice rules
- Write like the speaker talks — direct, practical, no corporate language
- Read `brand_context/voice-profile.md` for tone guidance
- Use "you" and "your" — this is for the reader
- No emojis, no clickbait, no "in this newsletter we explore..."
- Keep paragraphs short and scannable.

### Format
- Title: the video title (keep it as-is)
- Include the YouTube link at the top and bottom
- Use `---` horizontal rules to separate major sections

## Step 4: Save the Newsletter

Save to: `projects/mkt-content-repurposing/{today's date in YYYY-MM-DD}_newsletter_{video-title-slug}.md`

The video-title-slug should be lowercase, hyphens for spaces, no special characters. Keep it under 50 characters.

Create the folder if it doesn't exist.

## Step 5: Run Humanizer

After writing, run the output through `tool-humanizer` methodology to remove AI patterns. Use deep mode when `brand_context/voice-profile.md` exists, otherwise standard.

## Important

- Only process genuinely NEW videos (the --seen-file flag handles deduplication)
- The seen file at `cron/status/youtube-newsletter-seen.txt` is already seeded with existing video IDs
- If multiple new videos are found, generate a separate newsletter for each
- If no new videos: output [SILENT] and stop immediately
