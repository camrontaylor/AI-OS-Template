#!/usr/bin/env bash
# recall-self-improve.sh - run the recall self-improvement sensing pass across
# every scope (root plus each client that has its own golden set), writing one
# report and one machine-readable actions file per scope.
#
# This is the deterministic sensing half of the loop. It never edits the golden
# set or memory; the daily-recall-self-improve cron job reads the actions files
# and applies the guarded, verified cures. Safe to run by hand any time.
#
# Usage: bash scripts/recall-self-improve.sh [--window N] [--quiet]
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

ARGS=("$@")

echo "== recall self-improve: root =="
python3 "$ROOT/scripts/recall-self-improve.py" --scope root "${ARGS[@]+"${ARGS[@]}"}"

for gs in "$ROOT"/clients/*/scripts/lib/recall-golden-set.json; do
  [ -e "$gs" ] || continue
  slug="$(basename "$(dirname "$(dirname "$(dirname "$gs")")")")"
  echo
  echo "== recall self-improve: client:$slug =="
  python3 "$ROOT/scripts/recall-self-improve.py" --scope client --client "$slug" "${ARGS[@]+"${ARGS[@]}"}"
done
