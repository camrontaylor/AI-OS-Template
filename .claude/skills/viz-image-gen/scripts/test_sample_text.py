# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Tests for parse_sample_text_from_instructions() — the parser behind
`--use-sample-text` — covering the two AIOS-190 quirks:

  (a) a `sample:` value wrapped in BACKTICKS must not keep the literal backticks.
  (b) a `sample:` that appears INLINE in a combined `bbox · style · sample`
      one-liner must still be parsed (it was silently dropped before).

Runs via: uv run test_sample_text.py  OR  python -m pytest test_sample_text.py
"""

import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from render_template import (  # noqa: E402
    parse_sample_text_from_instructions,
    parse_slots_from_instructions,
    apply_masthead_tokens,
    _clean_sample_value,
)


def _write(md: str) -> Path:
    f = tempfile.NamedTemporaryFile(
        mode="w", suffix=".md", delete=False, encoding="utf-8"
    )
    f.write(textwrap.dedent(md))
    f.close()
    return Path(f.name)


class TestCleanSampleValue(unittest.TestCase):
    def test_strips_double_quotes(self):
        self.assertEqual(_clean_sample_value('"Learn More"'), "Learn More")

    def test_strips_single_quotes(self):
        self.assertEqual(_clean_sample_value("'Learn More'"), "Learn More")

    def test_strips_backticks(self):
        self.assertEqual(_clean_sample_value("`Learn More`"), "Learn More")

    def test_bare_value_untouched(self):
        self.assertEqual(_clean_sample_value("Learn More"), "Learn More")

    def test_only_one_layer_stripped(self):
        # Inner quotes are content, not wrapping — keep them.
        self.assertEqual(_clean_sample_value('`"quoted"`'), '"quoted"')

    def test_trailing_separator_trimmed(self):
        self.assertEqual(_clean_sample_value("Learn More ·"), "Learn More")


class TestParseSampleText(unittest.TestCase):
    def setUp(self):
        self._paths: list[Path] = []

    def tearDown(self):
        for p in self._paths:
            p.unlink(missing_ok=True)

    def _md(self, md: str) -> Path:
        p = _write(md)
        self._paths.append(p)
        return p

    def test_own_line_double_quoted(self):
        p = self._md("""\
            ## Slots
            - **HERO** — preamble
              - sample: "I never write"
        """)
        self.assertEqual(parse_sample_text_from_instructions(p), {"HERO": "I never write"})

    def test_backtick_wrapped_sample_has_no_backticks(self):
        p = self._md("""\
            ## Slots
            - **CTA** — button label
              - sample: `Learn More`
        """)
        out = parse_sample_text_from_instructions(p)
        self.assertEqual(out["CTA"], "Learn More")
        self.assertNotIn("`", out["CTA"])

    def test_inline_combined_line_is_parsed(self):
        # bbox · style · sample all on ONE line — previously dropped entirely.
        p = self._md("""\
            ## Slots
            - **KICKER** — small label
              - bbox: 4% 8% 50% 5% · style: caption, 3cqw · sample: "THE BIG IDEA"
        """)
        out = parse_sample_text_from_instructions(p)
        self.assertEqual(out.get("KICKER"), "THE BIG IDEA")

    def test_inline_combined_line_backtick(self):
        p = self._md("""\
            ## Slots
            - **CTA** — label
              - bbox: 30% 85% 40% 7% · style: pill · sample: `Go now`
        """)
        out = parse_sample_text_from_instructions(p)
        self.assertEqual(out.get("CTA"), "Go now")

    def test_sample_on_slot_header_line(self):
        p = self._md("""\
            ## Slots
            - **TAG** — micro label · sample: `New`
        """)
        out = parse_sample_text_from_instructions(p)
        self.assertEqual(out.get("TAG"), "New")

    def test_multiple_slots_mixed_forms(self):
        p = self._md("""\
            ## Slots
            - **HERO** — display
              - sample: "Ship it"
            - **CTA** — pill
              - bbox: 0% 0% 10% 10% · style: pill · sample: `Read more`
            - **KICKER** — caption
              - sample: 'No quotes kept'
        """)
        out = parse_sample_text_from_instructions(p)
        self.assertEqual(out, {
            "HERO": "Ship it",
            "CTA": "Read more",
            "KICKER": "No quotes kept",
        })


class TestParseSlotsInlineAndBacktick(unittest.TestCase):
    """The richer parse_slots_from_instructions() must share the tolerance."""

    def setUp(self):
        self._paths: list[Path] = []

    def tearDown(self):
        for p in self._paths:
            p.unlink(missing_ok=True)

    def _md(self, md: str) -> Path:
        p = _write(md)
        self._paths.append(p)
        return p

    def test_combined_one_liner_fills_all_fields(self):
        p = self._md("""\
            ## Slots
            - **HEAD** — headline
              - bbox: 4% 22% 92% 7% · style: display, 8cqw · sample: `Big news` · max_chars: 60
        """)
        slots = parse_slots_from_instructions(p)
        self.assertEqual(len(slots), 1)
        s = slots[0]
        self.assertEqual(s["name"], "HEAD")
        self.assertEqual(s["bbox"], {"x": 4.0, "y": 22.0, "w": 92.0, "h": 7.0})
        self.assertIn("display", s["style"])
        self.assertEqual(s["sample"], "Big news")
        self.assertEqual(s["max_chars"], 60)

    def test_backtick_sample_stripped(self):
        p = self._md("""\
            ## Slots
            - **CTA** — button
              - sample: `Learn More`
        """)
        slots = parse_slots_from_instructions(p)
        self.assertEqual(slots[0]["sample"], "Learn More")


class TestMastheadTokenPrecedence(unittest.TestCase):
    """l6-chrome parity gate: chrome.masthead.labels must OVERRIDE the per-template
    `sample:` values (TOKEN > SAMPLE). Guards the regression where a stale pre-rebrand
    sample (e.g. "@yourbrand") signs the masthead instead of the brand token."""

    KIT = {"chrome": {"masthead": {"enabled": True,
                                   "labels": ["@yourbrand", "", "AI-OS"]}}}

    def test_token_overrides_stale_sample(self):
        # Sample (merged first by --use-sample-text) carries the pre-rebrand handle.
        data = {
            "MASTHEAD_LEFT": "@yourbrand",
            "MASTHEAD_CENTER": "",
            "MASTHEAD_RIGHT": "AI-OS",
        }
        apply_masthead_tokens(data, self.KIT)
        self.assertEqual(data["MASTHEAD_LEFT"], "@yourbrand")
        self.assertEqual(data["MASTHEAD_RIGHT"], "AI-OS")
        self.assertNotIn("ai", (data["MASTHEAD_LEFT"] + data["MASTHEAD_RIGHT"]).lower())

    def test_empty_center_preserved_not_falling_back(self):
        # labels[1] == "" is an intentional empty center; the empty string must be
        # written THROUGH, overriding any non-empty sample (no fallback to sample).
        data = {"MASTHEAD_CENTER": "stale center"}
        apply_masthead_tokens(data, self.KIT)
        self.assertEqual(data["MASTHEAD_CENTER"], "")

    def test_token_wins_even_when_slot_absent_in_data(self):
        data = {}
        apply_masthead_tokens(data, self.KIT)
        self.assertEqual(data["MASTHEAD_LEFT"], "@yourbrand")
        self.assertEqual(data["MASTHEAD_CENTER"], "")
        self.assertEqual(data["MASTHEAD_RIGHT"], "AI-OS")

    def test_disabled_masthead_is_noop(self):
        data = {"MASTHEAD_LEFT": "@yourbrand"}
        kit = {"chrome": {"masthead": {"enabled": False,
                                       "labels": ["@yourbrand", "", "AI-OS"]}}}
        apply_masthead_tokens(data, kit)
        self.assertEqual(data["MASTHEAD_LEFT"], "@yourbrand")  # untouched

    def test_no_chrome_is_noop(self):
        data = {"MASTHEAD_LEFT": "keep"}
        apply_masthead_tokens(data, {"colors": {}})
        self.assertEqual(data["MASTHEAD_LEFT"], "keep")

    def test_none_brand_kit_is_noop(self):
        data = {"MASTHEAD_LEFT": "keep"}
        apply_masthead_tokens(data, None)
        self.assertEqual(data["MASTHEAD_LEFT"], "keep")

    def test_none_label_skips_slot_leaving_sample(self):
        data = {"MASTHEAD_RIGHT": "sample right"}
        kit = {"chrome": {"masthead": {"enabled": True,
                                       "labels": ["@yourbrand", "", None]}}}
        apply_masthead_tokens(data, kit)
        self.assertEqual(data["MASTHEAD_LEFT"], "@yourbrand")
        self.assertEqual(data["MASTHEAD_RIGHT"], "sample right")  # None label -> sample kept


if __name__ == "__main__":
    unittest.main(verbosity=2)
