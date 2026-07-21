#!/usr/bin/env python3
"""Trim empty "## Session HH:MM" stub blocks from memsearch shadow memory files.

Background: the memsearch Claude Code plugin (hooks/session-start.sh) writes a
"## Session HH:MM" heading to its shadow memory file on every session start, even
when the session produces nothing. The matching content is only written later by
hooks/stop.sh when the turn has real content. Sessions that start and close with
no captured content leave an empty heading. Those empty headings pollute both the
"# Recent Memory" cold-start injection and the search index.

This helper removes only the EMPTY blocks. An empty block is a "## Session ..."
heading whose body (every line until the next "## Session ..." heading or end of
file) has no non-blank lines. Blocks that carry any content (for example a
"### HH:MM" summary with bullets) are kept exactly as they are.

No hard delete: the caller copies each original file to the Trash before this
rewrites it, so removed content is always recoverable.

Usage:
  trim-memsearch-stubs.py [--dry-run] [--trash-dir DIR] FILE [FILE ...]

Output: one human-readable line per file, then a final line that starts with
"SUMMARY " followed by a JSON object (totals), so a wrapper can parse it.
"""

import argparse
import json
import os
import shutil
import sys

HEADER_PREFIX = "## Session "


def split_blocks(lines):
    """Return (preamble_lines, [(header_line, body_lines), ...])."""
    idx = [i for i, l in enumerate(lines) if l.startswith(HEADER_PREFIX)]
    if not idx:
        return lines, []
    preamble = lines[: idx[0]]
    blocks = []
    for n, i in enumerate(idx):
        end = idx[n + 1] if n + 1 < len(idx) else len(lines)
        blocks.append((lines[i], lines[i + 1 : end]))
    return preamble, blocks


def is_empty(body):
    return not any(l.strip() for l in body)


def process(path, dry_run, trash_dir):
    """Return (removed_count, kept_count) for one file."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError as e:
        print(f"  SKIP  {os.path.basename(path)} (cannot read: {e})")
        return (0, 0)

    lines = content.split("\n")
    preamble, blocks = split_blocks(lines)
    if not blocks:
        return (0, 0)

    kept = [(h, b) for (h, b) in blocks if not is_empty(b)]
    removed = len(blocks) - len(kept)
    if removed == 0:
        return (0, len(blocks))

    if not dry_run:
        if trash_dir:
            os.makedirs(trash_dir, exist_ok=True)
            shutil.copy2(path, os.path.join(trash_dir, os.path.basename(path)))
        out = list(preamble)
        for (h, b) in kept:
            out.append(h)
            out.extend(b)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(out))

    return (removed, len(kept))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--trash-dir", default="", help="copy originals here before rewriting")
    ap.add_argument("files", nargs="+")
    args = ap.parse_args()

    total_removed = 0
    total_kept = 0
    changed_files = 0

    for path in args.files:
        if not os.path.isfile(path):
            print(f"  SKIP  {path} (not a file)")
            continue
        removed, kept = process(path, args.dry_run, args.trash_dir or "")
        total_removed += removed
        total_kept += kept
        if removed:
            changed_files += 1
            verb = "would remove" if args.dry_run else "removed"
            print(f"  {os.path.basename(path):20} {verb} {removed:4d} empty, kept {kept:4d}")
        else:
            print(f"  {os.path.basename(path):20} clean ({kept} blocks, 0 empty)")

    print(
        "SUMMARY "
        + json.dumps(
            {
                "dry_run": args.dry_run,
                "files": len(args.files),
                "changed_files": changed_files,
                "removed": total_removed,
                "kept": total_kept,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
