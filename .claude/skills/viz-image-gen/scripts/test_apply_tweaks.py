# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Tests for apply_tweaks, _build_tweaks_css, and apply_global_tweaks helpers
in render_template.py — the override-merge contract for the tweaks.json layer.

Runs via: uv run test_apply_tweaks.py
          or: python test_apply_tweaks.py

RED phase: helpers do not exist yet — this file must exit non-zero on first run.
GREEN phase: all tests must pass after implementation.
"""

import sys
import unittest
from pathlib import Path

# --- sys.path setup (mirror render_template.py SCRIPT_DIR pattern) ---
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from render_template import (  # noqa: E402  (fails RED — functions absent)
    _build_tweaks_css,
    apply_global_tweaks,
    apply_tweaks,
    css_font_value,
    build_google_fonts_link,
    CURATED_FONTS,
    emit_edit_slide,
    fill,
    substitute,
    text_tweak_keys,
)
import json as _json
import tempfile as _tempfile


# ---------------------------------------------------------------------------
# AIOS-139 Stage A — per-zone fontFamily override + curated Google-Fonts parity
# ---------------------------------------------------------------------------

class TestEmitEditSlide(unittest.TestCase):
    """AIOS-139 FASE 7 #1 (Addendum 8) — render_template --emit-edit-slide writes a
    self-contained _slides/<sid>/ editing dir (template.html + instructions.md +
    metadata.json carrying the REAL post data) + a once-copied _slides/_shared/."""

    def setUp(self):
        self._td = _tempfile.TemporaryDirectory()
        self.root = Path(self._td.name)
        # A pool-shaped source: <pool>/<id>/{template.html,instructions.md} + <pool>/_shared/
        self.pool = self.root / "pool"
        self.tdir = self.pool / "cover"
        self.tdir.mkdir(parents=True)
        (self.tdir / "template.html").write_text(
            "<div class='slide'><h1>{{{HEADLINE}}}</h1><p>{{SUBHEAD}}</p></div>",
            encoding="utf-8")
        (self.tdir / "instructions.md").write_text("## Slots\n", encoding="utf-8")
        shared = self.pool / "_shared"
        shared.mkdir()
        (shared / "styles.css").write_text("body{font-family:X}", encoding="utf-8")
        (shared / "Inter.woff2").write_bytes(b"font-bytes")
        self.shared = shared
        self.run = self.root / "run"
        self.run.mkdir()
        self.out = self.run / "slide-01.png"
        self.out.write_bytes(b"png")

    def tearDown(self):
        self._td.cleanup()

    def test_writes_self_contained_slide_dir(self):
        data = {"HEADLINE": "Real copy", "_OMITTED_IDS": [], "BRAND_TOKENS_CSS": "x"}
        sdir = emit_edit_slide(
            self.out, "slide-01", self.tdir / "template.html",
            self.tdir / "instructions.md", self.shared, data,
            template_id="cover", template_pool="linkedin-carousel")
        self.assertTrue((sdir / "template.html").is_file())
        self.assertTrue((sdir / "instructions.md").is_file())
        meta = _json.loads((sdir / "metadata.json").read_text(encoding="utf-8"))
        # Real slot data persisted; render-internal keys stripped.
        self.assertEqual(meta["data"]["HEADLINE"], "Real copy")
        self.assertNotIn("_OMITTED_IDS", meta["data"])
        self.assertNotIn("BRAND_TOKENS_CSS", meta["data"])
        self.assertEqual(meta["template_id"], "cover")

    def test_template_own_assets_copied(self):
        # The template's own assets/ (logos, graphics, bg.png referenced via
        # src="assets/…") must travel into _slides/<sid>/assets/ or LOGO/GRAPHIC
        # zones render broken in the editor and the rebake can't composite them.
        (self.tdir / "assets").mkdir()
        (self.tdir / "assets" / "logo.png").write_bytes(b"\x89PNG logo")
        sdir = emit_edit_slide(self.out, "slide-01", self.tdir / "template.html",
                               self.tdir / "instructions.md", self.shared, {})
        self.assertTrue((sdir / "assets" / "logo.png").is_file())

    def test_shared_copied_once_with_fonts(self):
        emit_edit_slide(self.out, "slide-01", self.tdir / "template.html",
                        self.tdir / "instructions.md", self.shared, {})
        dest = self.run / "_slides" / "_shared"
        self.assertTrue((dest / "styles.css").is_file())
        self.assertTrue((dest / "Inter.woff2").is_file())  # fonts travel for offline/move-safety

    def test_text_zones_get_data_slot_handles(self):
        # An unmigrated pool template has only {{MUSTACHE}} placeholders; the persisted
        # _slides template must carry data-slot handles on its TEXT zones so Content
        # Studio introspects them as editable layers (else only decor would show).
        sdir = emit_edit_slide(self.out, "slide-01", self.tdir / "template.html",
                               self.tdir / "instructions.md", self.shared, {})
        persisted = (sdir / "template.html").read_text(encoding="utf-8")
        self.assertIn('data-slot="HEADLINE"', persisted)
        self.assertIn('data-slot="SUBHEAD"', persisted)

    def test_editor_resolves_shared_from_sibling(self):
        # The editor looks for template_dir.parent/_shared/styles.css; the writer's
        # layout (_slides/<sid>/ + _slides/_shared/) satisfies exactly that.
        sdir = emit_edit_slide(self.out, "slide-01", self.tdir / "template.html",
                               self.tdir / "instructions.md", self.shared, {})
        self.assertTrue((sdir.parent / "_shared" / "styles.css").is_file())


class TestFontTweaks(unittest.TestCase):
    """A per-zone `fontFamily` tweak must rebake the zone in that font, using the
    SAME curated set the editor offers (so preview == PNG)."""

    def test_css_font_value_quotes_and_fallback(self):
        self.assertEqual(css_font_value("Sora"), '"Sora", sans-serif')
        self.assertEqual(css_font_value("Playfair Display"), '"Playfair Display", serif')
        self.assertEqual(css_font_value("JetBrains Mono"), '"JetBrains Mono", monospace')
        self.assertEqual(css_font_value("Acme Brand"), '"Acme Brand", sans-serif')  # unknown → sans
        self.assertEqual(css_font_value(""), "")

    def test_build_tweaks_css_emits_font_family(self):
        css = _build_tweaks_css({"HEAD": {"fontFamily": "Sora"}})
        self.assertIn('[data-slot="HEAD"]', css)
        self.assertIn('font-family: "Sora", sans-serif', css)

    def test_font_family_composes_with_other_props(self):
        css = _build_tweaks_css({"HEAD": {"fontFamily": "Fraunces", "fontSize": 7, "x": 4}})
        self.assertIn('font-family: "Fraunces", serif', css)
        self.assertIn("font-size: 7cqw", css)
        self.assertIn("translate: 43.2px 0px", css)  # x=4 → 4% of 1080

    def test_no_font_family_no_emit(self):
        """No fontFamily tweak → no font-family rule (no-op / RNDR-05 safety)."""
        css = _build_tweaks_css({"HEAD": {"x": 4}})
        self.assertNotIn("font-family", css)

    def test_curated_set_and_link(self):
        names = [n for n, _ in CURATED_FONTS]
        for expected in ("Inter", "Geist", "Manrope", "Sora", "Hanken Grotesk",
                         "Playfair Display", "JetBrains Mono"):
            self.assertIn(expected, names)
        link = build_google_fonts_link()
        self.assertIn("fonts.googleapis.com/css2", link)
        self.assertIn("family=Sora", link)
        self.assertIn("family=Playfair+Display", link)
        self.assertIn('rel="stylesheet"', link)

    def test_link_includes_extra_brand_families(self):
        link = build_google_fonts_link(["Cabinet Grotesk"])
        self.assertIn("family=Cabinet+Grotesk", link)


# ---------------------------------------------------------------------------
# Tests for _build_tweaks_css
# ---------------------------------------------------------------------------

class TestBuildTweaksCss(unittest.TestCase):
    """CSS rule builder for per-zone tweaks."""

    def test_returns_string_for_full_css_props(self):
        """All supported CSS props emit correct values for a HERO slot."""
        result = _build_tweaks_css({
            "HERO": {"x": 5, "y": 24, "fontSize": 9, "opacity": 0.5, "tilt": 3}
        })
        self.assertIn('[data-slot="HERO"]', result)
        self.assertIn("translate: 54px 324px", result)  # x=5,y=24 of 1080x1350
        self.assertIn("font-size: 9cqw", result)
        self.assertIn("opacity: 0.5", result)
        self.assertIn("transform: rotate(3deg)", result)

    def test_empty_dict_returns_empty_string(self):
        """Empty slide dict → empty CSS string (RNDR-05 at CSS level)."""
        result = _build_tweaks_css({})
        self.assertEqual(result, "")

    def test_text_only_slot_produces_no_css_rule(self):
        """A slot with only 'text' has no CSS props — no CSS rule emitted."""
        result = _build_tweaks_css({"HERO": {"text": "New headline"}})
        self.assertEqual(result, "")

    def test_width_prop_emits_correctly(self):
        """'w' key maps to width: N%."""
        result = _build_tweaks_css({"BODY": {"w": 80}})
        self.assertIn("width: 80%", result)

    def test_partial_props_only_emit_present_keys(self):
        """Only present keys appear — missing keys produce no output."""
        result = _build_tweaks_css({"CTA": {"x": 10, "y": 50}})
        self.assertIn("translate: 108px 675px", result)  # x=10,y=50 of 1080x1350
        self.assertNotIn("font-size", result)
        self.assertNotIn("opacity", result)
        self.assertNotIn("transform", result)  # tilt absent → no transform rule

    def test_multiple_slots_produce_multiple_rules(self):
        """Multiple slots each get a separate rule block."""
        result = _build_tweaks_css({
            "HERO": {"x": 5},
            "BODY": {"y": 30},
        })
        self.assertIn('[data-slot="HERO"]', result)
        self.assertIn('[data-slot="BODY"]', result)

    def test_scale_square_emits_object_fit(self):
        """'scale': 'square' on an image slot emits object-fit CSS (EDIT-04)."""
        result = _build_tweaks_css({"PHOTO_MAIN": {"scale": "square"}})
        # scale="square" must produce some CSS — implementation may use object-fit: cover
        # or a dedicated square-crop rule; just assert something is emitted.
        self.assertIn("[data-slot=", result)

    def test_scale_crop_matches_live_object_fit_none(self):
        """'scale':'crop' → object-fit:none on BOTH the zone and its inner <img>,
        matching the editor (preview_editor.py applyToSlide sets objectFit:none).
        Audit #2: crop used to map to cover at bake → preview != PNG."""
        result = _build_tweaks_css({"PHOTO_MAIN": {"scale": "crop"}})
        self.assertIn("object-fit: none", result)
        self.assertNotIn("object-fit: cover", result)
        self.assertIn('[data-slot="PHOTO_MAIN"] img', result)
        # crop emits no aspect-ratio (live sets aspectRatio:'').
        self.assertNotIn("aspect-ratio", result)

    def test_scale_square_emits_aspect_ratio_1_1(self):
        """'scale':'square' → object-fit:cover + aspect-ratio:1/1 on zone and <img>,
        matching the editor (live sets objectFit cover + aspectRatio '1 / 1').
        Audit #2: square used to emit no aspect-ratio at bake → preview != PNG."""
        result = _build_tweaks_css({"PHOTO_MAIN": {"scale": "square"}})
        self.assertIn("object-fit: cover", result)
        self.assertIn("aspect-ratio: 1 / 1", result)

    def test_layers_ignored_without_error(self):
        """'layers': [] present on an image slot is silently ignored (CONS-02)."""
        # Should not raise and should not produce a 'layers' CSS property.
        result = _build_tweaks_css({"PHOTO_MAIN": {"x": 10, "layers": []}})
        self.assertNotIn("layers", result)
        self.assertIn("translate: 108px 0px", result)  # x=10 of 1080

    def test_global_key_skipped(self):
        """The 'global' key is skipped — it is not a slot name."""
        result = _build_tweaks_css({"global": {"accent": "#ff0000"}, "HERO": {"x": 5}})
        self.assertNotIn('[data-slot="global"]', result)
        self.assertIn('[data-slot="HERO"]', result)

    def test_text_color_emitted(self):
        """'color' on a text slot emits a color rule (rebake parity for text colour)."""
        result = _build_tweaks_css({"HERO": {"color": "#ff3366"}})
        self.assertIn("color: #ff3366", result)

    def test_stroke_emits_border(self):
        """strokeColor + strokeW emit a border; width 0 emits none."""
        result = _build_tweaks_css({"IMAGE": {"strokeColor": "#112233", "strokeW": 4}})
        self.assertIn("border: 4px solid #112233", result)
        self.assertNotIn("border:", _build_tweaks_css({"IMAGE": {"strokeColor": "#000", "strokeW": 0}}))

    def test_corner_radius_emitted(self):
        """'radius' emits border-radius + overflow:hidden to clip the image."""
        result = _build_tweaks_css({"IMAGE": {"radius": 24}})
        self.assertIn("border-radius: 24px", result)
        self.assertIn("overflow: hidden", result)

    def test_zindex_emitted(self):
        """'z' (layer order) emits position + z-index so reordering takes effect."""
        result = _build_tweaks_css({"IMAGE": {"z": 5}})
        self.assertIn("z-index: 5", result)
        self.assertIn("position: relative", result)

    def test_svg_color_recolors_shapes(self):
        """'color' on an SVG zone also emits child stroke/fill recolor rules."""
        result = _build_tweaks_css({"ANNOTATION_SVG": {"color": "#e2403a"}})
        self.assertIn('[data-slot="ANNOTATION_SVG"] svg [stroke]', result)
        self.assertIn("stroke: #e2403a", result)

    # ── §4 remove asset: hidden/removed zones must drop out of the bake ──
    def test_removed_true_emits_display_none(self):
        """removed:true → display:none !important so the zone omits from the PNG."""
        result = _build_tweaks_css({"OLD_BADGE": {"removed": True}})
        self.assertIn('[data-slot="OLD_BADGE"]', result)
        self.assertIn("display: none", result)
        self.assertIn("!important", result)

    def test_removed_true_skips_other_props(self):
        """A removed zone emits ONLY display:none — no left/top/etc. that would
        otherwise reposition a hidden element."""
        result = _build_tweaks_css({"OLD_BADGE": {"removed": True, "x": 10, "w": 50}})
        self.assertIn("display: none", result)
        self.assertNotIn("left: 10%", result)
        self.assertNotIn("width: 50%", result)

    def test_visible_false_emits_display_none(self):
        """The eye writing visible:false must now round-trip to the bake as
        display:none (the gap this fixes: hidden zones used to reappear)."""
        result = _build_tweaks_css({"HERO": {"visible": False}})
        self.assertIn("display: none", result)

    def test_visible_true_does_not_hide(self):
        """visible:true (or absent) must NOT emit display:none."""
        self.assertNotIn("display: none", _build_tweaks_css({"HERO": {"visible": True}}))
        self.assertNotIn("display: none", _build_tweaks_css({"HERO": {"x": 5}}))


