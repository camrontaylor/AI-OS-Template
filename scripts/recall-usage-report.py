#!/usr/bin/env python3
"""recall-usage-report.py - the readout for memory retrieval observability.

Turns .command-centre/recall-usage.jsonl into a truthful picture of what memory
actually gets retrieved and surfaced versus what sits in the index dead. This is
the signal that tells us whether adaptive memory work (aging, ranking) is worth
building - instrument before you automate. See
projects/briefs/memory-observability/brief.md.

It is deliberately conservative: it refuses to draw dead-weight conclusions until
there is enough data, because recall outcomes here are noisy over short windows.

Modes:
  (default)   print a full markdown report to stdout
  --summary   print ONE actionable line, or nothing when nothing is actionable
              (used by the monthly cron so it only speaks when it has something)
  --prune     drop records older than --window days from the log, then report
  --window N  analysis window in days (default 30)
"""
import argparse
import glob
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone, timedelta

ROOT = os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOG = os.environ.get("AI_OS_RECALL_LOG_PATH") or os.path.join(ROOT, ".command-centre", "recall-usage.jsonl")
ORGANIC = {"auto-recall", "manual"}
# Below this many days of data, dead-weight and usage-drought conclusions are not
# trustworthy - recall outcomes are noisy over short windows.
MIN_DAYS_FOR_SIGNAL = 28
COLD_FRACTION_GATE = 0.30   # G1: aging worth considering above this share never-retrieved

# Memory surfaces that could be retrieved. ROOT-relative, matching the log's `src`.
UNIVERSE_GLOBS = [
    "context/MEMORY.md",
    "context/learnings.md",
    "context/memory/*.md",
    "context/wiki/*.md",
    "daily/*.md",
    "clients/*/context/MEMORY.md",
    "clients/*/context/learnings.md",
    "clients/*/context/memory/*.md",
]


