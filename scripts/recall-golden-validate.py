#!/usr/bin/env python3
"""recall-golden-validate.py - the integrity guard for golden recall sets.

The daily-recall-self-improve job edits golden sets autonomously. A golden set is
load-bearing: scripts/test-recall-golden.sh (the authoritative nightly gate) reads
it, so a corrupt set does not just lose a case - it can break the whole recall
health signal. This validator is the deterministic net under that autonomy. Run it
after any automated edit; if it fails, restore from the pre-edit snapshot
(scripts/recall-golden-guard.sh handles both).

Checks per set:
  - file is valid JSON
  - has a non-empty `cases` list
  - every case has a non-empty `query` and `expect_source`
  - every `expect_source` compiles as a regex
  - no two cases share an identical query (dedupe / anti-bloat)
  - case count is within [1, max_cases] (bloat ceiling; default 60)
  - the coarse literal prefix of each `expect_source` resolves to a real path
    (a case pointing at a source that does not exist can never pass)

Usage:
  recall-golden-validate.py --all                 # root + every client set
  recall-golden-validate.py path/to/recall-golden-set.json [more...]
  --max-cases N   bloat ceiling (default 60)
  --quiet         print only PASS/FAIL summary
Exit: 0 if every set is valid, 1 otherwise.
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def base_golden_path():
    return os.path.join(ROOT, "scripts", "lib", "recall-golden-set.json")


def overlay_paths():
    return sorted(glob.glob(os.path.join(
        ROOT, "clients", "*", ".recall", "golden-additions.json")))


def all_golden_paths():
    # base first (must be non-empty), then every per-client overlay (may be empty).
    # The old clients/*/scripts/lib path is a symlink back to base, so it is not
    # listed separately - it IS base.
    return [p for p in [base_golden_path()] + overlay_paths() if os.path.exists(p)]


def literal_prefix(expr):
    return re.split(r"[\\(\[.*+?|]", expr)[0].strip("/")


def source_resolves(expect):
    lit = literal_prefix(expect)
    if not lit:
        return True  # too generic to disprove; do not fail on it
    probe = os.path.join(ROOT, lit)
    if os.path.isdir(probe) or glob.glob(probe + "*"):
        return True
    # client set expectations may be written relative to the client folder
    for client_dir in glob.glob(os.path.join(ROOT, "clients", "*")):
        cp = os.path.join(client_dir, lit)
        if os.path.isdir(cp) or glob.glob(cp + "*"):
            return True
    return False


def validate(path, max_cases, allow_empty=False):
    problems = []
    try:
        data = json.load(open(path))
    except Exception as e:
        return [f"not valid JSON: {e}"]
    cases = data.get("cases")
    if not isinstance(cases, list):
        return ["missing `cases` list"]
    if not cases and not allow_empty:
        return ["empty `cases` list"]
    if not cases:
        return []  # an empty overlay is valid (a client with no own cases yet)
    if len(cases) > max_cases:
        problems.append(f"{len(cases)} cases exceeds bloat ceiling {max_cases} - "
                        f"consolidate before adding more")
    seen = {}
    for i, c in enumerate(cases):
        if not isinstance(c, dict):
            problems.append(f"case {i} is not an object")
            continue
        q = (c.get("query") or "").strip()
        expect = (c.get("expect_source") or "").strip()
        if not q:
            problems.append(f"case {i} has empty query")
        if not expect:
            problems.append(f"case {i} ('{q[:40]}') has empty expect_source")
            continue
        try:
            re.compile(expect)
        except re.error as e:
            problems.append(f"case {i} ('{q[:40]}') expect_source is not a valid regex: {e}")
        if q:
            key = q.lower()
            if key in seen:
                problems.append(f"duplicate query: '{q[:50]}' (cases {seen[key]} and {i})")
            seen[key] = i
        if expect and not source_resolves(expect):
            problems.append(f"case {i} ('{q[:40]}') expect_source '{expect}' resolves "
                            f"to no existing file")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--max-cases", type=int, default=60)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    paths = all_golden_paths() if args.all or not args.paths else args.paths
    ok = True
    for p in paths:
        rel = os.path.relpath(p, ROOT)
        is_overlay = p.endswith("golden-additions.json")
        problems = validate(p, args.max_cases, allow_empty=is_overlay)
        if problems:
            ok = False
            print(f"FAIL {rel}")
            for pr in problems:
                print(f"  - {pr}")
        elif not args.quiet:
            n = len(json.load(open(p)).get("cases", []))
            print(f"PASS {rel} ({n} cases)")
    print("golden-set validation " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
