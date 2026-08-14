#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$ROOT/scripts/cron-scheduler-coverage.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/cron-coverage-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if printf 'ACTIVE\ta\nACTIVE\tb\nSCHEDULED\ta\nSCHEDULED\twatchdog\n' | bash "$CHECK" > "$work/missing.out"; then
  echo "coverage check passed despite a missing active job" >&2
  exit 1
fi
grep -q '^MISSING b$' "$work/missing.out"
grep -q 'covered: 1; missing: 1' "$work/missing.out"

printf 'ACTIVE\ta\nACTIVE\tb\nSCHEDULED\tb\nSCHEDULED\ta\n' | bash "$CHECK" > "$work/covered.out"
grep -q 'covered: 2; missing: 0' "$work/covered.out"

printf 'SCHEDULED\twatchdog\n' | bash "$CHECK" > "$work/empty.out"
grep -q 'Active AI-OS jobs: 0' "$work/empty.out"

echo "cron scheduler coverage: passed"
