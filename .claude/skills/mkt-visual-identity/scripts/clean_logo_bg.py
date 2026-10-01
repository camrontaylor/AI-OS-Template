#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pillow>=10.0.0",
#     "rembg>=2.0.50",
#     "onnxruntime>=1.16.0",
# ]
# ///
"""
Safe logo background removal with per-logo decision.

Pipeline per logo:
  1. SKIP if PNG already has alpha channel (already transparent)
  2. Detect background color (sample 4 corners + 4 edge midpoints, median)
  3. Detect logo's dominant non-background color (most common non-bg color)
  4. Compute RGB distance between bg and logo dominant color
  5. SKIP with reason `bg-too-close-to-logo` if distance < THRESHOLD — would destroy the logo
  6. SKIP with reason `bg-not-uniform` if corner colors disagree by > 30 RGB units (logo on photo/gradient)
  7. Otherwise: run rembg, then validate the result:
     - opaque_ratio = opaque_pixels / total
     - if opaque_ratio > 0.95 → rembg returned almost everything opaque (likely failed) → SKIP
     - if opaque_ratio < 0.02 → rembg returned almost nothing opaque (over-aggressive) → SKIP
     - else → save as {name}-transparent.png
  8. ALSO save a comparison PNG (original | result) for visual audit

Output:
  brand_context/visual-identity/logos/{name}-transparent.png         (only if validation passes)
  brand_context/visual-identity/logos/_bg_clean/{name}-comparison.png (always — side-by-side audit)
  brand_context/visual-identity/logos/_bg_clean/_decisions.json      (per-logo decision report)

Usage:
  uv run clean_logo_bg.py --logos-dir brand_context/visual-identity/logos
  uv run clean_logo_bg.py --input single-logo.png --output result.png
  uv run clean_logo_bg.py --logos-dir <path> --dry-run  # prints decisions, writes nothing
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

# Thresholds (RGB units, 0-255 space)
BG_LOGO_DISTANCE_MIN = 60      # if bg ↔ logo distance below this, removal would destroy the logo
CORNER_AGREEMENT_MAX = 30      # if corners disagree by more than this, bg is non-uniform (photo/gradient)
OPAQUE_RATIO_MIN = 0.02        # rembg result with < 2% opaque pixels → over-aggressive, reject
OPAQUE_RATIO_MAX = 0.95        # rembg result with > 95% opaque pixels → barely removed anything, reject


def rgb_distance(c1: tuple[int, int, int], c2: tuple[int, int, int]) -> float:
    return ((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2 + (c1[2] - c2[2]) ** 2) ** 0.5


def sample_bg_color(img: Image.Image) -> tuple[tuple[int, int, int], float]:
    """Sample 4 corners + 4 edge midpoints, return (median_color, max_disagreement)."""
    w, h = img.size
    rgb = img.convert("RGB")
    samples = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((w - 1, 0)),
        rgb.getpixel((0, h - 1)),
        rgb.getpixel((w - 1, h - 1)),
        rgb.getpixel((w // 2, 0)),
        rgb.getpixel((w // 2, h - 1)),
        rgb.getpixel((0, h // 2)),
        rgb.getpixel((w - 1, h // 2)),
    ]
    # Median per channel
    med = (
        sorted(s[0] for s in samples)[len(samples) // 2],
        sorted(s[1] for s in samples)[len(samples) // 2],
        sorted(s[2] for s in samples)[len(samples) // 2],
    )
    # Max disagreement = max distance between any two samples
    max_dist = 0.0
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            d = rgb_distance(samples[i], samples[j])
            if d > max_dist:
                max_dist = d
    return med, max_dist


def dominant_non_bg_color(img: Image.Image, bg: tuple[int, int, int], bg_tolerance: int = 25) -> tuple[int, int, int] | None:
    """Find the most common pixel color that ISN'T the background. Bucket to 0x10 per channel."""
    rgb = img.convert("RGB")
    # Downsample for speed
    small = rgb.resize((128, int(128 * rgb.height / rgb.width)))
    counter: Counter = Counter()
    for px in small.getdata():
        if rgb_distance(px, bg) <= bg_tolerance:
            continue
        bucket = (px[0] // 16 * 16, px[1] // 16 * 16, px[2] // 16 * 16)
        counter[bucket] += 1
    if not counter:
        return None
    top = counter.most_common(1)[0][0]
    return top


def opaque_ratio(rgba_img: Image.Image) -> float:
    """Fraction of pixels with alpha > 200."""
    if rgba_img.mode != "RGBA":
        return 1.0
    alpha = rgba_img.split()[-1]
    pixels = list(alpha.getdata())
    if not pixels:
        return 0.0
    opaque = sum(1 for a in pixels if a > 200)
    return opaque / len(pixels)


def make_comparison(original: Image.Image, result: Image.Image | None, decision: str) -> Image.Image:
    """Side-by-side: original | result-on-checker. Annotate decision text on result side."""
    w = max(original.width, result.width if result else original.width)
    h = original.height
    canvas = Image.new("RGB", (w * 2 + 20, h + 40), (240, 240, 240))
    canvas.paste(original.convert("RGB"), (0, 30))
    if result is not None:
        # Render result on checker background to show transparency
        checker = Image.new("RGB", result.size, (255, 255, 255))
        for y in range(0, result.height, 20):
            for x in range(0, result.width, 20):
                if (x // 20 + y // 20) % 2 == 0:
                    for py in range(y, min(y + 20, result.height)):
                        for px in range(x, min(x + 20, result.width)):
                            checker.putpixel((px, py), (220, 220, 220))
        composite = Image.alpha_composite(checker.convert("RGBA"), result.convert("RGBA"))
        canvas.paste(composite.convert("RGB"), (w + 20, 30))
    # Annotate decision on the right side
    try:
        from PIL import ImageDraw
        d = ImageDraw.Draw(canvas)
        d.text((10, 5), "ORIGINAL", fill=(0, 0, 0))
        d.text((w + 30, 5), f"RESULT — {decision}", fill=(0, 0, 0))
    except Exception:
        pass
    return canvas


def process_one(in_path: Path, out_dir: Path, audit_dir: Path, dry_run: bool, rembg_session=None) -> dict:
    """Process one logo. Returns decision record.

    Always emits a comparison PNG so the user can audit visually — even for skipped
    cases (the "result" pane shows the SKIPPED reason instead of a cutout).
    """
    record: dict = {
        "input": str(in_path),
        "decision": "",
        "reason": "",
        "bg_color": None,
        "logo_color": None,
        "distance": None,
        "corner_disagreement": None,
        "opaque_ratio": None,
        "output": None,
        "comparison": None,
    }

    try:
        img = Image.open(in_path)
    except Exception as e:
        record["decision"] = "error"
        record["reason"] = f"cannot open: {e}"
        return record

    def save_skip_comparison(reason: str) -> None:
        """Generate a comparison PNG for a SKIPPED logo (no result yet)."""
        if dry_run:
            return
        cmp_path = audit_dir / f"{in_path.stem}-comparison-SKIPPED.png"
        make_comparison(img, None, f"SKIPPED: {reason}").save(cmp_path)
        record["comparison"] = str(cmp_path)

    # 1. Already has alpha?
    if img.mode in ("RGBA", "LA"):
        alpha_ratio = opaque_ratio(img.convert("RGBA"))
        if alpha_ratio < 0.98:  # has meaningful transparency
            record["decision"] = "skip"
            record["reason"] = "already-has-alpha"
            record["opaque_ratio"] = round(alpha_ratio, 3)
            save_skip_comparison(record["reason"])
            return record
        # Else it's "RGBA but fully opaque" — treat as RGB and proceed

    # 2. Sample bg color (informational — used in logo distance check + report)
    bg, corner_max_dist = sample_bg_color(img)
    record["bg_color"] = list(bg)
    record["corner_disagreement"] = round(corner_max_dist, 1)

    # NOTE: previously skipped on corner_max_dist > CORNER_AGREEMENT_MAX,
    # but that pre-check was inverted for headshots / portraits:
    # corner disagreement just means foreground content extends into corners,
    # which is EVIDENCE that rembg has something to segment — not a failure.
    # rembg is robust to non-uniform bg; post-validation (opaque_ratio) catches real failures.

    # 3. Dominant logo color
    logo = dominant_non_bg_color(img, bg)
    record["logo_color"] = list(logo) if logo else None

    if logo is None:
        record["decision"] = "skip"
        record["reason"] = "no-distinct-foreground (whole image looks like bg)"
        save_skip_comparison(record["reason"])
        return record

    # 4. Distance check (still useful — if logo color matches bg, rembg would destroy detail)
    dist = rgb_distance(bg, logo)
    record["distance"] = round(dist, 1)
    if dist < BG_LOGO_DISTANCE_MIN:
        record["decision"] = "skip"
        record["reason"] = f"bg-too-close-to-logo (distance {dist:.0f} < {BG_LOGO_DISTANCE_MIN})"
        save_skip_comparison(record["reason"])
        return record

    # 5. Run rembg
    if dry_run:
        record["decision"] = "would-process"
        record["reason"] = f"checks pass (distance {dist:.0f}, corner-agree {corner_max_dist:.0f})"
        return record

    try:
        from rembg import remove, new_session
        if rembg_session is None:
            rembg_session = new_session("u2net")
        result = remove(img, session=rembg_session)
    except Exception as e:
        record["decision"] = "error"
        record["reason"] = f"rembg failed: {e}"
        return record

    # 6. Validate result
    ratio = opaque_ratio(result)
    record["opaque_ratio"] = round(ratio, 3)

    if ratio > OPAQUE_RATIO_MAX:
        record["decision"] = "skip"
        record["reason"] = f"barely-removed (opaque_ratio {ratio:.2f} > {OPAQUE_RATIO_MAX}) — bg removal didn't work"
        cmp_path = audit_dir / f"{in_path.stem}-comparison-FAILED.png"
        make_comparison(img, result, record["reason"]).save(cmp_path)
        record["comparison"] = str(cmp_path)
        return record
    if ratio < OPAQUE_RATIO_MIN:
        record["decision"] = "skip"
        record["reason"] = f"over-removed (opaque_ratio {ratio:.2f} < {OPAQUE_RATIO_MIN}) — content was destroyed"
        cmp_path = audit_dir / f"{in_path.stem}-comparison-FAILED.png"
        make_comparison(img, result, record["reason"]).save(cmp_path)
        record["comparison"] = str(cmp_path)
        return record

    # Validation passed — save
    out_path = out_dir / f"{in_path.stem}-transparent.png"
    result.save(out_path)
    cmp_path = audit_dir / f"{in_path.stem}-comparison.png"
    make_comparison(img, result, "OK").save(cmp_path)
    record["decision"] = "ok"
    record["reason"] = f"clean removal (opaque_ratio {ratio:.2f}, distance {dist:.0f})"
    record["output"] = str(out_path)
    record["comparison"] = str(cmp_path)
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe per-logo background removal with validation.")
    grp = parser.add_mutually_exclusive_group(required=True)
    grp.add_argument("--logos-dir", help="Process every PNG/JPG in this directory.")
    grp.add_argument("--input", help="Single logo path.")
    parser.add_argument("--output", help="Single-logo output path (used with --input).")
    parser.add_argument("--dry-run", action="store_true", help="Print decisions only, write nothing.")
    args = parser.parse_args()

    # Determine input list + output / audit dirs
    if args.input:
        in_paths = [Path(args.input).resolve()]
        out_dir = Path(args.output).parent if args.output else in_paths[0].parent
        audit_dir = out_dir / "_bg_clean"
    else:
        logos_dir = Path(args.logos_dir).resolve()
        if not logos_dir.exists():
            print(f"Error: {logos_dir} not found", file=sys.stderr)
            return 1
        in_paths = sorted(
            [p for p in logos_dir.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg") and "-transparent" not in p.stem]
        )
        out_dir = logos_dir
        audit_dir = logos_dir / "_bg_clean"

    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        audit_dir.mkdir(parents=True, exist_ok=True)

    # Lazy-init rembg session once (avoid re-loading model per file)
    rembg_session = None
    if not args.dry_run:
        try:
            from rembg import new_session
            rembg_session = new_session("u2net")
        except Exception as e:
            print(f"rembg unavailable: {e}", file=sys.stderr)
            return 2

    decisions: list[dict] = []
    for p in in_paths:
        print(f"  → {p.name}", file=sys.stderr)
        rec = process_one(p, out_dir, audit_dir, args.dry_run, rembg_session)
        decisions.append(rec)
        print(f"    {rec['decision'].upper()}: {rec['reason']}", file=sys.stderr)

    # Decision summary
    counts = Counter(d["decision"] for d in decisions)
    print("", file=sys.stderr)
    print(f"Summary: {dict(counts)}", file=sys.stderr)

    if not args.dry_run:
        report_path = audit_dir / "_decisions.json"
        report_path.write_text(json.dumps(decisions, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Decisions: {report_path}", file=sys.stderr)
        print(f"Audit PNGs: {audit_dir}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
