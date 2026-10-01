# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "numpy>=1.26.0"]
# ///
"""Unit tests for measure_text_heights.py — gate hook B (SPEC-B), the display-height gate.

Tests the pure verdict (enforce_verdict): display row >= floor AND within -max_shrink% of
the ref. Run:
    uv run test_measure_text_heights.py
    or: python test_measure_text_heights.py
"""
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from measure_text_heights import enforce_verdict, display_row  # noqa: E402


def rows(*cqws):
    return [{"row": i + 1, "cqw": c, "top_px": 0, "bot_px": 0, "height_px": 0,
             "guess_role": ""} for i, c in enumerate(cqws)]


class DisplayRow(unittest.TestCase):
    def test_picks_tallest(self):
        self.assertEqual(display_row(rows(3.2, 9.5, 2.4))["cqw"], 9.5)

    def test_none_on_empty(self):
        self.assertIsNone(display_row([]))


class EnforceVerdict(unittest.TestCase):
    def test_above_floor_no_ref_passes(self):
        ok, fails = enforce_verdict(rows(9.5, 3.2), None, display_floor=8.0, max_shrink=15.0)
        self.assertTrue(ok, fails)

    def test_below_floor_fails(self):
        ok, fails = enforce_verdict(rows(6.5, 3.0), None, display_floor=8.0, max_shrink=15.0)
        self.assertFalse(ok)
        self.assertTrue(any("floor" in f for f in fails))

    def test_within_ref_tolerance_passes(self):
        # preview 8.0 vs ref 8.8 -> -9% (within -15%)
        ok, fails = enforce_verdict(rows(8.0, 3.2), rows(8.8, 3.2), display_floor=8.0, max_shrink=15.0)
        self.assertTrue(ok, fails)

    def test_too_small_vs_ref_fails(self):
        # preview 6.7 vs ref 8.8 -> -24% (worse than -15%); also below floor
        ok, fails = enforce_verdict(rows(6.7, 3.5), rows(8.8, 3.2), display_floor=8.0, max_shrink=15.0)
        self.assertFalse(ok)
        self.assertTrue(any("smaller than the ref" in f for f in fails) or any("floor" in f for f in fails))

    def test_at_floor_but_shrunk_vs_ref_fails(self):
        # preview 8.0 meets floor, but ref is 10.0 -> -20% < -15% -> fail on the ref check only
        ok, fails = enforce_verdict(rows(8.0, 3.2), rows(10.0, 3.2), display_floor=8.0, max_shrink=15.0)
        self.assertFalse(ok)
        self.assertTrue(any("smaller than the ref" in f for f in fails))

    def test_no_rows_fails(self):
        ok, fails = enforce_verdict([], None, display_floor=8.0, max_shrink=15.0)
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
