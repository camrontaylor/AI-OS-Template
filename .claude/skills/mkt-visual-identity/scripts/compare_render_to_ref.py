#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "numpy>=1.26.0", "pyyaml>=6.0"]
# ///
"""Post-render pixel comparison: ref vs preview — line count AND scale/overflow/clip.

The math validator in validate_measurements.py only checks internal consistency
of declared numbers. If the agent reads the ref wrong and declares
observed_line_count=4 when the ref shows 5, the formula still balances
(font, bbox, lh all derived from the same wrong N) and the validator passes.

This script catches that class of error by actually LOOKING at the pixels. It runs
TWO independent per-element reads on the RENDERED preview:

A) LINE-COUNT (needs a ref + observed_line_count):
  1. Crops the bbox region from both ref.png and preview.png
  2. Auto-detects bg polarity (light bg + dark text, or vice versa)
  3. Otsu-thresholds to a text mask
  4. Computes the horizontal (per-row) projection of text pixels
  5. Clusters contiguous rows above a relative threshold into lines
  6. Compares cluster count to declared observed_line_count

B) SCALE / OVERFLOW / CLIP (r6g — independent of the ref, runs on the PREVIEW alone):
  the rendered text of a FIXED-dimension box may not (a) clip — overflow its OWN
  declared bbox, nor (b) bleed — cross the canvas safe margin. We crop an EXPANDED
  window (bbox + a margin ring) from the preview, threshold to a text mask, and
  measure how far the text ink reaches past the declared bbox edges and past the
  canvas edge. This is the r6h leg-3 generalization: it is NOT line-count
  (a single line that overflows its box reproves), and it runs for ANY text-bearing
  block — `display` INCLUDED (the old gate skipped `type:display` outright, so a
  headline overflowing a `.highlight-outlined` box sailed through). The display-height
  gate (measure_text_heights) checks the headline is big ENOUGH vs the ref; this checks
  it is not TOO big for its own box — the opposite failure the run-07 highlight-headline
  "Workflow" overflow exposed.

Verdict emitted per element (the worse of the two reads wins):

  OK                  no line-count mismatch and no overflow/clip
  LINE_COUNT_MISMATCH ref_lines != preview_lines, or either != declared
  OVERFLOW            preview text ink crosses its own bbox edge (clip) or the canvas
                      safe margin (bleed) by more than the tolerance
  EMPTY_REGION        no text pixels detected in the bbox (skipped)

Elements with a NON-text type (icon / image-zone / pill / bg-watermark) are skipped
for both reads. A text-bearing block with no observed_line_count still gets the
overflow read (the line-count read needs the count; the overflow read does not).

Usage:

    uv run compare_render_to_ref.py \\
        --ref _qa-renders/cover-dark-byline-pill-ref.png \\
        --preview _qa-renders/cover-dark-byline-pill-preview.png \\
        --measurements brand_context/templates/linkedin-carousel/cover-dark-byline-pill/_measurements.yaml \\
        --output _qa-renders/cover-dark-byline-pill-linecheck.json

--ref is OPTIONAL: with no ref, the line-count read is skipped and only the
overflow/clip read runs (it needs only the preview). If --output is omitted, JSON
is printed to stdout. Exit code is non-zero if any element verdicts
LINE_COUNT_MISMATCH or OVERFLOW (so CI can gate on it).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml
from PIL import Image


# Text-bearing element types we scan. The LINE-COUNT read keys on these; the
# OVERFLOW read scans the same set. `text` is the base; `display` and its weight/
# size variants are headline zones the OLD gate skipped outright (the run-07
# highlight-headline "Workflow"-overflows-the-box miss) — r6g generalizes the gate
# to ALL of them. Non-text types (icon / image-zone / pill / bg-watermark / chrome)
# are still skipped — they carry no line count and overflow is not meaningful for them.
TEXT_TYPES = {
    "text",
    "display", "display-bold", "display-italic", "display-large", "display-massive",
    "headline", "kicker", "subtitle", "body", "body-lead", "caption",
}

# A canonical-prefix check so an unforeseen `display-*` / `headline-*` variant still
# counts as text-bearing (forward-compatible with new role names in the measurements).
TEXT_TYPE_PREFIXES = ("display", "headline", "body", "kicker", "caption", "subtitle", "title")

# Minimum bbox area (in canvas %) below which we won't even try — too small
# to get a reliable projection signal. Kickers and tiny captions are still
# scanned; this guards against degenerate measurements.
MIN_BBOX_AREA_PCT = 0.5  # half a square percent of canvas

# --- Overflow / clip tolerances (r6g, item 1a) -------------------------------------------
# The text ink may reach this far PAST its declared bbox edge before it counts as a CLIP,
# as a fraction of the bbox's own dimension on that axis. A small slack absorbs antialiasing,
# the renderer's sub-pixel rounding, and legitimate descender/diacritic bleed; anything
# beyond it is the box failing to hold the text (the fixed-box-overflow failure).
OVERFLOW_BBOX_TOL_FRAC = 0.06
# Absolute floor (canvas %) on the bbox-overflow slack so a TINY bbox isn't tripped by a
# couple of antialiased pixels (6% of a 3%-tall kicker is sub-pixel — give it a real floor).
OVERFLOW_BBOX_TOL_MIN_PCT = 0.8
# The text ink may not come within this safe margin of the CANVAS edge (canvas %). Text that
# bleeds past it is at risk of being cropped by the feed's safe-area — the off-canvas bleed.
CANVAS_SAFE_MARGIN_PCT = 1.5
# The expanded crop window (the "margin ring") around the bbox we sample to SEE the overflow,
# as a fraction of the bbox dimension. Must be wide enough to capture text that spilled out.
OVERFLOW_PROBE_RING_FRAC = 0.6
# A column/row needs at least this fraction of the bbox's peak ink to count as "text reaches
# here" — rejects stray antialias specks in the margin ring from registering as overflow.
OVERFLOW_INK_REL_THRESH = 0.12
# Minimum luminance distance from the window's background tone for a pixel to count as ink in
# the overflow read. Robust to a clean two-tone synthetic AND a real antialiased render: it
# keys on contrast-from-bg, not an Otsu split (which collapses on a perfectly bimodal image).
OVERFLOW_INK_LUMA_DELTA = 40


def load_image_normalized(path: Path, target_w: int, target_h: int) -> np.ndarray:
    """Load image and resize to canonical canvas size. Returns grayscale ndarray."""
    img = Image.open(path).convert("L")
    if img.size != (target_w, target_h):
        img = img.resize((target_w, target_h), Image.LANCZOS)
    return np.array(img, dtype=np.uint8)


def parse_canvas(meas: dict) -> tuple[int, int]:
    """Parse `canvas: 1080x1350` (or list/tuple) into (w, h)."""
    raw = meas.get("canvas", "1080x1350")
    if isinstance(raw, str):
        w_str, h_str = raw.lower().replace(" ", "").split("x")
        return int(w_str), int(h_str)
    if isinstance(raw, (list, tuple)) and len(raw) == 2:
        return int(raw[0]), int(raw[1])
    return 1080, 1350


def crop_bbox(arr: np.ndarray, bbox_pct: list, canvas_w: int, canvas_h: int) -> np.ndarray:
    """Crop the bbox from a grayscale array. bbox_pct = [left, top, w, h] in % of canvas."""
    left_pct, top_pct, w_pct, h_pct = bbox_pct
    x0 = max(0, int(round(left_pct / 100.0 * canvas_w)))
    y0 = max(0, int(round(top_pct / 100.0 * canvas_h)))
    x1 = min(canvas_w, int(round((left_pct + w_pct) / 100.0 * canvas_w)))
    y1 = min(canvas_h, int(round((top_pct + h_pct) / 100.0 * canvas_h)))
    if x1 <= x0 or y1 <= y0:
        return np.zeros((1, 1), dtype=np.uint8)
    return arr[y0:y1, x0:x1]


def otsu_threshold(arr: np.ndarray) -> int:
    """Compute Otsu threshold for a grayscale ndarray. Returns the threshold value (0-255)."""
    # Build histogram
    hist, _ = np.histogram(arr.ravel(), bins=256, range=(0, 256))
    total = arr.size
    if total == 0:
        return 127
    sum_total = np.dot(np.arange(256), hist)
    sum_b = 0.0
    w_b = 0
    max_var = -1.0
    threshold = 127
    for i in range(256):
        w_b += hist[i]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += i * hist[i]
        m_b = sum_b / w_b
        m_f = (sum_total - sum_b) / w_f
        var_between = w_b * w_f * (m_b - m_f) ** 2
        if var_between > max_var:
            max_var = var_between
            threshold = i
    return int(threshold)


def text_mask(region: np.ndarray) -> tuple[np.ndarray, bool]:
    """Return a binary mask (True = pixel belongs to text) and bg polarity flag.

    Strategy: median-based polarity detection.
      - If median > 127, bg is light → text is dark → mask = pixel < otsu_t
      - Else, bg is dark → text is light → mask = pixel > otsu_t

    Returns (mask, bg_is_light).
    """
    if region.size == 0:
        return np.zeros_like(region, dtype=bool), True
    bg_is_light = bool(np.median(region) > 127)
    t = otsu_threshold(region)
    if bg_is_light:
        mask = region < t
    else:
        mask = region > t
    return mask, bg_is_light


def count_lines(mask: np.ndarray, min_line_height_px: int = 4,
                activity_threshold: float = 0.10,
                small_cluster_ratio: float = 0.30) -> tuple[int, list[tuple[int, int]]]:
    """Count text lines via horizontal projection clustering.

    Two-pass approach:
      Pass 1 — find all contiguous runs of "active" rows above a relative
               threshold. Drop runs below an absolute height floor.
      Pass 2 — drop clusters whose height is below `small_cluster_ratio` of
               the MEDIAN cluster height. This kills stray noise from
               ascenders/descenders bleeding outside the main text body, as
               well as thin bbox-edge artifacts.

    Args:
      mask: HxW binary mask, True where text pixel.
      min_line_height_px: hard floor on cluster height in raw rows.
      activity_threshold: row is "active" when active_px_count / max_row_count > this.
      small_cluster_ratio: clusters shorter than this fraction of median are dropped.

    Returns (line_count, list_of_(top_row, bottom_row)_per_line).
    """
    if mask.ndim != 2 or mask.size == 0:
        return 0, []

    # Per-row count of active pixels
    row_sums = mask.sum(axis=1).astype(np.float64)
    if row_sums.max() == 0:
        return 0, []

    # Relative threshold — lines vary in width (a single-word last line of a
    # paragraph has fewer active pixels), so we threshold against the row max
    # rather than an absolute value. 10% of max catches even narrow last-line
    # words while still rejecting kerning noise between lines.
    threshold = row_sums.max() * activity_threshold
    active = row_sums > threshold

    # Pass 1: contiguous runs above absolute height floor
    runs: list[tuple[int, int]] = []
    n = len(active)
    i = 0
    while i < n:
        if active[i]:
            j = i
            while j < n and active[j]:
                j += 1
            if j - i >= min_line_height_px:
                runs.append((i, j - 1))
            i = j
        else:
            i += 1

    if len(runs) <= 1:
        return len(runs), runs

    # Pass 2: drop micro-clusters relative to the median cluster height. The
    # idea is: real text lines all have roughly the same height (font is the
    # same), so anything dramatically smaller than the median is noise — a
    # descender that escaped the bbox, an emoji glyph dropped below baseline,
    # a sub-pixel anti-alias band, a row of border pixels near the bbox edge.
    heights = sorted(r[1] - r[0] + 1 for r in runs)
    median_h = heights[len(heights) // 2]
    min_keep = max(min_line_height_px, int(median_h * small_cluster_ratio))
    filtered = [r for r in runs if (r[1] - r[0] + 1) >= min_keep]

    return len(filtered), filtered


def is_text_type(etype: str | None) -> bool:
    """True when an element type is text-bearing (gets the overflow + line-count reads).

    Matches the explicit TEXT_TYPES set OR any canonical text prefix (display-*, headline-*,
    body-*, …) so a new role variant in the measurements still counts as text — `display`
    is INCLUDED (the old `etype not in {"text"}` skip is exactly the r6h leg-3 bug)."""
    if etype is None:
        return False
    e = str(etype).strip().lower()
    if e in TEXT_TYPES:
        return True
    return any(e == p or e.startswith(p + "-") for p in TEXT_TYPE_PREFIXES)


def overflow_ink_mask(region: np.ndarray) -> np.ndarray:
    """Boolean ink mask for the overflow read: pixels whose luminance differs from the window's
    BACKGROUND tone by more than OVERFLOW_INK_LUMA_DELTA.

    The background tone is the region's MODAL value (most-common grayscale level — the field the
    text sits on). Keying on contrast-from-bg (not Otsu) is robust to a perfectly bimodal
    synthetic image (where Otsu's threshold lands exactly on a mode and a strict `<` mask comes
    back empty) AND to a real antialiased render (ink + halo both clear the delta). Works for
    light-bg/dark-text and dark-bg/light-text alike — it is the absolute distance that counts."""
    if region.size == 0:
        return np.zeros_like(region, dtype=bool)
    vals, counts = np.unique(region, return_counts=True)
    bg = int(vals[int(np.argmax(counts))])
    return np.abs(region.astype(np.int16) - bg) > OVERFLOW_INK_LUMA_DELTA


def measure_overflow(preview_gray: np.ndarray, bbox_pct: list,
                     canvas_w: int, canvas_h: int) -> dict:
    """Measure how far the rendered text ink in a box reaches past (a) its OWN declared bbox
    and (b) the canvas safe margin. Runs on the PREVIEW alone — no ref needed.

    Strategy: crop an EXPANDED window (bbox + a margin ring) so ink that spilled OUT of the
    box is visible, threshold it to a text mask (reusing the same polarity+Otsu primitive as
    the line-count read), then find the ink's extent on each axis. The overflow on an edge is
    how far the ink extent crosses the declared bbox edge, expressed in canvas %.

    Returns a dict with per-edge overflow (canvas %), the bbox-tolerance applied, a
    canvas-bleed flag, and a verdict reason (empty string when within tolerance)."""
    left_pct, top_pct, w_pct, h_pct = (float(v) for v in bbox_pct)
    # The margin ring (in canvas %) around the bbox we sample on each side.
    ring_x = max(1.0, OVERFLOW_PROBE_RING_FRAC * w_pct)
    ring_y = max(1.0, OVERFLOW_PROBE_RING_FRAC * h_pct)
    win_left = max(0.0, left_pct - ring_x)
    win_top = max(0.0, top_pct - ring_y)
    win_right = min(100.0, left_pct + w_pct + ring_x)
    win_bottom = min(100.0, top_pct + h_pct + ring_y)

    # Pixel coords of the expanded window.
    px0 = int(round(win_left / 100.0 * canvas_w))
    py0 = int(round(win_top / 100.0 * canvas_h))
    px1 = int(round(win_right / 100.0 * canvas_w))
    py1 = int(round(win_bottom / 100.0 * canvas_h))
    region = preview_gray[py0:py1, px0:px1]
    base = {
        "left_overflow_pct": 0.0, "right_overflow_pct": 0.0,
        "top_overflow_pct": 0.0, "bottom_overflow_pct": 0.0,
        "max_overflow_pct": 0.0, "bbox_tol_pct": 0.0,
        "canvas_bleed": False, "reason": "",
    }
    if region.size == 0:
        return base

    mask = overflow_ink_mask(region)
    if not mask.any():
        return base

    # Ink extent (in window-local pixel coords), thresholding each row/col against the peak so
    # stray antialias specks in the ring don't count as the text reaching that far.
    col_sums = mask.sum(axis=0).astype(np.float64)
    row_sums = mask.sum(axis=1).astype(np.float64)
    col_thr = col_sums.max() * OVERFLOW_INK_REL_THRESH
    row_thr = row_sums.max() * OVERFLOW_INK_REL_THRESH
    cols = np.where(col_sums > col_thr)[0]
    rows = np.where(row_sums > row_thr)[0]
    if cols.size == 0 or rows.size == 0:
        return base

    # Convert the ink extent back to canvas % (window origin + local offset).
    ink_left = win_left + (cols[0] / max(1, region.shape[1])) * (win_right - win_left)
    ink_right = win_left + ((cols[-1] + 1) / max(1, region.shape[1])) * (win_right - win_left)
    ink_top = win_top + (rows[0] / max(1, region.shape[0])) * (win_bottom - win_top)
    ink_bottom = win_top + ((rows[-1] + 1) / max(1, region.shape[0])) * (win_bottom - win_top)

    # The declared bbox edges (canvas %).
    box_left, box_top = left_pct, top_pct
    box_right, box_bottom = left_pct + w_pct, top_pct + h_pct

    # Per-edge overflow past the OWN bbox (positive = ink crossed the edge outward).
    left_of = max(0.0, box_left - ink_left)
    right_of = max(0.0, ink_right - box_right)
    top_of = max(0.0, box_top - ink_top)
    bottom_of = max(0.0, ink_bottom - box_bottom)

    # Tolerance: a slack proportional to the bbox dimension, never below an absolute floor.
    tol_x = max(OVERFLOW_BBOX_TOL_MIN_PCT, OVERFLOW_BBOX_TOL_FRAC * w_pct)
    tol_y = max(OVERFLOW_BBOX_TOL_MIN_PCT, OVERFLOW_BBOX_TOL_FRAC * h_pct)

    # A clip is an overflow past the bbox beyond tolerance on the matching axis.
    clip_edges = []
    if left_of > tol_x:
        clip_edges.append(("left", left_of))
    if right_of > tol_x:
        clip_edges.append(("right", right_of))
    if top_of > tol_y:
        clip_edges.append(("top", top_of))
    if bottom_of > tol_y:
        clip_edges.append(("bottom", bottom_of))

    # A canvas bleed is ink within the safe margin of any canvas edge.
    canvas_bleed = (ink_left < CANVAS_SAFE_MARGIN_PCT
                    or ink_right > 100.0 - CANVAS_SAFE_MARGIN_PCT
                    or ink_top < CANVAS_SAFE_MARGIN_PCT
                    or ink_bottom > 100.0 - CANVAS_SAFE_MARGIN_PCT)

    max_of = max(left_of, right_of, top_of, bottom_of)
    reasons = []
    if clip_edges:
        worst = max(clip_edges, key=lambda e: e[1])
        reasons.append(
            f"text clips its own bbox on the {worst[0]} edge by {worst[1]:.1f}% of canvas "
            f"(tol {(tol_x if worst[0] in ('left', 'right') else tol_y):.1f}%) — the box does "
            f"not hold the rendered text")
    if canvas_bleed:
        reasons.append(
            f"text bleeds within the {CANVAS_SAFE_MARGIN_PCT:.1f}% canvas safe margin — at risk "
            f"of being cropped by the feed safe-area")

    return {
        "left_overflow_pct": round(left_of, 3), "right_overflow_pct": round(right_of, 3),
        "top_overflow_pct": round(top_of, 3), "bottom_overflow_pct": round(bottom_of, 3),
        "max_overflow_pct": round(max_of, 3), "bbox_tol_pct": round(max(tol_x, tol_y), 3),
        "canvas_bleed": canvas_bleed, "reason": "; ".join(reasons),
    }


def is_skippable(element: dict, *, require_line_count: bool = True) -> tuple[bool, str]:
    """Decide whether to skip this element. Returns (skip, reason).

    require_line_count gates the LINE-COUNT read (which needs observed_line_count). The
    OVERFLOW read calls this with require_line_count=False — a text block with no declared
    line count is still scanned for overflow."""
    etype = element.get("type")
    if not is_text_type(etype):
        return True, f"type={etype} not a text element"
    if require_line_count and element.get("observed_line_count") is None:
        return True, "no observed_line_count declared"
    bbox = element.get("bbox_pct")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return True, "bbox_pct missing or malformed"
    if bbox[2] * bbox[3] < MIN_BBOX_AREA_PCT:
        return True, f"bbox area {bbox[2] * bbox[3]:.2f}% below scan floor"
    return False, ""


def analyze_element(element: dict, ref_gray: np.ndarray | None, preview_gray: np.ndarray,
                    canvas_w: int, canvas_h: int) -> dict:
    """Run BOTH reads for one element: line-count (when a ref + observed_line_count exist) and
    the ref-independent overflow/clip read (always, on the preview). The result's verdict is
    the worse of the two. Returns a result dict."""
    eid = element.get("id", "<unnamed>")
    bbox = element["bbox_pct"]

    # --- read B: overflow/clip (preview alone, no ref, no line count needed) ---
    overflow = measure_overflow(preview_gray, bbox, canvas_w, canvas_h)
    overflowed = bool(overflow["reason"])

    # --- read A: line-count (only when a ref AND a declared line count are available) ---
    declared = element.get("observed_line_count")
    line_verdict = None
    ref_lines = prev_lines = None
    ref_runs = prev_runs = []
    ref_total = prev_total = None
    ref_bg_light = prev_bg_light = None
    prev_region = crop_bbox(preview_gray, bbox, canvas_w, canvas_h)
    prev_mask, prev_bg_light = text_mask(prev_region)
    prev_lines, prev_runs = count_lines(prev_mask)
    prev_total = int(prev_mask.sum())
    if ref_gray is not None and declared is not None:
        declared = int(declared)
        ref_region = crop_bbox(ref_gray, bbox, canvas_w, canvas_h)
        ref_mask, ref_bg_light = text_mask(ref_region)
        ref_lines, ref_runs = count_lines(ref_mask)
        ref_total = int(ref_mask.sum())
        if ref_total == 0 and prev_total == 0:
            line_verdict = "EMPTY_REGION"
        elif ref_lines == declared and prev_lines == declared:
            line_verdict = "OK"
        else:
            line_verdict = "LINE_COUNT_MISMATCH"

    # Verdict precedence: a hard mismatch on either read wins; else OK / EMPTY_REGION.
    if line_verdict == "LINE_COUNT_MISMATCH":
        verdict = "LINE_COUNT_MISMATCH"
    elif overflowed:
        verdict = "OVERFLOW"
    elif line_verdict == "EMPTY_REGION":
        verdict = "EMPTY_REGION"
    else:
        verdict = "OK"

    return {
        "id": eid,
        "type": element.get("type"),
        "role": element.get("role"),
        "bbox_pct": bbox,
        "declared_lines": declared,
        "ref_lines": ref_lines,
        "preview_lines": prev_lines,
        "ref_text_pixels": ref_total,
        "preview_text_pixels": prev_total,
        "ref_bg_is_light": ref_bg_light,
        "preview_bg_is_light": prev_bg_light,
        "ref_line_bands_rows": ref_runs,
        "preview_line_bands_rows": prev_runs,
        "overflow": overflow,
        "verdict": verdict,
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Post-render check: line-count (vs ref) AND scale/overflow/clip (preview).")
    ap.add_argument("--ref", type=Path, default=None,
                    help="Reference image path. OPTIONAL — omit to run the overflow/clip read "
                         "alone (the line-count read needs a ref).")
    ap.add_argument("--preview", required=True, type=Path, help="Rendered preview image path")
    ap.add_argument("--measurements", required=True, type=Path, help="Path to _measurements.yaml")
    ap.add_argument("--output", type=Path, default=None,
                    help="Output JSON path. If omitted, prints to stdout.")
    ap.add_argument("--strict-exit", action="store_true",
                    help="Exit 1 if any element MISMATCHES or OVERFLOWS (default behavior).")
    ap.add_argument("--no-strict-exit", dest="strict_exit", action="store_false",
                    help="Always exit 0 even on mismatch (for inspection runs).")
    ap.set_defaults(strict_exit=True)
    args = ap.parse_args()

    for p in (args.preview, args.measurements):
        if not p.exists():
            print(f"Error: input not found: {p}", file=sys.stderr)
            return 2
    if args.ref is not None and not args.ref.exists():
        print(f"Error: --ref given but not found: {args.ref}", file=sys.stderr)
        return 2

    with args.measurements.open("r", encoding="utf-8") as f:
        meas = yaml.safe_load(f)

    canvas_w, canvas_h = parse_canvas(meas)
    ref_gray = load_image_normalized(args.ref, canvas_w, canvas_h) if args.ref else None
    preview_gray = load_image_normalized(args.preview, canvas_w, canvas_h)

    results: list[dict] = []
    skipped: list[dict] = []
    for element in meas.get("elements", []):
        # Scan every TEXT-bearing block (require_line_count=False): the overflow read runs even
        # with no line count; the line-count read inside analyze_element no-ops when its inputs
        # (ref + observed_line_count) are absent.
        skip, reason = is_skippable(element, require_line_count=False)
        if skip:
            skipped.append({"id": element.get("id"), "type": element.get("type"), "reason": reason})
            continue
        results.append(analyze_element(element, ref_gray, preview_gray, canvas_w, canvas_h))

    mismatches = [r for r in results if r["verdict"] == "LINE_COUNT_MISMATCH"]
    overflows = [r for r in results if r["verdict"] == "OVERFLOW"]
    failures = mismatches + overflows
    payload = {
        "ref": str(args.ref) if args.ref else None,
        "preview": str(args.preview),
        "measurements": str(args.measurements),
        "canvas": {"width": canvas_w, "height": canvas_h},
        "elements": results,
        "skipped": skipped,
        "summary": {
            "elements_scanned": len(results),
            "elements_skipped": len(skipped),
            "mismatches": len(mismatches),
            "mismatch_ids": [m["id"] for m in mismatches],
            "overflows": len(overflows),
            "overflow_ids": [o["id"] for o in overflows],
        },
    }

    text = json.dumps(payload, indent=2)
    if args.output is None:
        print(text)
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
        print(f"Wrote: {args.output}", file=sys.stderr)
        # Also print a short summary to stdout for human eyeballs
        print(f"scanned={len(results)} skipped={len(skipped)} "
              f"mismatches={len(mismatches)} overflows={len(overflows)}")
        for m in mismatches:
            print(f"  LINE_COUNT_MISMATCH [{m['id']}] declared={m['declared_lines']} "
                  f"ref={m['ref_lines']} preview={m['preview_lines']}")
        for o in overflows:
            print(f"  OVERFLOW [{o['id']}] {o['overflow']['reason']}")

    if failures and args.strict_exit:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
