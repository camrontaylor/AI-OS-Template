#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "numpy>=1.26.0", "scipy>=1.11.0"]
# ///
"""Generate a guide-line overlay on top of a reference image.

The overlay marks discrete reference points that a vision LLM can name when
reporting layout, instead of having to estimate raw bbox percentages from a
naked image (which produces hallucinated coordinates).

Overlay layers:
  - 10% canvas grid in faint gray (background ruler)
  - Coordinate ticks every 10% in left/top margins
  - Horizontal text bands detected via projection — top/bottom of each band
    drawn in red, labels H1, H2, H3... with the y-percent range
  - Element bounding boxes detected via connected components — drawn in cyan,
    labels E1, E2, E3... with [left, top, width, height] in percents

Then in Step 0 (vision analysis) the agent reads BOTH ref.png AND
_ref-guided.png and reports bbox by referring to band/element labels:
  "headline spans H2 to H4 → y=14% to y=22% → height=8%"
  "image-zone is E1 → bbox [10, 35, 80, 50]"

This makes the script deterministic on detection (where ink is) and the LLM
semantic on interpretation (what each region IS in the design).

Usage:
    uv run make_guide_overlay.py --ref path/to/ref.png --output path/to/_ref-guided.png
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage


def otsu_threshold(arr: np.ndarray) -> int:
    """Compute Otsu's threshold for a grayscale image array."""
    hist, _ = np.histogram(arr.ravel(), bins=256, range=(0, 255))
    total = arr.size
    sum_total = float(np.dot(np.arange(256), hist))
    sum_b = 0.0
    w_b = 0
    max_var = 0.0
    threshold = 0
    for t in range(256):
        w_b += int(hist[t])
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_total - sum_b) / w_f
        var_between = w_b * w_f * (m_b - m_f) ** 2
        if var_between > max_var:
            max_var = var_between
            threshold = t
    return threshold


def detect_text_bands(binary: np.ndarray, min_height_px: int, min_gap_px: int) -> list[tuple[int, int]]:
    """Detect horizontal text bands via row projection of ink mask.

    Returns list of (y_top, y_bottom) tuples.
    """
    proj = binary.sum(axis=1)
    # Adaptive activity threshold: rows with ink-pixel count above 5% of max.
    activity_floor = max(5, proj.max() * 0.05)
    active = proj > activity_floor

    bands: list[tuple[int, int]] = []
    in_band = False
    start = 0
    for i, a in enumerate(active):
        if a and not in_band:
            in_band = True
            start = i
        elif not a and in_band:
            in_band = False
            if i - start >= min_height_px:
                bands.append((start, i))
    if in_band:
        bands.append((start, len(active)))

    # Merge bands separated by small gaps (descenders, kerning artifacts)
    merged: list[tuple[int, int]] = []
    for band in bands:
        if merged and band[0] - merged[-1][1] < min_gap_px:
            merged[-1] = (merged[-1][0], band[1])
        else:
            merged.append(band)
    return merged


def detect_element_boxes(
    binary: np.ndarray,
    min_area_pct: float = 0.5,
    max_area_pct: float = 90.0,
    max_count: int = 10,
) -> list[tuple[int, int, int, int]]:
    """Detect significant element bounding boxes via connected components.

    Returns list of (x, y, w, h) in pixel coordinates, sorted by area descending.
    Filters out tiny noise and full-canvas components.
    """
    labels, n = ndimage.label(binary)
    if n == 0:
        return []

    total_area = binary.shape[0] * binary.shape[1]
    objects = ndimage.find_objects(labels)

    boxes: list[tuple[int, int, int, int]] = []
    for slc in objects:
        if slc is None:
            continue
        ys, xs = slc
        x0, x1 = xs.start, xs.stop
        y0, y1 = ys.start, ys.stop
        w = x1 - x0
        h = y1 - y0
        area_pct = (w * h) / total_area * 100
        if min_area_pct <= area_pct <= max_area_pct:
            boxes.append((int(x0), int(y0), int(w), int(h)))

    boxes.sort(key=lambda b: -(b[2] * b[3]))
    return boxes[:max_count]


