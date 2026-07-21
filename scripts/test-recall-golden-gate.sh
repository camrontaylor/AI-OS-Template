#!/usr/bin/env bash
# test-recall-golden-gate.sh - fast regression test for the two-tier recall gate.
#
# Guards the 2026-07-20 fix: a healthy ~90% index must NOT report FAILURE, while
# a genuine collapse (below floor) or a dead semantic layer (paraphrase miss)
# still must. Imports scripts/lib/recall_gate.py directly, so it runs in
# milliseconds with no Milvus and no search - and can never drift from the real
# gate because both use the same classify().
set -uo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import sys
sys.path.insert(0, "scripts/lib")
from recall_gate import classify

FLOOR, TARGET, PARA = 0.80, 0.95, 1.0

# (rate, para_rate) -> (want_verdict, want_exit)
cases = [
    (0.90, 1.0, "WARN", 0),  # the real-world healthy-but-not-sharp state - must NOT fail
    (0.95, 1.0, "PASS", 0),  # hits target
    (1.00, 1.0, "PASS", 0),  # perfect
    (0.80, 1.0, "WARN", 0),  # exactly at floor -> healthy warn
    (0.79, 1.0, "FAIL", 1),  # just below floor -> real collapse
    (0.50, 1.0, "FAIL", 1),  # decorative index
    (0.90, 0.50, "FAIL", 1), # good overall but paraphrase collapsed -> hard fail
    (1.00, 0.00, "FAIL", 1), # perfect literal, semantic layer dead -> hard fail
]

fails = 0
for rate, para, want_v, want_e in cases:
    v, e, msg = classify(rate, para, FLOOR, TARGET, PARA)
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
