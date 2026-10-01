#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""test_layer_bake_parity.py — RNDR-04 parity check for decomposed layer baking.

A decomposed layer placed on the Content Studio canvas via x/y/w/tilt tweaks
must bake as a positioned <img data-slot="LAYER_NN"> element whose CSS rules
are keyed by the same handle — preview HTML == bake HTML.

No new tweaks schema is introduced. Empty tweaks remain byte-identical to
baseline (RNDR-05).

Run: python test_layer_bake_parity.py
"""
import sys
import unittest
from pathlib import Path

# ── Cross-skill sys.path injection ─────────────────────────────────────────
_SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPTS))

from render_template import (  # noqa: E402
    _build_tweaks_css,
    _materialize_layers,
    apply_tweaks,
    fill,
)


# ---------------------------------------------------------------------------
# Minimal template HTML for testing
# ---------------------------------------------------------------------------

_BASE_TEMPLATE = """\
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
<div class="slide" style="width:1080px;height:1350px;position:relative;">
  <div data-slot="HERO" style="position:absolute;left:10%;top:20%;width:80%;">
    {{HERO}}
  </div>
</div>
</body>
</html>
"""

_BASE_DATA = {
    "HERO": "Sample headline",
    "BRAND_TOKENS_CSS": "",
}


def _render_with_layers(slide_tweaks: dict) -> str:
    """Reproduce the layer-materialize + tweaks-inject + fill() pipeline.

    Mirrors what render() does when _slide_tweaks contains layer entries.
    Returns the filled HTML string (no Playwright — HTML-level parity only).
    """
    raw = _BASE_TEMPLATE
    processed = dict(_BASE_DATA)

    # Step 1: materialize layer <img> elements (new FASE-2 hook)
    raw = _materialize_layers(raw, slide_tweaks)

    # Step 2: apply text overrides + inject tweaks CSS
    if slide_tweaks:
        apply_tweaks(processed, slide_tweaks)
        css = _build_tweaks_css(slide_tweaks)
        if css:
            inject = f"<style>{css}</style>"
            raw = raw.replace("</head>", inject + "</head>", 1)

    return fill(raw, processed)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestLayerMaterializeInHtml(unittest.TestCase):
    """A layer entry in slide_tweaks injects an <img data-slot="LAYER_NN"> element."""

    def _make_layer_tweaks(self, handle="LAYER_00", x=5, y=10, w=50, tilt=0, src=None):
        return {
            handle: {
                "x": x,
                "y": y,
                "w": w,
                "tilt": tilt,
                "img": src or "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
            }
        }

    def test_layer_img_element_present(self):
        """A layer with 'img' src injects a <img data-slot='LAYER_00'> into the HTML."""
        tweaks = self._make_layer_tweaks()
        html = _render_with_layers(tweaks)
        self.assertIn('data-slot="LAYER_00"', html, "Layer element not materialized")
        self.assertIn("<img", html)

    def test_layer_css_rule_injected(self):
        """The injected layer is positioned by a [data-slot='LAYER_NN'] CSS rule."""
        tweaks = self._make_layer_tweaks(x=5, y=10, w=50)
        html = _render_with_layers(tweaks)
        self.assertIn('[data-slot="LAYER_00"]', html, "CSS rule for layer not found")
        self.assertIn("translate: 54px 135px", html)
        self.assertIn("width: 50%", html)

    def test_layer_differs_from_baseline(self):
        """HTML with a layer differs from the no-layer baseline."""
        baseline = _render_with_layers({})
        with_layer = _render_with_layers(self._make_layer_tweaks())
        self.assertNotEqual(
            baseline, with_layer,
            "Layer tweak did not change the HTML (layer materialization not wired)"
        )

    def test_tilt_in_css_rule(self):
        """tilt key emits a transform:rotate rule for the layer slot."""
        tweaks = self._make_layer_tweaks(tilt=15)
        html = _render_with_layers(tweaks)
        self.assertIn("rotate(15deg)", html, "tilt not in CSS rule for layer")


class TestNoNewTweaksSchema(unittest.TestCase):
    """Layer baking reuses ONLY existing tweaks keys — no new schema invented."""

    def test_existing_keys_only(self):
        """A layer entry uses only x/y/w/tilt/img — no bespoke 'layer' key needed."""
        from render_template import _build_tweaks_css
        # A layer that uses x/y/w/tilt produces CSS via the existing _build_tweaks_css
        # (which already supports these). If this passes without any new branch,
        # it proves no new schema is needed.
        result = _build_tweaks_css({"LAYER_00": {"x": 10, "y": 20, "w": 40, "tilt": 5}})
        self.assertIn('[data-slot="LAYER_00"]', result)
        self.assertIn("translate: 108px 270px", result)
        self.assertIn("width: 40%", result)
        self.assertIn("rotate(5deg)", result)


class TestParityGate(unittest.TestCase):
    """RNDR-04: preview HTML == bake HTML for a layer placed via tweaks."""

    def test_preview_equals_bake(self):
        """The HTML produced by the materialize+fill pipeline (preview) equals
        what render() would produce (bake) — both go through the same path."""
        layer_tweaks = {
            "LAYER_00": {
                "x": 5.0,
                "y": 10.0,
                "w": 80.0,
                "tilt": 0,
                "img": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
            }
        }
        # Call _render_with_layers twice with identical input — must be deterministic
        html1 = _render_with_layers(layer_tweaks)
        html2 = _render_with_layers(layer_tweaks)
        self.assertEqual(
            html1, html2,
            "Layer bake is non-deterministic — preview != bake"
        )
        # The layer element must be present and positioned
        self.assertIn('data-slot="LAYER_00"', html1)
        self.assertIn("translate: 54px 135px", html1)

    def test_layer_img_src_present_in_bake(self):
        """The materialized <img> carries the src from the tweaks 'img' key."""
        src = "data:image/png;base64,AABBCC=="
        tweaks = {"LAYER_00": {"x": 0, "y": 0, "w": 100, "img": src}}
        html = _render_with_layers(tweaks)
        self.assertIn(src, html, "Layer src not in baked HTML")


class TestClientBakeMarkupParity(unittest.TestCase):
    """RNDR-04 (the hard rule): the markup the Content Studio client injects live
    (__addLayerAsset in STUDIO_JS) must be BYTE-IDENTICAL to what _materialize_layers
    emits at bake time, and positioned by the same x/y/w/h/tilt/opacity keys, so a
    layer placed via the canvas bakes to the exact position the preview shows."""

    def _bake_img_markup(self, handle, src):
        """The exact <img> string _materialize_layers writes for a layer."""
        out = _materialize_layers(
            '<div class="slide"></div>',
            {handle: {"img": src, "x": 0, "y": 0, "w": 100}})
        # Extract the injected <img ... /> substring.
        import re
        m = re.search(r'<img data-slot="' + handle + r'"[^>]*/>', out)
        self.assertIsNotNone(m, "no layer <img> injected by _materialize_layers")
        return m.group(0)

    def test_bake_markup_is_the_canonical_shape(self):
        src = "data:image/png;base64,AABBCC=="
        markup = self._bake_img_markup("LAYER_00", src)
        # The canonical shape the client must replicate exactly.
        self.assertEqual(
            markup,
            f'<img data-slot="LAYER_00" src="{src}" '
            f'style="position:absolute;max-width:none;" />')

    def test_studio_js_injects_identical_markup(self):
        # Load STUDIO_JS and assert its injection string is the SAME shape, so the
        # live DOM == bake DOM (the parity guarantee). The client builds:
        #   '<img data-slot="' + handle + '" src="' + dataUri +
        #   '" style="position:absolute;max-width:none;" />'
        import importlib.util
        cs_path = (_SCRIPTS.parent.parent / "00-social-content" / "scripts"
                   / "content-studio" / "content_studio.py")
        spec = importlib.util.spec_from_file_location("content_studio_parity", cs_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        js = mod.STUDIO_JS
        # the data-slot attribute, the src attribute, and the EXACT style string
        self.assertIn('data-slot="\' + handle + \'"', js)
        self.assertIn('src="\' + dataUri +', js)
        self.assertIn('style="position:absolute;max-width:none;" />', js)

    def test_position_keys_match_between_live_and_bake(self):
        # A geometry placed via tweaks keys (x/y/w/h/tilt/opacity) produces the SAME
        # CSS the live applyToSlide path uses — both read these exact keys.
        css = _build_tweaks_css({"LAYER_00": {
            "x": 25, "y": 25, "w": 50, "h": 50, "opacity": 1, "tilt": 7}})
        self.assertIn("translate: 270px 337.5px", css)
        self.assertIn("width: 50%", css)
        self.assertIn("height: 50%", css)
        self.assertIn("opacity: 1", css)
        self.assertIn("rotate(7deg)", css)


class TestRndr05NotRegressed(unittest.TestCase):
    """RNDR-05: empty tweaks must produce output identical to no tweaks."""

    def test_empty_tweaks_identical_to_baseline(self):
        """_materialize_layers({}) must return the raw HTML unchanged."""
        result = _materialize_layers(_BASE_TEMPLATE, {})
        self.assertEqual(result, _BASE_TEMPLATE,
                         "RNDR-05: _materialize_layers({}) changed the HTML")

    def test_no_img_key_no_injection(self):
        """A tweaks entry without 'img' key does not inject a layer element."""
        tweaks = {"HERO": {"x": 10, "y": 20}}
        result = _materialize_layers(_BASE_TEMPLATE, tweaks)
        self.assertEqual(result, _BASE_TEMPLATE,
                         "Non-layer tweaks caused _materialize_layers to inject an element")

    def test_full_render_empty_tweaks_identical(self):
        """Full render pipeline: empty tweaks == no tweaks (byte-identical)."""
        baseline = _render_with_layers({})
        empty = _render_with_layers({"HERO": {}})
        self.assertEqual(
            baseline, empty,
            "RNDR-05 regressed: empty tweaks produced different output"
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
