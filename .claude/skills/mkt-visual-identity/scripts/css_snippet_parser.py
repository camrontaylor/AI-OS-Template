#!/usr/bin/env python3
"""
Extract design tokens from raw CSS snippets the user pasted from Figma.

Figma's "Copy as code → CSS" output looks like:
    background: #14130f;
    font-family: 'Fraunces', serif;
    font-size: 48px;
    line-height: 1.05;
    letter-spacing: -0.025em;

This parser scans any .css / .txt / .md the user dropped in the inbox and
collects the declared values, returning a partial token sketch.

Usage:
    python css_snippet_parser.py <input.css|.txt|.md> [--output tokens.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


COLOR_RE = re.compile(
    r"(?:background(?:-color)?|color|fill|stroke|border-color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^\)]+\))",
    re.IGNORECASE,
)
FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;}\n]+)", re.IGNORECASE)
FONT_SIZE_RE = re.compile(r"font-size\s*:\s*([\d.]+)(px|rem|em)", re.IGNORECASE)
FONT_WEIGHT_RE = re.compile(r"font-weight\s*:\s*(\d{3}|bold|normal)", re.IGNORECASE)


def parse(text: str) -> dict:
    colors = set()
    for raw in COLOR_RE.findall(text):
        colors.add(_normalize_color(raw))

    fonts = set()
    for raw in FONT_FAMILY_RE.findall(text):
        head = raw.split(",")[0].strip().strip("'\";")
        if head:
            fonts.add(head)

    sizes = []
    for value, unit in FONT_SIZE_RE.findall(text):
        sizes.append({"value": float(value), "unit": unit.lower()})

    weights = sorted({_normalize_weight(w) for w in FONT_WEIGHT_RE.findall(text)})

    return {
        "colors": sorted(colors),
        "fonts": sorted(fonts),
        "font_sizes": sizes,
        "font_weights": weights,
    }


def _normalize_color(val: str) -> str:
    v = val.strip().lower()
    if v.startswith("#") and len(v) == 4:
        v = "#" + "".join(c * 2 for c in v[1:])
    return v


def _normalize_weight(w: str) -> int:
    w = w.strip().lower()
    if w == "bold":
        return 700
    if w == "normal":
        return 400
    try:
        return int(w)
    except ValueError:
        return 400


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path, help="File containing pasted CSS (e.g., Figma 'Copy as code')")
    ap.add_argument("--output", type=Path, default=None)
    args = ap.parse_args()

    if not args.input.is_file():
        sys.exit(f"ERROR: not found: {args.input}")

    sketch = parse(args.input.read_text(encoding="utf-8", errors="replace"))
    sketch["source"] = str(args.input)
    payload = json.dumps(sketch, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
        print(f"Wrote: {args.output}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
