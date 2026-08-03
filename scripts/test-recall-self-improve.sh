#!/usr/bin/env bash
# test-recall-self-improve.sh - guards the recall self-improvement loop.
#
# Fast: unit-tests the pure harvest/filter logic and the integrity guard without
# doing real semantic searches (which are slow and index-dependent). The full
# search path is exercised by running scripts/recall-self-improve.sh by hand.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
fail=0
ok()   { echo "  ok  - $1"; }
bad()  { echo "  FAIL- $1"; fail=1; }

echo "== unit: task-prompt filter and query cleaner =="
python3 - <<'PY' || exit 1
import importlib.util, os, sys
ROOT = os.getcwd()
spec = importlib.util.spec_from_file_location("rsi", os.path.join(ROOT, "scripts", "recall-self-improve.py"))
rsi = importlib.util.module_from_spec(spec); spec.loader.exec_module(rsi)

# queries that must be REJECTED as task prompts, not harvested into a benchmark
reject = [
    "Finish implementing /goal",
    "Answer this questions again with actual fucking context and memory",
    "write the vendor email about the demo",
    "implement everything now",
    "fix the recall loop",
]
# queries that must be KEPT (real recall questions or topic queries)
keep = [
    "how do I restore a memory backup",
    "How does Northwind price quotes for customers, dealer discounts",
    "Kilimanjaro Consulting MYOB EXO partner API licence",
    "what did Nick say about quoting staying in EXO",
    "canonical memsearch collection name",
]
bad = 0
for q in reject:
    if not rsi.looks_like_task_prompt(q):
        print(f"  FAIL- should REJECT: {q!r}"); bad = 1
    else:
        print(f"  ok  - reject: {q[:48]}")
for q in keep:
    if rsi.looks_like_task_prompt(q):
        print(f"  FAIL- should KEEP: {q!r}"); bad = 1
    else:
        print(f"  ok  - keep:   {q[:48]}")

# clean_query trims a trailing task clause and a pasted second line
c1 = rsi.clean_query("How does Northwind price quotes, dealer discounts - answer for the buyer doc")
assert c1 == "How does Northwind price quotes, dealer discounts", c1
c2 = rsi.clean_query("Are the marketing skills up to date?\nnpx skills add coreyhaines")
assert c2 == "Are the marketing skills up to date?", c2
print("  ok  - clean_query trims task clause and pasted line")

# the safety floor exists and is a real gate
assert 0 < rsi.SAFETY_FLOOR < 1, rsi.SAFETY_FLOOR
print(f"  ok  - SAFETY_FLOOR gate present ({rsi.SAFETY_FLOOR})")
sys.exit(bad)
PY
[ $? -eq 0 ] || fail=1

echo "== unit: wrapper survives NO-ARG invocation under set -u (the daemon calls it with no args) =="
# Regression: the cron daemon runs `bash scripts/recall-self-improve.sh` with zero
# args. Under `set -u`, a bare "${ARGS[@]}" on an empty array throws "unbound
# variable" (bash 3.2). The wrapper must use the ${ARGS[@]+...} safe expansion.
# Every line that expands ARGS must carry the ${ARGS[@]+...} guard. Count lines
# that reference ARGS[@] but lack the +guard - must be zero.
unguarded=$(grep -nE 'ARGS\[@\]' scripts/recall-self-improve.sh | grep -vE 'ARGS\[@\]\+' | wc -l | tr -d ' ')
if [ "$unguarded" = "0" ]; then
  ok "every \${ARGS[@]} expansion carries the +guard (no-arg daemon run safe)"
else
  bad "$unguarded unguarded \${ARGS[@]} expansion(s) remain (breaks no-arg daemon run)"
fi
bash -uc 'ARGS=(); printf "%s" "${ARGS[@]+"${ARGS[@]}"}"' >/dev/null 2>&1 \
  && ok "empty-array safe expansion works under set -u" \
  || bad "safe expansion pattern itself fails under set -u"

echo "== unit: broken-index safety gate (safe_to_act flips false, no edits) =="
python3 - <<'PY' || exit 1
import importlib.util, os, sys
ROOT = os.getcwd()
spec = importlib.util.spec_from_file_location("rsi", os.path.join(ROOT, "scripts", "recall-self-improve.py"))
rsi = importlib.util.module_from_spec(spec); spec.loader.exec_module(rsi)
bad = 0

