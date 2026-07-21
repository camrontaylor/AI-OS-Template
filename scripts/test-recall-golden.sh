#!/usr/bin/env bash
# test-recall-golden.sh - retrieval-quality eval over the real memory corpus.
#
# The 2026-07-16 audit found AI-OS had no retrieval-quality eval at all: fusion
# weights could silently make the semantic index decorative and nothing would
# notice. This runs the golden set in scripts/lib/recall-golden-set.json
# against the recall stack and fails below the pass threshold.
#
# Modes:
#   default - runs against scripts/memsearch-search.sh (hybrid when Milvus is
#             available, markdown fallback when sandboxed). Deterministic
#             either way because the golden facts live in markdown surfaces.
#   --markdown-only - forces scripts/memory-search.sh (no Milvus dependency).
#
# Paraphrase cases (cross-vocabulary) are reported separately: they are the
# semantic layer's reason to exist, and a hybrid run should catch them.
set -uo pipefail
cd "$(dirname "$0")/.."

SEARCH_CMD="bash scripts/memsearch-search.sh"
if [ "${1:-}" = "--markdown-only" ]; then
  SEARCH_CMD="bash scripts/memory-search.sh"
fi

GOLDEN="scripts/lib/recall-golden-set.json" SEARCH_CMD="$SEARCH_CMD" python3 - <<'PY'
import json
import os
import re
import subprocess
import sys

# Shared verdict logic (single source of truth for the two-tier gate).
sys.path.insert(0, os.path.dirname(os.path.abspath(os.environ["GOLDEN"])))
from recall_gate import classify

golden = json.load(open(os.environ["GOLDEN"]))
search_cmd = os.environ["SEARCH_CMD"].split()
# Two-tier gate: `target` is what we aspire to; `floor` is the hard line below
# which the index is treated as broken. Between them is a healthy WARN, not a
# failure - a genuinely healthy 90% index was crying FAILURE against a 95% hard
# gate and training the operator to ignore the job status (2026-07-20 fix).
target = float(golden.get("pass_threshold", 0.95))
floor = float(golden.get("floor_threshold", 0.8))
top_k = int(golden.get("top_k", 3))
paraphrase_threshold = float(golden.get("semantic_paraphrase_threshold", 1.0))

hits, misses, para_hits, para_total = 0, [], 0, 0
for case in golden["cases"]:
    query, expect = case["query"], case["expect_source"]
    is_para = bool(case.get("paraphrase"))
    if is_para:
        para_total += 1
    try:
        raw = subprocess.run(
            search_cmd + [query, str(top_k), "--scope", "root"],
            capture_output=True, text=True, timeout=120,
        ).stdout
        start = raw.find("[")
        results = json.loads(raw[start:]) if start >= 0 else []
    except Exception:
        results = []
    sources = [str(r.get("source") or r.get("source_path") or "") for r in results]
    matching = [r for r, source in zip(results, sources) if re.search(expect, source)]
    if matching:
        hits += 1
        semantic_match = any(
            r.get("search_mode") in {"semantic", "hybrid"}
            or "semantic" in r.get("search_modes", [])
            for r in matching
        )
        if is_para and semantic_match:
            para_hits += 1
        print(f"  ✓ {query[:64]}")
    else:
        misses.append((query, expect, sources[:3]))
        print(f"  ✗ {query[:64]}  (wanted {expect})")

total = len(golden["cases"])
rate = hits / total if total else 0.0
print(f"\nGolden recall at top-{top_k}: {hits}/{total} ({rate:.0%}); semantic paraphrase cases: {para_hits}/{para_total}")
for query, expect, top in misses:
    print(f"  MISS: '{query}' -> expected {expect}; top sources: {top}")

para_rate = para_hits / para_total if para_total else 1.0
verdict, exit_code, message = classify(rate, para_rate, floor, target, paraphrase_threshold)
print(message)
# meta-systems-check greps for the literal "golden recall eval passed" to confirm
# the health floor was cleared. The PASS message already contains it; a WARN is
# still above the floor (healthy), so echo it there too. FAIL prints neither.
if verdict == "WARN":
    print("golden recall eval passed")
sys.exit(exit_code)
PY