def _load_font(px: int) -> ImageFont.ImageFont:
    """Best-effort font load — fall back to PIL default if no TTF available."""
    for name in ("arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size=px)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_overlay(ref_path: Path, output_path: Path) -> dict:
    img = Image.open(ref_path).convert("RGB")
    W, H = img.size
    gray = np.asarray(img.convert("L"))

    threshold = otsu_threshold(gray)
    # Polarity: if bg is light (median > 128), ink is darker than threshold; otherwise inverted.
    if np.median(gray) > 128:
        binary = gray < threshold
    else:
        binary = gray > threshold

    bands = detect_text_bands(
        binary,
        min_height_px=max(4, int(H * 0.005)),
        min_gap_px=max(3, int(H * 0.004)),
    )
    elements = detect_element_boxes(binary)

    overlay = img.copy()
    draw = ImageDraw.Draw(overlay, "RGBA")
    font = _load_font(max(14, H // 80))

    grid_color = (180, 180, 180, 120)
    band_color = (220, 60, 60, 220)
    band_fill = (220, 60, 60, 30)
    elem_color = (40, 140, 200, 220)
    tick_color = (110, 110, 110, 220)

    # 10% grid
    for i in range(1, 10):
        x = int(W * i / 10)
        draw.line([(x, 0), (x, H)], fill=grid_color, width=1)
        y = int(H * i / 10)
        draw.line([(0, y), (W, y)], fill=grid_color, width=1)

    # Element bounding boxes (drawn first so they sit under band lines)
    for i, (x, y, w, h) in enumerate(elements, 1):
        draw.rectangle([(x, y), (x + w, y + h)], outline=elem_color, width=2)
        x_pct = x / W * 100
        y_pct = y / H * 100
        w_pct = w / W * 100
        h_pct = h / H * 100
        label = f"E{i} [{x_pct:.0f}, {y_pct:.0f}, {w_pct:.0f}x{h_pct:.0f}]"
        draw.text((x + 4, y + 4), label, fill=elem_color, font=font)

    # Text band tops and bottoms
    for i, (y0, y1) in enumerate(bands, 1):
        draw.rectangle([(0, y0), (W, y1)], fill=band_fill)
        draw.line([(0, y0), (W, y0)], fill=band_color, width=2)
        draw.line([(0, y1), (W, y1)], fill=band_color, width=1)
        pct_top = y0 / H * 100
        pct_bot = y1 / H * 100
        label = f"H{i}  y={pct_top:.0f}%-{pct_bot:.0f}%  (h={pct_bot - pct_top:.0f}%)"
        draw.text((6, y0 + 3), label, fill=band_color, font=font)

    # Coordinate ticks every 10% in left + top margins
    for i in range(11):
        x = int(W * i / 10)
        draw.line([(x, 0), (x, 10)], fill=tick_color, width=1)
        if 0 < i < 10:
            draw.text((x + 2, 12), f"{i*10}%", fill=tick_color, font=font)
        y = int(H * i / 10)
        draw.line([(0, y), (10, y)], fill=tick_color, width=1)
        if 0 < i < 10:
            draw.text((12, y + 2), f"{i*10}%", fill=tick_color, font=font)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    overlay.save(output_path)

    return {
        "output": str(output_path),
        "canvas_px": (W, H),
        "text_bands": len(bands),
        "element_boxes": len(elements),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate guide-line overlay on a reference image.")
    ap.add_argument("--ref", required=True, type=Path, help="Reference image path")
    ap.add_argument("--output", required=True, type=Path, help="Output overlay path")
    args = ap.parse_args()

    ref = args.ref.resolve()
    if not ref.exists():
        print(f"Error: ref not found: {ref}", file=sys.stderr)
        return 1

    stats = draw_overlay(ref, args.output.resolve())
    print(f"[ok] {stats['output']}", file=sys.stderr)
    print(f"     canvas: {stats['canvas_px'][0]}x{stats['canvas_px'][1]}", file=sys.stderr)
    print(f"     text bands detected: {stats['text_bands']}", file=sys.stderr)
    print(f"     element boxes detected: {stats['element_boxes']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
