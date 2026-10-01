#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Query the pool manifest by role/bg/tone/fits filters; return matching template ids.

Used by downstream skills (00-social-content, ssc-designer) to pick templates per slide.

Usage:
    # All CTA templates that need a person portrait bg:
    uv run pick_template.py --manifest <path>/manifest.json --role cta --bg-subject person-portrait

    # All body templates that don't need a bg subject (texture-only):
    uv run pick_template.py --manifest <path>/manifest.json --role body --bg-subject textured

    # First match for a tone:
    uv run pick_template.py --manifest <path>/manifest.json --role cover --tone founder-led --first

    # JSON output for piping:
    uv run pick_template.py --manifest <path>/manifest.json --role cta --json
"""
import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--role", choices=["cover", "body", "cta"], help="Filter by role")
    ap.add_argument("--bg-subject", help="Filter by bg subject_type (person-portrait/product-shot/scene-backdrop/textured/none)")
    ap.add_argument("--tone", help="Filter by tone tag (must match exactly one of the template's tone[])")
    ap.add_argument("--fits", help="Filter by fits tag")
    ap.add_argument("--has-composition", action="store_true", help="Only templates with composition_techniques declared")
    ap.add_argument("--status", default="ready", help="Filter by status (default: ready)")
    ap.add_argument("--first", action="store_true", help="Return only the first match")
    ap.add_argument("--json", action="store_true", help="Output full entries as JSON")
    args = ap.parse_args()

    if not args.manifest.exists():
        print(f"Error: manifest not found: {args.manifest}", file=sys.stderr)
        return 1

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    templates = manifest.get("templates", {})

    matches = []
    for tid, entry in templates.items():
        if args.role and entry.get("role") != args.role:
            continue
        if args.bg_subject and entry.get("bg_subject_type") != args.bg_subject:
            continue
        if args.tone and args.tone not in (entry.get("tone") or []):
            continue
        if args.fits and args.fits not in (entry.get("fits") or []):
            continue
        if args.has_composition and not entry.get("has_composition_techniques"):
            continue
        if args.status and entry.get("status") != args.status:
            continue
        matches.append(entry)

    if args.first and matches:
        matches = matches[:1]

    if args.json:
        print(json.dumps(matches, indent=2))
    else:
        for m in matches:
            print(m["id"])
    return 0 if matches else 1


if __name__ == "__main__":
    sys.exit(main())
