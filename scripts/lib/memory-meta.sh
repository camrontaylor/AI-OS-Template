#!/usr/bin/env bash
# memory-meta.sh — Temporal inventory of AI-OS memory coverage.
# Usage: bash scripts/lib/memory-meta.sh ["topic"]
# Outputs: MEMORY.md stats, session log date range + gaps, optional topic grep.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MEMORY_FILE="$ROOT/context/MEMORY.md"
SESSION_DIR="$ROOT/context/memory"
AUTO_DIR="$ROOT/.memsearch/memory"
TOPIC="${1:-}"

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

# --- Helper: collect and sort dated .md files from a directory ---
collect_dates() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  # Only files named YYYY-MM-DD.md (ignore gap-analysis files etc.)
  ls "$dir" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$' | sed 's/\.md$//' | sort
}

# --- Session logs (context/memory/) ---
SESSION_DATES=( $(collect_dates "$SESSION_DIR") )
echo "=== Session Logs (context/memory/) ==="
if [ ${#SESSION_DATES[@]} -eq 0 ]; then
  echo "No session logs found."
else
  LAST_SESSION_INDEX=$(( ${#SESSION_DATES[@]} - 1 ))
  echo "Range: ${SESSION_DATES[0]} → ${SESSION_DATES[$LAST_SESSION_INDEX]}"
  echo "Count: ${#SESSION_DATES[@]} day(s)"

  # Detect gaps > 2 days
  GAPS=()
  for (( i=1; i<${#SESSION_DATES[@]}; i++ )); do
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
      GAPS+=("${PREV} → ${CURR} (${DIFF_DAYS} days)")
    fi
  done

  if [ ${#GAPS[@]} -eq 0 ]; then
    echo "Gaps: none"
  else
    echo "Gaps (>2 days):"
    for g in "${GAPS[@]}"; do
      echo "  - $g"
    done
  fi
fi

echo ""

# --- Auto-captured logs (.memsearch/memory/) ---
AUTO_DATES=( $(collect_dates "$AUTO_DIR") )
echo "=== Auto-Captures (.memsearch/memory/) ==="
if [ ${#AUTO_DATES[@]} -eq 0 ]; then
  echo "No auto-captured logs found."
else
  LAST_AUTO_INDEX=$(( ${#AUTO_DATES[@]} - 1 ))
  echo "Range: ${AUTO_DATES[0]} → ${AUTO_DATES[$LAST_AUTO_INDEX]}"
  echo "Count: ${#AUTO_DATES[@]} day(s)"
fi

echo ""

# --- Topic search (optional) ---
if [ -n "$TOPIC" ]; then
  echo "=== Topic: \"${TOPIC}\" ==="
  FOUND=0
  # Search in both memory directories and MEMORY.md
  for dir in "$SESSION_DIR" "$AUTO_DIR"; do
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
