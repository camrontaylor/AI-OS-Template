#!/usr/bin/env bash
# memsearch-reindex.sh - rebuild the AI-OS canonical memsearch index from ALL
# real memory sources in ONE pass. This is the single source of truth for "what
# AI-OS indexes"; the nightly and weekly cron jobs both call it.
#
# Why one pass (this is the whole point):
#   `memsearch index <paths>` is a DESTRUCTIVE sync - after indexing the given
#   paths it deletes every source in the collection that was NOT in those paths.
#   So every index run MUST list the COMPLETE source set, or it wipes whatever it
#   left out. The old design split indexing across a nightly job (small sources)
#   and a weekly job (the rest); because each listed only part of the sources,
#   they erased each other's work every night. Listing everything in one run
#   fixes that, and it stays fast because memsearch skips unchanged files unless
#   --force is given.
#
# The collection name comes from scripts/lib/memsearch-collection.sh, which is
# DELIBERATELY different from the memsearch plugin's own collection so the
# plugin's per-session shadow indexing can never clobber this canonical index.
#
# Usage: bash scripts/memsearch-reindex.sh [--force]
#   --force   re-embed every file (full rebuild); default skips unchanged files.
set -euo pipefail

FORCE=""
[ "${1:-}" = "--force" ] && FORCE="--force"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
cd "$ROOT"

if ! command -v memsearch >/dev/null 2>&1; then
  echo "memsearch not installed - reindex skipped."
  exit 0
fi

LOCK_DIR="$ROOT/.command-centre/memsearch-index.lock"
mkdir -p "$(dirname "$LOCK_DIR")"
cleanup_lock() {
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

write_lock_pid() {
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  trap cleanup_lock EXIT
}

if mkdir "$LOCK_DIR" 2>/dev/null; then
  write_lock_pid
else
  LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -z "$LOCK_PID" ]; then
    sleep 1
    LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  fi

  if [[ "$LOCK_PID" =~ ^[0-9]+$ ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Another memsearch index job is already running (pid ${LOCK_PID}); skipped to avoid Milvus Lite lock contention."
    exit 0
  fi

  echo "Removing stale memsearch index lock${LOCK_PID:+ (pid ${LOCK_PID})}."
  if rm -f "$LOCK_DIR/pid" 2>/dev/null && rmdir "$LOCK_DIR" 2>/dev/null && mkdir "$LOCK_DIR" 2>/dev/null; then
    write_lock_pid
  else
    echo "Memsearch index lock exists but is not held by a live process, and could not be cleared: $LOCK_DIR"
    exit 1
  fi
fi

if command -v pgrep >/dev/null 2>&1; then
  EXISTING_INDEX="$(pgrep -fl 'memsearch .*index' 2>/dev/null | grep -v "pgrep -fl" || true)"
  if [ -n "$EXISTING_INDEX" ]; then
    echo "Another memsearch index process is already running; skipped to avoid Milvus Lite lock contention."
    echo "$EXISTING_INDEX"
    exit 0
  fi
fi

COLL="$(bash scripts/lib/memsearch-collection.sh "$ROOT" 2>/dev/null || true)"
if [ -z "$COLL" ]; then
  echo "Could not resolve the canonical collection name - aborting."
  exit 1
fi

# Keep the plugin's shadow folder clean before indexing it (empty-stub guard).
if [ -x scripts/trim-memsearch-stubs.sh ]; then
  bash scripts/trim-memsearch-stubs.sh >/dev/null 2>&1 || true
fi

# Remove the obsolete generated bundle if it exists. The fast indexer keeps raw
# Notion source paths, so indexing this bundle would duplicate Notion content.
rm -f context/notion/_memsearch.md 2>/dev/null || true

# The COMPLETE AI-OS memory source set. Every index run lists ALL of these so
# none get deleted by the destructive sync. Only existing paths are included.
# Brand context is intentionally left to markdown fallback. Client brand folders
# can contain design systems, app assets, and other large reference trees that
# make semantic indexing too slow for routine memory maintenance.
SOURCES=()
add_source() {
  local p="$1"
  if [ -e "$p" ]; then
    SOURCES+=("$p")
  fi
}

add_source context/MEMORY.md
add_source context/memory/
add_source context/learnings.md

shopt -s nullglob
for client_dir in clients/*/; do
  [ -d "$client_dir/context" ] || continue
  add_source "${client_dir}context/MEMORY.md"
  add_source "${client_dir}context/memory/"
  add_source "${client_dir}context/learnings.md"
done
shopt -u nullglob
if [ ${#SOURCES[@]} -eq 0 ]; then
  echo "No memory sources found - nothing to index."
  exit 0
fi

echo "Indexing ${#SOURCES[@]} sources into ${COLL}${FORCE:+ (force)}: ${SOURCES[*]}"
MEMSEARCH_PY=""
MEMSEARCH_BIN="$(command -v memsearch || true)"
if [ -n "$MEMSEARCH_BIN" ] && [ -f "$MEMSEARCH_BIN" ]; then
  MEMSEARCH_PY="$(sed -n '1s/^#!//p' "$MEMSEARCH_BIN" 2>/dev/null || true)"
fi

if [ -x "$MEMSEARCH_PY" ] && [ -f scripts/memsearch-fast-index.py ]; then
  GLOG_minloglevel=3 GRPC_VERBOSITY=NONE "$MEMSEARCH_PY" scripts/memsearch-fast-index.py "${SOURCES[@]}" --collection "$COLL" $FORCE
else
  GLOG_minloglevel=3 GRPC_VERBOSITY=NONE memsearch index "${SOURCES[@]}" --collection "$COLL" $FORCE
fi
echo -n "Result: "
GLOG_minloglevel=3 memsearch stats --collection "$COLL" 2>/dev/null | grep -iE "chunk|total" | head -1
