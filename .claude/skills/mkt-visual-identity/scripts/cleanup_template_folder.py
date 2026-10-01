#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Move ALL diagnostic / log / iteration artifacts to {template_dir}/_workdir/.

The template root stays clean and contains only:
  - ref.png                       (source ref)
  - bg.png                        (cleaned bg, from clean_ref.py)
  - template.html                 (deterministic translation of _measurements.yaml)
  - instructions.md               (slot documentation)
  - _measurements.yaml            (source of truth)
  - preview.png                   (final render)
  - *.ttf                         (font files for @font-face)
  - <asset>.png                   (brand-extracted assets used by template, e.g. badge-tight.png)

Everything else (_comparison.png, _grid*.png, _overlay.png, _diff.png, *.log.md,
old iteration files _grid_vN.png, etc.) moves to _workdir/.

Usage:
    uv run cleanup_template_folder.py --template-dir path/to/template/folder
    uv run cleanup_template_folder.py --template-dir path/... --dry-run  # preview only"""
import argparse
import re
import shutil
import sys
from pathlib import Path


# KEEP these at root (source-of-truth + final outputs)
KEEP_ROOT_EXACT = {
    "ref.png",
    "bg.png",
    "template.html",
    "instructions.md",
    "_measurements.yaml",
    "preview.png",
}
KEEP_ROOT_PATTERNS = [
    re.compile(r"\.ttf$"),
    re.compile(r"\.woff2?$"),
    re.compile(r"^badge.*\.png$"),     # brand-extracted assets referenced by template
    re.compile(r"^icon.*\.png$"),
    re.compile(r"^logo.*\.png$"),
]
# These ALWAYS move to _workdir/
MOVE_PATTERNS = [
    re.compile(r"_clean-prompt.*\.txt$"),
    re.compile(r"\.log\.md$"),
    re.compile(r"_comparison\.png$"),
    re.compile(r"_grid.*\.png$"),
    re.compile(r"_overlay.*\.png$"),
    re.compile(r"_diff.*\.png$"),
    re.compile(r"_inspect.*\.png$"),
    re.compile(r"_inventory\.yaml$"),  # superseded by _measurements.yaml
]


def should_keep_at_root(name: str) -> bool:
    if name in KEEP_ROOT_EXACT:
        return True
    for pat in KEEP_ROOT_PATTERNS:
        if pat.search(name):
            return True
    return False


def should_move(name: str) -> bool:
    for pat in MOVE_PATTERNS:
        if pat.search(name):
            return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--template-dir", required=True, type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    tdir = args.template_dir.resolve()
    if not tdir.is_dir():
        print(f"Error: not a directory: {tdir}", file=sys.stderr)
        return 1

    workdir = tdir / "_workdir"
    moved = []
    skipped_keep = []
    unknown = []

    for item in tdir.iterdir():
        if item.name == "_workdir":
            continue  # don't recurse
        if item.is_dir():
            # Whole subdirs that look like work-folders move too
            if item.name.startswith("_") and item.name != "_workdir":
                moved.append(item)
            continue
        if should_keep_at_root(item.name):
            skipped_keep.append(item.name)
        elif should_move(item.name):
            moved.append(item)
        else:
            unknown.append(item.name)

    print(f"Template dir: {tdir}")
    print(f"  KEEP at root: {len(skipped_keep)} files")
    for n in sorted(skipped_keep):
        print(f"    - {n}")
    print(f"  MOVE to _workdir/: {len(moved)} files")
    for f in sorted(moved, key=lambda p: p.name):
        print(f"    - {f.name}")
    if unknown:
        print(f"  UNKNOWN (skipped, no rule): {len(unknown)} files")
        for n in sorted(unknown):
            print(f"    - {n}")

    if args.dry_run:
        print("\n[dry-run] no changes made.")
        return 0

    if not moved:
        print("\n[ok] nothing to clean.")
        return 0

    workdir.mkdir(exist_ok=True)
    for f in moved:
        dest = workdir / f.name
        if dest.exists():
            dest.unlink() if dest.is_file() else shutil.rmtree(dest)
        if f.is_dir():
            shutil.move(str(f), str(dest))
        else:
            shutil.move(str(f), str(dest))
    print(f"\n[ok] moved {len(moved)} item(s) to {workdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
