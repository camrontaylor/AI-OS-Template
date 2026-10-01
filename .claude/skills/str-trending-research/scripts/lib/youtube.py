"""YouTube as a keyless research source.

Uses the local ``yt-dlp`` binary, so there is no API key and no quota. Search
runs against YouTube's own results page with the "this month" upload filter
applied, which keeps every hit inside the research window without paying for a
metadata fetch per video. The top videos by view count then get their
auto-caption transcript pulled, because what was *said* in a video is the part
no other source carries.

Degrades to an empty list whenever yt-dlp is missing or slow: the caller
reports YouTube as unavailable rather than failing the run.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional

# YouTube's own "upload date: this month" search filter.
MONTH_FILTER = "EgQIBBAB"
SEARCH_URL = "https://www.youtube.com/results?search_query={query}&sp=" + MONTH_FILTER

DEPTH_CONFIG = {"quick": 6, "default": 12, "deep": 20}
TRANSCRIPT_LIMITS = {"quick": 1, "default": 2, "deep": 3}

SEARCH_TIMEOUT = 90
TRANSCRIPT_TIMEOUT = 60
TRANSCRIPT_CHARS = 4000


def _log(msg: str) -> None:
    sys.stderr.write(f"[YouTube] {msg}\n")
    sys.stderr.flush()


def available() -> bool:
    """True when the yt-dlp binary is on PATH."""
    return shutil.which("yt-dlp") is not None


def _run(args: List[str], timeout: int) -> Optional[str]:
    try:
        proc = subprocess.run(
            args, capture_output=True, timeout=timeout, text=True,
            encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired:
        _log(f"timeout after {timeout}s")
        return None
    except OSError as e:
        _log(f"yt-dlp not runnable: {e}")
        return None
    if proc.returncode != 0 and not proc.stdout:
        _log(f"yt-dlp exit {proc.returncode}")
        return None
    return proc.stdout


def search_youtube(topic: str, depth: str = "default") -> List[Dict[str, Any]]:
    """Search YouTube for videos uploaded this month. Never raises."""
    if not available():
        _log("yt-dlp not installed; skipping YouTube")
        return []

    count = DEPTH_CONFIG.get(depth, DEPTH_CONFIG["default"])
    from urllib.parse import quote_plus

    url = SEARCH_URL.format(query=quote_plus(topic))
    out = _run(
        [
            "yt-dlp", url, "--flat-playlist", "--dump-json", "--no-warnings",
            "--playlist-end", str(count),
        ],
        SEARCH_TIMEOUT,
    )
    if not out:
        return []

    items: List[Dict[str, Any]] = []
    for line in out.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        video_id = d.get("id")
        if not video_id:
            continue
        items.append({
            "id": video_id,
            "title": d.get("title") or "",
            "url": d.get("url") or f"https://www.youtube.com/watch?v={video_id}",
            "author": d.get("channel") or d.get("uploader") or "",
            "excerpt": (d.get("description") or "")[:400],
            "duration": d.get("duration"),
            "engagement": {"views": d.get("view_count")},
            "transcript": "",
            "why_relevant": "YouTube (this month)",
        })

    _log(f"Found {len(items)} videos")
    return items


def _parse_vtt(text: str) -> str:
    """Flatten a WebVTT caption file into deduplicated prose."""
    lines: List[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            continue
        if "-->" in line:
            continue
        line = re.sub(r"<[^>]+>", "", line)
        if not line:
            continue
        if lines and lines[-1] == line:
            continue
        lines.append(line)

    out: List[str] = []
    for line in lines:
        # Auto-captions repeat the previous line as a rolling window.
        if out and (line in out[-1] or out[-1].endswith(line)):
            continue
        out.append(line)
    return " ".join(out)


def fetch_transcript(video_url: str) -> str:
    """Fetch the auto-caption transcript for one video. Empty string on failure."""
    with tempfile.TemporaryDirectory() as tmp:
        template = os.path.join(tmp, "cap")
        _run(
            [
                "yt-dlp", video_url, "--skip-download", "--write-auto-sub",
                "--sub-lang", "en", "--sub-format", "vtt", "--no-warnings",
                "-o", template,
            ],
            TRANSCRIPT_TIMEOUT,
        )
        for name in os.listdir(tmp):
            if name.endswith(".vtt"):
                try:
                    raw = open(
                        os.path.join(tmp, name), encoding="utf-8", errors="replace"
                    ).read()
                except OSError:
                    return ""
                return _parse_vtt(raw)[:TRANSCRIPT_CHARS]
    return ""


def enrich_top_videos(
    items: List[Dict[str, Any]], depth: str = "default",
) -> List[Dict[str, Any]]:
    """Attach transcripts to the most-watched videos, under a bounded budget."""
    if not items:
        return items

    limit = TRANSCRIPT_LIMITS.get(depth, TRANSCRIPT_LIMITS["default"])
    order = sorted(
        range(len(items)),
        key=lambda i: (items[i].get("engagement") or {}).get("views") or 0,
        reverse=True,
    )[:limit]

    filled = 0
    for i in order:
        text = fetch_transcript(items[i]["url"])
        if text:
            items[i]["transcript"] = text
            filled += 1
    if filled:
        _log(f"Transcripts fetched for {filled} video(s)")
    return items


def search_and_enrich(topic: str, depth: str = "default") -> List[Dict[str, Any]]:
    """Full keyless YouTube pipeline: search this month, then transcribe the top."""
    items = search_youtube(topic, depth)
    if not items:
        return []
    items.sort(key=lambda d: (d.get("engagement") or {}).get("views") or 0, reverse=True)
    items = enrich_top_videos(items, depth)
    for i, item in enumerate(items):
        item["id"] = f"Y{i + 1}"
    return items
