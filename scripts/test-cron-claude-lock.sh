#!/usr/bin/env bash
# test-cron-claude-lock.sh - proves the claude cron concurrency gate serializes.
#
# Launches several concurrent invocations of scripts/lib/cron-claude-lock.py, each
# wrapping a fake "claude" that records START/END around a short sleep. If the gate
# works, no two runs overlap: peak concurrency stays at 1. This is the regression
# guard for the 2026-07-23 catch-up storm fix.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/scripts/lib/cron-claude-lock.py"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/aios-lock-test.XXXXXX")"
LOG="$WORK/events.log"
FAKE="$WORK/fake-claude.sh"
: > "$LOG"

cat > "$FAKE" <<'EOF'
#!/usr/bin/env bash
# Fake claude: mark entry, hold the slot briefly, mark exit.
echo "START $$ $(date +%s.%N)" >> "$EVENTS"
sleep 0.5
echo "END $$ $(date +%s.%N)" >> "$EVENTS"
EOF
chmod +x "$FAKE"

export EVENTS="$LOG"
export AIOS_CRON_CLAUDE_LOCK="$WORK/gate.lock"
export AIOS_CRON_CLAUDE_LOCK_WAIT="30"

# Fire 5 at once - the storm.
for i in 1 2 3 4 5; do
  python3 "$HELPER" "$FAKE" &
done
wait

# Replay the event log and track peak concurrency.
peak=0; active=0
while read -r kind _rest; do
  case "$kind" in
    START) active=$((active + 1)); [ "$active" -gt "$peak" ] && peak=$active ;;
    END)   active=$((active - 1)) ;;
  esac
done < "$LOG"

starts=$(grep -c '^START' "$LOG")
echo "runs=$starts peak_concurrency=$peak (log: $LOG)"
if [ "$starts" -eq 5 ] && [ "$peak" -eq 1 ]; then
  echo "PASS: gate serialized all 5 runs (peak concurrency 1)"
  exit 0
fi
echo "FAIL: expected 5 runs serialized to peak 1, got runs=$starts peak=$peak"
exit 1