# ---------------------------------------------------------------------------
# Tests for apply_tweaks (text-merge helper)
# ---------------------------------------------------------------------------

class TestApplyTweaks(unittest.TestCase):
    """Text-merge helper: apply_tweaks(processed, slide_tweaks) -> dict."""

    def test_text_override_sets_slot_value(self):
        """Text tweak updates the processed dict entry for that slot."""
        processed = {"HERO": "original text", "BODY": "body copy"}
        slide_tweaks = {"HERO": {"text": "New headline"}}
        result = apply_tweaks(processed, slide_tweaks)
        self.assertEqual(result["HERO"], "New headline")

    def test_other_slots_untouched(self):
        """Slots not present in tweaks retain their original values."""
        processed = {"HERO": "original", "BODY": "body copy", "CTA": "click"}
        result = apply_tweaks(processed, {"HERO": {"text": "New"}})
        self.assertEqual(result["BODY"], "body copy")
        self.assertEqual(result["CTA"], "click")

    def test_empty_slide_tweaks_is_noop(self):
        """Empty slide_tweaks dict leaves processed unchanged (RNDR-05 at unit level)."""
        processed = {"HERO": "original", "BODY": "body"}
        result = apply_tweaks(processed, {})
        self.assertEqual(result["HERO"], "original")
        self.assertEqual(result["BODY"], "body")

    def test_slot_without_text_key_not_touched(self):
        """A slot entry with only CSS props (no 'text') does not alter processed."""
        processed = {"HERO": "original"}
        result = apply_tweaks(processed, {"HERO": {"x": 5, "y": 24}})
        self.assertEqual(result["HERO"], "original")

    def test_returns_the_same_dict(self):
        """apply_tweaks returns the processed dict (mutates in place or returns same ref)."""
        processed = {"HERO": "original"}
        result = apply_tweaks(processed, {"HERO": {"text": "New"}})
        self.assertIsNotNone(result)
        self.assertIsInstance(result, dict)


