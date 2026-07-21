#!/usr/bin/env bash
# run-all-tests.sh - run every scripts/test-*.sh and report one pass/fail line each.
#
# The 2026-07-16 audit found 29 test scripts (220 KB) that nothing ever ran
# automatically. This is the runner the weekly-test-suite cron job executes;
# it exits non-zero when any suite fails, so the failure notifies and lands
# in the daily health rollup.
#
# Usage: bash scripts/run-all-tests.sh
set -uo pipefail
cd "$(dirname "$0")/.."

pass=0; failed=(); skipped=0
for t in scripts/test-*.sh; do
  [ -f "$t" ] || continue
  name="$(basename "$t")"
  # Suites that need live external services or user credentials are skipped in
  # unattended runs; everything else must pass.
  case "$name" in
    test-centre-shortcut.sh) skipped=$((skipped+1)); echo "SKIP $name (needs interactive app)"; continue ;;
    test-update.sh) skipped=$((skipped+1)); echo "SKIP $name (interactive scenario menu, needs /dev/tty)"; continue ;;
  esac
  if out="$(bash "$t" 2>&1)"; then
    pass=$((pass+1)); echo "PASS $name"
  else
    failed+=("$name"); echo "FAIL $name"; echo "$out" | tail -5 | sed 's/^/     /'
  fi
done

echo ""
echo "Suites: $pass passed, ${#failed[@]} failed, $skipped skipped."
if [ "${#failed[@]}" -gt 0 ]; then
  echo "Failed: ${failed[*]}"
  exit 1
fi
