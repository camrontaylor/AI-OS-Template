# HeyGen API Reference

## Authentication

All requests use `X-Api-Key` header with `HEYGEN_API_KEY` env var.

```
Base URL: https://api.heygen.com
Header: X-Api-Key: $HEYGEN_API_KEY
Response format: { "error": null | string, "data": T }
```

## MCP Tools (Preferred)

When HeyGen MCP is connected, prefer these over direct API calls:

| Function | MCP Tool |
|----------|----------|
| Prompt-to-video | `mcp__heygen__generate_video_agent` |
| Get video status/URL | `mcp__heygen__get_video` |
| List videos | `mcp__heygen__list_videos` |
| Delete video | `mcp__heygen__delete_video` |
| Text-to-speech | `mcp__heygen__text_to_speech` |
| List voices | `mcp__heygen__list_audio_voices` / `mcp__heygen__get_voices` |
| List avatars | `mcp__heygen__get_avatars_in_avatar_group` |
| Generate avatar video | `mcp__heygen__generate_avatar_video` |
| Check credits | `mcp__heygen__get_remaining_credits` |

## Direct API Endpoints

### List Avatars

```bash
GET /v2/avatars
```

Returns avatar_id, name, gender, preview_image_url, preview_video_url.

### Avatar Details (with default voice)

```bash
GET /v2/avatar/{avatar_id}/details
```

Returns `default_voice_id` — optimized for that avatar's lip sync.

### List Voices

```bash
GET /v2/voices
```

Returns voice_id, name, language, gender, preview_audio_url. Filter for ElevenLabs voices by checking the source/provider field.

### Check Credits

```bash
GET /v2/user/remaining_quota
```

Returns `remaining_quota` and `used_quota`. ~1 credit/min at 720p, ~1.5x at 1080p.

### Video Agent (One-Shot)

```bash
POST /v1/video_agent/generate
{
  "prompt": "...",          // Required — structured prompt
  "duration_sec": 60,       // 5-300
  "avatar_id": "...",       // Lock specific avatar
  "orientation": "portrait" // portrait | landscape
}
```

Returns `video_id`. Poll for completion.

### Precise Video Generation

```bash
POST /v2/video/generate
{
  "video_inputs": [
    {
      "character": {
        "type": "avatar",
        "avatar_id": "...",
        "avatar_style": "normal"  // normal | closeUp | circle | voice_only
      },
      "voice": {
        "type": "text",
        "input_text": "Script here...",
        "voice_id": "...",
        "speed": 1.0,    // 0.5–1.5
        "pitch": 0,       // -50 to +50
        "emotion": "Friendly",  // Excited | Friendly | Serious | Soothing | Broadcaster
        "elevenlabs_settings": {  // optional — for ElevenLabs cloned voices
          "stability": 0.3,       // 0-1, lower = more expressive
          "similarity_boost": 0.75, // 0-1, higher = closer to original voice
          "style": 0.7            // 0-1, higher = more stylistic variation
        }
      },
      "background": {
        "type": "color",
        "value": "#FFFFFF"
      }
    }
  ],
  "dimension": { "width": 1080, "height": 1920 },
  "caption": true,
  "title": "Video Title",
  "test": false
}
```

Avatar styles: `normal` (full body), `closeUp` (face focus), `circle` (talking head PIP), `voice_only` (audio only).

### Video Status Polling

```bash
GET /v1/video_status.get?video_id=YOUR_VIDEO_ID
```

Statuses: `pending` → `processing` → `completed` | `failed`

- Poll every 10 seconds
- Typical generation: 5-15 minutes
- Set timeout: 20 minutes
- On `completed`: response includes `video_url`, `thumbnail_url`, `duration`

### Multi-Scene Videos

Add multiple objects to `video_inputs` array. Each scene can have:
- Different script text
- Different background
- Same or different avatar style
- Max 50 scenes per request

## Background Options

```json
// Solid color
{ "type": "color", "value": "#1a1a2e" }

// Image
{ "type": "image", "url": "https://...", "fit": "cover" }

// Video (loops, audio muted)
{ "type": "video", "url": "https://..." }
```

## Caption Configuration

The API `caption` field is **boolean only** — no styling options:
```json
{ "caption": true }
```

For branded captions: set `"caption": false`, download the `.ass` subtitle file from `caption_url` in the status response, restyle it, and burn with ffmpeg. See `scripts/burn-captions.py`.

## Test Mode

Set `"test": true` to generate without consuming credits. Output has watermark but validates your config works.

## Voice Options

Beyond TTS, you can use pre-recorded audio:
```json
{
  "voice": {
    "type": "audio",
    "audio_url": "https://..."
  }
}
```

Or silence between scenes:
```json
{
  "voice": {
    "type": "silence",
    "duration": 2.0
  }
}
```

## SSML Break Tags

For natural pauses in TTS:
```
Hello everyone! <break time="0.5s"/> Welcome to today's video.
<break time="1s"/>
Let me show you something cool.
```

- 0.5-1s after greetings
- 1-1.5s for section transitions
- 1.5-2s for dramatic tension