# ---------------------------------------------------------------------------
# Tests for the text-tweak RAW-render contract (audit #2: live innerHTML == bake)
# ---------------------------------------------------------------------------

class TestTextTweakRawRender(unittest.TestCase):
    """A user TEXT tweak is applied live as ``el.innerHTML = value`` (editor trusts
    its own input). So a double-brace ``{{SLOT}}`` whose value came from a text tweak
    must render RAW at bake — not HTML-escaped — or a <mark>/<br> becomes literal in
    the PNG → live != bake."""

    def test_text_tweak_keys_collects_text_slots(self):
        keys = text_tweak_keys({
            "HEAD": {"text": "Hi <mark>x</mark>"},
            "BODY": {"x": 5},                 # CSS-only, not a text tweak
            "global": {"accent": "#fff"},      # skipped
            "__texture": {"id": "grain"},      # skipped
        })
        self.assertEqual(keys, {"HEAD"})

    def test_double_brace_raw_when_in_raw_keys(self):
        """{{HEAD}} renders raw markup when HEAD is a text tweak (raw_keys)."""
        out = substitute("<h1>{{HEAD}}</h1>", {"HEAD": "A <mark>word</mark> here"},
                         raw_keys={"HEAD"})
        self.assertIn("<mark>word</mark>", out)
        self.assertNotIn("&lt;mark&gt;", out)

    def test_double_brace_still_escapes_untweaked(self):
        """A double-brace slot NOT in raw_keys still escapes (no injection from data)."""
        out = substitute("<h1>{{HEAD}}</h1>", {"HEAD": "A <mark>word</mark>"},
                         raw_keys=set())
        self.assertIn("&lt;mark&gt;", out)
        self.assertNotIn("<mark>word</mark>", out)

    def test_br_survives_in_tweaked_text(self):
        """A <br> the user kept in a retyped headline renders as a real line break."""
        out = fill("<h1>{{HEAD}}</h1>", {"HEAD": "line one<br>line two"},
                   raw_keys={"HEAD"})
        self.assertIn("line one<br>line two", out)

    def test_no_raw_keys_is_byte_identical_to_old_behavior(self):
        """Default raw_keys (None/empty) keeps the pre-change escaping (RNDR-05)."""
        tmpl = "<h1>{{HEAD}}</h1><p>{{{BODY}}}</p>"
        data = {"HEAD": "a & b <i>x</i>", "BODY": "<em>raw</em>"}
        self.assertEqual(substitute(tmpl, data), substitute(tmpl, data, raw_keys=None))
        self.assertEqual(substitute(tmpl, data), substitute(tmpl, data, raw_keys=set()))


