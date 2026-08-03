#!/usr/bin/env bash
# recall-usage-review.sh - weekly memory-observability readout for cron.
#
# Prunes the recall-usage log to its window, writes the usage report under
# projects/system-health/, and prints an actionable one-liner. The report only
# carries the "action needed" phrase health-rollup.py greps for when the data is
# sufficient AND something needs a decision, so it surfaces into a session only
# then and stays silent otherwise. See projects/briefs/memory-observability/brief.md.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" 2>/dev/null || exit 0

OUT_DIR="$ROOT/projects/system-health"
mkdir -p "$OUT_DIR" 2>/dev/null || true
REPORT="$OUT_DIR/$(date +%F)_recall-usage.md"

python3 "$ROOT/scripts/recall-usage-report.py" --prune > "$REPORT" 2>/dev/null || true
echo "recall-usage report -> ${REPORT#"$ROOT/"}"

SUMMARY="$(python3 "$ROOT/scripts/recall-usage-report.py" --summary 2>/dev/null || true)"
[ -n "$SUMMARY" ] && echo "$SUMMARY"
exit 0
