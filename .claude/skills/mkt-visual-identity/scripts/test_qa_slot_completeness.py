#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0", "pillow>=10.0.0", "numpy>=1.26.0"]
# ///
"""test_qa_slot_completeness.py — D2 (studio-sweep): instructions.md ↔ template slots.

The defect (highlight-stack-cover): template.html declares text slots LINE_1/LINE_2/
LINE_4 + CONNECTOR, but instructions.md's ## Slots block leaves a numbering gap
(LINE_3 missing). The Template Card must enumerate EVERY text data-slot the template
renders (no gaps). run_template_qa.py Step 4b is the gate.

Run: uv run test_qa_slot_completeness.py
"""
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from run_template_qa import (  # noqa: E402
    template_text_slots,
    instructions_enumerated_slots,
    check_instructions_slot_completeness,
)

HTML = (
    '<div class="slide">'
    '<div class="bg" data-zone="photo" data-slot="PHOTO_MAIN"></div>'
    '<div data-slot="LINE_1"><span>{{{LINE_1}}}</span></div>'
    '<div data-slot="LINE_2"><span>{{{LINE_2}}}</span></div>'
    '<div data-slot="CONNECTOR">{{{CONNECTOR}}}</div>'
    '<div data-slot="LINE_4"><span>{{{LINE_4}}}</span></div>'
    '<div class="masthead" data-slot="MASTHEAD"></div>'
    '<div data-slot="WORDMARK"></div>'
    '</div>'
)

INSTR_COMPLETE = """# Template: highlight-stack-cover

## Slots

- **LINE_1** — first display line
- **LINE_2** — second display line
- **CONNECTOR** — subtitle connector
- **LINE_4** — final display line

## Strategy notes
"""

INSTR_GAP = """# Template: highlight-stack-cover

## Slots

- **LINE_1** — first display line
- **LINE_2** — second display line
- **CONNECTOR** — subtitle connector

## Strategy notes
"""


class TestSlotCompleteness(unittest.TestCase):
    def test_template_text_slots_excludes_chrome_and_image(self):
        slots = template_text_slots(HTML)
        self.assertEqual(slots, ["LINE_1", "LINE_2", "CONNECTOR", "LINE_4"])
        self.assertNotIn("PHOTO_MAIN", slots)
        self.assertNotIn("MASTHEAD", slots)
        self.assertNotIn("WORDMARK", slots)

    def test_instructions_enumerated_slots(self):
        self.assertEqual(
            instructions_enumerated_slots(INSTR_COMPLETE),
            ["LINE_1", "LINE_2", "CONNECTOR", "LINE_4"],
        )

    def test_complete_instructions_pass(self):
        self.assertEqual(check_instructions_slot_completeness(HTML, INSTR_COMPLETE), [])

    def test_missing_slot_flagged(self):
        issues = check_instructions_slot_completeness(HTML, INSTR_GAP)
        self.assertEqual(len(issues), 1, issues)
        self.assertIn("LINE_4", issues[0])


if __name__ == "__main__":
    unittest.main()
