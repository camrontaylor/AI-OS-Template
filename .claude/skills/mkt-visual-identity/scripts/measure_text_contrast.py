#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "numpy>=1.26.0", "pyyaml>=6.0"]
# ///
"""Measure WCAG contrast ratio between text color and bg luminance under each text bbox.

KNOWN LIMITATION: this script measures BG luminance only — it does NOT factor `text-shadow`
or display weight. An element with strong text-shadow may render legibly but still flag LOW.
Treat LOW verdicts as ADVISORY when:
  - The element's CSS class has a heavy text-shadow (e.g., 0 2px 4px rgba(0,0,0,0.95))
  - The element is display-large weight (font_size > 8cqw + font_weight 900)
Otherwise treat LOW as a HARD fix-required signal.


Reads the rendered preview.png + _measurements.yaml. For each element with role in
PRIMARY_ROLES (body, headline, display, kicker), samples the average bg luminance under
that bbox in the rendered preview, then computes the WCAG contrast ratio vs the declared
color_role (white = text-on-dark, black = text-on-light).

Outputs warnings for elements where contrast_ratio < 4.5 (WCAG AA for body) or < 3.0 (large).

Why preview.png not bg.png: the scrim is applied at render time, so the EFFECTIVE bg
luminance under text already includes the scrim's darkening. Sampling preview gives the
real-world contrast a viewer will see.

Usage:
    uv run measure_text_contrast.py --preview <path>/preview.png --measurements <path>/_measurements.yaml
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import yaml


# WCAG relative luminance
def relative_luminance(r: float, g: float, b: float) -> float:
    """sRGB → relative luminance per WCAG."""
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(L1: float, L2: float) -> float:
    """WCAG contrast ratio. L1 > L2 conventionally."""
    if L1 < L2:
        L1, L2 = L2, L1
    return (L1 + 0.05) / (L2 + 0.05)


# Approximate text-color luminance per color_role (assumes brand defaults)
ROLE_LUMINANCE = {
    "text-on-dark": 1.0,    # white
    "text-on-light": 0.0,   # black
    "accent": 0.15,         # brand accent — approximated as mid-dark
    "auto": 1.0,            # bg-adaptive (auto-luminance token) — advisory only (see HARD_GATED_ROLES)
}


# WCAG thresholds
WCAG_AA_NORMAL = 4.5
WCAG_AA_LARGE = 3.0   # ≥18pt regular or ≥14pt bold

# Only TEXT roles are HARD-gated against WCAG. Logos / brand-badges / decorative
# accent graphics (color_role == "accent") are not text — WCAG legibility thresholds
# don't apply. They're reported ADVISORY so a genuinely invisible mark still gets
# surfaced, but they never hard-fail the gate. Without this, the coral Claude
# brand-badge (a logo) hard-failed at ~1.9:1 as if it were body copy.
HARD_GATED_ROLES = {"text-on-light", "text-on-dark"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", required=True, type=Path)
    ap.add_argument("--measurements", required=True, type=Path)
    ap.add_argument("--threshold", type=float, default=4.5, help="Contrast ratio floor (default WCAG AA 4.5)")
    args = ap.parse_args()

    if not args.preview.exists() or not args.measurements.exists():
        print("Error: preview or measurements not found", file=sys.stderr)
        return 1

    img = Image.open(args.preview).convert("RGB")
    arr = np.array(img)
    H, W = arr.shape[:2]

    meas = yaml.safe_load(args.measurements.read_text(encoding="utf-8")) or {}

    warnings = []
    print(f"Contrast audit on {args.preview.name} (threshold {args.threshold:.1f}):\n")
    print(f"  {'element_id':<32} {'role':<14} {'bg_lum':>7} {'text_lum':>9} {'contrast':>9} {'verdict'}")
    print("  " + "-" * 90)

    # Elements that carry their OWN background fill (a coral pill, the numeral seal, a
    # callout card) provide their own contrast surface — sampling the SCENE bg behind
    # them is meaningless and produces false LOWs (white-on-coral pill reads fine but
    # the scene behind the pill is dark → fake 2.5:1). Skip them: their text/fill combo
    # is a brand-controlled constant, validated once in the brand bible, not per-post.
    OWN_FILL_TYPES = {"pill", "badge", "card", "seal", "callout-card"}
    OWN_FILL_ID_HINTS = ("pill", "badge", "seal", "numeral", "card", "callout")

    for el in meas.get("elements", []) or []:
        bb = el.get("bbox_pct") or []
        if len(bb) != 4:
            continue
        eid_l = str(el.get("id", "")).lower()
        el_type = str(el.get("type", "")).lower()
        if el_type in OWN_FILL_TYPES or any(h in eid_l for h in OWN_FILL_ID_HINTS):
            print(f"  {el.get('id','?'):<32} {'(own-fill)':<14} {'—':>7} {'—':>9} {'—':>9}  SKIP")
            continue
        color_role = el.get("color_role", "text-on-dark")
        text_lum = ROLE_LUMINANCE.get(color_role, 1.0)
        # Large display text uses the WCAG AA LARGE floor (3.0:1), not 4.5 — big bold
        # headlines/numerals are legible at lower ratios. Detect via font size if present.
        fsize = el.get("font_size_cqw") or el.get("font_size") or 0
        try:
            fsize = float(str(fsize).replace("cqw", "").strip() or 0)
        except ValueError:
            fsize = 0
        el_threshold = WCAG_AA_LARGE if fsize >= 8 else args.threshold
        l, t, w, h = bb
        x0 = max(0, int(l / 100 * W))
        x1 = min(W, int((l + w) / 100 * W))
        y0 = max(0, int(t / 100 * H))
        y1 = min(H, int((t + h) / 100 * H))
        if x1 - x0 < 5 or y1 - y0 < 5:
            continue
        region = arr[y0:y1, x0:x1]
        # Sample the BG behind the text by masking out pixels close to the text color
        # (so thin antialiased strokes don't bias the bg luminance). The text color is
        # taken from color_role. NOTE (known limit, see docstring): for an element whose
        # color is bg-adaptive (auto-luminance token) the declared role may not match the
        # rendered color — such elements should carry `color_role: auto` and are advisory.
        if color_role == "text-on-dark":
            mask = ~((region[..., 0] > 220) & (region[..., 1] > 220) & (region[..., 2] > 220))
        elif color_role == "text-on-light":
            mask = ~((region[..., 0] < 50) & (region[..., 1] < 50) & (region[..., 2] < 50))
        else:
            mask = np.ones(region.shape[:2], dtype=bool)
        if mask.sum() < 10:
            continue
        bg_pixels = region[mask]
        lums = np.array([relative_luminance(p[0], p[1], p[2]) for p in bg_pixels[::max(1, len(bg_pixels)//500)]])
        bg_lum = float(lums.mean())
        cr = contrast_ratio(text_lum, bg_lum)
        # An element whose color is bg-adaptive (auto-luminance token) can't be hard-gated
        # by a static role — the renderer already matched its color to the bg. Treat as advisory.
        is_text = color_role in HARD_GATED_ROLES
        if cr >= el_threshold:
            verdict = "OK"
        else:
            verdict = "LOW" if is_text else "LOW(advisory:non-text)"
        eid = el.get("id", "?")
        print(f"  {eid:<32} {color_role:<14} {bg_lum:>7.3f} {text_lum:>9.3f} {cr:>8.2f}:1  {verdict}")
        if cr < el_threshold and is_text:
            warnings.append(
                f"[contrast] {eid} role={color_role} contrast={cr:.2f}:1 below threshold "
                f"{el_threshold:.1f} (WCAG AA) — bg avg luminance {bg_lum:.2f} too close to "
                f"text luminance {text_lum:.2f}. Flip text color OR add scrim/plate OR move element."
            )
        elif cr < el_threshold and not is_text:
            print(f"     ↳ advisory: non-text element (role={color_role}); not hard-gated. "
                  f"Verify the mark is still visible.", file=sys.stderr)

    print()
    if warnings:
        print(f"[fail] {len(warnings)} contrast violation(s):", file=sys.stderr)
        for w in warnings:
            print(f"  - {w}", file=sys.stderr)
        return 2
    print("[ok] all text elements meet contrast threshold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