def parse_ts(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def load_records(window_days):
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    recs = []
    for path in (LOG, LOG + ".1"):
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue  # a torn/malformed line must not sink the report
                ts = parse_ts(r.get("ts"))
                if ts is None:
                    continue
                if ts >= cutoff:
                    recs.append(r)
    return recs


def memory_universe():
    files = set()
    for pat in UNIVERSE_GLOBS:
        for full in glob.glob(os.path.join(ROOT, pat)):
            if os.path.isfile(full):
                files.add(os.path.relpath(full, ROOT))
    return files


def data_days(recs):
    """Days of data we actually have to reason over = age of the oldest record
    WITHIN the analysis window. Records outside the window must not count, or a
    single old straggler would unlock dead-weight conclusions on days of real data
    (the gate's whole job is to refuse exactly that)."""
    if not recs:
        return 0
    stamps = [parse_ts(r.get("ts")) for r in recs]
    stamps = [s for s in stamps if s]
    if not stamps:
        return 0
    return max(0, (datetime.now(timezone.utc) - min(stamps)).days)


def prune(window_days):
    """Rewrite the log keeping only records within the window. Best-effort."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    for path in (LOG, LOG + ".1"):
        if not os.path.exists(path):
            continue
        kept = []
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    ts = parse_ts(json.loads(line).get("ts"))
                except Exception:
                    continue
                if ts and ts >= cutoff:
                    kept.append(line)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write("\n".join(kept) + ("\n" if kept else ""))
        os.replace(tmp, path)


def analyze(recs):
    a = {}
    a["total"] = len(recs)
    a["by_caller"] = Counter(r.get("caller", "?") for r in recs)
    a["by_kind"] = Counter(r.get("kind", "?") for r in recs)

    organic = [r for r in recs if r.get("caller") in ORGANIC]
    organic_retrieved = [r for r in organic if r.get("kind") == "retrieved"]
    surfaced = [r for r in recs if r.get("kind") == "surfaced"]  # auto-recall only
    a["organic_events"] = len(organic_retrieved)
    a["surfaced_events"] = len(surfaced)
    # An organic retrieval that returned zero items = a recall that found nothing.
    a["empty_organic"] = sum(1 for r in organic_retrieved if int(r.get("n") or 0) == 0)

    # Hot units: what actually gets used. Surfaced (injected) is the strongest
    # signal; organic retrieval is the backup.
    a["hot_surfaced"] = Counter(
        (it.get("src", ""), it.get("head", "")) for r in surfaced for it in r.get("items", [])
    )
    a["hot_retrieved_src"] = Counter(
        it.get("src", "") for r in organic_retrieved for it in r.get("items", [])
    )

    # Which sources were ever retrieved (organic, any kind).
    retrieved_src = set()
    for r in organic_retrieved + surfaced:
        for it in r.get("items", []):
            if it.get("src"):
                retrieved_src.add(it["src"])
    a["retrieved_src"] = retrieved_src

    universe = memory_universe()
    a["universe"] = universe
    a["cold_files"] = sorted(f for f in universe if f not in retrieved_src)
    a["coverage"] = (len(universe) - len(a["cold_files"])) / len(universe) if universe else 0.0
    a["cold_fraction"] = len(a["cold_files"]) / len(universe) if universe else 0.0
    return a


def gate_lines(a, days):
    enough = days >= MIN_DAYS_FOR_SIGNAL
    lines = []
    if not enough:
        lines.append(
            f"- **Data sufficiency:** {days} day(s) of data; need {MIN_DAYS_FOR_SIGNAL}+ "
            "before any dead-weight or drought conclusion is trustworthy. Still collecting."
        )
        lines.append("- **G1 (aging):** insufficient data - do not act yet.")
        lines.append("- **Usage-health:** insufficient data.")
        return lines
    if a["organic_events"] == 0:
        # "action needed" is the phrase health-rollup.py greps for, so this line
        # surfaces into the next session via the daily rollup. Non-actionable
        # states below carry no signal word and stay silent.
        lines.append(
            "- **Usage-health: ALERT (action needed)** - zero organic memory recall in "
            f"{days} days. auto-recall or memsearch may be silently broken. Check "
            "`.claude/hooks/auto-recall.js` and `bash scripts/memsearch-health.sh`."
        )
    else:
        lines.append(f"- **Usage-health: OK** - {a['organic_events']} organic recall event(s) in {days} days.")
    if a["cold_fraction"] > COLD_FRACTION_GATE:
        lines.append(
            f"- **G1 (aging): MET (action needed)** - {a['cold_fraction']:.0%} of indexed memory "
            f"({len(a['cold_files'])}/{len(a['universe'])} files) was never retrieved in "
            f"{days} days. Building retrieval-based aging is now justified; scope it against "
            "the curator so the two do not fight."
        )
    else:
        lines.append(
            f"- **G1 (aging): not met** - only {a['cold_fraction']:.0%} of memory never "
            f"retrieved (gate is >{COLD_FRACTION_GATE:.0%}). The curator is keeping up; leave aging unbuilt."
        )
    return lines


def summary_line(a, days):
    """One actionable line, or '' when nothing is worth surfacing."""
    if days < MIN_DAYS_FOR_SIGNAL:
        return ""
    if a["organic_events"] == 0:
        return (f"Memory recall usage: ZERO organic recall in {days} days - auto-recall "
                "or memsearch may be broken. Run: bash scripts/recall-usage-report.py")
    if a["cold_fraction"] > COLD_FRACTION_GATE:
        return (f"Memory observability: {a['cold_fraction']:.0%} of indexed memory never "
                f"retrieved in {days} days (gate G1 met) - retrieval-based aging may be worth "
                "building. See bash scripts/recall-usage-report.py")
    return ""


def render(a, days):
    today = datetime.now(timezone.utc).date().isoformat()
    out = [f"# Memory retrieval usage - {today}", ""]
    out.append(f"Window: last {days} day(s) of logged recall. Total records: {a['total']}.")
    out.append("")
    out.append("## Decision gates")
    out.extend(gate_lines(a, days))
    out.append("")
    out.append("## Volume")
    callers = ", ".join(f"{k}={v}" for k, v in a["by_caller"].most_common()) or "none"
    kinds = ", ".join(f"{k}={v}" for k, v in a["by_kind"].most_common()) or "none"
    out.append(f"- By caller: {callers}")
    out.append(f"- By kind: {kinds}")
    out.append(f"- Organic recall events: {a['organic_events']} (of which {a['empty_organic']} returned nothing)")
    out.append(f"- Index coverage: {a['coverage']:.0%} of {len(a['universe'])} memory files retrieved at least once")
    out.append("")
    out.append("## Hottest memory (most surfaced into sessions)")
    if a["hot_surfaced"]:
        for (src, head), n in a["hot_surfaced"].most_common(10):
            label = f"{src}" + (f" - {head}" if head else "")
            out.append(f"- {n}x  {label}")
    else:
        out.append("- nothing surfaced yet (auto-recall injects only above the relevance floor)")
    out.append("")
    out.append("## Never retrieved by organic recall in this window (dead-weight candidates)")
    if days < MIN_DAYS_FOR_SIGNAL:
        out.append(f"- (holding this list until {MIN_DAYS_FOR_SIGNAL}+ days of data - short-window 'never retrieved' is noise)")
    elif a["cold_files"]:
        for f in a["cold_files"][:25]:
            out.append(f"- {f}")
        if len(a["cold_files"]) > 25:
            out.append(f"- ...and {len(a['cold_files']) - 25} more")
    else:
        out.append("- none - every memory file was retrieved at least once")
    out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", type=int, default=30)
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--prune", action="store_true")
    args = ap.parse_args()

    if args.prune:
        prune(max(args.window, 90))

    recs = load_records(args.window)
    days = data_days(recs)
    a = analyze(recs)

    if args.summary:
        line = summary_line(a, days)
        if line:
            print(line)
        return 0
    print(render(a, days))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"recall-usage-report: {exc}", file=sys.stderr)
        sys.exit(0)
