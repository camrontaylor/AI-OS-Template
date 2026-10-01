#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "numpy>=1.26.0"]
# ///
"""Detect text rows in a PNG and report their heights in pixels AND cqw.

Works on any high-contrast text-on-solid-bg image (e.g., coral-numbered slide).
Uses horizontal projection: for each row, count pixels above a brightness threshold;
contiguous runs of high-count rows are text lines.

The 'cqw' value is the line height as a percentage of canvas WIDTH (1080 by default)
— matching how render_template.py interprets `font-size: Xcqw` in CSS.

Usage:

    uv run measure_text_heights.py --image preview.png
    uv run measure_text_heights.py --image preview.png --compare-to ref.png  # delta mode

Output (text mode):

    Row 1:  y=140-220 (80px tall) ~ 7.4cqw  - likely DISPLAY
    Row 2:  y=240-310 (70px tall) ~ 6.5cqw  - likely DISPLAY
    Row 3:  y=460-505 (45px tall) ~ 4.2cqw  - likely BODY-LEAD
    ...

Output (compare mode):

    ROW MATCH  ref_height_cqw  preview_height_cqw  delta_pct
      1   yes       8.8                  6.7              -23.9%   ← preview is 24% smaller
      2   yes       8.5                  6.5              -23.5%
      3   yes       3.2                  3.5              +9.4%
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def detect_text_rows(img: Image.Image, *, brightness_threshold: int = 200, min_pixels_per_row: int = 30, gap_threshold: int = 8) -> list[tuple[int, int]]:
    """Find vertical bands of bright pixels (assumes text is bright-on-dark or vice-versa).

    Returns list of (top_y, bottom_y) tuples in pixel coords.
    """
    arr = np.array(img.convert("L"))  # grayscale
    h, w = arr.shape

    # Invert if image is mostly bright (text-on-light scenario)
    if arr.mean() > 127:
        arr = 255 - arr

    # Per-row count of bright pixels (now: bright = text candidate)
    counts = (arr > brightness_threshold).sum(axis=1)

    # Threshold: a row has "text" if it has at least min_pixels_per_row bright pixels
    has_text = counts >= min_pixels_per_row

    # Find contiguous runs of has_text, allowing short gaps
    runs: list[tuple[int, int]] = []
    in_run = False
    start = 0
    gap = 0
    for y in range(h):
        if has_text[y]:
            if not in_run:
                start = y
                in_run = True
            gap = 0
        else:
            if in_run:
                gap += 1
                if gap > gap_threshold:
                    end = y - gap
                    if end - start >= 3:  # ignore noise blips
                        runs.append((start, end))
                    in_run = False
                    gap = 0
    if in_run:
        runs.append((start, h - 1))
    return runs


def classify_role(cqw: float) -> str:
    """Best guess at role from cqw — uses design-fundamentals.md scale."""
    if cqw >= 18: return "display-massive"
    if cqw >= 8:  return "display-large"
    if cqw >= 6:  return "display"
    if cqw >= 4.5: return "headline"
    if cqw >= 3.5: return "body-lead"
    if cqw >= 3.0: return "body"
    if cqw >= 2.0: return "caption"
    if cqw >= 1.2: return "kicker"
    return "below-floor"


def report_single(img_path: Path, canvas_w: int) -> list[dict]:
    img = Image.open(img_path).convert("RGB")
    # Normalize to canvas width for consistent cqw math
    if img.width != canvas_w:
        ratio = canvas_w / img.width
        img = img.resize((canvas_w, int(img.height * ratio)), Image.LANCZOS)
    rows = detect_text_rows(img)
    out = []
    for i, (top, bot) in enumerate(rows, 1):
        height_px = bot - top
        cqw = height_px / canvas_w * 100
        out.append({
            "row": i,
            "top_px": top,
            "bot_px": bot,
            "height_px": height_px,
            "cqw": round(cqw, 2),
            "guess_role": classify_role(cqw),
        })
    return out


def display_row(rows: list[dict]) -> dict | None:
    """The display headline row = the tallest detected row (largest cqw). None if no rows."""
    return max(rows, key=lambda r: r["cqw"]) if rows else None


def enforce_verdict(rows_preview: list[dict], rows_ref: list[dict] | None,
                    display_floor: float, max_shrink: float) -> tuple[bool, list[str]]:
    """Gate hook B (SPEC-B): the display row must be >= display_floor cqw AND, when a ref is
    given, within -max_shrink% of the ref's display height (the preview must not be more than
    max_shrink% SMALLER than the ref). Returns (ok, failures)."""
    failures: list[str] = []
    dp = display_row(rows_preview)
    if dp is None:
        return False, ["no text rows detected in the preview — cannot verify the display height"]
    if dp["cqw"] < display_floor:
        failures.append(
            f"display row is {dp['cqw']:.1f}cqw < floor {display_floor:.1f}cqw — the headline "
            f"reads as body, not display. Grow it (and tighten line-height/tracking, never weight).")
    if rows_ref:
        dr = display_row(rows_ref)
        if dr and dr["cqw"] > 0:
            delta = (dp["cqw"] - dr["cqw"]) / dr["cqw"] * 100
            if delta < -max_shrink:
                failures.append(
                    f"display row is {dp['cqw']:.1f}cqw vs ref {dr['cqw']:.1f}cqw ({delta:+.1f}%) — "
                    f"more than {max_shrink:.0f}% smaller than the ref. Scale the headline up to "
                    f"within -{max_shrink:.0f}% of the ref.")
    return (not failures), failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", type=Path, required=True)
    ap.add_argument("--compare-to", type=Path, help="If given, run delta mode against this REF image.")
    ap.add_argument("--canvas-width", type=int, default=1080)
    ap.add_argument("--enforce", action="store_true",
                    help="Gate hook B: BLOCK (exit 2) when the display row is below the floor "
                         "or (with --compare-to) more than --max-shrink%% smaller than the ref.")
    ap.add_argument("--display-floor", type=float, default=8.0,
                    help="Minimum display-row height in cqw (default 8.0).")
    ap.add_argument("--max-shrink", type=float, default=15.0,
                    help="Max %% the preview display may be SMALLER than the ref (default 15).")
    args = ap.parse_args()

    if not args.image.exists():
        print(f"Error: image not found: {args.image}", file=sys.stderr)
        return 1

    rows_a = report_single(args.image, args.canvas_width)
    rows_b = None

    if args.compare_to:
        if not args.compare_to.exists():
            print(f"Error: ref image not found: {args.compare_to}", file=sys.stderr)
            return 1
        rows_b = report_single(args.compare_to, args.canvas_width)

        print(f"\n  Comparing REF={args.compare_to.name} vs PREVIEW={args.image.name}")
        print(f"  Canvas width: {args.canvas_width}px\n")
        print(f"  {'ROW':>3}  {'ref_cqw':>8}  {'preview_cqw':>11}  {'delta_pct':>9}  guess_role")
        print("  " + "-" * 60)
        n = max(len(rows_a), len(rows_b))
        for i in range(n):
            ref = rows_b[i] if i < len(rows_b) else None
            pre = rows_a[i] if i < len(rows_a) else None
            if ref and pre:
                delta = (pre["cqw"] - ref["cqw"]) / ref["cqw"] * 100
                print(f"  {i+1:>3}  {ref['cqw']:>8.2f}  {pre['cqw']:>11.2f}  {delta:>+8.1f}%  ref:{ref['guess_role']}, preview:{pre['guess_role']}")
            elif ref:
                print(f"  {i+1:>3}  {ref['cqw']:>8.2f}  {'(missing)':>11}        -    preview missing this row")
            elif pre:
                print(f"  {i+1:>3}  {'(missing)':>8}  {pre['cqw']:>11.2f}        -    ref missing this row (extra in preview)")
    else:
        # Single-image mode
        print(f"\n  Image: {args.image.name}  (canvas {args.canvas_width}px)")
        print(f"  Detected {len(rows_a)} text row(s):\n")
        for r in rows_a:
            print(f"    Row {r['row']:>2}: y={r['top_px']}-{r['bot_px']} ({r['height_px']}px tall) ~ {r['cqw']:.2f}cqw - guess: {r['guess_role']}")

    if args.enforce:
        ok, failures = enforce_verdict(rows_a, rows_b, args.display_floor, args.max_shrink)
        print()
        if ok:
            dp = display_row(rows_a)
            print(f"[ok] display row {dp['cqw']:.1f}cqw meets floor {args.display_floor:.1f}cqw"
                  + (" and is within tolerance of the ref" if rows_b else ""))
            return 0
        for f in failures:
            print(f"[fail] {f}", file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
