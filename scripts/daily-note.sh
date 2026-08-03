#!/usr/bin/env bash
# Build / refresh an AI-OS daily note (daily/<YYYY-MM-DD>.md).
# Thin wrapper around scripts/daily-note.py. See that file for full detail.
#
#   bash scripts/daily-note.sh                 # today
#   bash scripts/daily-note.sh 2026-07-20      # a specific day (frozen days are skipped)
#   bash scripts/daily-note.sh 2026-07-20 --force
#   bash scripts/daily-note.sh --catch-up      # finalize yesterday, refresh today (cron)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$DIR/scripts/daily-note.py" "$@"
