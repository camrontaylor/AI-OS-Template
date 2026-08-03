#!/usr/bin/env python3
"""memory-hygiene.py - deterministic curator for context/MEMORY.md.

Keeps the startup scratchpad under its hard cap with ZERO AI, so nothing in the
write path can time out, hang, or nondeterministically drop a fact. Semantic
judgment (merging overlapping threads, deciding what is stale) is deliberately
NOT here: it belongs in a REPORT a human or session applies against the
recoverable archive (see cron/jobs/weekly-memory-gaps.md), never in an
unattended rewrite of the most cache-sensitive file in the system. That mirrors
the design's own pattern (docs/meta/memory-architecture.md: evaluate -> report
-> curate; "better access and organization, not memory degradation").

`curate` does, in order, and never loses a distinct fact (everything removed is
written to the archive FIRST, recoverable):
  1. Drop Active Threads carrying an explicit resolved marker (only [done]/✅ and
     friends - never a soft "...to be fixed", which is an OPEN task).
  2. Collapse exact-duplicate entries within a section.
  3. ONLY if still over the hard cap, archive the stalest entries down to target
     (real headroom): Active Threads first (that is where stale work
     accumulates), Environment Notes and Pending Decisions preserved longest;
     oldest-dated first within a section, demonstrably-recent entries kept.
     Between target and cap, entries are left hot - eviction is a last resort.
Unknown "## Heading" blocks (something added a 4th section) are preserved
verbatim and never curated.

Usage:
  memory-hygiene.py curate --file PATH [--cap 2500] [--target 2300] [--archive PATH]
  memory-hygiene.py report --file PATH [--cap 2500] [--cold-days N]
"""
import argparse
import datetime
import json
import os
import re
import sys
import tempfile

SECTIONS = ["Active Threads", "Environment Notes", "Pending Decisions"]
HEADER_COMMENT = "<!-- Cap: 2,500 chars. Curated scratchpad. -->"
TITLE = "# Working Memory"
DEFAULT_CAP = 2500
DEFAULT_TARGET = 2300
# Undated entries have unknown age; treat them as moderately old so a clearly
# old dated entry is evicted before an undated one, but a demonstrably recent
# dated entry is kept over an undated one.
ASSUMED_UNDATED_AGE_DAYS = 21

# Only an UNAMBIGUOUS marker counts as resolved: a check mark or a bracketed
# tag. A bullet that merely ends in "...to be fixed" or "far from done" is an
# ACTIVE task and must stay hot. Recall-first: never evict on a soft signal.
RESOLVED_RE = re.compile(r"✅|\[(?:done|shipped|closed|resolved|fixed)\]", re.IGNORECASE)
DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
# A line that STARTS a new entry: a markdown bullet or a numbered item.
BULLET_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s")


def _normalize(text):
    return text.replace("\r\n", "\n").replace("\r", "\n")


def parse(text):
    """Return (preamble_lines, {section: [entries]}, extras).

    An entry is a whole logical bullet: its marker line plus any wrapped
    continuation lines folded in with newlines, so dating, dedup, the
    resolved-check, and eviction each treat it as ONE unit. Unknown "## Heading"
    blocks are captured in `extras` (heading, [body_lines]) and preserved
    verbatim - never curated, never mangled into a known section.
    """
    sections = {s: [] for s in SECTIONS}
    preamble = []
    extras = []
    current = None  # None (preamble) | a section name | "__extra__"
    for ln in _normalize(text).split("\n"):
        m = re.match(r"^##\s+(.*\S)\s*$", ln)
        if m:
            name = m.group(1).strip()
            if name in SECTIONS:
                current = name
            else:
                extras.append((ln.rstrip(), []))
                current = "__extra__"
            continue
        if current is None:
            preamble.append(ln)
        elif current == "__extra__":
            extras[-1][1].append(ln.rstrip())
        elif ln.strip():
            if BULLET_RE.match(ln) or not sections[current]:
                sections[current].append(ln.rstrip())
            else:  # a wrapped continuation line -> fold into the previous entry
                sections[current][-1] += "\n" + ln.rstrip()
    return preamble, sections, extras


def render(preamble, sections, extras):
    pre = "\n".join(preamble).rstrip()
    if not any(l.lstrip().startswith("# ") for l in preamble):
        pre = (pre + "\n" if pre else "") + HEADER_COMMENT + "\n" + TITLE
    blocks = [pre]
    for s in SECTIONS:
        body = "\n".join(sections[s])
        blocks.append(f"## {s}" + ("\n" + body if body else ""))
    for heading, body_lines in extras:
        body = "\n".join(body_lines).rstrip()
        blocks.append(heading + ("\n" + body if body else ""))
    return "\n\n".join(blocks).rstrip() + "\n"


def size_of(preamble, sections, extras):
    return len(render(preamble, sections, extras).encode("utf-8"))


def is_resolved(entry):
    return bool(RESOLVED_RE.search(entry))


def bullet_date(entry):
    """The entry's own date: first YYYY-MM-DD in the first line's leading 40
    chars (the "(YYYY-MM-DD):" convention), so a date buried in prose or a
    continuation line does not misdate the entry."""
    head = entry.split("\n", 1)[0][:40]
    m = DATE_RE.search(head)
    if not m:
        return None
    try:
        return datetime.date.fromisoformat(m.group(1))
    except ValueError:
        return None


def dedup(entries):
    seen, out, removed = set(), [], 0
    for b in entries:
        key = b.strip().lower()
        if key in seen:
            removed += 1
            continue
        seen.add(key)
        out.append(b)
    return out, removed