# DEAD index: every search returns nothing -> every case misses, semantic dead.
rsi.run_search = lambda *a, **k: []
g = {"cases": [{"query": "a", "expect_source": "x"}, {"query": "b", "expect_source": "y"}], "top_k": 3}
m = rsi.measure(g, "root", "")
healthy = bool(m["semantic_alive"]) and m["rate"] >= rsi.SAFETY_FLOOR
if healthy or m["rate"] != 0.0:
    print(f"  FAIL- dead index should gate: healthy={healthy} rate={m['rate']}"); bad = 1
else:
    print("  ok  - dead index -> safe_to_act would be FALSE (job reports only, no edits)")

# HALF-broken index below the 50% floor also gates.
seq = {"n": 0}
def half(q, k, s, c):
    seq["n"] += 1
    return [{"source": "x", "search_mode": "hybrid"}] if seq["n"] % 3 == 0 else []
rsi.run_search = half
g3 = {"cases": [{"query": f"q{i}", "expect_source": "x"} for i in range(10)], "top_k": 3}
m3 = rsi.measure(g3, "root", "")
healthy3 = bool(m3["semantic_alive"]) and m3["rate"] >= rsi.SAFETY_FLOOR
if healthy3:
    print(f"  FAIL- {m3['rate']:.0%} recall is below floor, should gate"); bad = 1
else:
    print(f"  ok  - {m3['rate']:.0%} recall (< {rsi.SAFETY_FLOOR:.0%} floor) -> gated")

# HEALTHY index does NOT gate.
rsi.run_search = lambda q, k, s, c: [{"source": "x", "search_mode": "hybrid"}]
m2 = rsi.measure({"cases": [{"query": "a", "expect_source": "x"}], "top_k": 3}, "root", "")
healthy2 = bool(m2["semantic_alive"]) and m2["rate"] >= rsi.SAFETY_FLOOR
if not healthy2:
    print("  FAIL- healthy index should NOT gate"); bad = 1
else:
    print("  ok  - healthy index -> safe_to_act TRUE (job may act)")
sys.exit(bad)
PY
[ $? -eq 0 ] || fail=1

echo "== unit: robust to empty / malformed usage log =="
python3 - <<'PY' || exit 1
import importlib.util, os, sys, tempfile
ROOT = os.getcwd()
spec = importlib.util.spec_from_file_location("rsi", os.path.join(ROOT, "scripts", "recall-self-improve.py"))
rsi = importlib.util.module_from_spec(spec); spec.loader.exec_module(rsi)
# point the loader at a garbage log
d = tempfile.mkdtemp()
p = os.path.join(d, "recall-usage.jsonl")
open(p, "w").write("not json\n{}\n{\"ts\":\"broken\"}\n\n")
rsi.USAGE_LOG = p
recs = rsi.load_usage(30, "root", "")
cands = rsi.harvest(recs, {"cases": []}, "root", "", 5)
assert recs == [] and cands == [], f"garbage log should yield nothing: {recs} {cands}"
print("  ok  - garbage/empty usage log yields no candidates, no crash")
sys.exit(0)
PY
[ $? -eq 0 ] || fail=1

echo "== unit: golden-set validator catches corruption =="
TMP="$(mktemp -d "${TMPDIR:-/tmp}/rsi-test.XXXXXX")"
cat > "$TMP/good.json" <<'JSON'
{"cases":[{"query":"canonical memsearch collection name","expect_source":"context/MEMORY\\.md"}]}
JSON
cat > "$TMP/badregex.json" <<'JSON'
{"cases":[{"query":"x","expect_source":"context/(unclosed"}]}
JSON
cat > "$TMP/dupe.json" <<'JSON'
{"cases":[{"query":"same","expect_source":"context/MEMORY\\.md"},{"query":"same","expect_source":"context/MEMORY\\.md"}]}
JSON
echo "{ not json" > "$TMP/broken.json"
python3 scripts/recall-golden-validate.py "$TMP/good.json" >/dev/null 2>&1 && ok "valid set passes" || bad "valid set should pass"
python3 scripts/recall-golden-validate.py "$TMP/badregex.json" >/dev/null 2>&1 && bad "bad regex should fail" || ok "bad regex rejected"
python3 scripts/recall-golden-validate.py "$TMP/dupe.json" >/dev/null 2>&1 && bad "duplicate query should fail" || ok "duplicate query rejected"
python3 scripts/recall-golden-validate.py "$TMP/broken.json" >/dev/null 2>&1 && bad "broken JSON should fail" || ok "broken JSON rejected"
rm -rf "$TMP"

