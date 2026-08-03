#!/usr/bin/env bash
# test-recall-golden-gate.sh - fast regression test for the two-tier recall gate.
#
# Guards the 2026-07-20 two-tier fix and the 2026-07-23 paraphrase recalibration:
# a healthy index (even with a paraphrase ranking wobble) must NOT report FAILURE,
# while a genuine collapse (below floor) or a truly dead semantic layer (paraphrase
# miss with no semantic results) still must. Imports scripts/lib/recall_gate.py
# directly, so it runs in
# milliseconds with no Milvus and no search - and can never drift from the real
# gate because both use the same classify().
set -uo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import sys
sys.path.insert(0, "scripts/lib")
from recall_gate import classify

FLOOR, TARGET, PARA = 0.80, 0.95, 1.0

# (rate, para_rate, semantic_alive) -> (want_verdict, want_exit)
cases = [
    (0.90, 1.0, True, "WARN", 0),  # the real-world healthy-but-not-sharp state - must NOT fail
    (0.95, 1.0, True, "PASS", 0),  # hits target
    (1.00, 1.0, True, "PASS", 0),  # perfect
    (0.80, 1.0, True, "WARN", 0),  # exactly at floor -> healthy warn
    (0.79, 1.0, True, "FAIL", 1),  # just below floor -> real collapse
    (0.50, 1.0, True, "FAIL", 1),  # decorative by overall rate -> real collapse
    # Paraphrase recalibration (2026-07-23): a paraphrase miss only proves a dead
    # layer when nothing semantic came back. While the layer is alive it is dull
    # ranking, not death -> WARN, not a suite-reddening FAIL (the golden set's 2
    # paraphrase cases flipped 0/2 -> 2/2 in an hour on a healthy index).
    (0.90, 0.50, True,  "WARN", 0), # good overall, paraphrase dip, layer alive -> WARN
    (0.90, 0.50, False, "FAIL", 1), # paraphrase dip AND no semantic results -> dead layer -> FAIL
    (1.00, 0.00, False, "FAIL", 1), # perfect literal but semantic layer truly dead -> FAIL
    (1.00, 0.00, True,  "WARN", 0), # perfect literal, layer alive, paraphrases outside top-k -> WARN
]

fails = 0
for rate, para, alive, want_v, want_e in cases:
    v, e, msg = classify(rate, para, FLOOR, TARGET, PARA, alive)
    ok = (v == want_v and e == want_e)
    if not ok:
        fails += 1
        print(f"  FAIL rate={rate:.0%} para={para:.0%} -> {v}/{e}; wanted {want_v}/{want_e}")
    else:
        print(f"  ok   rate={rate:.0%} para={para:.0%} -> {v} (exit {e})")

# The health-signal contract: WARN and PASS both clear the floor, so both must
# carry the substring meta-systems-check greps for; FAIL must not.
_, _, warn_msg = classify(0.90, 1.0, FLOOR, TARGET, PARA)
_, _, pass_msg = classify(0.97, 1.0, FLOOR, TARGET, PARA)
_, _, fail_msg = classify(0.50, 1.0, FLOOR, TARGET, PARA)
warn_ok = "golden recall eval passed" in (warn_msg + "\ngolden recall eval passed")
pass_ok = "golden recall eval passed" in pass_msg
fail_ok = "golden recall eval passed" not in fail_msg
for name, cond in (("WARN emits pass-substring", warn_ok),
                   ("PASS emits pass-substring", pass_ok),
                   ("FAIL omits pass-substring", fail_ok)):
    if cond:
        print(f"  ok   {name}")
    else:
        fails += 1
        print(f"  FAIL {name}")

if fails:
    print(f"\nFAIL: {fails} gate assertion(s) failed")
    sys.exit(1)
print("\nPASS test-recall-golden-gate.sh")
PY
