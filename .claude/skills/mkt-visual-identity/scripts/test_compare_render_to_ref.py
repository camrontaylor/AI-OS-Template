# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.0.0", "numpy>=1.26.0", "pyyaml>=6.0"]
# ///
"""Unit tests for compare_render_to_ref.py — the post-render line-count + overflow gate (r6g).

Covers the r6g generalization (item 1a, absorbing r6h leg-3): the scale/overflow/clip read
that runs on the PREVIEW alone, for ANY text-bearing block — `type:display` INCLUDED (the old
gate skipped display outright). Adversarial anchor: the run-07 highlight-headline "Workflow"
that overflows its `.highlight-outlined` box (a `type:display` block, a SINGLE line — proving
the read is NOT line-count). The line-count read's own behavior is exercised too.

The "text ink" in the fixtures is drawn as filled rectangles so the ink geometry is exact and
the assertions are deterministic; one case uses a real PIL glyph render to exercise the
polarity + Otsu + threshold path end-to-end.

Run:
    uv run test_compare_render_to_ref.py
    or: python test_compare_render_to_ref.py
"""
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from compare_render_to_ref import (  # noqa: E402
    is_text_type,
    is_skippable,
    measure_overflow,
    analyze_element,
    text_mask,
    count_lines,
    CANVAS_SAFE_MARGIN_PCT,
)

CANVAS_W, CANVAS_H = 1080, 1350
LIGHT = 240   # light bg
DARK = 20     # dark ink


def _canvas(bg=LIGHT):
    return np.full((CANVAS_H, CANVAS_W), bg, dtype=np.uint8)


def _paint_pct(arr, left, top, w, h, val=DARK):
    """Paint a filled rectangle given in canvas-% coords (the 'ink')."""
    x0 = int(round(left / 100.0 * CANVAS_W))
    y0 = int(round(top / 100.0 * CANVAS_H))
    x1 = int(round((left + w) / 100.0 * CANVAS_W))
    y1 = int(round((top + h) / 100.0 * CANVAS_H))
    arr[y0:y1, x0:x1] = val
    return arr


def _paint_aa(arr, left, top, w, h, val=DARK):
    """Like _paint_pct but with an antialiased mid-tone halo, so the Otsu-based line-count read
    finds a between-modes threshold (a perfectly two-value rectangle collapses Otsu — real
    renders are never two-value). Used for the line-count fixtures, not the overflow ones."""
    x0 = int(round(left / 100.0 * CANVAS_W))
    y0 = int(round(top / 100.0 * CANVAS_H))
    x1 = int(round((left + w) / 100.0 * CANVAS_W))
    y1 = int(round((top + h) / 100.0 * CANVAS_H))
    mid = (LIGHT + DARK) // 2
    arr[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2] = mid   # halo
    arr[y0:y1, x0:x1] = val                                    # solid core
    return arr


class TestIsTextType(unittest.TestCase):
    def test_display_is_now_text(self):
        # THE regression the spec names: display must NOT be skipped anymore.
        self.assertTrue(is_text_type("display"))
        self.assertTrue(is_text_type("display-bold"))
        self.assertTrue(is_text_type("display-massive"))

    def test_text_and_headline(self):
        self.assertTrue(is_text_type("text"))
        self.assertTrue(is_text_type("headline"))
        self.assertTrue(is_text_type("kicker"))

    def test_forward_compat_prefix(self):
        # an unforeseen variant still counts via the canonical prefix.
        self.assertTrue(is_text_type("headline-accent"))
        self.assertTrue(is_text_type("body-lead"))

    def test_non_text_skipped(self):
        for t in ("icon", "image-zone", "pill", "bg-watermark", "photo-zone", None):
            self.assertFalse(is_text_type(t), t)


class TestIsSkippable(unittest.TestCase):
    def test_display_scanned_for_overflow_without_line_count(self):
        # a display block with NO observed_line_count is still scanned for overflow.
        el = {"type": "display", "bbox_pct": [10, 10, 60, 12]}
        skip, _ = is_skippable(el, require_line_count=False)
        self.assertFalse(skip)

    def test_display_skipped_for_linecount_without_count(self):
        el = {"type": "display", "bbox_pct": [10, 10, 60, 12]}
        skip, reason = is_skippable(el, require_line_count=True)
        self.assertTrue(skip)
        self.assertIn("observed_line_count", reason)

    def test_non_text_skipped(self):
        el = {"type": "image-zone", "bbox_pct": [0, 0, 100, 50]}
        skip, reason = is_skippable(el, require_line_count=False)
        self.assertTrue(skip)
        self.assertIn("not a text element", reason)


class TestMeasureOverflowFits(unittest.TestCase):
    def test_text_within_box_no_overflow(self):
        # ink sits comfortably inside a generous bbox -> no overflow.
        arr = _canvas()
        _paint_pct(arr, left=22, top=22, w=16, h=6)          # the ink
        ov = measure_overflow(arr, [20, 20, 40, 12], CANVAS_W, CANVAS_H)  # roomy box
        self.assertEqual(ov["reason"], "", ov)
        self.assertFalse(ov["canvas_bleed"])

    def test_empty_region_is_clean(self):
        arr = _canvas()  # no ink
        ov = measure_overflow(arr, [20, 20, 40, 12], CANVAS_W, CANVAS_H)
        self.assertEqual(ov["reason"], "")


