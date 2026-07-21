#!/usr/bin/env bash
# log-evolution.sh - append a dated entry to the AI-OS evolution record.
#
# The evolution log (docs/meta/evolution-log.md) records WHY AI-OS changed - the
# design decisions, not every commit - so future agents do not undo hard-won
# choices. This helper keeps the format consistent. Deliberately simple.
#
# Usage:
#   bash scripts/log-evolution.sh "Title" "What changed and why (a sentence or two)." "What regression to avoid."
# The third argument is optional.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
LOG="$ROOT/docs/meta/evolution-log.md"

TITLE="${1:-}"
BODY="${2:-}"
REGRESSION="${3:-}"

if [ -z "$TITLE" ] || [ -z "$BODY" ]; then
  echo "Usage: bash scripts/log-evolution.sh \"Title\" \"What changed and why.\" [\"Regression to avoid.\"]" >&2
  exit 64
fi

DATE="$(date +%Y-%m-%d)"

if [ ! -f "$LOG" ]; then
  echo "Evolution log not found at $LOG" >&2
  exit 1
fi

{
  echo ""
  echo "## $DATE - $TITLE"
  echo ""
  echo "$BODY"
  if [ -n "$REGRESSION" ]; then
    echo ""
    echo "Regression to avoid: $REGRESSION"
  fi
} >> "$LOG"

echo "Logged to docs/meta/evolution-log.md: $DATE - $TITLE"
