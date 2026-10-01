# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "numpy>=1.26.0", "pyyaml>=6.0"]
# ///
"""Unit tests for the WCAG math in measure_text_contrast.py (AIOS-190 gate coverage).

Tests the MEASUREMENT — the deterministic WCAG relative-luminance + contrast-ratio functions —
not the aesthetic. Pairs with test_dead_space.py to give both script-measured gate criteria
unit coverage (per the PRD: "test the measurement, not the aesthetic").

Run:
    uv run test_measure_text_contrast.py
    or: python test_measure_text_contrast.py
"""
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from measure_text_contrast import relative_luminance, contrast_ratio  # noqa: E402


class TestRelativeLuminance(unittest.TestCase):
    def test_black_is_zero(self):
        self.assertAlmostEqual(relative_luminance(0, 0, 0), 0.0)

    def test_white_is_one(self):
        self.assertAlmostEqual(relative_luminance(255, 255, 255), 1.0)

    def test_pure_red_coefficient(self):
        # WCAG: luminance(red) == 0.2126 * channel(1.0) == 0.2126
        self.assertAlmostEqual(relative_luminance(255, 0, 0), 0.2126, places=4)

    def test_pure_green_coefficient(self):
        self.assertAlmostEqual(relative_luminance(0, 255, 0), 0.7152, places=4)

    def test_monotonic_in_brightness(self):
        self.assertLess(relative_luminance(50, 50, 50), relative_luminance(200, 200, 200))


class TestContrastRatio(unittest.TestCase):
    def test_black_on_white_is_21(self):
        cr = contrast_ratio(relative_luminance(255, 255, 255), relative_luminance(0, 0, 0))
        self.assertAlmostEqual(cr, 21.0, places=2)

    def test_same_color_is_1(self):
        self.assertAlmostEqual(contrast_ratio(0.5, 0.5), 1.0)

    def test_order_independent(self):
        a = contrast_ratio(1.0, 0.0)
        b = contrast_ratio(0.0, 1.0)
        self.assertAlmostEqual(a, b)

    def test_aa_boundary_known_pair(self):
        # mid-grey 0.18 vs white: (1+.05)/(.18+.05) ≈ 4.57 — just over the 4.5 AA floor
        cr = contrast_ratio(1.0, 0.18)
        self.assertGreater(cr, 4.5)
        self.assertAlmostEqual(cr, 4.565, places=2)


if __name__ == "__main__":
    unittest.main()