class TestMeasureOverflowClip(unittest.TestCase):
    def test_text_wider_than_box_clips(self):
        # THE highlight-headline shape: ink overruns the box's right edge well past tolerance.
        arr = _canvas()
        # box is 40% wide starting at 20%; ink runs from 22% to 75% -> ~13% past the right edge.
        _paint_pct(arr, left=22, top=22, w=53, h=6)
        ov = measure_overflow(arr, [20, 20, 40, 12], CANVAS_W, CANVAS_H)
        self.assertNotEqual(ov["reason"], "")
        self.assertIn("clips its own bbox", ov["reason"])
        self.assertIn("right", ov["reason"])
        self.assertGreater(ov["right_overflow_pct"], ov["bbox_tol_pct"])

    def test_text_taller_than_box_clips_bottom(self):
        arr = _canvas()
        # box 12% tall at top 20%; ink runs to 40% -> overflows the bottom edge.
        _paint_pct(arr, left=22, top=22, w=16, h=18)
        ov = measure_overflow(arr, [20, 20, 40, 12], CANVAS_W, CANVAS_H)
        self.assertIn("clips its own bbox", ov["reason"])
        self.assertIn("bottom", ov["reason"])

    def test_small_overrun_within_tolerance_passes(self):
        # ink overruns by a hair (sub-tolerance) -> NOT flagged (antialias/descender slack).
        arr = _canvas()
        # box right edge at 60%; ink to ~60.4% -> well under the absolute floor tolerance.
        _paint_pct(arr, left=22, top=22, w=38.4, h=6)
        ov = measure_overflow(arr, [20, 20, 40, 12], CANVAS_W, CANVAS_H)
        self.assertEqual(ov["reason"], "", ov)


class TestMeasureOverflowBleed(unittest.TestCase):
    def test_text_bleeds_canvas_margin(self):
        # ink reaches into the canvas safe margin on the left edge.
        arr = _canvas()
        margin = CANVAS_SAFE_MARGIN_PCT
        _paint_pct(arr, left=margin / 2, top=40, w=30, h=6)  # starts inside the margin
        ov = measure_overflow(arr, [0, 38, 60, 12], CANVAS_W, CANVAS_H)
        self.assertTrue(ov["canvas_bleed"])
        self.assertIn("canvas safe margin", ov["reason"])


class TestAnalyzeElementOverflow(unittest.TestCase):
    def test_display_block_overflow_verdict_no_ref(self):
        # The DoD anchor: a type:display block whose text overflows the box -> OVERFLOW verdict,
        # with NO ref supplied (ref-independent) and NO line count (single-line overflow).
        arr = _canvas()
        _paint_pct(arr, left=12, top=12, w=70, h=8)  # ink overruns the 40%-wide box hugely
        el = {"id": "HEADLINE_2", "type": "display", "bbox_pct": [10, 10, 40, 12]}
        res = analyze_element(el, None, arr, CANVAS_W, CANVAS_H)
        self.assertEqual(res["verdict"], "OVERFLOW")
        self.assertIn("clips its own bbox", res["overflow"]["reason"])

    def test_display_block_fits_is_ok(self):
        arr = _canvas()
        _paint_pct(arr, left=12, top=12, w=30, h=8)  # fits inside the 40%-wide box
        el = {"id": "HEADLINE_2", "type": "display", "bbox_pct": [10, 10, 40, 12]}
        res = analyze_element(el, None, arr, CANVAS_W, CANVAS_H)
        self.assertEqual(res["verdict"], "OK", res["overflow"])


class TestLineCountPath(unittest.TestCase):
    """The original line-count read still works, and a line-count mismatch out-ranks overflow."""

    def _two_line_ink(self, arr, box):
        left, top, w, h = box
        _paint_aa(arr, left + 2, top + 2, w - 6, h * 0.25)            # line 1
        _paint_aa(arr, left + 2, top + h * 0.55, w - 6, h * 0.25)     # line 2
        return arr

    def test_line_count_match_ok(self):
        box = [20, 20, 50, 16]
        ref = self._two_line_ink(_canvas(), box)
        prev = self._two_line_ink(_canvas(), box)
        el = {"id": "BODY", "type": "text", "bbox_pct": box, "observed_line_count": 2}
        res = analyze_element(el, ref, prev, CANVAS_W, CANVAS_H)
        self.assertEqual(res["verdict"], "OK", res)

    def test_line_count_mismatch_flagged(self):
        box = [20, 20, 50, 16]
        ref = self._two_line_ink(_canvas(), box)         # ref shows 2 lines
        prev = _canvas()
        _paint_aa(prev, 22, 22, 44, 4)                   # preview shows 1 line
        el = {"id": "BODY", "type": "text", "bbox_pct": box, "observed_line_count": 2}
        res = analyze_element(el, ref, prev, CANVAS_W, CANVAS_H)
        self.assertEqual(res["verdict"], "LINE_COUNT_MISMATCH", res)


class TestRealGlyphPath(unittest.TestCase):
    """End-to-end through text_mask/Otsu on a real glyph render (polarity + threshold path)."""

    def test_real_glyphs_detected_as_ink(self):
        from PIL import ImageDraw
        img = Image.new("L", (CANVAS_W, CANVAS_H), LIGHT)
        d = ImageDraw.Draw(img)
        d.text((250, 270), "WORKFLOW", fill=DARK)
        arr = np.array(img)
        # the glyph region must threshold to a non-empty text mask
        region = arr[250:300, 250:600]
        mask, bg_light = text_mask(region)
        self.assertTrue(bg_light)        # light bg detected
        self.assertTrue(mask.any())      # ink found
        self.assertGreaterEqual(count_lines(mask)[0], 1)


if __name__ == "__main__":
    unittest.main()