def eviction_order(entries):
    """Stalest first: oldest date first; undated treated as moderately old."""
    assumed = datetime.date.today() - datetime.timedelta(days=ASSUMED_UNDATED_AGE_DAYS)
    return sorted(entries, key=lambda b: bullet_date(b) or assumed)


def do_floor(preamble, sections, extras, ceiling, archived):
    """Archive the stalest entries until at or under ceiling. Section order is
    deliberate: Active Threads churn (stale work), so they go first; Environment
    Notes (durable facts) and Pending Decisions (open questions) are preserved
    longest. Eviction is a last resort and always recoverable via the archive."""
    for s in SECTIONS:
        if size_of(preamble, sections, extras) <= ceiling:
            break
        for b in eviction_order(list(sections[s])):
            if size_of(preamble, sections, extras) <= ceiling:
                break
            sections[s].remove(b)
            archived.append(b)


def write_archive(path, entries):
    if not entries:
        return
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    fresh = not os.path.exists(path)
    today = datetime.date.today().isoformat()
    with open(path, "a", encoding="utf-8") as f:
        if fresh:
            f.write(
                "# MEMORY.md archive\n\n"
                "Entries moved out of the hot scratchpad to keep it under cap. "
                "Never deleted; recoverable.\n"
            )
        f.write(f"\n## Archived {today} (from MEMORY.md curation)\n")
        f.write("\n".join(entries) + "\n")


def default_archive(file_path):
    # Deliberately a sibling of memory/, NOT inside it: memsearch-reindex.sh
    # sources context/memory/ into semantic recall, so an archive under it would
    # resurface the very entries we evicted. context/archive/ is not a reindex
    # source, so evicted entries stay recoverable without polluting recall.
    ctx = os.path.dirname(os.path.abspath(file_path))
    return os.path.join(ctx, "archive", "MEMORY-archive.md")


def atomic_write(path, content):
    """Write via a unique temp file + os.replace so a kill mid-write can never
    leave a partial file at `path`, and two concurrent runs cannot collide on a
    shared temp name. On any failure the original at `path` is untouched."""
    directory = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".memtmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def cmd_curate(args):
    with open(args.file, encoding="utf-8") as f:
        text = f.read()
    if not any(f"## {s}" in text for s in SECTIONS):
        sys.stderr.write("memory-hygiene: no recognizable sections; refusing to write.\n")
        return 3

    preamble, sections, extras = parse(text)
    archive_path = args.archive or default_archive(args.file)
    archived = []
    resolved = 0

    # 1. explicitly-resolved Active Threads -> archive (recoverable)
    kept = []
    for b in sections["Active Threads"]:
        if is_resolved(b):
            resolved += 1
            archived.append(b)
        else:
            kept.append(b)
    sections["Active Threads"] = kept

    # 2. exact-duplicate collapse within each section
    dups = 0
    for s in SECTIONS:
        sections[s], r = dedup(sections[s])
        dups += r

    # 3. Eviction is a last resort: only if resolved-removal and dedup left the
    #    file over the HARD cap. Between target and cap the entries are left hot
    #    (recall-first). When it does fire, trim to target for real headroom.
    if size_of(preamble, sections, extras) > args.cap:
        do_floor(preamble, sections, extras, args.target, archived)
    floored = len(archived) - resolved

    # Archive BEFORE touching the main file: if the archive write fails, leave
    # MEMORY.md untouched so nothing is dropped without a recoverable copy.
    try:
        write_archive(archive_path, archived)
    except OSError as exc:
        sys.stderr.write(f"memory-hygiene: archive write failed ({exc}); MEMORY.md untouched.\n")
        return 5

    new = render(preamble, sections, extras)
    try:
        atomic_write(args.file, new)
    except OSError as exc:
        sys.stderr.write(f"memory-hygiene: write failed ({exc}); original left intact.\n")
        return 4

    size = len(new.encode("utf-8"))
    print(
        f"hygiene: removed {resolved} resolved, {dups} dup, "
        f"archived {floored}, MEMORY.md {size}/{args.cap}"
    )
    return 0 if size <= args.cap else 2


def cmd_report(args):
    with open(args.file, encoding="utf-8") as f:
        text = f.read()
    preamble, sections, extras = parse(text)
    size = size_of(preamble, sections, extras)
    cold = []
    if args.cold_days:
        cutoff = datetime.date.today() - datetime.timedelta(days=args.cold_days)
        for b in sections["Active Threads"]:
            d = bullet_date(b)
            if d and d < cutoff:
                cold.append(b.split("\n", 1)[0])
    print(json.dumps({
        "size": size,
        "cap": args.cap,
        "over_cap": size > args.cap,
        "active_threads": len(sections["Active Threads"]),
        "cold_threads": cold,
    }, ensure_ascii=False))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="Deterministic MEMORY.md curator.")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("curate", help="Enforce the cap deterministically.")
    c.add_argument("--file", required=True)
    c.add_argument("--cap", type=int, default=DEFAULT_CAP)
    c.add_argument("--target", type=int, default=DEFAULT_TARGET)
    c.add_argument("--archive", default=None)
    c.set_defaults(func=cmd_curate)

    r = sub.add_parser("report", help="Emit a health JSON line.")
    r.add_argument("--file", required=True)
    r.add_argument("--cap", type=int, default=DEFAULT_CAP)
    r.add_argument("--cold-days", type=int, default=0)
    r.set_defaults(func=cmd_report)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
