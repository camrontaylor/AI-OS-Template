# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Tests for parse_slots_from_instructions() — full-schema slot parser.

Runs via: uv run test_parse_slots.py
          or: python test_parse_slots.py

RED phase: function does not exist yet — this file must exit non-zero on first run.
"""

import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

# --- sys.path setup (mirror render_template.py SCRIPT_DIR pattern) ---
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from render_template import parse_slots_from_instructions  # noqa: E402  (fails RED)

# ---------------------------------------------------------------------------
# Fixture: a realistic ## Slots block with all four zone types
# ---------------------------------------------------------------------------

FIXTURE_SLOTS = textwrap.dedent("""\
    # Instructions

    ## Slots

    - **HERO** — italic preamble
      - bbox: 4% 22% 92% 7%
      - style: display-italic, 8cqw, white on coral, left-align
      - sample: "I never write"
      - max_chars: 60

    - **PHOTO_MAIN** — full-bleed background image
      - bbox: 0% 0% 100% 100%
      - style: ai-image, cover, no-text
      - sample: "Abstract gradient background"

    - **MASTHEAD_CENTER** — brand masthead bar
      - bbox: 0% 0% 100% 8%
      - style: masthead, 2.5cqw, brand-bg, chrome
      - sample: "ACME Brand"
      - max_chars: 30

    - **CTA** — call-to-action button label
      - bbox: 30% 85% 40% 7%
      - style: pill, 3cqw, accent-bg, white-text
      - sample: "Learn More"
      - max_chars: 20

    ## Notes

    Some other section that should be ignored.
