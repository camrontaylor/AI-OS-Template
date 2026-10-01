#!/usr/bin/env python3
"""
Extract design tokens from an SVG file.

Walks the SVG tree and collects unique fill/stroke colors and font-family
declarations. Useful when the user exports Figma frames as SVG: those exports
preserve the exact colors and font names that the deterministic raster pipeline
(extract_tokens.py) would have to k-means / OCR back out.

Usage:
    python svg_to_tokens.py <input.svg> [--output tokens.json]

Returns a partial token sketch — feed into merge_extraction.py (deferred,
Phase 4) so it can be consolidated with other extraction passes.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


HEX_RE = re.compile(r"#[0-9a-fA-F]{3,6}\b")


def collect_attrs(svg_path: Path) -> dict:
    """Walk every element; collect fill/stroke colors + font-family strings."""
    text = svg_path.read_text(encoding="utf-8", errors="replace")

    colors: set[str] = set()
    fonts: set[str] = set()

    # Inline style="fill:#xxx;font-family:'Foo'" attributes
    for style in re.findall(r"style\s*=\s*\"([^\"]+)\"", text):
        for hex_val in HEX_RE.findall(style):
            colors.add(_normalize_hex(hex_val))
        for ff in re.findall(r"font-family\s*:\s*([^;]+)", style):
            fonts.add(_normalize_font(ff))

    # Element attrs fill="..." stroke="..." font-family="..."
    try:
        tree = ET.fromstring(text)
    except ET.ParseError:
        # Malformed XML — fall back to regex-only sweep
        tree = None

    if tree is not None:
        for el in tree.iter():
            for attr in ("fill", "stroke", "color"):
                val = el.attrib.get(attr) or el.attrib.get(f"{{http://www.w3.org/2000/svg}}{attr}")
                if val and val.startswith("#"):
                    colors.add(_normalize_hex(val))
            ff = el.attrib.get("font-family")
            if ff:
                fonts.add(_normalize_font(ff))

    # Discard SVG defaults (none, transparent, currentColor)
    colors.discard("#000")
    return {
        "colors": sorted(colors),
        "fonts": sorted(fonts),
        "source": str(svg_path),
    }


def _normalize_hex(val: str) -> str:
    v = val.strip().lower()
    # Expand #rgb to #rrggbb
    if len(v) == 4:
        v = "#" + "".join(c * 2 for c in v[1:])
    return v


def _normalize_font(val: str) -> str:
    # Strip surrounding quotes and trailing fallbacks
    head = val.split(",")[0].strip().strip("'\"")
    return head


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("svg", type=Path, help="Input .svg file (typically a Figma export)")
    ap.add_argument("--output", type=Path, default=None, help="Where to write the JSON sketch (default stdout)")
    args = ap.parse_args()

    if not args.svg.is_file():
        sys.exit(f"ERROR: not found: {args.svg}")

    sketch = collect_attrs(args.svg)
    payload = json.dumps(sketch, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
        print(f"Wrote: {args.output}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
