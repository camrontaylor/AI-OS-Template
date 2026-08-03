#!/usr/bin/env bash
# test-recall-observability.sh - stress + correctness for the memory-observability
# layer (recall-log.py + recall-usage-report.py). Runs on an isolated temp log so
# it never touches real usage data.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aios-obs-test.XXXXXX")"
export AI_OS_RECALL_LOG_PATH="$LOG_DIR/recall.jsonl"
LOGGER="python3 $ROOT/scripts/lib/recall-log.py"
REPORT="python3 $ROOT/scripts/recall-usage-report.py"

pass=0; fail=0
ok()   { echo "  ok   $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL $1"; fail=$((fail+1)); }

# Build a small valid results file to feed the logger.
RESULTS="$LOG_DIR/results.json"
cat > "$RESULTS" <<'EOF'
[{"source":"/workspace/AI-OS/context/learnings.md","chunk_hash":"abc123","heading":"H","score":0.9},
 {"source":"/workspace/AI-OS/context/MEMORY.md","chunk_hash":"def456","heading":"Threads","score":0.8}]
EOF

# 1. CONCURRENCY: 60 parallel appends must yield 60 intact, parseable lines.
for i in $(seq 1 60); do
  $LOGGER --query "q$i" --scope root --caller test --results-file "$RESULTS" &
done
wait
total=$(wc -l < "$AI_OS_RECALL_LOG_PATH" | tr -d ' ')
valid=$(python3 - "$AI_OS_RECALL_LOG_PATH" <<'PY'
import json,sys
v=0
for line in open(sys.argv[1]):
    line=line.strip()
    if not line: continue
    try: json.loads(line); v+=1
    except Exception: pass
print(v)
PY
)
[ "$total" = "60" ] && [ "$valid" = "60" ] && ok "60 concurrent appends, 60 intact JSON lines (no torn writes)" || bad "concurrency: total=$total valid=$valid (want 60/60)"

# 2. ROTATION: with a tiny cap, the log rotates to .1 and the main file resets.
export AI_OS_RECALL_LOG_MAX_BYTES=500
for i in $(seq 1 20); do
  $LOGGER --query "rot$i" --scope root --caller test --results-file "$RESULTS" >/dev/null 2>&1
done
if [ -f "$AI_OS_RECALL_LOG_PATH.1" ]; then
  ok "rotation to .1 fired past the size cap"
else
  bad "rotation: no .1 file created"
fi
unset AI_OS_RECALL_LOG_MAX_BYTES

# 3. MALFORMED / EMPTY tolerance: a torn line and blank lines must not sink the report.
printf 'this is not json\n\n{"broken": \n' >> "$AI_OS_RECALL_LOG_PATH"
if $REPORT >/dev/null 2>&1; then
  ok "report survives malformed + blank lines"
else
  bad "report crashed on malformed input"
fi

# 4. EMPTY RESULT SET: a recall that found nothing logs n=0, report counts it.
echo '[]' > "$LOG_DIR/empty.json"
$LOGGER --query "nothing found" --scope root --caller test --results-file "$LOG_DIR/empty.json"
lastn=$(tail -1 "$AI_OS_RECALL_LOG_PATH" | python3 -c "import sys,json;print(json.loads(sys.stdin.read()).get('n'))")
[ "$lastn" = "0" ] && ok "empty-result recall logged as n=0" || bad "empty result: n=$lastn (want 0)"

# 5. NO-RESULTS-FILE and DISABLE must both be safe no-ops (never throw).
before=$(wc -l < "$AI_OS_RECALL_LOG_PATH" | tr -d ' ')
$LOGGER --query "no file" --scope root --caller test >/dev/null 2>&1
AI_OS_RECALL_LOG_DISABLE=1 $LOGGER --query "disabled" --caller test --results-file "$RESULTS" >/dev/null 2>&1
after=$(wc -l < "$AI_OS_RECALL_LOG_PATH" | tr -d ' ')
# missing results-file still logs a record (n=0); disable adds nothing. So +1 exactly.
[ "$after" = "$((before+1))" ] && ok "missing-file logs empty; disable is a no-op" || bad "edge appends: before=$before after=$after (want +1)"

# 6. DATA SUFFICIENCY (regression: data_days must count only in-window data).
# An old record OUTSIDE the window must not unlock dead-weight/alert conclusions.
FRESH="$LOG_DIR/fresh.jsonl"
export AI_OS_RECALL_LOG_PATH="$FRESH"
OLD_TS="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=40)).isoformat(timespec='seconds'))")"
printf '{"ts":"%s","kind":"retrieved","caller":"manual","scope":"root","q":"old","n":0,"items":[]}\n' "$OLD_TS" > "$FRESH"
for i in 1 2 3; do $LOGGER --query "recent$i" --scope root --caller manual --results-file "$RESULTS"; done
if $REPORT --window 30 2>/dev/null | grep -q "insufficient data"; then
  ok "old out-of-window record does not unlock conclusions (data_days honest)"
else
  bad "data_days: an out-of-window record unlocked conclusions on days of data"
fi

# 7. ROTATION PRESERVES THE ARCHIVE (regression: no clobber-to-a-single-record).
ROT="$LOG_DIR/rot2.jsonl"
export AI_OS_RECALL_LOG_PATH="$ROT"
export AI_OS_RECALL_LOG_MAX_BYTES=400
for i in $(seq 1 12); do $LOGGER --query "seq$i" --scope root --caller manual --results-file "$RESULTS" >/dev/null 2>&1; done
unset AI_OS_RECALL_LOG_MAX_BYTES
read -r nlines nvalid < <(cat "$ROT" "$ROT.1" 2>/dev/null | python3 -c "
import sys, json
n = ok = 0
for l in sys.stdin:
    l = l.strip()
    if not l:
        continue
    n += 1
    try:
        json.loads(l); ok += 1
    except Exception:
        pass
print(n, ok)")
if [ -f "$ROT.1" ] && [ "$nlines" = "$nvalid" ] && [ "${nlines:-0}" -ge 2 ]; then
  ok "rotation preserves a valid archive (no clobber-to-one)"
else
  bad "rotation archive: .1=$([ -f "$ROT.1" ] && echo yes || echo no) lines=$nlines valid=$nvalid"
fi

# 8. CONCURRENT ROTATION must not corrupt lines (the confirmed double-rotate bug).
ROT3="$LOG_DIR/rot3.jsonl"
export AI_OS_RECALL_LOG_PATH="$ROT3"
export AI_OS_RECALL_LOG_MAX_BYTES=350
for i in $(seq 1 30); do $LOGGER --query "p$i" --scope root --caller manual --results-file "$RESULTS" & done
wait
unset AI_OS_RECALL_LOG_MAX_BYTES
badlines=$(cat "$ROT3" "$ROT3.1" 2>/dev/null | python3 -c "
import sys, json
b = 0
for l in sys.stdin:
    l = l.strip()
    if not l:
        continue
    try:
        json.loads(l)
    except Exception:
        b += 1
print(b)")
[ "${badlines:-1}" = "0" ] && ok "concurrent rotation: zero corrupt lines" || bad "concurrent rotation produced ${badlines} corrupt line(s)"

echo ""
echo "test-recall-observability: PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ] || exit 1
