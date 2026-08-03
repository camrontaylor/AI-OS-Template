#!/usr/bin/env bash
# Response-bloat prove-out report.
# Summarizes .claude/hooks_info/bloat-misses.log (written by the
# response-bloat-check.js Stop hook) so "is the Response Discipline landing?"
# has a one-command answer instead of raw JSON lines.
#
# Usage:
#   bash scripts/bloat-report.sh            # all-time summary
#   bash scripts/bloat-report.sh 20         # + last 20 flagged replies
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/.claude/hooks_info/bloat-misses.log"
TAIL_N="${1:-0}"

if [ ! -s "$LOG" ]; then
  echo "No bloat flagged yet (log empty or missing: $LOG)."
  echo "The hook loads at session start; run a few real sessions, then re-check."
  exit 0
fi

python3 - "$LOG" "$TAIL_N" <<'PY'
import sys, json, collections, statistics
log, tail_n = sys.argv[1], int(sys.argv[2])
rows = []
for line in open(log):
    line = line.strip()
    if not line:
        continue
    try:
        rows.append(json.loads(line))
    except Exception:
        continue

n = len(rows)
sig = collections.Counter(s for r in rows for s in r.get("signals", []))
# Violations = everything except the neutral "concession" and "long_tail" tags.
violations = {k: v for k, v in sig.items() if k not in ("concession", "long_tail")}
chars = [r.get("chars", 0) for r in rows]
sessions = {r.get("session") for r in rows if r.get("session")}

print(f"Response-bloat report  -  {n} flagged replies across {len(sessions)} session(s)")
print("-" * 60)
print("VIOLATIONS by type (most common first):")
if violations:
    for k, v in sorted(violations.items(), key=lambda x: -x[1]):
        print(f"  {v:>4}  {k}")
else:
    print("  none")
pm = sig.get("correction_postmortem", 0)
print()
print(f"HEADLINE  correction_postmortem: {pm}   "
      f"(clean concessions tracked: {sig.get('concession', 0)})")
print(f"          long-tail replies (>2500 chars): {sig.get('long_tail', 0)}")
if chars:
    print(f"          flagged-reply length  median {int(statistics.median(chars))}  "
          f"max {max(chars)}")
print()
verdict = ("CLEAN - no post-mortems flagged" if pm == 0
           else f"STILL FIRING - {pm} post-mortem(s); consider the soft self-check nudge")
print(f"VERDICT   {verdict}")

if tail_n > 0:
    print()
    print(f"Last {tail_n} flagged replies:")
    for r in rows[-tail_n:]:
        sigs = ",".join(r.get("signals", []))
        print(f"  {r.get('ts','?')[:19]}  [{sigs}]  {r.get('chars','?')}c  {r.get('head','')[:70]}")
PY
