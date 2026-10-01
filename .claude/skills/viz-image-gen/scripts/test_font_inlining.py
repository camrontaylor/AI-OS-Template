# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Tests for the SPEC-C font plumbing in render_template.py:

  - _read_css_with_inlined_urls(): a shared stylesheet's relative @font-face
    url(...) refs are inlined to base64 data URIs (resolved against the CSS file's
    OWN parent dir) — the fix for the decisive "brand @font-face never loads" bug.
  - _brand_display_family(): parse the first (brand) display family from a
    --brand-display token declaration (drives the C3 font-resolved gate).

Runs via: uv run test_font_inlining.py
          or: python test_font_inlining.py
"""

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from render_template import _read_css_with_inlined_urls, _brand_display_family  # noqa: E402


class ReadCssWithInlinedUrls(unittest.TestCase):
    def test_relative_font_face_url_inlined_to_base64(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            # Mirror the real pool layout: styles.css in _shared/, font three dirs up.
            shared = root / "templates" / "pool" / "_shared"
            shared.mkdir(parents=True)
            fonts = root / "visual-identity" / "fonts"
            fonts.mkdir(parents=True)
            (fonts / "anton-400.woff2").write_bytes(b"\x00FONTBYTES\x00")
            css = shared / "styles.css"
            css.write_text(
                "@font-face {\n"
                "  font-family: 'Anton';\n"
                "  src: url('../../../visual-identity/fonts/anton-400.woff2') format('woff2');\n"
                "}\n",
                encoding="utf-8",
            )
            out = _read_css_with_inlined_urls(css)
            self.assertIn("data:font/woff2;base64,", out)
            # The relative path must be gone (it would resolve against about:blank).
            self.assertNotIn("../../../visual-identity/fonts/anton-400.woff2", out)

    def test_missing_font_file_left_untouched(self):
        with tempfile.TemporaryDirectory() as td:
            css = Path(td) / "styles.css"
            css.write_text(
                "@font-face { font-family:'X'; src: url('nope.woff2') format('woff2'); }",
                encoding="utf-8",
            )
            out = _read_css_with_inlined_urls(css)
            # Non-existent file: regex leaves the ref as-is (no crash, no data URI).
            self.assertIn("nope.woff2", out)
            self.assertNotIn("data:font", out)


class BrandDisplayFamily(unittest.TestCase):
    def test_first_family_extracted_and_unquoted(self):
        tokens = "--font-display: \"Anton\"; --brand-display: \"Anton\", 'Inter Tight', system-ui;"
        self.assertEqual(_brand_display_family(tokens), "Anton")

    def test_single_quotes(self):
        self.assertEqual(_brand_display_family("--brand-display: 'Bebas Neue', sans-serif;"), "Bebas Neue")

    def test_absent_returns_none(self):
        self.assertIsNone(_brand_display_family("--font-display: 'Anton';"))
        self.assertIsNone(_brand_display_family(""))


if __name__ == "__main__":
    unittest.main()
