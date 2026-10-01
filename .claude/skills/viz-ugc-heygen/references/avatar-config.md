# Avatar & Voice Configuration

## Voice

| Name | Voice ID | Source |
|------|----------|--------|
| Your Voice Name | `your-voice-id` | ElevenLabs clone |

## Avatar Group

- **Group ID:** `your-group-id`
- **Name:** Your Name

## Looks

| # | Name | Avatar ID |
|---|------|-----------|
| 1 | Look 1 | `avatar-id-1` |
| 2 | Look 2 | `avatar-id-2` |
| 3 | Look 3 | `avatar-id-3` |

## Voice Defaults

- **Speed:** 1.2 (slightly faster, more natural energy)
- **Pitch:** 0 (neutral)
- **Emotion:** Friendly (options: Excited, Friendly, Serious, Soothing, Broadcaster)

## ElevenLabs Settings

These fine-tune the cloned voice quality. Lower stability = more expressive, higher = more consistent but robotic.

- **stability:** 0.3 (more expressive — confirmed better than default in testing)
- **similarity_boost:** 0.75 (high voice match)
- **style:** 0.7 (more stylistic variation — confirmed better than default in testing)

Include in API request as:
```json
"elevenlabs_settings": {
    "stability": 0.3,
    "similarity_boost": 0.75,
    "style": 0.7
}
```

## Video Defaults

- **Captions:** Always enabled — but use branded captions (see below), NOT HeyGen's default
- **Download:** Always download the **non-captioned** MP4 (`video_url`) + the `.ass` subtitle file (`caption_url`)
- **Brand captions:** Restyle the `.ass` file with brand fonts/colors, then burn onto video with ffmpeg
- **Save video file:** Final branded MP4 to `projects/viz-ugc-heygen/` alongside the metadata .md file
- **File naming:** `{YYYY-MM-DD}_{topic-slug}.mp4` (matches the .md file)
- **Signed URLs expire** — always download immediately after generation completes

## Branded Caption Template

The `.ass` subtitle format uses this style line. Replace the `Style: Default,...` line in HeyGen's `.ass` file with this branded version:

```
Style: Default,Roboto-Bold,18.0,&H00FFFFFF,&H000000FF,&H00F56E2E,&H80000000,1,0,0,0,100,100,0,0,3,3,0,2,10,10,30,1
```

**What each field means (in order):**

| Field | Value | Why |
|-------|-------|-----|
| Name | Default | Style name |
| Fontname | Roboto-Bold | Brand font (bold for readability) |
| Fontsize | 18.0 | Larger than HeyGen default (12) for mobile |
| PrimaryColour | &H00FFFFFF | White text |
| SecondaryColour | &H000000FF | Red secondary (unused) |
| OutlineColour | &H00F56E2E | Brand blue #2E6EF5 as outline (BGR format) |
| BackColour | &H80000000 | Semi-transparent black shadow |
| Bold | 1 | Bold on |
| Italic | 0 | No italic |
| Underline | 0 | No underline |
| StrikeOut | 0 | No strikeout |
| ScaleX | 100 | Full width |
| ScaleY | 100 | Full height |
| Spacing | 0 | Default letter spacing |
| Angle | 0 | No rotation |
| BorderStyle | 3 | Opaque box background |
| Outline | 3 | 3px outline |
| Shadow | 0 | No shadow offset |
| Alignment | 2 | Bottom center |
| MarginL | 10 | Left margin |
| MarginR | 10 | Right margin |
| MarginV | 30 | Bottom margin (above mobile UI) |
| Encoding | 1 | Default encoding |

**ASS color format:** `&HAABBGGRR` (alpha, blue, green, red — reversed from hex)
- Brand blue `#2E6EF5` → `&H00F56E2E`
- Brand gold `#F8D481` → `&H0081D4F8`
- White `#FFFFFF` → `&H00FFFFFF`

**To switch to gold outline:** replace `&H00F56E2E` with `&H0081D4F8` in OutlineColour

## Avatar Defaults

- **Default look:** 1
- **Default style:** normal
- **Rotation:** Cycle through looks sequentially per video
- **Rotation tracking:** Check the most recent file in `projects/viz-ugc-heygen/` for last look used