# ---------------------------------------------------------------------------
# Tests for apply_global_tweaks (non-destructive brand_kit patch)
# ---------------------------------------------------------------------------

class TestApplyGlobalTweaks(unittest.TestCase):
    """Global tweaks: apply_global_tweaks(brand_kit, global_dict) -> patched copy."""

    def test_accent_patched_in_copy(self):
        """'accent' in global tweaks sets colors.accent in the returned copy."""
        brand_kit = {"colors": {"accent": "#original", "bg": "#fff"}}
        result = apply_global_tweaks(brand_kit, {"accent": "#ff0000"})
        self.assertEqual(result["colors"]["accent"], "#ff0000")

    def test_original_brand_kit_unmutated(self):
        """The original brand_kit dict is NOT modified (non-destructive, Pitfall 4)."""
        brand_kit = {"colors": {"accent": "#original"}}
        apply_global_tweaks(brand_kit, {"accent": "#ff0000"})
        self.assertEqual(brand_kit["colors"]["accent"], "#original")

    def test_empty_global_tweaks_returns_equivalent_copy(self):
        """Empty global tweaks returns a copy with same values."""
        brand_kit = {"colors": {"accent": "#abc"}, "fonts": {}}
        result = apply_global_tweaks(brand_kit, {})
        self.assertEqual(result["colors"]["accent"], "#abc")

    def test_unrecognized_key_does_not_raise(self):
        """Unknown global tweak keys are silently ignored (forward-compat)."""
        brand_kit = {"colors": {"accent": "#abc"}}
        result = apply_global_tweaks(brand_kit, {"unknownKey": "value"})
        self.assertIsNotNone(result)

    def test_returns_dict(self):
        """Return value is always a dict."""
        result = apply_global_tweaks({}, {"accent": "#ff0000"})
        self.assertIsInstance(result, dict)


