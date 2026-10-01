#!/usr/bin/env python3
"""Load brand_kit from disk — reads assets.md + tokens.md from brand_context/.

Falls back to defaults at mkt-brand-voice/references/defaults/anthropic-ish/ when
the user's brand_context is missing.

Usage:
    python brand_kit_loader.py                            # auto-detect project root
    python brand_kit_loader.py --brand-context <path>     # override
    python brand_kit_loader.py --json                     # emit JSON (machine-readable)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent


def find_project_root(start: Path) -> Path:
    for c in [start, *start.parents]:
        if c.name == ".claude":
            continue
        if (c / ".claude").is_dir():
            return c
    return Path.cwd()


PROJECT_ROOT = find_project_root(SCRIPT_DIR)
DEFAULTS_DIR = PROJECT_ROOT / ".claude" / "skills" / "mkt-brand-voice" / "references" / "defaults" / "anthropic-ish"


def grep1(text: str, pattern: str, default: str | None = None) -> str | None:
    m = re.search(pattern, text, re.MULTILINE)
    return m.group(1).strip() if m else default


def grep_all(text: str, pattern: str) -> list[str]:
    return [m.group(1).strip() for m in re.finditer(pattern, text)]


def parse_assets_md(text: str) -> dict:
    """Parse the assets.md schema into a structured brand_kit."""
    brand = grep1(text, r"^# (.+?) — Visual Assets")
    primary = grep1(text, r"\*\*Primary:\*\* `(#[0-9a-fA-F]{6})`")
    secondary = grep1(text, r"\*\*Secondary:\*\* `(#[0-9a-fA-F]{6})`")
    background = grep1(text, r"\*\*Background:\*\* `(#[0-9a-fA-F]{6})`")
    text_color = grep1(text, r"\*\*Text:\*\* `(#[0-9a-fA-F]{6})`")
    accents = grep_all(text, r"\*\*Accent \d+:\*\* `(#[0-9a-fA-F]{6})`")

    sketch_color = grep1(text, r"\*\*Sketch color:\*\* `(#[0-9a-fA-F]{6})`")
    sketch_weight = grep1(text, r"\*\*Sketch weight:\*\* (\w+)")
    sketch_personality = grep1(text, r"\*\*Sketch personality:\*\* (\w+)")

    logo_primary = grep1(text, r"\*\*Primary logo path:\*\* (.+)")
    logo_dark = grep1(text, r"\*\*Logo on dark background:\*\* (.+)")
    logo_placement = grep1(text, r"\*\*Preferred placement:\*\* ([\w-]+)")
    logo_size = grep1(text, r"\*\*Preferred size:\*\* (\d+)%")
    logo_alt = grep1(text, r"\*\*Alt text:\*\* (.+)")

    author_name = grep1(text, r"\*\*Display name:\*\* (.+)")
    author_handle = grep1(text, r"\*\*Handle \(optional\):\*\* (.+)")
    author_headshot = grep1(text, r"\*\*Headshot path \(optional\):\*\* (.+)")

    mood_match = re.search(r"## Mood \(AI Prompt Block\)\s*\n\s*```\n([\s\S]+?)\n```", text)
    mood_block = mood_match.group(1).strip() if mood_match else ""

    headline_family = grep1(text, r"\*\*Headline:\*\* ([^\n—\-]+)")
    body_family = grep1(text, r"\*\*Body:\*\* ([^\n—\-]+)")

    def clean(v: str | None) -> str | None:
        if v is None or v.strip().lower() in {"unknown", "", "tbd"}:
            return None
        return v.strip()

    return {
        "brand": brand,
        "colors": {
            "primary": (primary or "").lower() or None,
            "secondary": (secondary or "").lower() or None,
            "background": (background or "").lower() or None,
            "text": (text_color or "").lower() or None,
            "accents": [a.lower() for a in accents],
        },
        "sketch": {
            "color": (sketch_color or "").lower() or None,
            "weight": sketch_weight,
            "personality": sketch_personality,
        },
        "logo": {
            "primary_path": clean(logo_primary),
            "dark_variant_path": clean(logo_dark),
            "placement": logo_placement or "top-left",
            "size_pct_width": int(logo_size) if logo_size and logo_size.isdigit() else 8,
            "alt": clean(logo_alt) or "brand logo",
        },
        "author": {
            "display_name": clean(author_name),
            "handle": clean(author_handle),
            "headshot_path": clean(author_headshot),
        },
        "fonts": {
            "headline_family": clean(headline_family),
            "body_family": clean(body_family),
        },
        "mood_block": mood_block,
    }


def parse_tokens_md(text: str) -> dict:
    """Parse the tokens.md schema into structural tokens."""
    type_scale = {}
    for key, label in [
        ("display", "Display"), ("h1", "H1"), ("h2", "H2"), ("h3", "H3"),
        ("body_l", "Body L"), ("body_m", "Body M"), ("body_s", "Body S"),
        ("caption", "Caption"),
    ]:
        m = re.search(rf"\*\*{label}:\*\* (\d+)", text)
        if m:
            type_scale[key] = int(m.group(1))

    spacing = {}
    for token, val in re.findall(r"`(2xs|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl)`\s+(\d+)", text):
        spacing[token] = int(val)

    grid = {}
    canvas = re.search(r"Carousel canvas:\s*\*\*(\d+)×(\d+)px\*\*", text)
    if canvas:
        grid["canvas_width"] = int(canvas.group(1))
        grid["canvas_height"] = int(canvas.group(2))
    cols = grep1(text, r"Columns:\s*(\d+)")
    if cols:
        grid["columns"] = int(cols)

    density = grep1(text, r"\*\*Density:\*\*\s*([\w\-]+)")
    tone = grep1(text, r"\*\*Tone alignment:\*\*\s*([\w\-]+)")

    aspects = {}
    for skill, w, h in re.findall(r"-\s+([\w\-]+):\s+(\d+)×(\d+)", text):
        aspects[skill] = [int(w), int(h)]

    return {
        "type_scale": type_scale,
        "spacing": spacing,
        "grid": grid,
        "density": density,
        "tone": tone,
        "aspect_ratios": aspects,
    }


def load(brand_context: Path | None = None) -> dict:
    """Load brand_kit. Order: user's brand_context tokens.json (v3 schema, AUTHORITATIVE) →
    user's assets.md/tokens.md (legacy markdown schema) → defaults → empty.

    Returns a merged dict where user values override defaults.

    BRAND WINS RULE — when `visual-identity/tokens.json` exists in the brand_context,
    its colors/fonts/type_scale take precedence over anything else (defaults, legacy md).
    Without this, brands using the v3 schema (tokens.json only) fall through to
    defaults/anthropic-ish/ and render with the wrong accent color (the chartreuse
    accent bug). See feedback memory feedback-scene-template-bbox-mandatory.
    """
    if brand_context is None:
        brand_context = PROJECT_ROOT / "brand_context"

    def read(p: Path) -> str:
        return p.read_text(encoding="utf-8") if p.is_file() else ""

    # Start with defaults
    default_assets = read(DEFAULTS_DIR / "assets.md")
    default_tokens = read(DEFAULTS_DIR / "tokens.md")
    kit = parse_assets_md(default_assets) if default_assets else {}
    kit.update({"tokens": parse_tokens_md(default_tokens) if default_tokens else {}})

    # Override with user's legacy markdown values
    user_assets = read(brand_context / "assets.md")
    user_tokens = read(brand_context / "tokens.md")
    if user_assets:
        user_kit = parse_assets_md(user_assets)
        # shallow merge — user wins for any non-None fields
        for k, v in user_kit.items():
            if isinstance(v, dict):
                kit.setdefault(k, {})
                for sk, sv in v.items():
                    if sv is not None and sv != [] and sv != "":
                        kit[k][sk] = sv
            elif v is not None:
                kit[k] = v
    if user_tokens:
        kit["tokens"] = parse_tokens_md(user_tokens)

    # v3 schema (AUTHORITATIVE): read brand_context/visual-identity/tokens.json
    # and overlay everything on top. Schema differs from legacy md — colors are
    # named (accent, bg_dark, text_on_dark, etc.) rather than indexed accents[].
    v3_tokens_path = brand_context / "visual-identity" / "tokens.json"
    if v3_tokens_path.is_file():
        try:
            v3 = json.loads(v3_tokens_path.read_text(encoding="utf-8"))
            # Top-level brand identity
            if v3.get("brand"):
                kit["brand"] = v3["brand"]
            # Colors — overlay v3 keys ONTO existing colors dict. Both schemas can coexist.
            v3_colors = v3.get("colors") or {}
            kit.setdefault("colors", {})
            for k, v in v3_colors.items():
                if v:
                    kit["colors"][k] = v
            # Synthesize legacy `accents[]` from v3 `accent` + `accent_secondary` so
            # downstream code reading `colors.accents` still works.
            v3_accent = v3_colors.get("accent")
            v3_accent_2 = v3_colors.get("accent_secondary")
            synthesized_accents = [c for c in (v3_accent, v3_accent_2) if c]
            if synthesized_accents and not kit["colors"].get("accents"):
                kit["colors"]["accents"] = synthesized_accents
            # Fonts — v3 has fonts.{display,body,micro}.{family,weight,style}
            v3_fonts = v3.get("fonts") or {}
            if v3_fonts:
                kit.setdefault("fonts", {})
                # Preserve v3 nested structure (consumed by build_brand_tokens_css)
                for role, role_cfg in v3_fonts.items():
                    if isinstance(role_cfg, dict):
                        kit["fonts"][role] = role_cfg
                # Also project to legacy flat keys for backwards compat
                if isinstance(v3_fonts.get("display"), dict) and v3_fonts["display"].get("family"):
                    kit["fonts"]["headline_family"] = v3_fonts["display"]["family"]
                if isinstance(v3_fonts.get("body"), dict) and v3_fonts["body"].get("family"):
                    kit["fonts"]["body_family"] = v3_fonts["body"]["family"]
            # Type scale — top-level in v3
            if v3.get("type_scale"):
                kit["type_scale"] = v3["type_scale"]
                kit.setdefault("tokens", {})["type_scale"] = v3["type_scale"]
            # Canvas
            if v3.get("canvas"):
                kit["canvas"] = v3["canvas"]
                kit.setdefault("tokens", {})["grid"] = {
                    "canvas_width": v3["canvas"].get("width"),
                    "canvas_height": v3["canvas"].get("height"),
                }
            # Tagline, locked_fields, schema version, chrome
            for passthrough in ("tagline", "locked_fields", "version", "spacing", "chrome"):
                if v3.get(passthrough) is not None:
                    kit[passthrough] = v3[passthrough]
            # Chrome migration warning: legacy schema (logo_path/page_indicator)
            # without masthead.labels[] — surfaces silently-degraded chrome to caller.
            chrome = kit.get("chrome") or {}
            if isinstance(chrome, dict):
                has_legacy_keys = any(k in chrome for k in ("logo_path", "headshot_path", "page_indicator", "creator_badge"))
                masthead = chrome.get("masthead") or {}
                has_new_masthead = isinstance(masthead, dict) and isinstance(masthead.get("labels"), list)
                if has_legacy_keys and not has_new_masthead:
                    print(
                        "[brand_kit_loader] WARN: tokens.json > chrome uses legacy schema "
                        "(logo_path/page_indicator/creator_badge). primitive_to_template.py "
                        "needs chrome.masthead.labels[] + chrome.pagination{} for editorial chrome. "
                        "Run mkt-visual-identity Step 0.3 to capture masthead labels.",
                        file=sys.stderr,
                    )
        except (json.JSONDecodeError, OSError) as e:
            print(f"[brand_kit_loader] WARN: failed to read v3 tokens.json: {e}", file=sys.stderr)

    # Resolve logo path: v3 brand_context/visual-identity/logos/*-transparent.png
    # takes precedence over legacy assets.md path (which may point at archived defaults).
    logos_dir = brand_context / "visual-identity" / "logos"
    if logos_dir.is_dir():
        for pattern in ("*-transparent.png", "*-transparent.svg", "*.svg"):
            for candidate in sorted(logos_dir.glob(pattern)):
                if "_bg_clean" in candidate.parts:
                    continue
                kit.setdefault("logo", {})["primary_path"] = str(candidate.resolve())
                break
            if kit.get("logo", {}).get("primary_path"):
                break

    kit["_brand_context"] = str(brand_context.resolve())
    return kit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand-context", type=Path, default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    kit = load(args.brand_context)
    if args.json:
        print(json.dumps(kit, indent=2, ensure_ascii=False))
    else:
        # human-readable summary
        c = kit.get("colors", {})
        t = kit.get("tokens", {})
        print(f"Brand: {kit.get('brand')}")
        print(f"Brand context: {kit.get('_brand_context')}")
        print(f"Colors: {c.get('primary')} / {c.get('secondary')} / {c.get('background')} / {c.get('text')}")
        if c.get("accents"):
            print(f"Accents: {', '.join(c['accents'])}")
        ts = t.get("type_scale", {})
        if ts:
            print(f"Type scale: display={ts.get('display')} h1={ts.get('h1')} h2={ts.get('h2')} body_m={ts.get('body_m')}")
        if t.get("tone"):
            print(f"Tone: {t['tone']}, density: {t.get('density')}")


if __name__ == "__main__":
    main()
