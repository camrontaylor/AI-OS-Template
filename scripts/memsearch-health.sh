#!/usr/bin/env bash
# Read-only semantic memory health probe for AI-OS.
#
# This intentionally uses scripts/memsearch-search.sh instead of raw memsearch
# commands so collection resolution, markdown fallback, and sandbox handling stay
# consistent with runtime recall.

set -euo pipefail

# Tag probe searches as eval so the memory-observability usage log does not count
# this health check as organic recall.
export AI_OS_RECALL_CALLER=eval

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRITE_REPORT=0
if [[ "${1:-}" == "--report" ]]; then
  WRITE_REPORT=1
  shift
fi
QUERY="${1:-semantic vector health ordinary language probe}"
OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch-health.XXXXXX")"
ERR="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch-health.err.XXXXXX")"
REPORT_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch-health.report.XXXXXX")"
cleanup() {
  rm -f "$OUT" "$ERR" "$REPORT_OUT"
}
trap cleanup EXIT

finish() {
  # Collection inventory: flag any collection other than the canonical one so
  # orphans from repo moves/experiments are caught instead of growing forever
  # (the 2026-07-16 audit found 345 MB of dead collections). GC them with:
  # bash scripts/memsearch-gc.sh
  local canonical orphans=""
  canonical="$(bash "$ROOT/scripts/lib/memsearch-collection.sh" 2>/dev/null || true)"
  if [[ -n "$canonical" && -d "$HOME/.memsearch/milvus.db/collections" ]]; then
    local coll
    for coll in "$HOME"/.memsearch/milvus.db/collections/*/; do
      [[ -d "$coll" ]] || continue
      local name; name="$(basename "$coll")"
      [[ "$name" == "$canonical" ]] || orphans="$orphans $name"
    done
    if [[ -n "$orphans" ]]; then
      printf '\nOrphan collections (run bash scripts/memsearch-gc.sh):%s\n' "$orphans" >> "$REPORT_OUT"
    fi
  fi

  local state="$ROOT/.command-centre/semantic-index-last-success.json"
  if [[ -f "$state" ]]; then
    local completed collection total
    completed="$(sed -n 's/.*"completed_at": "\([^"]*\)".*/\1/p' "$state" | head -1)"
    collection="$(sed -n 's/.*"collection": "\([^"]*\)".*/\1/p' "$state" | head -1)"
    total="$(sed -n 's/.*"total_chunks": \([0-9][0-9]*\).*/\1/p' "$state" | head -1)"
    if [[ -n "$completed" && -n "$collection" && -n "$total" ]]; then
      {
        printf '\nIndex completed: %s\n' "$completed"
        printf 'Collection: %s\n' "$collection"
        printf 'Indexed chunks: %s\n' "$total"
        printf 'Probe scope: root\n'
      } >> "$REPORT_OUT"
    fi
  fi

  if [[ "$WRITE_REPORT" -eq 1 ]]; then
    local report_dir="$ROOT/projects/system-health"
    local report="$report_dir/$(date +%F)_semantic-memory-health.md"
    mkdir -p "$report_dir"
    {
      printf '# Semantic Memory Health - %s\n\n' "$(date +%F)"
      cat "$REPORT_OUT"
      printf '\n'
    } > "$report"
    printf 'Semantic memory health report saved to %s\n' "${report#"$ROOT/"}"
  else
    cat "$REPORT_OUT"
  fi
}

if ! command -v python3 >/dev/null 2>&1; then
  {
    echo "Status: NEEDS ATTENTION"
    echo "Reason: python3 is required to parse memory health results."
    echo "Fix: install Python 3, then rerun bash scripts/memsearch-health.sh"
  } > "$REPORT_OUT"
  finish
  exit 1
fi

if ! bash "$ROOT/scripts/memsearch-search.sh" "$QUERY" 5 --scope root >"$OUT" 2>"$ERR"; then
  {
    echo "Status: NEEDS ATTENTION"
    echo "Reason: memory recall wrapper failed."
    echo "Fix: bash scripts/memsearch-search.sh \"$QUERY\" 5 --scope root"
    sed -n '1,12p' "$ERR" | sed 's/^/Detail: /'
  } > "$REPORT_OUT"
  finish
  exit 1
fi

set +e
python3 - "$OUT" "$ERR" > "$REPORT_OUT" <<'PY'
import json
import sys
from pathlib import Path

out_path = Path(sys.argv[1])
err_path = Path(sys.argv[2])

try:
    data = json.loads(out_path.read_text() or "[]")
except Exception as exc:
    print("Status: NEEDS ATTENTION")
    print(f"Reason: memory recall wrapper returned non-JSON output ({exc}).")
    print("Fix: bash scripts/memsearch-search.sh \"AI-OS memory system\" 5 --scope root")
    raise SystemExit(1)

modes = set()
for item in data:
    for mode in item.get("search_modes", [item.get("search_mode")]):
        if mode:
            modes.add(mode)

stderr = err_path.read_text(errors="replace")

blocked = any(
    marker in stderr
    for marker in (
        "Milvus Lite",
        "LOCK",
        "Open local milvus failed",
        "Operation not permitted",
        "Failed to bind to address",
        "DataDirLockedError",
    )
)

if not data and blocked:
    print("Status: DEGRADED")
    print("Semantic recall: not proven")
    print("Fallback recall: available but returned no match for this probe")
    print("Reason: Milvus Lite was blocked or locked, so AI-OS could not prove semantic recall from this sandbox.")
    print("Fix: rerun in a shell with access to Milvus Lite, or run bash scripts/memsearch-health.sh in an unrestricted local shell.")
    raise SystemExit(1)
elif not data:
    print("Status: NEEDS ATTENTION")
    print("Reason: memory recall returned no results.")
    print("Fix: bash scripts/memsearch-reindex.sh")
    raise SystemExit(1)
elif "semantic" in modes:
    print("Status: OK")
    print("Semantic recall: working")
    print(f"Results: {len(data)}")
elif modes == {"markdown_fallback"} or "markdown_fallback" in modes:
    print("Status: DEGRADED")
    print("Semantic recall: not proven")
    print("Fallback recall: working")
    if blocked:
        print("Reason: Milvus Lite was blocked or locked, so AI-OS used markdown fallback.")
        print("Fix: rerun in a shell with access to Milvus Lite, or run bash scripts/memsearch-reindex.sh if the index is stale.")
    else:
        print("Reason: recall wrapper returned fallback-only results.")
        print("Fix: run bash scripts/memsearch-reindex.sh, then rerun this health probe.")
    raise SystemExit(1)
else:
    print("Status: NEEDS ATTENTION")
    print(f"Reason: unknown recall mode set: {sorted(modes)}")
    print("Fix: bash scripts/test-memsearch-search.sh")
    raise SystemExit(1)
PY
STATUS=$?
set -e
finish
exit "$STATUS"
