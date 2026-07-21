"""recall_gate.py - the two-tier verdict for golden recall quality.

Single source of truth for how a golden-recall rate maps to a job verdict, so
test-recall-golden.sh and its regression test can never drift apart.

Why two tiers (2026-07-20): a genuinely healthy ~90% index was exiting non-zero
against a single 95% hard gate, so the nightly cron reported FAILURE on a
working index and trained the operator to ignore the job status. Now:

  paraphrase recall < paraphrase_threshold -> FAIL  (semantic layer is dead)
  overall rate      < floor                -> FAIL  (index looks broken)
  floor <= rate     < target               -> WARN  (healthy, just not sharp)
  rate              >= target              -> PASS

WARN exits 0: it is a signal, not a failure. Only a real collapse fails the job.
"""


def classify(rate, para_rate, floor, target, para_threshold):
    """Return (verdict, exit_code, message).

    verdict is one of "PASS" | "WARN" | "FAIL". exit_code is 0 for PASS/WARN and
    1 for FAIL. message is the human line to print.
    """
    if para_rate < para_threshold:
        return ("FAIL", 1,
                f"FAIL: semantic paraphrase recall {para_rate:.0%} below threshold {para_threshold:.0%}")
    if rate < floor:
        return ("FAIL", 1,
                f"FAIL: golden recall {rate:.0%} below hard floor {floor:.0%} - retrieval looks broken, not merely dull.")
    if rate < target:
        return ("WARN", 0,
                f"WARN: golden recall {rate:.0%} is below the {target:.0%} target but above the {floor:.0%} floor - index is healthy, not failing.")
    return ("PASS", 0,
            f"golden recall eval passed ({rate:.0%} at or above the {target:.0%} target)")