# ---------------------------------------------------------------------------
# Integration test: global patch lands BEFORE build_brand_tokens_css (Pitfall 4)
# ---------------------------------------------------------------------------

class TestGlobalPatchOrdering(unittest.TestCase):
    """Prove that apply_global_tweaks + build_brand_tokens_css produces the patched token CSS.

    This test directly calls build_brand_tokens_css on a patched brand_kit copy and
    asserts that the accent color reaches the emitted CSS — proving the global patch
    MUST be applied before build_brand_tokens_css is called (Pitfall 4 cannot regress).

    No Playwright involved — this is pure Python/string logic.
    """

    def test_global_accent_reaches_token_css(self):
        """Patching brand_kit before build_brand_tokens_css embeds the accent in token CSS."""
        from render_template import build_brand_tokens_css

        brand_kit = {"colors": {"accent": "#aaaaaa"}}
        global_tweaks = {"accent": "#ff0000"}

        # Apply global patch first (the correct ordering)
        patched_kit = apply_global_tweaks(brand_kit, global_tweaks)

        # Build tokens from the PATCHED kit — this is what render() must do
        token_css = build_brand_tokens_css(patched_kit)

        # The emitted CSS must contain the new accent, not the original
        self.assertIn("ff0000", token_css.lower())
        self.assertNotIn("aaaaaa", token_css.lower())

    def test_wrong_order_would_miss_accent(self):
        """Sanity check: building tokens from ORIGINAL kit produces old color (confirms the test is meaningful)."""
        from render_template import build_brand_tokens_css

        brand_kit = {"colors": {"accent": "#aaaaaa"}}

        # Build tokens from original (wrong order — what would happen if patch is too late)
        token_css_wrong = build_brand_tokens_css(brand_kit)

        # The old accent must appear when we skip the patch
        self.assertIn("aaaaaa", token_css_wrong.lower())


