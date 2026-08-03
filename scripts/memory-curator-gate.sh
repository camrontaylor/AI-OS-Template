#!/usr/bin/env bash
# memory-curator-gate.sh - deterministic gate that keeps context/MEMORY.md under cap.
#
# History: the curation used to run as a full `claude -p` session invoked with
# `exec`. When that session timed out (2026-07-21 and -22, two nights running)
# nothing trimmed the file and it drifted over cap, and the job reported on
# process status, never on whether the file was actually healthy.
#
# An independent review then showed the inline AI step was not just the failure
# source but the ONLY unrecoverable-loss path (a model rewriting the file in
# place can drop a distinct fact that the archive never sees), and that it put
# nondeterminism into the write path of the most cache-sensitive file in the
# system. So the AI is gone. Semantic judgment (merging overlapping threads,
# what is stale) lives in a REPORT job (cron/jobs/weekly-memory-gaps.md), which
# never edits MEMORY.md and so cannot corrupt it - the design's own pattern.
#
# This gate is now purely deterministic:
#   1. Under the review threshold -> silent, zero cost.
#   2. Over it -> scripts/lib/memory-hygiene.py enforces the cap with no AI:
#      drop explicitly-resolved threads, dedup, and archive (never delete) the
#      stalest entries down to target. Writes are atomic.
#   3. Capture curate's exit code AND re-read the size: any nonzero result, or a
#      file still over cap, is a loud failure (notify), never silent drift.
#
# Test knobs (scripts/test-memory-curator-gate.sh): AI_OS_MEMORY_FILE,
# AI_OS_MEMORY_ARCHIVE, AI_OS_MEMORY_STATUS, AI_OS_PYTHON.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FILE="${AI_OS_MEMORY_FILE:-$ROOT/context/MEMORY.md}"
# context/archive/, NOT context/memory/archive/: the latter is a semantic-index
# source, so evicted entries would resurface in recall.
ARCHIVE="${AI_OS_MEMORY_ARCHIVE:-$ROOT/context/archive/MEMORY-archive.md}"
STATUS="${AI_OS_MEMORY_STATUS:-$ROOT/.command-centre/memory-hygiene.json}"
HYGIENE="$SCRIPT_DIR/lib/memory-hygiene.py"
PYTHON="${AI_OS_PYTHON:-python3}"
CAP=2500
TARGET=2300

size_of() { wc -c < "$1" | tr -d ' '; }
write_status() {
  mkdir -p "$(dirname "$STATUS")" 2>/dev/null
  "$PYTHON" "$HYGIENE" report --file "$FILE" --cap "$CAP" --cold-days 10 > "$STATUS" 2>/dev/null || true
}

if [ ! -f "$FILE" ]; then
  echo "No root MEMORY.md - nothing to curate. [SILENT]"
  exit 0
fi

SIZE="$(size_of "$FILE")"
if [ "${SIZE:-0}" -le "$TARGET" ]; then
  echo "MEMORY.md at ${SIZE}/${CAP} chars - under the ${TARGET} target, no curation needed. [SILENT]"
  write_status
  exit 0
fi

echo "MEMORY.md at ${SIZE}/${CAP} chars - over the ${TARGET} target, curating."

# python is the load-bearing dependency - fail loudly if it is missing, rather
# than silently leaving the file over cap.
if ! command -v "${PYTHON%% *}" >/dev/null 2>&1 && [ ! -x "${PYTHON%% *}" ]; then
  echo "FAILURE: $PYTHON not found - cannot enforce the MEMORY.md cap." >&2
  exit 1
fi

# Deterministic curation (atomic write inside).
"$PYTHON" "$HYGIENE" curate --file "$FILE" --cap "$CAP" --target "$TARGET" --archive "$ARCHIVE"
RC=$?

# Post-condition check: verify the outcome, not the process. A nonzero exit
# (2 still-over-cap, 3 no sections, 4 write failed, 5 archive failed) or a file
# still over cap is a real failure that must notify.
write_status
FINAL="$(size_of "$FILE")"
if [ "$RC" -ne 0 ] || [ "${FINAL:-99999}" -gt "$CAP" ]; then
  echo "FAILURE: curate exit ${RC}, MEMORY.md ${FINAL}/${CAP} chars - needs a look." >&2
  exit 1
fi
echo "MEMORY.md curated to ${FINAL}/${CAP} chars."
exit 0
