#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "numpy>=1.26.0"]
# ///
"""Compare ref.png against preview.png in multiple modes.

Modes:
  side-by-side  — two panels with labels (default)
  overlay       — 50/50 alpha blend; size/position mismatches jump out instantly
  diff          — pixel difference heat-map (red = high diff, transparent = match)
  grid          — overlay a cqw ruler grid on both panels (lines at 5/10/20/30/...%)

All modes normalize both images to the same canvas size before composing, so
size comparisons are valid even if ref and preview have different source dims.

Usage:

    uv run compare_ref_to_preview.py \\
        --ref brand_context/visual_refs/<ref-name>.png \\
        --preview brand_context/templates/<pool>/<slug>/preview.png \\
        --output _comparison.png \\
        --mode overlay              # or: side-by-side | diff | grid

You can combine grid with any mode via --with-grid.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import numpy as np


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def normalize(ref: Image.Image, preview: Image.Image, canvas_w: int, canvas_h: int) -> tuple[Image.Image, Image.Image]:
    """Scale both images to the same canvas (canvas_w × canvas_h)."""
    return (
        ref.resize((canvas_w, canvas_h), Image.LANCZOS),
        preview.resize((canvas_w, canvas_h), Image.LANCZOS),
    )


def draw_grid(img: Image.Image, percentages: list[int] = None) -> Image.Image:
    """Draw cqw ruler grid (horizontal + vertical lines at given % positions)."""
    if percentages is None:
        percentages = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95]
    out = img.convert("RGBA")
    overlay = Image.new("RGBA", out.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    w, h = out.size
    font = load_font(20)
    for p in percentages:
        x = int(w * p / 100)
        y = int(h * p / 100)
        # vertical
        draw.line([(x, 0), (x, h)], fill=(0, 200, 255, 100), width=1)
        draw.text((x + 4, 4), f"{p}%", fill=(0, 200, 255, 200), font=font)
        # horizontal
        draw.line([(0, y), (w, y)], fill=(0, 200, 255, 100), width=1)
        draw.text((4, y + 2), f"{p}%", fill=(0, 200, 255, 200), font=font)
    return Image.alpha_composite(out, overlay).convert("RGB")


def make_side_by_side(ref: Image.Image, preview: Image.Image, label_ref: str, label_preview: str, gap: int) -> Image.Image:
    """Original behavior: panels side by side with labels."""
    label_h = 60
    w = ref.width + gap + preview.width
    h = ref.height + label_h + 20
    canvas = Image.new("RGB", (w, h), (245, 245, 245))
    draw = ImageDraw.Draw(canvas)
    font = load_font(36)
    draw.text((ref.width // 2, label_h // 2), label_ref, fill=(40, 40, 40), font=font, anchor="mm")
    draw.text((ref.width + gap + preview.width // 2, label_h // 2), label_preview, fill=(40, 40, 40), font=font, anchor="mm")
    canvas.paste(ref, (0, label_h))
    canvas.paste(preview, (ref.width + gap, label_h))
    line_x = ref.width + gap // 2
    draw.line([(line_x, label_h), (line_x, label_h + ref.height)], fill=(200, 200, 200), width=2)
    return canvas


def make_overlay(ref: Image.Image, preview: Image.Image, alpha: float = 0.5) -> Image.Image:
    """Alpha blend: 50/50 by default. Misalignment / size diffs are instantly visible."""
    ref_rgba = ref.convert("RGBA")
    prev_rgba = preview.convert("RGBA")
    return Image.blend(ref_rgba, prev_rgba, alpha).convert("RGB")


def make_diff(ref: Image.Image, preview: Image.Image) -> Image.Image:
    """Heat-map: red intensity = how different each pixel is between ref and preview.

    Where they match (background, same elements at same position) shows the ref image
    desaturated. Where they differ (text in wrong place, size mismatch) shows red."""
    a = np.array(ref.convert("RGB"), dtype=np.int16)
    b = np.array(preview.convert("RGB"), dtype=np.int16)
    diff = np.abs(a - b).sum(axis=2)            # 0 = identical, max = ~765 (255×3)
    intensity = np.clip(diff / 3, 0, 255).astype(np.uint8)  # normalize to 0-255

    # Build a desaturated grayscale of ref as base
    gray = np.array(ref.convert("L"), dtype=np.uint8)
    base = np.stack([gray, gray, gray], axis=2).astype(np.int16) // 2 + 100  # very faded
    # Overlay red where intensity > threshold
    red = np.zeros_like(base)
    red[..., 0] = intensity                     # R channel
    threshold = 30                              # ignore tiny pixel noise
    mask = (intensity > threshold)[..., None]
    result = np.where(mask, np.clip(base + red, 0, 255), base).astype(np.uint8)
    return Image.fromarray(result, mode="RGB")


def main() -> int:
    ap = argparse.ArgumentParser(description="Compare ref vs preview — multiple modes.")
    ap.add_argument("--ref", required=True, type=Path)
    ap.add_argument("--preview", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--mode", choices=["side-by-side", "overlay", "diff", "grid"], default="side-by-side")
    ap.add_argument("--with-grid", action="store_true", help="Overlay cqw ruler grid on the result.")
    ap.add_argument("--canvas", type=int, nargs=2, default=[1080, 1350], help="Normalize both images to this canvas (default 1080 1350).")
    ap.add_argument("--gap", type=int, default=40, help="Pixel gap between panels in side-by-side mode.")
    ap.add_argument("--label-ref", default="REF")
    ap.add_argument("--label-preview", default="PREVIEW")
    ap.add_argument("--alpha", type=float, default=0.5, help="Blend alpha for overlay mode (0 = pure ref, 1 = pure preview).")
    args = ap.parse_args()

    if not args.ref.exists() or not args.preview.exists():
        print("Error: ref or preview not found", file=sys.stderr)
        return 1

    ref = Image.open(args.ref).convert("RGB")
    preview = Image.open(args.preview).convert("RGB")
    cw, ch = args.canvas
    ref, preview = normalize(ref, preview, cw, ch)

    if args.mode == "side-by-side":
        out = make_side_by_side(ref, preview, args.label_ref, args.label_preview, args.gap)
    elif args.mode == "overlay":
        out = make_overlay(ref, preview, args.alpha)
    elif args.mode == "diff":
        out = make_diff(ref, preview)
    elif args.mode == "grid":
        # Pure grid mode: side-by-side with grids on both
        ref_grid = draw_grid(ref)
        prev_grid = draw_grid(preview)
        out = make_side_by_side(ref_grid, prev_grid, args.label_ref, args.label_preview, args.gap)

    if args.with_grid and args.mode != "grid":
        out = draw_grid(out)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.output, format="PNG", optimize=True)
    print(f"Wrote ({args.mode}): {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