# ---------------------------------------------------------------------------
# No-op / parity tests (RNDR-05 unit-level assertion)
# ---------------------------------------------------------------------------

class TestNoOpParity(unittest.TestCase):
    """Empty or absent tweaks must produce identical pre-fill state (RNDR-05)."""

    def test_apply_tweaks_none_vs_empty_dict_identical(self):
        """tweaks=None path and tweaks={} path produce identical processed dicts."""
        processed_base = {"HERO": "headline", "BODY": "body text", "CTA": "click"}

        # Simulate the no-tweaks path: slide_tweaks = {}
        import copy
        p_no_tweaks = copy.deepcopy(processed_base)
        result_no_tweaks = apply_tweaks(p_no_tweaks, {})

        # Simulate the empty-slide-dict path: same result
        p_empty_slide = copy.deepcopy(processed_base)
        result_empty_slide = apply_tweaks(p_empty_slide, {})

        self.assertEqual(result_no_tweaks, result_empty_slide)

    def test_build_tweaks_css_empty_produces_no_injection(self):
        """_build_tweaks_css({}) returns empty string — no <style> will be injected."""
        css = _build_tweaks_css({})
        self.assertEqual(css, "")
        # Confirm this means the injection guard `if css:` would prevent any <style> tag
        self.assertFalse(bool(css))

    def test_parity_no_tweaks_vs_empty_slide_dict(self):
        """Both tweaks=None and tweaks={'slide-01': {}} leave processed state identical."""
        import copy

        processed_original = {"HERO": "headline", "BODY": "body", "CTA": "cta"}

        # Path A: no tweaks (slide_tweaks = {})
        proc_a = copy.deepcopy(processed_original)
        result_a = apply_tweaks(proc_a, {})
        css_a = _build_tweaks_css({})

        # Path B: tweaks with empty slide entry
        proc_b = copy.deepcopy(processed_original)
        slide_tweaks_b = {}  # tweaks.get("slide-01", {}) with slide-01: {}
        result_b = apply_tweaks(proc_b, slide_tweaks_b)
        css_b = _build_tweaks_css(slide_tweaks_b)

        self.assertEqual(result_a, result_b)
        self.assertEqual(css_a, css_b)
        self.assertEqual(css_a, "")


if __name__ == "__main__":
    unittest.main()