echo "== unit: live golden sets are all valid =="
python3 scripts/recall-golden-validate.py --all --quiet >/dev/null 2>&1 && ok "all live golden sets valid" || bad "a live golden set is invalid"

echo "== unit: guard snapshot -> verify round trip =="
bash scripts/recall-golden-guard.sh snapshot >/dev/null 2>&1 && ok "snapshot writes" || bad "snapshot failed"
bash scripts/recall-golden-guard.sh verify >/dev/null 2>&1 && ok "verify passes on clean sets" || bad "verify failed on clean sets"

echo "== unit: guard check confirms base+overlay layout is safe =="
CHECK_OUT="$(bash scripts/recall-golden-guard.sh check 2>&1)"
echo "$CHECK_OUT" | grep -qE 'independent client overlays over 1 shared base - routing is safe' \
  && ok "check confirms independent overlays over shared base" || bad "check verdict wrong"

echo "== unit: isolate/force-break is NOT offered (we respect the symlink) =="
bash scripts/recall-golden-guard.sh isolate >/dev/null 2>&1 && bad "isolate should not exist" || ok "no force-break command"

echo "== unit: overlays are independent and union-measured =="
python3 - <<'PY' || exit 1
import importlib.util, os, json, tempfile
ROOT = os.getcwd()
spec = importlib.util.spec_from_file_location("rsi", os.path.join(ROOT, "scripts", "recall-self-improve.py"))
rsi = importlib.util.module_from_spec(spec); spec.loader.exec_module(rsi)
with tempfile.TemporaryDirectory() as fixture_root:
    os.makedirs(os.path.join(fixture_root, "scripts", "lib"), exist_ok=True)
    os.makedirs(os.path.join(fixture_root, "clients", "alpha-co", ".recall"), exist_ok=True)
    os.makedirs(os.path.join(fixture_root, "clients", "bravo-co", ".recall"), exist_ok=True)
    base_path = os.path.join(fixture_root, "scripts", "lib", "recall-golden-set.json")
    open(base_path, "w").write(json.dumps({"cases": [{"query": "base", "expect_source": "context/MEMORY\\.md"}]}))
    rsi.ROOT = fixture_root
    rsi.BASE_GOLDEN = base_path
    op = rsi.overlay_path("alpha-co")
    open(op, "w").write(json.dumps({"cases": []}))
    d = json.load(open(op)); d["cases"] = [{"query": "__probe__", "expect_source": "clients/alpha-co/context/MEMORY\\.md"}]
    open(op, "w").write(json.dumps(d))
    _, cb, co = rsi.load_cases("client", "alpha-co")
    _, mb, mo = rsi.load_cases("client", "bravo-co")
    _, rb, ro = rsi.load_cases("root", "")
    assert co == 1, f"alpha overlay not merged: {co}"
    assert mo == 0, f"bravo overlay contaminated: {mo}"
    assert ro == 0, f"root contaminated: {ro}"
    print("  ok  - client overlay independent (other client + root untouched)")
PY
[ $? -eq 0 ] || fail=1

echo "== unit: validator accepts an empty overlay but rejects an empty base =="
TMP2="$(mktemp -d "${TMPDIR:-/tmp}/rsi-test2.XXXXXX")"
echo '{"cases":[]}' > "$TMP2/golden-additions.json"
echo '{"cases":[]}' > "$TMP2/recall-golden-set.json"
python3 scripts/recall-golden-validate.py "$TMP2/golden-additions.json" >/dev/null 2>&1 && ok "empty overlay accepted" || bad "empty overlay should pass"
python3 scripts/recall-golden-validate.py "$TMP2/recall-golden-set.json" >/dev/null 2>&1 && bad "empty base should fail" || ok "empty base rejected"
rm -rf "$TMP2"

if [ "$fail" -eq 0 ]; then echo "test-recall-self-improve: PASS"; else echo "test-recall-self-improve: FAIL"; fi
exit $fail
