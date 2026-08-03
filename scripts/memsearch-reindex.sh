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
# Usage: bash scripts/memsearch-reindex.sh [--force] [--strict]
#   --force   re-embed every file (full rebuild); default skips unchanged files.
#   --strict  treat missing prerequisites, lock skips, and empty sources as failure.
set -euo pipefail

FORCE=""
STRICT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) FORCE="--force" ;;
    --strict) STRICT=1 ;;
    -h|--help)
      echo "Usage: bash scripts/memsearch-reindex.sh [--force] [--strict]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 64
      ;;
  esac
  shift
done

skip_or_fail() {
  echo "$1"
  if [ "$STRICT" -eq 1 ]; then
    exit 1
  fi
  exit 0
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
cd "$ROOT"

if ! command -v memsearch >/dev/null 2>&1; then
  skip_or_fail "memsearch not installed - reindex skipped."
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
    skip_or_fail "Another memsearch index job is already running (pid ${LOCK_PID}); skipped to avoid Milvus Lite lock contention."
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
    echo "$EXISTING_INDEX"
    skip_or_fail "Another memsearch index process is already running; skipped to avoid Milvus Lite lock contention."
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
  [ -e "$p" ] || return 0
  # Idempotent: skip if this exact path is already queued. Lets the explicit
  # required lines below coexist with the top-level *.md globs without adding
  # the same file twice.
  local existing
  for existing in "${SOURCES[@]:-}"; do
    [ "$existing" = "$p" ] && return 0
  done
  SOURCES+=("$p")
}

# Curated knowledge subfolders: durable vendor/product/reference synthesis that
# lives ONE level down inside a context/ folder (not a top-level *.md, and not a
# deep-search-only tree like meetings/, inbox/, or transcripts/). These were a
# recall blind spot - both indexers walk context/*.md NON-recursively, so a whole
# knowledge folder could be invisible to recall (2026-07-29 fix: a client
# context/myob-exo/ folder was built 07-28 and was never reachable). Add a folder NAME
# here to make its markdown routinely indexed, root and every client. Keep in
# sync with routine_semantic in config/memory-index-policy.json and with the
# KNOWLEDGE_SUBFOLDERS list in scripts/memory-search.py.
KNOWLEDGE_SUBFOLDERS=(myob-exo operator)
# Noisy machine maps inside a knowledge folder that must stay OUT of routine
# recall (large table-of-contents / topic dumps that would drown recall in
# hundreds of near-identical headings). Matched against the full path.
KNOWLEDGE_SUBFOLDER_SKIP_GLOBS=('*/official-help/topic-index.md')

add_knowledge_subfolder() {
  # $1 = a context/ directory (e.g. "context" or "clients/{slug}/context").
  # No-op when the named subfolders are absent, so it is safe to call for root
  # and every client uniformly.
  local ctx="$1" sub f skip keep
  for sub in "${KNOWLEDGE_SUBFOLDERS[@]}"; do
    [ -d "$ctx/$sub" ] || continue
    while IFS= read -r f; do
      keep=1
      for skip in "${KNOWLEDGE_SUBFOLDER_SKIP_GLOBS[@]}"; do
        # shellcheck disable=SC2254
        case "$f" in $skip) keep=0; break ;; esac
      done
      [ "$keep" = 1 ] && add_source "$f"
    done < <(find "$ctx/$sub" -type f -name '*.md' | sort)
  done
}

add_source context/MEMORY.md
add_source context/memory/
add_source context/learnings.md
# Root top-level curated context (SOUL, USER, decisions, learnings.shared,
# prompt-tags, ...). These are durable hot memory that used to fall through the
# cracks: only MEMORY.md and learnings.md were indexed, so identity and
# standing-decision knowledge was invisible to semantic recall (2026-07-27 fix).
# Non-recursive on purpose - subfolders (inbox/, notion/, transcripts/) keep
# their deep-search-only tier from config/memory-index-policy.json.
shopt -s nullglob
for f in context/*.md; do
  # Skip files that are not recall memory: learnings.shared.md is the git-tracked
  # sanitized MIRROR of learnings.md (indexing both double-counts the same lesson
  # and lets the mirror outrank the authoritative copy - proven in the golden
  # recall benchmark), and prompt-tags.md is reusable prompt config, not memory.
  case "$(basename "$f")" in
    learnings.shared.md|prompt-tags.md) continue ;;
  esac
  add_source "$f"
done
shopt -u nullglob
add_source context/wiki/
# The curated Notion catalog (Stack + Resources), so "what tool did I save for X"
# is answerable from memory. Deliberately the single generated CATALOG.md and NOT
# context/notion/items/ - indexing all ~500 raw scraped pages would add more
# marketing copy than there is real memory, and drown recall in product taglines.
# Curated knowledge subfolders at root (none today; no-op unless one is added).
add_knowledge_subfolder context
add_source context/notion/CATALOG.md
# The human daily notes: your journal plus the auto session/Notion index. Real
# hot memory, and terse (note titles and links, never raw note bodies - those
# stay deep-search-only in context/notion/), so it belongs in routine recall.
add_source daily/

shopt -s nullglob
for client_dir in clients/*/; do
  [ -d "$client_dir/context" ] || continue
  add_source "${client_dir}context/MEMORY.md"
  add_source "${client_dir}context/memory/"
  add_source "${client_dir}context/learnings.md"
  # Client topic wiki: durable per-client synthesis (for example integration,
  # setup, and discovery-question notes), symmetric to the root
  # context/wiki/ indexed above. The markdown fallback already covers this via
  # MEMORY_SOURCE_DIRS; naming it here makes the semantic index deterministic so
  # it is never pruned as an unlisted source (2026-07-29 parity fix).
  add_source "${client_dir}context/wiki/"
  # Durable client synthesis layer: the top-level context/*.md files (overview,
  # relationship-history, ops synthesis, timeline, current-state, billing, ...).
  # These are the richest curated client knowledge and were previously invisible
  # to semantic recall - only MEMORY.md/learnings.md were indexed (2026-07-27
  # fix). Non-recursive: subfolders (meetings/, inbox/, intake/, transcripts/,
  # reference/) keep their deep-search-only / candidate tiers per
  # config/memory-index-policy.json - raw transcripts stay out, but the
  # relationship-history that summarizes every call is now indexed.
  for f in "${client_dir}context"/*.md; do add_source "$f"; done
  # Curated knowledge subfolders (e.g. myob-exo/): durable vendor/product/
  # reference synthesis one level down, minus noisy machine maps. See
  # KNOWLEDGE_SUBFOLDERS above. This closes the recursive blind spot without
  # sweeping in the deep-search-only trees (meetings/, inbox/, transcripts/).
  add_knowledge_subfolder "${client_dir}context"
done
shopt -u nullglob
if [ ${#SOURCES[@]} -eq 0 ]; then
  skip_or_fail "No memory sources found - nothing to index."
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
