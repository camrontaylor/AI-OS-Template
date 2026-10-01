#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "openai>=1.0.0",
#     "pillow>=10.0.0",
#     "python-dotenv>=1.0.0",
# ]
# ///
"""
Generate images using OpenAI's GPT Image API (gpt-image-1 / gpt-image-2).

Usage:
    uv run generate_image_gpt.py --prompt "your image description" --filename "output.png"

Image editing (up to 16 images):
    uv run generate_image_gpt.py --prompt "combine these" --filename "output.png" -i img1.png -i img2.png
"""

import argparse
import base64
import os
import sys
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

# Map the requested output format to the Pillow encoder name. The OpenAI API
# may return bytes encoded differently than requested (e.g. JPEG bytes for a
# PNG request), which would otherwise land on disk as a JPEG named `.png`
# (wrong mime for strict consumers). Re-encoding through Pillow guarantees the
# on-disk bytes match the file extension.
_PIL_FORMATS = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}


def _save_image_bytes(image_bytes: bytes, output_path: Path, output_format: str) -> None:
    """Write image bytes to disk, re-encoding so the file's bytes honestly
    match the requested format. Falls back to raw bytes only if Pillow or the
    decode fails (so a save still happens), but the normal path always
    produces a true PNG/JPEG/WEBP matching the extension."""
    pil_format = _PIL_FORMATS.get(output_format)
    try:
        from PIL import Image

        with Image.open(BytesIO(image_bytes)) as img:
            img.load()
            save_img = img
            # JPEG cannot hold alpha; flatten onto white if present.
            if pil_format == "JPEG" and save_img.mode in ("RGBA", "LA", "P"):
                rgba = save_img.convert("RGBA")
                flattened = Image.new("RGB", rgba.size, (255, 255, 255))
                flattened.paste(rgba, mask=rgba.split()[3])
                save_img = flattened
            save_img.save(str(output_path), format=pil_format or img.format)
        return
    except Exception as e:
        # Last resort: keep the raw bytes so we don't lose the generation,
        # but warn loudly because the on-disk format may not match the name.
        print(
            f"Warning: could not re-encode image to {output_format} "
            f"({e}); writing raw API bytes.",
            file=sys.stderr,
        )
        with open(str(output_path), "wb") as f:
            f.write(image_bytes)

SUPPORTED_SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"]
SUPPORTED_QUALITIES = ["low", "medium", "high", "auto"]
SUPPORTED_FORMATS = ["png", "jpeg", "webp"]
SUPPORTED_BACKGROUNDS = ["transparent", "opaque", "auto"]


def get_api_key(provided_key: str | None) -> str | None:
    """Get API key from argument first, then environment."""
    if provided_key:
        return provided_key
    return os.environ.get("OPENAI_API_KEY")


def _load_env() -> None:
    """Populate os.environ from the project's .env so API keys resolve even when
    the caller's shell (e.g. a sub-agent) didn't export them. Existing env vars win."""
    try:
        from dotenv import load_dotenv, find_dotenv
    except ImportError:
        return
    # Search upward from the current working directory first…
    load_dotenv(find_dotenv(usecwd=True))
    # …then walk up from this script to the project root and load its .env as a fallback.
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env"
        if candidate.is_file():
            load_dotenv(candidate)
            break


