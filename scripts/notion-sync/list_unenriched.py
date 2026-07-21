#!/usr/bin/env python3
"""
list_unenriched.py - show which catalog items still need a real record.

The daily sync is credit-free and only captures whatever Notion scraped, which
is often just a title. Enrichment (fetching the page and writing what the tool
actually does, or what the resource actually says) costs credits, so it is a
separate, deliberate step. This script is the work queue for that step.

Scope matches the enrichment store: stack and resources only. Notes are never
enriched, because that database holds client and personal material and the
store is committed to git.

Items whose source cannot be fetched (login-walled courses, job listings) are
reported separately so they are not mistaken for outstanding work.

Usage:
  python3 scripts/notion-sync/list_unenriched.py           # human-readable
  python3 scripts/notion-sync/list_unenriched.py --json    # for an agent to consume
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_catalog import (  # noqa: E402
    load_enrichment, load_db, dedupe, gated_label,
)


def collect():
    enrichment = load_enrichment()
    todo, gated = [], []
    for db in ("stack", "resources"):
        items, _ = dedupe(load_db(db, enrichment))
        for it in items:
            if it.get("enriched"):
                continue
            row = {
                "db": db,
                "notion_id": it.get("notion_id", ""),
                "name": it.get("name", ""),
                "url": it.get("url", ""),
                "current_desc": it.get("desc", ""),
            }
            label = gated_label(it.get("url", ""))
            if label:
                row["reason"] = label
                gated.append(row)
            else:
                todo.append(row)
    return todo, gated


def main():
    ap = argparse.ArgumentParser(description="List catalog items needing enrichment")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    todo, gated = collect()

    if args.json:
        print(json.dumps({"todo": todo, "gated": gated}, indent=2, ensure_ascii=False))
        return

    if not todo:
        print("Nothing to enrich. Every fetchable tool and resource has a real record.")
    else:
        print(f"{len(todo)} item(s) need enrichment:\n")
        for r in todo:
            print(f"  [{r['db']}] {r['name'][:70]}")
            print(f"      {r['url']}")
            print(f"      now: {r['current_desc'][:80] or '(no description)'}")
            print()

    if gated:
        print(f"{len(gated)} item(s) cannot be auto-enriched (reported, not outstanding work):")
        for r in gated:
            print(f"  - {r['name'][:60]}  ({r['reason']})")


if __name__ == "__main__":
    main()
