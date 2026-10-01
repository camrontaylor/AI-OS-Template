"""
Tests for _load_canonical_tweaks and _merge_tweaks in render_template.py.
TDD RED phase for Phase 05 Plan 02 (TMPL-03).

Run:
    python test_canonical_tweaks.py
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path


# ---------------------------------------------------------------------------
# Import helpers from render_template without launching the script entry-point
# ---------------------------------------------------------------------------
import importlib.util
_HERE = Path(__file__).parent
_RT_PATH = _HERE / "render_template.py"

spec = importlib.util.spec_from_file_location("render_template", _RT_PATH)
RT = importlib.util.module_from_spec(spec)
# render_template uses argparse + sys.exit in __main__ guard so import is safe
spec.loader.exec_module(RT)


# ---------------------------------------------------------------------------
# Minimal args stub
# ---------------------------------------------------------------------------
class _Args:
    template_dir: str | None = None
    template_pool: str | None = None
    template_id: str | None = None
    brand_context: str | None = None
    allow_draft: bool = False
    tweaks: str | None = None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestLoadCanonicalTweaks(unittest.TestCase):

    def _make_tdir(self, content: dict | None) -> Path:
        d = Path(tempfile.mkdtemp())
        if content is not None:
            (d / "tweaks.json").write_text(json.dumps(content), encoding="utf-8")
        return d

    # Test 1 — sentinel re-key to output stem when no --tweaks-slide
    def test_sentinel_rekeyed_to_output_stem(self):
        tdir = self._make_tdir({"__canonical__": {"zones": {"HEADLINE": {"fontSize": 88}}}})
        args = _Args()
        args.template_dir = str(tdir)
        result = RT._load_canonical_tweaks(args, None, "slide-01")
        self.assertIsNotNone(result)
        self.assertIn("slide-01", result)
        self.assertEqual(result["slide-01"]["zones"]["HEADLINE"]["fontSize"], 88)

    # Test 1b — sentinel re-key uses tweaks_slide_id when provided
    def test_sentinel_rekeyed_to_tweaks_slide_id(self):
        tdir = self._make_tdir({"__canonical__": {"zones": {"HEADLINE": {"fontSize": 72}}}})
        args = _Args()
        args.template_dir = str(tdir)
        result = RT._load_canonical_tweaks(args, "slide-03", "slide-03")
        self.assertIsNotNone(result)
        self.assertIn("slide-03", result)
        self.assertEqual(result["slide-03"]["zones"]["HEADLINE"]["fontSize"], 72)

    # Test 4 — no canonical file -> None
    def test_no_canonical_file_returns_none(self):
        tdir = self._make_tdir(None)  # no tweaks.json
        args = _Args()
        args.template_dir = str(tdir)
        result = RT._load_canonical_tweaks(args, None, "slide-01")
        self.assertIsNone(result)

    # Test 4b — no template_dir + no template_pool -> None
    def test_no_template_args_returns_none(self):
        args = _Args()
        result = RT._load_canonical_tweaks(args, None, "slide-01")
        self.assertIsNone(result)

    # Already-slide-keyed file (hand-written) returned as-is
    def test_already_slide_keyed_returned_as_is(self):
        content = {"slide-01": {"zones": {"SUBHEAD": {"fontSize": 40}}}}
        tdir = self._make_tdir(content)
        args = _Args()
        args.template_dir = str(tdir)
        result = RT._load_canonical_tweaks(args, None, "slide-01")
        self.assertIsNotNone(result)
        self.assertIn("slide-01", result)

    # Malformed JSON -> None (no exception raised)
    def test_malformed_json_returns_none(self):
        tdir = Path(tempfile.mkdtemp())
        (tdir / "tweaks.json").write_text("{ bad json }", encoding="utf-8")
        args = _Args()
        args.template_dir = str(tdir)
        result = RT._load_canonical_tweaks(args, None, "slide-01")
        self.assertIsNone(result)


class TestMergeTweaks(unittest.TestCase):

    # Test 2 — caller wins on same key
    def test_caller_wins_same_key(self):
        canonical = {"slide-01": {"zones": {"HEADLINE": {"fontSize": 88}}}}
        caller = {"slide-01": {"zones": {"HEADLINE": {"fontSize": 120}}}}
        merged = RT._merge_tweaks(canonical, caller)
        self.assertEqual(merged["slide-01"]["zones"]["HEADLINE"]["fontSize"], 120)

    # Test 3 — caller adds new zone, both present in merged
    def test_caller_adds_new_zone(self):
        canonical = {"slide-01": {"zones": {"HEADLINE": {"fontSize": 88}}}}
        caller = {"slide-01": {"zones": {"SUBHEAD": {"fontSize": 40}}}}
        merged = RT._merge_tweaks(canonical, caller)
        self.assertIn("HEADLINE", merged["slide-01"]["zones"])
        self.assertIn("SUBHEAD", merged["slide-01"]["zones"])
        self.assertEqual(merged["slide-01"]["zones"]["HEADLINE"]["fontSize"], 88)
        self.assertEqual(merged["slide-01"]["zones"]["SUBHEAD"]["fontSize"], 40)

    # Test 4 — both None -> None
    def test_both_none_returns_none(self):
        self.assertIsNone(RT._merge_tweaks(None, None))

    # Test — base None, over supplied -> over returned
    def test_base_none_over_supplied(self):
        caller = {"slide-01": {"zones": {"HEADLINE": {"fontSize": 55}}}}
        result = RT._merge_tweaks(None, caller)
        self.assertEqual(result, caller)

    # Test — base supplied, over None -> base returned
    def test_base_supplied_over_none(self):
        canonical = {"slide-01": {"zones": {"HEADLINE": {"fontSize": 88}}}}
        result = RT._merge_tweaks(canonical, None)
        self.assertEqual(result, canonical)


if __name__ == "__main__":
    unittest.main(verbosity=2)
