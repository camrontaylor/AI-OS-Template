#!/usr/bin/env bash
# memory-meta.sh — Temporal inventory of AI-OS memory coverage.
# Usage: bash scripts/lib/memory-meta.sh [--include-legacy] ["topic"]
# Outputs: MEMORY.md stats, session log date range + gaps, optional topic grep.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MEMORY_FILE="$ROOT/context/MEMORY.md"
SESSION_DIR="$ROOT/context/memory"
AUTO_DIR="$ROOT/.memsearch/memory"
INCLUDE_LEGACY=0
TOPIC=""

for arg in "$@"; do
  case "$arg" in
    --include-legacy)
      INCLUDE_LEGACY=1
      ;;
    -h|--help)
      echo "Usage: bash scripts/lib/memory-meta.sh [--include-legacy] [\"topic\"]"
      exit 0
      ;;
    *)
      if [ -z "$TOPIC" ]; then
        TOPIC="$arg"
      else
        TOPIC="$TOPIC $arg"
      fi
      ;;
  esac
done

# --- MEMORY.md stats ---
echo "=== Memory Coverage Report ==="
echo ""

if [ -f "$MEMORY_FILE" ]; then
  CHAR_COUNT=$(wc -c < "$MEMORY_FILE" | tr -d ' ')
  PCT=$(( CHAR_COUNT * 100 / 2500 ))
  # Cross-platform last-modified: try date -r (macOS/Git Bash), fall back to stat
  if date -r "$MEMORY_FILE" +"%Y-%m-%d" 2>/dev/null | grep -q .; then
    LAST_MOD=$(date -r "$MEMORY_FILE" +"%Y-%m-%d")
  else
    LAST_MOD=$(stat -c "%y" "$MEMORY_FILE" 2>/dev/null | cut -d' ' -f1 || echo "unknown")
  fi
  echo "MEMORY.md: ${CHAR_COUNT}/2500 chars (${PCT}%), last modified ${LAST_MOD}"
else
  echo "MEMORY.md: not found"
fi

echo ""

# --- Helper: collect and sort dated memory files from a directory ---
collect_dates() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  # Only files named YYYY-MM-DD.md or YYYY-MM-DD.aos.md.
  ls "$dir" 2>/dev/null |
    grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.aos)?\.md$' |
    sed -E 's/(\.aos)?\.md$//' |
    sort -u
}

# --- Session logs (context/memory/) ---
SESSION_DATES=()
SESSION_COUNT=0
while IFS= read -r session_date; do
  [ -n "$session_date" ] || continue
  SESSION_DATES[$SESSION_COUNT]="$session_date"
  SESSION_COUNT=$((SESSION_COUNT + 1))
done < <(collect_dates "$SESSION_DIR")

echo "=== Session Logs (context/memory/) ==="
if [ "$SESSION_COUNT" -eq 0 ]; then
  echo "No session logs found."
else
  SESSION_LAST_INDEX=$((SESSION_COUNT - 1))
  echo "Range: ${SESSION_DATES[0]} → ${SESSION_DATES[$SESSION_LAST_INDEX]}"
  echo "Count: ${SESSION_COUNT} day(s)"

  # Detect gaps > 2 days
  GAPS=()
  GAP_COUNT=0
  for (( i=1; i<SESSION_COUNT; i++ )); do
    PREV="${SESSION_DATES[$((i-1))]}"
    CURR="${SESSION_DATES[$i]}"
    # Convert to epoch — try date -d (Linux/Git Bash) then date -j (macOS)
    if PREV_EPOCH=$(date -d "$PREV" +%s 2>/dev/null); then
      CURR_EPOCH=$(date -d "$CURR" +%s)
    else
      PREV_EPOCH=$(date -j -f "%Y-%m-%d" "$PREV" +%s 2>/dev/null || echo 0)
      CURR_EPOCH=$(date -j -f "%Y-%m-%d" "$CURR" +%s 2>/dev/null || echo 0)
    fi
    DIFF_DAYS=$(( (CURR_EPOCH - PREV_EPOCH) / 86400 ))
    if [ "$DIFF_DAYS" -gt 2 ]; then
      GAPS[$GAP_COUNT]="${PREV} → ${CURR} (${DIFF_DAYS} days)"
      GAP_COUNT=$((GAP_COUNT + 1))
    fi
  done

  if [ "$GAP_COUNT" -eq 0 ]; then
    echo "Gaps: none"
  else
    echo "Gaps (>2 days):"
    for (( i=0; i<GAP_COUNT; i++ )); do
      echo "  - ${GAPS[$i]}"
    done
  fi
fi

echo ""

if [ "$INCLUDE_LEGACY" -eq 1 ]; then
  # --- Legacy auto-captured logs (.memsearch/memory/) ---
  AUTO_DATES=()
  AUTO_COUNT=0
  while IFS= read -r auto_date; do
    [ -n "$auto_date" ] || continue
    AUTO_DATES[$AUTO_COUNT]="$auto_date"
    AUTO_COUNT=$((AUTO_COUNT + 1))
  done < <(collect_dates "$AUTO_DIR")

  echo "=== Legacy Auto-Captures (.memsearch/memory/) ==="
  if [ "$AUTO_COUNT" -eq 0 ]; then
    echo "No legacy auto-captured logs found."
  else
    AUTO_LAST_INDEX=$((AUTO_COUNT - 1))
    echo "Range: ${AUTO_DATES[0]} → ${AUTO_DATES[$AUTO_LAST_INDEX]}"
    echo "Count: ${AUTO_COUNT} day(s)"
  fi
  echo ""
fi

# --- Topic search (optional) ---
if [ -n "$TOPIC" ]; then
  echo "=== Topic: \"${TOPIC}\" ==="
  FOUND=0
  SEARCH_DIRS=("$SESSION_DIR")
  SEARCH_DIR_COUNT=1
  if [ "$INCLUDE_LEGACY" -eq 1 ]; then
    SEARCH_DIRS[$SEARCH_DIR_COUNT]="$AUTO_DIR"
    SEARCH_DIR_COUNT=$((SEARCH_DIR_COUNT + 1))
  fi

  for (( i=0; i<SEARCH_DIR_COUNT; i++ )); do
    dir="${SEARCH_DIRS[$i]}"
    [ -d "$dir" ] || continue
    while IFS= read -r file; do
      BASENAME=$(basename "$file")
      DATE="${BASENAME%.md}"
      if grep -qi "$TOPIC" "$file" 2>/dev/null; then
        echo "  $DATE: $file"
        FOUND=1
      fi
    done < <(find "$dir" -name "*.md" -type f | sort)
  done
  if [ -f "$MEMORY_FILE" ] && grep -qi "$TOPIC" "$MEMORY_FILE" 2>/dev/null; then
    echo "  (current): context/MEMORY.md"
    FOUND=1
  fi
  LEARNINGS="$ROOT/context/learnings.md"
  if [ -f "$LEARNINGS" ] && grep -qi "$TOPIC" "$LEARNINGS" 2>/dev/null; then
    echo "  (ongoing): context/learnings.md"
    FOUND=1
  fi
  if [ "$FOUND" -eq 0 ]; then
    echo "  No mentions found for \"${TOPIC}\"."
  fi
  echo ""
fi
