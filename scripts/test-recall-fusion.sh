#!/usr/bin/env bash
# test-recall-fusion.sh - regression tests for scripts/lib/merge-memory-results.py.
#
# Guards the 2026-07-16 audit fix: with the old 1.35 markdown weight and
# exact-range fusion keys, a purely-semantic result could never enter the
# fused top-k whenever markdown filled it (markdown ranks 1-22 all outscored
# semantic rank 1), making the embedding index decorative. These tests pin:
#   1. Semantic-only (cross-vocabulary) hits are reachable in the top-k.
#   2. Chunks from the two engines with OVERLAPPING line ranges in the same
#      file fuse into one hybrid result.
#   3. Cross-engine agreement outranks single-engine hits.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import json, subprocess, tempfile

semantic = [
    {"source": f"context/memory/sem{i}.md", "start_line": 1, "end_line": 5,
     "score": 0.9 - i * 0.01, "search_mode": "semantic"}
    for i in range(10)
]
markdown = [
    {"source": f"context/memory/md{i}.md", "start_line": 1, "end_line": 5,
     "score": 5 - i * 0.1, "search_mode": "markdown_fallback"}
    for i in range(10)
]
semantic[2].update(source="context/learnings.md", start_line=10, end_line=30)
markdown[4].update(source="context/learnings.md", start_line=25, end_line=45)

sp = tempfile.mktemp(suffix=".json")
mp = tempfile.mktemp(suffix=".json")
open(sp, "w").write(json.dumps(semantic))
open(mp, "w").write(json.dumps(markdown))
out = json.loads(subprocess.check_output(
    ["python3", "scripts/lib/merge-memory-results.py", sp, mp, "8"]))

sem_only = sum(1 for r in out if r["search_mode"] == "semantic")
hybrid = sum(1 for r in out if r["search_mode"] == "hybrid")
assert sem_only >= 2, f"semantic-only results unreachable in top-8 (got {sem_only})"
assert hybrid >= 1, "overlapping line ranges did not fuse into a hybrid result"
assert out[0]["search_mode"] == "hybrid", (
    f"cross-engine agreement should rank first, got {out[0]['search_mode']}")
print("  ✓ semantic-only hits reachable in top-k")
print("  ✓ overlapping ranges fuse into one hybrid result")
print("  ✓ cross-engine agreement ranks first")

# A near-tied, single-stream hot-memory result should beat a duplicated daily
# session note. Otherwise fusion silently throws away the authority contract
# applied inside each engine and stale episodic detail outranks the current fact.
semantic2 = [{"source": "context/memory/2026-07-01.md", "start_line": 1,
              "end_line": 5, "score": 0.9, "search_mode": "semantic"}]
markdown2 = [
    {"source": "context/memory/2026-07-01.md", "start_line": 1,
     "end_line": 5, "score": 5, "search_mode": "markdown_fallback"},
    {"source": "context/MEMORY.md", "start_line": 10,
     "end_line": 20, "score": 4, "search_mode": "markdown_fallback"},
]
open(sp, "w").write(json.dumps(semantic2))
open(mp, "w").write(json.dumps(markdown2))
out2 = json.loads(subprocess.check_output(
    ["python3", "scripts/lib/merge-memory-results.py", sp, mp, "2"]))
assert out2[0]["source"] == "context/MEMORY.md", (
    f"fusion erased hot-memory authority: {out2}")
print("  ✓ hot-memory authority survives cross-engine fusion")
PY

echo "recall fusion tests passed"
