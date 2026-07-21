#!/usr/bin/env bash
# memsearch-gc.sh - retire dead semantic-index data safely.
#
# Every repo move or experiment leaves an orphan Milvus collection behind
# forever (the 2026-07-16 audit found ~345 MB of 382 MB was dead data, and the
# old-path collection stayed silently queryable). This moves everything except
# the canonical collection to the macOS Trash - never a hard delete - and
# reports what it freed. Safe to re-run; skips when an index is running.
#
# Usage: bash scripts/memsearch-gc.sh [--dry-run]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STORE="$HOME/.memsearch"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# Never GC underneath a live index run.
if pgrep -f "memsearch (index|search)" >/dev/null 2>&1; then
  echo "An indexing/search process is running - skipping GC."
  exit 0
fi
LOCK_PID_FILE="$ROOT/.command-centre/memsearch-index.lock/pid"
if [ -f "$LOCK_PID_FILE" ] && kill -0 "$(cat "$LOCK_PID_FILE" 2>/dev/null)" 2>/dev/null; then
  echo "A live index lock is held - skipping GC."
  exit 0
fi

CANONICAL="$(bash "$SCRIPT_DIR/lib/memsearch-collection.sh" 2>/dev/null || true)"
if [ -z "$CANONICAL" ]; then
  echo "Could not resolve the canonical collection - refusing to GC."
  exit 1
fi
echo "Canonical collection: $CANONICAL"

send_to_trash() {
  local target="$1"
  [ -e "$target" ] || return 0
  local size
  size="$(du -sh "$target" 2>/dev/null | cut -f1)"
  if [ "$DRY" -eq 1 ]; then
    echo "  would trash: $target ($size)"
    return 0
  fi
  if command -v trash >/dev/null 2>&1; then
    trash "$target" && echo "  trashed: $target ($size)"
  else
    local dest="$HOME/.Trash/$(basename "$target").$(date +%s)"
    mv "$target" "$dest" && echo "  moved to Trash: $target ($size)"
  fi
}

echo "Orphan collections:"
for dir in "$STORE"/milvus.db/collections/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ "$name" = "$CANONICAL" ] && continue
  send_to_trash "${dir%/}"
done

echo "Stale whole-db backups:"
send_to_trash "$STORE/milvus.db.incompatible-bak"
send_to_trash "$STORE/milvus.db.partial-bak"

echo "Repo-local stale store (home store is canonical):"
send_to_trash "$ROOT/.memsearch/milvus.db"
for pidfile in "$ROOT"/.memsearch/.index*.pid "$ROOT"/.memsearch/*.pid; do
  [ -e "$pidfile" ] && send_to_trash "$pidfile"
done

echo "Store size now: $(du -sh "$STORE" 2>/dev/null | cut -f1)"