def main():
    _load_env()
    parser = argparse.ArgumentParser(
        description="Generate images using OpenAI GPT Image API"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="Image description/prompt"
    )
    parser.add_argument(
        "--filename", "-f",
        required=True,
        help="Output filename (e.g., output.png)"
    )
    parser.add_argument(
        "--input-image", "-i",
        action="append",
        dest="input_images",
        metavar="IMAGE",
        help="Input image path(s) for editing. Can be specified multiple times."
    )
    parser.add_argument(
        "--size", "-s",
        choices=SUPPORTED_SIZES,
        default="auto",
        help="Output size (default: auto)"
    )
    parser.add_argument(
        "--quality", "-q",
        choices=SUPPORTED_QUALITIES,
        default="high",
        help="Output quality (default: high)"
    )
    parser.add_argument(
        "--background", "-b",
        choices=SUPPORTED_BACKGROUNDS,
        default="auto",
        help="Background type (default: auto)"
    )
    parser.add_argument(
        "--format",
        choices=SUPPORTED_FORMATS,
        default="png",
        dest="output_format",
        help="Output format (default: png)"
    )
    parser.add_argument(
        "--model", "-m",
        default="gpt-image-2",
        help="Model to use (default: gpt-image-2 — best text rendering + multi-image consistency)"
    )
    parser.add_argument(
        "--api-key", "-k",
        help="OpenAI API key (overrides OPENAI_API_KEY env var)"
    )

    args = parser.parse_args()

    # Get API key
    api_key = get_api_key(args.api_key)
    if not api_key:
        print("Error: No API key provided.", file=sys.stderr)
        print("Please either:", file=sys.stderr)
        print("  1. Provide --api-key argument", file=sys.stderr)
        print("  2. Set OPENAI_API_KEY environment variable", file=sys.stderr)
        sys.exit(1)

    import openai

    client = openai.OpenAI(api_key=api_key)

    # Set up output path
    output_path = Path(args.filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Determine file extension for output
    ext = args.output_format
    if output_path.suffix.lower() not in (f".{ext}", ""):
        output_path = output_path.with_suffix(f".{ext}")

    # Handle image editing vs generation
    if args.input_images:
        # Image editing mode
        print(f"Editing {len(args.input_images)} image(s)...")

        # For editing, we use the edits endpoint
        image_files = []
        for img_path in args.input_images:
            if not Path(img_path).exists():
                print(f"Error: Input image not found: {img_path}", file=sys.stderr)
                sys.exit(1)
            image_files.append(open(img_path, "rb"))

        try:
            result = client.images.edit(
                model=args.model,
                image=image_files[0],
                prompt=args.prompt,
                size=args.size if args.size != "auto" else "1024x1024",
            )

            image_base64 = result.data[0].b64_json
            image_bytes = base64.b64decode(image_base64)

            _save_image_bytes(image_bytes, output_path, args.output_format)

        finally:
            for f in image_files:
                f.close()
    else:
        # Generation mode
        gen_kwargs = {
            "model": args.model,
            "prompt": args.prompt,
            "n": 1,
            "quality": args.quality,
            "output_format": args.output_format,
        }

        if args.size != "auto":
            gen_kwargs["size"] = args.size

        if args.background != "auto":
            gen_kwargs["background"] = args.background

        print(f"Generating image with {args.model}, quality={args.quality}, size={args.size}...")

        try:
            result = client.images.generate(**gen_kwargs)
        except Exception as e:
            print(f"Error generating image: {e}", file=sys.stderr)
            sys.exit(1)

        # Decode base64 response
        image_base64 = result.data[0].b64_json
        if not image_base64:
            print("Error: No image data in response.", file=sys.stderr)
            sys.exit(1)

        image_bytes = base64.b64decode(image_base64)

        _save_image_bytes(image_bytes, output_path, args.output_format)

    full_path = output_path.resolve()
    print(f"\nImage saved: {full_path}")
    print(f"MEDIA:{full_path}")

    # Save companion log file
    log_path = full_path.with_suffix(".log.md")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    mode = "editing" if args.input_images else "generation"
    input_note = ""
    if args.input_images:
        input_note = f"\n### Input Images\n" + "\n".join(
            f"- `{p}`" for p in args.input_images
        ) + "\n"

    log_content = f"""# Image Generation Log

## Generation Details

| Field | Value |
|-------|-------|
| **Timestamp** | {timestamp} |
| **Backend** | GPT Image ({args.model}) |
| **Mode** | {mode} |
| **Size** | {args.size} |
| **Quality** | {args.quality} |
| **Background** | {args.background} |
| **Format** | {args.output_format} |
| **Output** | `{full_path}` |
{input_note}
## Prompt

```
{args.prompt}
```

## Reasoning

<!-- Claude fills this section after generation -->
"""
    log_path.write_text(log_content, encoding="utf-8")
    print(f"Log saved: {log_path}")


if __name__ == "__main__":
    main()
