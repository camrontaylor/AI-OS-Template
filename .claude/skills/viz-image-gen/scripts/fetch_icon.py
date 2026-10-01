#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "requests>=2.31.0",
# ]
# ///
"""
Resolve an icon by name, using a deterministic source chain (NO AI fallback).

Resolution order (stop at first hit):
  1. brand_context/visual-identity/icons/{name}.svg       (brand-specific override)
  2. viz-image-gen/references/icons/commons/**/{name}.svg (curated local library, 58+ icons)
  3. Simple Icons CDN (CC0, ~3,300 brand icons)
  4. Lobehub Icons CDN (MIT, AI tools)
  5. Devicon CDN (MIT, dev tools / IDEs)

When fetched from CDN, the SVG is CACHED at brand_context/visual-identity/icons/{name}.svg
so subsequent lookups hit the local cache (step 1).

Source URL patterns documented in:
  .claude/skills/viz-image-gen/references/icons/README.md

Usage:
  uv run fetch_icon.py --name flame --brand-context brand_context
  uv run fetch_icon.py --name openai --brand-context brand_context --color "#E25A45"
  uv run fetch_icon.py --name vscode --brand-context brand_context --variant original

Output (stdout): JSON
  { "name": "flame", "source": "local_commons" | "simple_icons" | "lobehub" | "devicon" | "brand_override",
    "path": "<absolute path>", "url": "<cdn url if fetched>" }

Exit codes:
  0 = found (any source)
  1 = error (network / file)
  2 = not found in any source
"""

import argparse
import json
import os
import sys
from pathlib import Path

# CDN URL patterns (mirror of viz-image-gen/references/icons/README.md)
SIMPLE_ICONS_URL  = "https://cdn.simpleicons.org/{name}/{color}"          # color = hex w/o '#', or 'default'
SIMPLE_ICONS_RAW  = "https://cdn.simpleicons.org/{name}"
LOBEHUB_MONO      = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/{name}.svg"
LOBEHUB_COLOR     = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/{name}-color.svg"
DEVICON_URL       = "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/{name}/{name}-{variant}.svg"
DEVICON_VARIANTS  = ("original", "plain", "original-wordmark", "plain-wordmark")


def find_local(commons_root: Path, name: str) -> Path | None:
    """Search recursively in commons/ for {name}.svg."""
    if not commons_root.exists():
        return None
    matches = list(commons_root.rglob(f"{name}.svg"))
    return matches[0] if matches else None


def fetch(url: str, timeout: float = 10.0) -> bytes | None:
    """GET with timeout. Returns body bytes on 200, None otherwise."""
    import requests
    try:
        r = requests.get(url, timeout=timeout, headers={"User-Agent": "fetch_icon/1.0"})
        if r.status_code == 200 and r.content and len(r.content) > 50:
            # Sanity: SVGs usually start with '<?xml' or '<svg'
            head = r.content.lstrip()[:5].lower()
            if head.startswith(b"<?xml") or head.startswith(b"<svg"):
                return r.content
        return None
    except Exception:
        return None


def try_simple_icons(name: str, color: str | None) -> tuple[bytes, str] | None:
    color_clean = (color or "").lstrip("#").lower() or None
    url = SIMPLE_ICONS_URL.format(name=name, color=color_clean) if color_clean else SIMPLE_ICONS_RAW.format(name=name)
    body = fetch(url)
    return (body, url) if body else None


def try_lobehub(name: str, prefer_color: bool) -> tuple[bytes, str] | None:
    if prefer_color:
        url = LOBEHUB_COLOR.format(name=name)
        body = fetch(url)
        if body:
            return body, url
    url = LOBEHUB_MONO.format(name=name)
    body = fetch(url)
    return (body, url) if body else None


def try_devicon(name: str, variant: str | None) -> tuple[bytes, str] | None:
    variants_to_try = (variant,) if variant else DEVICON_VARIANTS
    for v in variants_to_try:
        url = DEVICON_URL.format(name=name, variant=v)
        body = fetch(url)
        if body:
            return body, url
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve an icon by name (local then CDN).")
    parser.add_argument("--name", required=True, help="Icon name (kebab-case, e.g., 'flame', 'openai', 'vscode').")
    parser.add_argument("--brand-context", required=True, help="brand_context/ directory (for cache + override lookup).")
    parser.add_argument("--commons", default=".claude/skills/viz-image-gen/references/icons/commons",
                        help="Path to the curated commons/ icons directory.")
    parser.add_argument("--color", default=None, help="Hex color for Simple Icons (e.g., '#E25A45' or 'E25A45').")
    parser.add_argument("--variant", default=None, choices=list(DEVICON_VARIANTS),
                        help="Devicon variant preference (e.g., 'original', 'plain').")
    parser.add_argument("--prefer-color", action="store_true", help="For Lobehub, try the -color variant first.")
    parser.add_argument("--no-fetch", action="store_true", help="Only check local sources (skip CDN).")
    args = parser.parse_args()

    name = args.name.strip().lower()
    brand_context = Path(args.brand_context).resolve()
    brand_icons_dir = brand_context / "visual-identity" / "icons"
    brand_icons_dir.mkdir(parents=True, exist_ok=True)
    commons_root = Path(args.commons).resolve()

    # 1. Brand override (cache or curated brand asset)
    brand_path = brand_icons_dir / f"{name}.svg"
    if brand_path.exists():
        print(json.dumps({"name": name, "source": "brand_override", "path": str(brand_path), "url": None}))
        return 0

    # 2. Curated commons
    local_hit = find_local(commons_root, name)
    if local_hit:
        print(json.dumps({"name": name, "source": "local_commons", "path": str(local_hit), "url": None}))
        return 0

    if args.no_fetch:
        print(json.dumps({"name": name, "source": None, "path": None, "url": None, "error": "not found locally (no-fetch)"}), file=sys.stderr)
        return 2

    # 3-5. CDN chain
    chain = (
        ("simple_icons", lambda: try_simple_icons(name, args.color)),
        ("lobehub",      lambda: try_lobehub(name, args.prefer_color)),
        ("devicon",      lambda: try_devicon(name, args.variant)),
    )
    for source_name, fetcher in chain:
        result = fetcher()
        if result is not None:
            body, url = result
            brand_path.write_bytes(body)
            print(json.dumps({"name": name, "source": source_name, "path": str(brand_path), "url": url}))
            return 0

    # Not found anywhere
    print(
        json.dumps({
            "name": name,
            "source": None,
            "path": None,
            "url": None,
            "error": "not found in local_commons, simple_icons, lobehub, or devicon",
            "next_action": "fetch manually from official brand press page or use type=vector subtype=ai-illustration",
        }),
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
