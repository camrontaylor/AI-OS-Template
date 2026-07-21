#!/usr/bin/env bash
# archive-client.sh - offboard a client workspace without deleting anything.
#
# Moves clients/<slug>/ to .backup/archived-clients/<slug>-<date>/ so cron
# iteration, sync audits, sanitizer needle derivation, and memory indexing all
# stop seeing it, while every file stays on disk (and tracked history stays in
# git). Restore by moving the folder back.
#
# Usage: bash scripts/archive-client.sh <slug>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "Usage: bash scripts/archive-client.sh <slug>"
  echo "Clients on disk:"
  ls -1 "$ROOT/clients" 2>/dev/null | sed 's/^/  /'
  exit 64
fi

SRC="$ROOT/clients/$SLUG"
if [ ! -d "$SRC" ]; then
  echo "No client folder at clients/$SLUG"
  exit 1
fi

# Refuse to archive a client with a REAL session log from the last 7 days -
# that is an active workspace, and archiving it is probably a mistake.
# Only strictly dated logs (YYYY-MM-DD.md) count; cron-generated reports like
# *_memory-health.md and *_gap-analysis.md are machine noise, not activity.
recent="$(find "$SRC/context/memory" -mtime -7 2>/dev/null \
  | grep -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$' | head -1 || true)"
if [ -n "$recent" ]; then
  echo "clients/$SLUG has a session log from the last 7 days ($recent)."
  echo "Refusing to archive an active client. Move it manually if this is intentional."
  exit 1
fi

DEST_DIR="$ROOT/.backup/archived-clients"
DEST="$DEST_DIR/$SLUG-$(date +%F)"
mkdir -p "$DEST_DIR"
if [ -e "$DEST" ]; then
  DEST="$DEST-$(date +%H%M%S)"
fi

mv "$SRC" "$DEST"
echo "Archived clients/$SLUG -> ${DEST#"$ROOT/"}"
echo "Everything is preserved; restore with:"
echo "  mv \"$DEST\" \"$SRC\""
echo "Note: the folder leaves git tracking on the next commit; history keeps every past version."
