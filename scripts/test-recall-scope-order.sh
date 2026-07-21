#!/usr/bin/env bash
# Regression test for the recall pipeline order (audit fix A1).
#
# The scope filter MUST run before the reranker. The reranker's Stage 3
# floor-gate derives its cutoff from the top-scoring result, so a high-scoring
# out-of-scope (wrong-client) hit can gate out a correct low-scoring in-scope
# result. If the filter runs first, the out-of-scope hit is removed before it
# can raise the gate, and the in-scope result survives.
#
# This test is deterministic: it drives filter-memory-results.py and reranker.py
# directly with fixed JSON, no memsearch, no network, no Milvus.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILTER="$ROOT/scripts/lib/filter-memory-results.py"
RERANK="$ROOT/scripts/lib/reranker.py"

for f in "$FILTER" "$RERANK"; do
  [ -f "$f" ] || { echo "missing dependency: $f" >&2; exit 1; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Out-of-scope (other client) hit scores high; in-scope (acme) hit scores low.
# Both are MEMORY.md so authority weight is identical; the only difference is
# scope. With floor_ratio 0.3, acme (s2=0.2) sits below the gate set by other
# (s2=2.0 -> threshold 0.6), so rerank-first drops acme.
cat >"$tmp/raw.json" <<'JSON'
[
  {"source": "clients/other/context/MEMORY.md", "score": 1.0, "text": "other client note"},
  {"source": "clients/acme/context/MEMORY.md", "score": 0.1, "text": "acme client note"}
]
JSON

pass=0; fail=0
check() {
  if [ "$1" = "$2" ]; then echo "ok: $3"; pass=$((pass + 1));
  else echo "FAIL: $3 (want '$2' got '$1')"; fail=$((fail + 1)); fi
}
has_acme() {
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(any("clients/acme/" in (i.get("source") or "") for i in d))' "$1"
}

# NEW order (the fix): filter the RAW results first, then rerank the in-scope set.
python3 "$FILTER" "$ROOT" client acme "$tmp/raw.json" >"$tmp/filtered.json"
python3 "$RERANK" "acme" <"$tmp/filtered.json" >"$tmp/new.json"
check "$(has_acme "$tmp/new.json")" "True" "new order (filter->rerank) keeps the in-scope acme result"

# OLD order (the bug): rerank the RAW results first (gate drops low-scoring
# acme), then filter. Proves the reorder is load-bearing, not cosmetic.
python3 "$RERANK" "acme" <"$tmp/raw.json" >"$tmp/reranked.json"
python3 "$FILTER" "$ROOT" client acme "$tmp/reranked.json" >"$tmp/old.json"
check "$(has_acme "$tmp/old.json")" "False" "old order (rerank->filter) would have dropped acme"

echo "---"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
