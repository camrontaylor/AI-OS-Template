#!/usr/bin/env python3
"""
Load a Design Tokens Community Group (W3C DTCG) or Tokens Studio export.

DTCG / Tokens Studio JSON looks like:
    {
      "colors": {
        "primary": { "$value": "#0a0a0a", "$type": "color" },
        "accent":  { "$value": "#e25a45", "$type": "color" }
      },
      "fontFamily": {
        "display": { "$value": "Geist Black", "$type": "fontFamily" }
      },
      "fontSize": {
        "h1": { "$value": "108px", "$type": "dimension" }
      }
    }

This loader walks the tree, normalizes structure, and returns a sketch that
merge_extraction.py (Phase 4) can fold into brand_context/visual-identity/tokens.json.

Usage:
    python dtcg_loader.py <tokens.json> [--output sketch.json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def walk(node, prefix: tuple = ()) -> list[dict]:
    """Depth-first yield of every leaf {$value, $type, path}."""
    out: list[dict] = []
    if isinstance(node, dict):
        if "$value" in node:
            out.append({
                "path": ".".join(prefix),
                "value": node.get("$value"),
                "type":  node.get("$type"),
            })
            return out
        for k, v in node.items():
            if k.startswith("$"):
                continue  # metadata
            out.extend(walk(v, prefix + (k,)))
    return out


def to_sketch(leaves: list[dict]) -> dict:
    colors: dict[str, str] = {}
    fonts: dict[str, str] = {}
    sizes: dict[str, str] = {}
    weights: dict[str, int] = {}
    spacing: dict[str, str] = {}

    for leaf in leaves:
        t = (leaf.get("type") or "").lower()
        path = leaf.get("path") or ""
        val = leaf.get("value")
        if val is None:
            continue
        if t == "color" or path.startswith(("colors.", "color.")):
            colors[path] = str(val).lower()
        elif t in ("fontfamily", "font-family") or path.startswith(("fontFamily.", "fonts.", "typography.")):
            if isinstance(val, list):
                val = val[0]
            fonts[path] = str(val).strip("'\"")
        elif t in ("dimension", "fontsize") or path.startswith(("fontSize.", "size.", "type.")):
            sizes[path] = str(val)
        elif t == "fontweight" or path.startswith(("fontWeight.", "weight.")):
            try:
                weights[path] = int(val) if str(val).isdigit() else {"bold": 700, "normal": 400}.get(str(val).lower(), 400)
            except (TypeError, ValueError):
                weights[path] = 400
        elif t in ("spacing", "size") or "spacing" in path:
            spacing[path] = str(val)

    return {
        "colors":   colors,
        "fonts":    fonts,
        "sizes":    sizes,
        "weights":  weights,
        "spacing":  spacing,
    }


def load(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    leaves = walk(payload)
    return to_sketch(leaves)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path, help="Path to a Tokens Studio / DTCG export (JSON)")
    ap.add_argument("--output", type=Path, default=None)
    args = ap.parse_args()
    if not args.input.is_file():
        sys.exit(f"ERROR: not found: {args.input}")
    sketch = load(args.input)
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
