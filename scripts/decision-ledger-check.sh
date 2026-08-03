#!/usr/bin/env bash
# decision-ledger-check.sh - read-only health guard for the Decision Ledger.
#
# The Decision Ledger (context/decisions.md, root and per client) records
# directional decisions with a reopen gate, so a settled call is not silently
# re-decided by the next session. This is its detect-and-report arm: the health
# check AI-OS's design philosophy requires for any self-maintaining loop. It
# flags, and never edits:
#   - CHRONIC churn: a decision reopened 3+ times. The reopen gate is not
#     holding; escalate or retire the decision, do not just re-decide it again.
#   - MALFORMED entries: an entry missing a required field, so it would silently
#     fail to surface in the current-state brief at session start.
#
# Complements client-facts-drift.sh: that guard checks authority docs against
# live billed reality (facts-of-record); this one checks the decisions themselves.
#
# Usage: bash scripts/decision-ledger-check.sh [--client slug] [--strict]
#   --strict  exit non-zero on MALFORMED as well as CHRONIC.
# Test hook: AI_OS_ROOT overrides where ledgers are found (the lib stays real).
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${AI_OS_ROOT:-$SCRIPT_ROOT}"
LIB="$SCRIPT_ROOT/scripts/lib/decision_ledger.py"
PY="${AI_OS_PYTHON:-python3}"
TODAY="$(date +%F)"
REPORT_DIR="$ROOT/projects/system-health"
ONLY_CLIENT=""
STRICT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --client) ONLY_CLIENT="${2:-}"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    *) printf 'Unknown arg: %s\n' "$1" >&2; exit 2 ;;
  esac
done

command -v "$PY" >/dev/null 2>&1 || { printf 'python3 not found (%s)\n' "$PY" >&2; exit 2; }
[[ -f "$LIB" ]] || { printf 'decision_ledger.py not found at %s\n' "$LIB" >&2; exit 2; }

CHRONIC=0
MALFORMED=0
CLEAN=0
DETAILS=()

check_ledger() {
  local label="$1" ledger="$2"
  [[ -f "$ledger" ]] || return 0
  local out
  out="$("$PY" "$LIB" check "$ledger" 2>/dev/null || true)"
  if [[ -z "$out" ]]; then
    CLEAN=$((CLEAN + 1))
    DETAILS+=("OK|$label: ledger clean")
    return 0
  fi
  local kind msg
  while IFS='|' read -r kind msg; do
    [[ -z "$kind" ]] && continue
    if [[ "$kind" == "CHRONIC" ]]; then
      CHRONIC=$((CHRONIC + 1))
      DETAILS+=("CHRONIC|$label: $msg")
    else
      MALFORMED=$((MALFORMED + 1))
      DETAILS+=("MALFORMED|$label: $msg")
    fi
  done <<< "$out"
}

check_ledger "root" "$ROOT/context/decisions.md"
if [[ -n "$ONLY_CLIENT" ]]; then
  check_ledger "$ONLY_CLIENT" "$ROOT/clients/$ONLY_CLIENT/context/decisions.md"
elif [[ -d "$ROOT/clients" ]]; then
  while IFS= read -r d; do
    [[ -d "$d" ]] || continue
    check_ledger "$(basename "$d")" "$d/context/decisions.md"
  done < <(find "$ROOT/clients" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
fi

mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/${TODAY}_decision-ledger-check.md"
{
  printf '# Decision Ledger Health - %s\n\n' "$TODAY"
  printf 'Read-only guard over every `context/decisions.md`. Chronic churn = a decision reopened 3 or more times: the reopen gate is not holding, so escalate the gate or retire the decision, do not just re-decide it again. Malformed = an entry missing a required field, so it would silently fail to surface at session start.\n\n'
  printf '## Summary\n\n'
  printf -- '- Chronic churn: %s\n' "$CHRONIC"
  printf -- '- Malformed entries: %s\n' "$MALFORMED"
  printf -- '- Clean ledgers: %s\n\n' "$CLEAN"
  printf '## Findings\n\n'
  if [[ "${#DETAILS[@]}" -eq 0 ]]; then
    printf 'No ledgers found.\n'
  else
    for item in "${DETAILS[@]}"; do
      printf -- '- `%s`: %s\n' "${item%%|*}" "${item#*|}"
    done
  fi
} > "$REPORT"

printf 'Decision ledger health report saved to %s\n' "${REPORT#"$ROOT/"}"
printf 'Summary: %s chronic, %s malformed, %s clean.\n' "$CHRONIC" "$MALFORMED" "$CLEAN"

if [[ "$CHRONIC" -gt 0 ]]; then exit 1; fi
if [[ "$STRICT" -eq 1 && "$MALFORMED" -gt 0 ]]; then exit 1; fi
exit 0
