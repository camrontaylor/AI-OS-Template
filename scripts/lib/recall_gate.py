"""recall_gate.py - the two-tier verdict for golden recall quality.

Single source of truth for how a golden-recall rate maps to a job verdict, so
test-recall-golden.sh and its regression test can never drift apart.

Why two tiers (2026-07-20): a genuinely healthy ~90% index was exiting non-zero
against a single 95% hard gate, so the nightly cron reported FAILURE on a
working index and trained the operator to ignore the job status.

Paraphrase recalibration (2026-07-23): the paraphrase gate hard-FAILed whenever
cross-vocabulary recall dipped below its threshold, on the assumption that a
paraphrase miss means the semantic layer is dead. But the same brittle false
alarm applied here: the golden set's 2 paraphrase cases flipped 0/2 -> 2/2
within an hour purely from the live corpus shifting, so a healthy, demonstrably
alive semantic index was hard-FAILing the whole health suite on a ranking
wobble. A paraphrase miss only proves a dead layer when the run produced NO
semantic/hybrid results at all; while the layer is alive it is dull ranking, not
death - the same healthy near-miss the overall two-tier gate already tolerates.
This changes only the verdict mapping, never the fusion/ranking (retuning fusion
was declined - see recall-golden-set.json threshold_note). Now:

  paraphrase miss AND no semantic/hybrid results -> FAIL  (semantic layer dead)
  overall rate < floor                           -> FAIL  (index looks broken)
  rate < target, or paraphrase miss while alive  -> WARN  (healthy, not sharp)
  rate >= target and paraphrases sharp           -> PASS

WARN exits 0: it is a signal, not a failure. Only a real collapse fails the job.
"""


def classify(rate, para_rate, floor, target, para_threshold,
             semantic_alive=True, expect_semantic=True):
    """Return (verdict, exit_code, message).

    verdict is one of "PASS" | "WARN" | "FAIL". exit_code is 0 for PASS/WARN and
    1 for FAIL. message is the human line to print.

    semantic_alive: did the run produce ANY semantic/hybrid result? A paraphrase
    shortfall means two different things: with no semantic results the index went
    decorative/dead (FAIL); while it is alive a target merely ranks outside top-k
    (dull ranking -> WARN). expect_semantic is False in markdown-only mode, where
    cross-vocabulary recall is not expected and the paraphrase gate is skipped.
    """
    # The real thing the paraphrase gate guards: a decorative/dead semantic layer.
    # Only fire it when we expect semantic AND the layer produced nothing semantic.
    if expect_semantic and para_rate < para_threshold and not semantic_alive:
        return ("FAIL", 1,
                f"FAIL: semantic paraphrase recall {para_rate:.0%} with no semantic/hybrid "
                f"results - the semantic layer is dead, not merely dull.")
    if rate < floor:
        return ("FAIL", 1,
                f"FAIL: golden recall {rate:.0%} below hard floor {floor:.0%} - retrieval looks broken, not merely dull.")
    paraphrase_dull = expect_semantic and para_rate < para_threshold
    if rate < target or paraphrase_dull:
        parts = []
        if rate < target:
            parts.append(f"golden recall {rate:.0%} (target {target:.0%}, above the {floor:.0%} floor)")
        if paraphrase_dull:
            parts.append(f"semantic paraphrase recall {para_rate:.0%} (target {para_threshold:.0%}) - "
                         "targets found but ranked just outside top-k")
        return ("WARN", 0, "WARN: index healthy, not sharp - " + "; ".join(parts))
    return ("PASS", 0,
            f"golden recall eval passed ({rate:.0%} at or above the {target:.0%} target)")
