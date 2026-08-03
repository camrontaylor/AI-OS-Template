#!/usr/bin/env python3
"""recall-log.py - best-effort append sink for memory retrieval observability.

One compact JSONL record per recall, so we can later see what memory actually gets
retrieved and surfaced versus what sits in the index dead. This is the signal the
memory system needs before any adaptive behaviour (aging, ranking) is worth
building. See projects/briefs/memory-observability/brief.md.

Contract: this NEVER throws and NEVER blocks the caller. Any error -> exit 0 with
nothing logged. It must be invisible to the recall it is observing.

Record shape (one line):
  {"ts": iso8601, "kind": "retrieved"|"surfaced", "caller": str, "scope": str,
   "q": query[:200], "n": int, "items": [{"src","chunk","head","rank","score"}]}

Privacy/size: query is truncated; only source path + chunk hash + heading + rank +
score are kept (never the memory content). The log lives in the gitignored
.command-centre/, is capped, and rotates to one .1 generation.

Usage:
  recall-log.py --query Q --scope S --caller C [--kind retrieved|surfaced]
                (--results-file F | --items-json J)
Env: AI_OS_RECALL_LOG_DISABLE=1 bypasses entirely.
"""
import argparse
import fcntl
import json
import os
import sys
from datetime import datetime, timezone

# realpath so a symlinked/worktree checkout resolves to the same absolute prefix
# the search producers emit (memory-search.py uses path.resolve()); otherwise the
# startswith-ROOT strip below misses and sources fall through to the fragile marker.
ROOT = os.path.realpath(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
LOG_PATH = os.environ.get("AI_OS_RECALL_LOG_PATH") or os.path.join(ROOT, ".command-centre", "recall-usage.jsonl")
try:
    MAX_BYTES = int(os.environ.get("AI_OS_RECALL_LOG_MAX_BYTES") or 8 * 1024 * 1024)
except ValueError:
    MAX_BYTES = 8 * 1024 * 1024   # rotate past 8 MB; one .1 kept -> ~16 MB ceiling
MAX_ITEMS = 15                # top-k is normally <= 10; cap keeps a line < ~4 KB
QUERY_CAP = 200


def short_source(source):
    s = str(source or "").replace("\\", "/")
    if not s:
        return ""
    try:
        if s.startswith(ROOT + "/"):
            return s[len(ROOT) + 1:]
    except Exception:
        pass
    marker = "/AI-OS/"
    i = s.find(marker)
    if i >= 0:
        return s[i + len(marker):]
    return "/".join(s.split("/")[-2:])


def compact(results):
    """Turn a list of raw result dicts into compact, content-free items."""
    items = []
    for rank, r in enumerate(results[:MAX_ITEMS], start=1):
        if not isinstance(r, dict):
            continue
        score = r.get("score")
        if score is None:
            score = r.get("final_score")
        try:
            score = round(float(score), 3)
        except (TypeError, ValueError):
            score = None
        item = {
            "src": short_source(r.get("source") or r.get("source_path")),
            "chunk": str(r.get("chunk_hash") or "")[:16],
            "head": str(r.get("heading") or "")[:80],
            "rank": rank,
            "score": score,
        }
        # Scoring lane (semantic 0-1 cosine vs markdown term-rarity 20-150):
        # without it the two scales mix in one score field (2026-07-28).
        lane = r.get("lane")
        if lane:
            item["lane"] = str(lane)[:16]
        items.append(item)
    return items


def load_results(args):
    if args.items_json:
        return json.loads(args.items_json)
    if args.results_file and os.path.exists(args.results_file):
        with open(args.results_file, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        start = text.find("[")
        return json.loads(text[start:]) if start >= 0 else []
    return []


def append_record(record):
    """Flock-guarded append with pre-append size rotation.

    flock serialises concurrent writers so records never interleave, and releases
    when the fd closes (including on process death). The subtlety is rotation: a
    writer that was BLOCKED on the lock while another writer rotated the file would,
    if it trusted its own stale fd, rotate a second time and clobber the just-
    archived generation. So after acquiring the lock we verify our fd still refers
    to the live path; if it was rotated out from under us, we reopen and retry
    instead of rotating again.
    """
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    line = (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8", "replace")
    for _ in range(6):  # bounded: each rotation reopens the fresh file once
        fd = os.open(LOG_PATH, os.O_CREAT | os.O_RDWR | os.O_APPEND, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            # Someone may have rotated between our open() and our lock(). If our fd's
            # inode is no longer the live path, we are holding a rotated-out file.
            try:
                if os.stat(LOG_PATH).st_ino != os.fstat(fd).st_ino:
                    continue  # reopen the live file and retry
            except FileNotFoundError:
                continue
            # We hold the live file under lock. Rotate only if it is genuinely over.
            if os.fstat(fd).st_size > MAX_BYTES:
                try:
                    os.replace(LOG_PATH, LOG_PATH + ".1")
                except Exception:
                    pass
                continue  # reopen the fresh live file and write there
            os.write(fd, line)
            return
        finally:
            os.close(fd)  # also releases the flock
    # Best-effort: give up silently rather than spin forever.


def main():
    if os.environ.get("AI_OS_RECALL_LOG_DISABLE") == "1":
        return 0
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", default="")
    parser.add_argument("--scope", default="")
    parser.add_argument("--caller", default="manual")
    parser.add_argument("--kind", default="retrieved", choices=["retrieved", "surfaced"])
    parser.add_argument("--results-file", default="")
    parser.add_argument("--items-json", default="")
    args = parser.parse_args()

    results = load_results(args)
    if not isinstance(results, list):
        results = []
    items = compact(results)
    record = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "kind": args.kind,
        "caller": (args.caller or "manual")[:40],
        "scope": (args.scope or "")[:20],
        "q": str(args.query or "")[:QUERY_CAP],
        "n": len(items),
        "items": items,
    }
    append_record(record)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Observability must never break the thing it observes.
        sys.exit(0)
