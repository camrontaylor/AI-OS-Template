#!/usr/bin/env bash
# memory-curator-gate.sh - deterministic gate in front of the memory curator.
#
# Before this gate, a full sonnet session started every morning just to run
# `wc -c` and usually conclude "under budget, do nothing" (2026-07-16 audit:
# several LLM jobs should be shell). The size check is plumbing; the shell
# does it. Claude is invoked ONLY when a MEMORY.md actually needs curation -
# judgment stays with the model, the check costs nothing.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
THRESHOLD=2300

FILE="$ROOT/context/MEMORY.md"
if [ ! -f "$FILE" ]; then
  echo "No root MEMORY.md - nothing to curate. [SILENT]"
  exit 0
fi

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
if [ "${SIZE:-0}" -le "$THRESHOLD" ]; then
  echo "MEMORY.md at ${SIZE}/2500 chars - under the ${THRESHOLD} review threshold, no curation needed. [SILENT]"
  exit 0
fi

echo "MEMORY.md at ${SIZE}/2500 chars - over the ${THRESHOLD} threshold, invoking the curator."

CLAUDE_BIN="${AI_OS_CLAUDE_BIN:-claude}"
if ! command -v "${CLAUDE_BIN%% *}" >/dev/null 2>&1 && [ ! -x "${CLAUDE_BIN%% *}" ]; then
  echo "Claude binary not found ($CLAUDE_BIN) - curation skipped; MEMORY.md stays over threshold." >&2
  exit 1
fi

PROMPT="$(cat <<'EOF'
You are running as a scheduled job for AI-OS. Task: curate context/MEMORY.md, which is over its 2,300-char review threshold (hard cap 2,500).

1. Read context/MEMORY.md in full. Identify: stale Active Threads with clear done/shipped/resolved language; Environment Notes superseded by newer entries; Pending Decisions clearly already decided.
2. Consolidate duplicate or near-identical entries in the same section into one tighter line.
3. Remove the stale entries (count them). Never remove anything still clearly active - when in doubt, keep it.
4. Re-check the size. If still over 2,500, tighten verbose entries, preserving every distinct fact; relocate long reference detail to a sibling file under context/ with a one-line pointer rather than deleting it.
5. Write the updated context/MEMORY.md. Only write that file (plus a context/ reference file if relocating). Never touch client memory, never create new sections, never store secret values.
6. Output one line: Curator: removed {N} stale, merged {N} dup, MEMORY.md {chars}/2,500.
EOF
)"

cd "$ROOT"
exec "$CLAUDE_BIN" -p --model sonnet --permission-mode dontAsk -- "$PROMPT"