""")


class TestParseSlotsFromInstructions(unittest.TestCase):

    def setUp(self):
        """Write the fixture to a temp file for each test."""
        self._tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False, encoding="utf-8"
        )
        self._tmp.write(FIXTURE_SLOTS)
        self._tmp.close()
        self.path = Path(self._tmp.name)

    def tearDown(self):
        self.path.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Basic shape
    # ------------------------------------------------------------------

    def test_returns_list(self):
        result = parse_slots_from_instructions(self.path)
        self.assertIsInstance(result, list)

    def test_four_slots_parsed(self):
        result = parse_slots_from_instructions(self.path)
        self.assertEqual(len(result), 4, f"Expected 4 slots, got {len(result)}: {result}")

    def test_all_slots_have_required_keys(self):
        result = parse_slots_from_instructions(self.path)
        required_keys = {"name", "bbox", "style", "sample", "max_chars", "type"}
        for slot in result:
            self.assertEqual(
                set(slot.keys()), required_keys,
                f"Slot {slot.get('name')} missing keys: {required_keys - set(slot.keys())}"
            )

    # ------------------------------------------------------------------
    # HERO slot — text zone
    # ------------------------------------------------------------------

    def test_hero_name(self):
        result = parse_slots_from_instructions(self.path)
        hero = next((s for s in result if s["name"] == "HERO"), None)
        self.assertIsNotNone(hero, "HERO slot not found")

    def test_hero_bbox(self):
        result = parse_slots_from_instructions(self.path)
        hero = next(s for s in result if s["name"] == "HERO")
        self.assertEqual(hero["bbox"], {"x": 4.0, "y": 22.0, "w": 92.0, "h": 7.0})

    def test_hero_style_contains_display_italic(self):
        result = parse_slots_from_instructions(self.path)
        hero = next(s for s in result if s["name"] == "HERO")
        self.assertIn("display-italic", hero["style"])

    def test_hero_sample(self):
        result = parse_slots_from_instructions(self.path)
        hero = next(s for s in result if s["name"] == "HERO")
        self.assertEqual(hero["sample"], "I never write")

    def test_hero_max_chars(self):
        result = parse_slots_from_instructions(self.path)
        hero = next(s for s in result if s["name"] == "HERO")
        self.assertEqual(hero["max_chars"], 60)

    def test_hero_type_is_text(self):
        result = parse_slots_from_instructions(self.path)
        hero = next(s for s in result if s["name"] == "HERO")
        self.assertEqual(hero["type"], "text")

    # ------------------------------------------------------------------
    # PHOTO_MAIN — image zone
    # ------------------------------------------------------------------

    def test_photo_main_type_is_image(self):
        result = parse_slots_from_instructions(self.path)
        photo = next((s for s in result if s["name"] == "PHOTO_MAIN"), None)
        self.assertIsNotNone(photo, "PHOTO_MAIN slot not found")
        self.assertEqual(photo["type"], "image")

    def test_photo_main_bbox(self):
        result = parse_slots_from_instructions(self.path)
        photo = next(s for s in result if s["name"] == "PHOTO_MAIN")
        self.assertEqual(photo["bbox"], {"x": 0.0, "y": 0.0, "w": 100.0, "h": 100.0})

    def test_photo_main_max_chars_is_none(self):
        """PHOTO_MAIN has no max_chars line — should be None, not crash."""
        result = parse_slots_from_instructions(self.path)
        photo = next(s for s in result if s["name"] == "PHOTO_MAIN")
        self.assertIsNone(photo["max_chars"])

    # ------------------------------------------------------------------
    # MASTHEAD_CENTER — chrome zone
    # ------------------------------------------------------------------

    def test_masthead_type_is_chrome(self):
        result = parse_slots_from_instructions(self.path)
        masthead = next((s for s in result if s["name"] == "MASTHEAD_CENTER"), None)
        self.assertIsNotNone(masthead, "MASTHEAD_CENTER slot not found")
        self.assertEqual(masthead["type"], "chrome")

    # ------------------------------------------------------------------
    # CTA — pill zone
    # ------------------------------------------------------------------

    def test_cta_type_is_pill(self):
        result = parse_slots_from_instructions(self.path)
        cta = next((s for s in result if s["name"] == "CTA"), None)
        self.assertIsNotNone(cta, "CTA slot not found")
        self.assertEqual(cta["type"], "pill")

    def test_cta_bbox(self):
        result = parse_slots_from_instructions(self.path)
        cta = next(s for s in result if s["name"] == "CTA")
        self.assertEqual(cta["bbox"], {"x": 30.0, "y": 85.0, "w": 40.0, "h": 7.0})

    def test_cta_max_chars(self):
        result = parse_slots_from_instructions(self.path)
        cta = next(s for s in result if s["name"] == "CTA")
        self.assertEqual(cta["max_chars"], 20)

    # ------------------------------------------------------------------
    # Edge cases
    # ------------------------------------------------------------------

    def test_empty_input_returns_empty_list(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False, encoding="utf-8"
        ) as f:
            f.write("# No slots here\n\nJust some content.\n")
            empty_path = Path(f.name)
        try:
            result = parse_slots_from_instructions(empty_path)
            self.assertEqual(result, [])
        finally:
            empty_path.unlink(missing_ok=True)

    def test_slot_missing_bbox_yields_none(self):
        """A slot with no bbox line should have bbox=None, not crash."""
        fixture = textwrap.dedent("""\
            ## Slots

            - **TITLE** — standalone title
              - style: display, 6cqw, white
              - sample: "Hello World"
              - max_chars: 40
        """)
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False, encoding="utf-8"
        ) as f:
            f.write(fixture)
            no_bbox_path = Path(f.name)
        try:
            result = parse_slots_from_instructions(no_bbox_path)
            self.assertEqual(len(result), 1)
            self.assertIsNone(result[0]["bbox"])
            self.assertEqual(result[0]["max_chars"], 40)
        finally:
            no_bbox_path.unlink(missing_ok=True)

    def test_slot_name_captured_correctly(self):
        """Slot names must be extracted without asterisks or surrounding text."""
        result = parse_slots_from_instructions(self.path)
        names = [s["name"] for s in result]
        self.assertIn("HERO", names)
        self.assertIn("PHOTO_MAIN", names)
        self.assertIn("MASTHEAD_CENTER", names)
        self.assertIn("CTA", names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
