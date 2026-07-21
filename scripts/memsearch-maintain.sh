#!/usr/bin/env bash
# Run the canonical semantic-memory index and its health proof as one ordered job.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch-maintain.XXXXXX")"
QUALITY_OUT="$(mktemp "${TMPDIR:-/tmp}/aios-memsearch-quality.XXXXXX")"
cleanup() { rm -f "$INDEX_OUT" "$QUALITY_OUT"; }
trap cleanup EXIT

bash "$ROOT/scripts/memsearch-reindex.sh" --strict | tee "$INDEX_OUT"

COLLECTION="$(bash "$ROOT/scripts/lib/memsearch-collection.sh" "$ROOT")"
TOTAL_CHUNKS="$(sed -n 's/.*Total indexed chunks:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$INDEX_OUT" | tail -1)"
[[ "$TOTAL_CHUNKS" =~ ^[0-9]+$ ]] || {
  echo "Index completed but no total chunk count was reported." >&2
  exit 1
}

STATE_DIR="$ROOT/.command-centre"
STATE="$STATE_DIR/semantic-index-last-success.json"
STATE_TMP="$STATE.tmp.$$"
mkdir -p "$STATE_DIR"
printf '{\n  "completed_at": "%s",\n  "collection": "%s",\n  "total_chunks": %s\n}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$COLLECTION" "$TOTAL_CHUNKS" > "$STATE_TMP"
mv "$STATE_TMP" "$STATE"

bash "$ROOT/scripts/memsearch-health.sh" --report

# Infrastructure health is not retrieval quality. Run the stable real-question
# benchmark against the just-completed generation and keep its result durable.
set +e
bash "$ROOT/scripts/test-recall-golden.sh" 2>&1 | tee "$QUALITY_OUT"
QUALITY_STATUS=${PIPESTATUS[0]}
set -e

QUALITY_REPORT="$ROOT/projects/system-health/$(date +%F)_semantic-retrieval-quality.md"
mkdir -p "$(dirname "$QUALITY_REPORT")"
{
  printf '# Semantic Retrieval Quality - %s\n\n' "$(date +%F)"
  printf 'Index collection: `%s`\n\n' "$COLLECTION"
  printf '```text\n'
  cat "$QUALITY_OUT"
  printf '```\n'
} > "$QUALITY_REPORT"
printf 'Semantic retrieval quality report saved to %s\n' "${QUALITY_REPORT#"$ROOT/"}"
exit "$QUALITY_STATUS"
