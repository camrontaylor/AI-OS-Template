#!/usr/bin/env python3
"""
Burn branded .ass captions onto a video using ffmpeg's native libass renderer.

Usage:
    python3 burn-captions.py <video.mp4> <captions.ass> <output.mp4> [--restyle]

Features:
- Splits HeyGen's multi-word subtitle chunks into 1-2 word segments
- Normalizes phonetic TTS forms back to written forms (e.g., "slash loop" → "/loop")
- Restyles with branded fonts/colors when --restyle is passed
- Burns using ffmpeg's native libass filter (high quality rendering)
"""
import sys
import os
import re
import subprocess
import shutil

BRANDED_STYLE = (
    "Style: Default,Roboto-Bold,18.0,&H00FFFFFF,&H000000FF,&H00F56E2E,"
    "&H80000000,1,0,0,0,100,100,0,0,3,3,0,2,10,10,30,1"
)

MAX_WORDS_PER_SEGMENT = 2

# Phonetic-to-written replacements for captions.
# HeyGen TTS needs spoken forms ("slash loop") but captions should show written forms ("/loop").
# Case-insensitive, applied per dialogue line. Order matters — longer patterns first.
NORMALIZATIONS = [
    # Symbols spelled out for TTS
    (r"\bslash\s+", "/"),
    (r"\bdot\s+com\b", ".com"),
    (r"\bdot\s+co\b", ".co"),
    (r"\bdot\s+io\b", ".io"),
    (r"\bdot\s+ai\b", ".ai"),
    (r"\bdot\s+org\b", ".org"),
    (r"\bdot\s+net\b", ".net"),
    (r"\bdot\s+md\b", ".md"),
    (r"\bdot\s+js\b", ".js"),
    (r"\bdot\s+py\b", ".py"),
    (r"\bhashtag\s+", "#"),
    (r"\bat sign\s+", "@"),
    (r"\bdollar sign\s+", "$"),
    (r"\bpercent\b", "%"),
    (r"\bampersand\b", "&"),
]


def normalize_text(text: str) -> str:
    """Convert phonetic/spoken forms back to written forms for display."""
    for pattern, replacement in NORMALIZATIONS:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text


def parse_ass_time(time_str: str) -> float:
    """Parse ASS time H:M:S.CS to seconds."""
    parts = time_str.strip().split(":")
    h = int(parts[0])
    m = int(parts[1])
    s = float(parts[2])
    return h * 3600 + m * 60 + s


def format_ass_time(seconds: float) -> str:
    """Format seconds to ASS time H:MM:SS.CC."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def split_dialogues(content: str) -> str:
    """Split multi-word dialogue lines into 1-2 word segments with proportional timing."""
    lines = content.splitlines()
    output_lines = []

    for line in lines:
        match = re.match(
            r"(Dialogue:\s*\d+),(\d+:\d+:\d+\.\d+),(\d+:\d+:\d+\.\d+),(.*?,.*?,\d+,\d+,\d+,.*?,)(.*)",
            line,
        )
        if not match:
            output_lines.append(line)
            continue

        prefix = match.group(1)
        start = parse_ass_time(match.group(2))
        end = parse_ass_time(match.group(3))
        style_part = match.group(4)
        text = match.group(5)

        # Clean up the text: remove \n and \N, collapse whitespace
        clean_text = text.replace("\\n", " ").replace("\\N", " ")
        clean_text = re.sub(r"\s+", " ", clean_text).strip()

        # Convert phonetic/spoken forms to written forms
        clean_text = normalize_text(clean_text)

        words = clean_text.split()
        if not words:
            output_lines.append(line)
            continue

        # If already 1-2 words, keep as-is
        if len(words) <= MAX_WORDS_PER_SEGMENT:
            new_text = " ".join(words)
            output_lines.append(
                f"{prefix},{format_ass_time(start)},{format_ass_time(end)},{style_part}{new_text}"
            )
            continue

        # Split into chunks of MAX_WORDS_PER_SEGMENT
        chunks = []
        for i in range(0, len(words), MAX_WORDS_PER_SEGMENT):
            chunk = " ".join(words[i : i + MAX_WORDS_PER_SEGMENT])
            chunks.append(chunk)

        # Distribute time proportionally by character count
        total_chars = sum(len(c) for c in chunks)
        duration = end - start
        current_time = start

        for chunk in chunks:
            char_ratio = len(chunk) / total_chars if total_chars > 0 else 1.0 / len(chunks)
            chunk_duration = duration * char_ratio
            chunk_end = min(current_time + chunk_duration, end)

            output_lines.append(
                f"{prefix},{format_ass_time(current_time)},{format_ass_time(chunk_end)},{style_part}{chunk}"
            )
            current_time = chunk_end

    return "\n".join(output_lines) + "\n"


def restyle_ass(content: str) -> str:
    """Replace the default style line with branded style."""
    return re.sub(
        r"^Style: Default,.*$",
        BRANDED_STYLE,
        content,
        count=1,
        flags=re.MULTILINE,
    )


def main():
    if len(sys.argv) < 4:
        print("Usage: python3 burn-captions.py <video.mp4> <captions.ass> <output.mp4> [--restyle]")
        sys.exit(1)

    video_path = sys.argv[1]
    ass_path = sys.argv[2]
    output_path = sys.argv[3]
    do_restyle = "--restyle" in sys.argv

    if not os.path.exists(video_path):
        print(f"Error: video not found: {video_path}")
        sys.exit(1)
    if not os.path.exists(ass_path):
        print(f"Error: subtitle file not found: {ass_path}")
        sys.exit(1)

    if not shutil.which("ffmpeg"):
        print("Error: ffmpeg not found. Run setup.sh first.")
        sys.exit(1)

    # Read and process the .ass file
    with open(ass_path, "r") as f:
        content = f.read()

    # Count original dialogues
    orig_count = content.count("Dialogue:")

    # Split into 1-2 word segments
    content = split_dialogues(content)

    new_count = content.count("Dialogue:")
    print(f"Split {orig_count} subtitle chunks → {new_count} segments (1-2 words each)")

    # Optionally restyle
    if do_restyle:
        content = restyle_ass(content)
        print("Applied branded style (Roboto-Bold, white text, brand blue outline)")

    # Write processed .ass to /tmp with a clean filename (avoids ffmpeg filter escaping issues)
    processed_ass = "/tmp/heygen_captions.ass"
    with open(processed_ass, "w") as f:
        f.write(content)

    # Burn captions using ffmpeg's native ass filter (libass)
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"ass=/tmp/heygen_captions.ass",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "copy",
        output_path,
    ]

    print(f"Burning captions onto video...")
    print(f"  Input: {video_path}")
    print(f"  Output: {output_path}")

    result = subprocess.run(cmd, capture_output=True, text=True)

    # Clean up
    if os.path.exists(processed_ass):
        os.remove(processed_ass)

    if result.returncode != 0:
        print(f"ffmpeg error:\n{result.stderr[-800:]}")
        sys.exit(1)

    output_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Done! Saved to {output_path} ({output_size:.1f}MB)")


if __name__ == "__main__":
    main()
