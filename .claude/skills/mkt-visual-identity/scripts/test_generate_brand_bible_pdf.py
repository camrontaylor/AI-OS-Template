# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Unit tests for generate_brand_bible_pdf.py — idempotency + canonical in-place overwrite.

Covers Lane 6 (fix-brand-book-idempotent):
  - two runs with unchanged inputs -> 1 PDF + [skip] + ZERO new .vN
  - changing an input -> re-render in place (no .vN)
  - --force re-renders even when the hash matches
  - .vN only ever appears with the opt-in --backup flag
  - legacy visual-identity.pdf -> brand-book.pdf one-time migration preserved

The real render goes through Playwright/Chromium; here we stub both the page
`Builder.build()` HTML and the playwright module so `main()` runs offline and just
writes a sentinel PDF file. The dirty-check / backup / migration logic under test is
pure filesystem + hashing — no browser needed.

Run:
    uv run test_generate_brand_bible_pdf.py
    or: python test_generate_brand_bible_pdf.py
"""
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import generate_brand_bible_pdf as g  # noqa: E402

MINIMAL_TOKENS = {
    "brand": "Test Brand (testbrand)",
    "version": "v1",
    "colors": {"primary": "#1f1816", "accent": "#d05344", "bg_light": "#efeeee", "bg_dark": "#101010"},
    "fonts": {"display": {"name": "Inter Tight"}, "body": {"name": "Inter"}},
}


class _FakePage:
    def __init__(self, calls):
        self._calls = calls

    def goto(self, *a, **k):
        pass

    def wait_for_timeout(self, *a, **k):
        pass

    def pdf(self, *a, path=None, **k):
        # emulate Chromium: write a NON-deterministic PDF (different bytes each call)
        Path(path).write_bytes(b"%PDF fake " + str(len(self._calls)).encode())
        self._calls.append(path)


class _FakeBrowser:
    def __init__(self, calls):
        self._calls = calls

    def new_page(self, *a, **k):
        return _FakePage(self._calls)

    def close(self):
        pass


class _FakeChromium:
    def __init__(self, calls):
        self._calls = calls

    def launch(self, *a, **k):
        return _FakeBrowser(self._calls)


class _FakePW:
    def __init__(self, calls):
        self.chromium = _FakeChromium(calls)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class BrandBookIdempotencyTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.brand_ctx = Path(self._tmp.name) / "brand_context"
        self.vi = self.brand_ctx / "visual-identity"
        self.vi.mkdir(parents=True)
        (self.vi / "tokens.json").write_text(json.dumps(MINIMAL_TOKENS), encoding="utf-8")
        (self.vi / "identity.md").write_text("# Identity\nclean", encoding="utf-8")
        (self.vi / "moves.md").write_text("## Move\n**What it is:** x", encoding="utf-8")

        self.render_calls: list[str] = []
        # Stub the playwright module main() imports lazily.
        fake_mod = types.ModuleType("playwright.sync_api")
        fake_mod.sync_playwright = lambda: _FakePW(self.render_calls)
        self._saved = sys.modules.get("playwright.sync_api")
        sys.modules["playwright.sync_api"] = fake_mod
        # Stub Builder.build so no real HTML/asset work is needed.
        self._saved_build = g.Builder.build
        g.Builder.build = lambda self, include_mockups=True: "<html></html>"

    def tearDown(self):
        g.Builder.build = self._saved_build
        if self._saved is not None:
            sys.modules["playwright.sync_api"] = self._saved
        else:
            sys.modules.pop("playwright.sync_api", None)
        self._tmp.cleanup()

    def _run(self, *extra):
        return g.main(["--brand-context", str(self.brand_ctx), *extra])

    def _pdf(self):
        return self.vi / "brand-book.pdf"

    def _vn(self):
        return sorted(self.vi.glob("brand-book.v*.pdf"))

    # 1. Two unchanged runs -> 1 PDF, skip, ZERO .vN
    def test_unchanged_second_run_skips(self):
        self.assertEqual(self._run(), 0)
        self.assertTrue(self._pdf().exists())
        self.assertEqual(len(self.render_calls), 1)

        self.assertEqual(self._run(), 0)
        self.assertEqual(len(self.render_calls), 1, "second run must NOT re-render")
        self.assertEqual(self._vn(), [], "no .vN may be created on a skip")

    # 2. Changing an input -> re-render in place, no .vN
    def test_changed_input_rerenders_in_place(self):
        self._run()
        t = json.loads((self.vi / "tokens.json").read_text())
        t["colors"]["accent"] = "#00ff00"
        (self.vi / "tokens.json").write_text(json.dumps(t), encoding="utf-8")

        self.assertEqual(self._run(), 0)
        self.assertEqual(len(self.render_calls), 2, "changed input must re-render")
        self.assertTrue(self._pdf().exists())
        self.assertEqual(self._vn(), [], "in-place overwrite leaves no .vN")

    # 3. --force re-renders even when hash matches
    def test_force_rerenders(self):
        self._run()
        self.assertEqual(self._run("--force"), 0)
        self.assertEqual(len(self.render_calls), 2)
        self.assertEqual(self._vn(), [])

    # 4. .vN only with opt-in --backup
    def test_backup_opt_in_creates_vn(self):
        self._run()
        # force so it actually re-renders; --backup archives the prior
        self.assertEqual(self._run("--force", "--backup"), 0)
        self.assertEqual(len(self._vn()), 1, "--backup archives the prior PDF")
        self.assertTrue(self._pdf().exists())

    def test_no_vn_without_backup_flag(self):
        # several forced re-renders, no --backup => never any .vN
        self._run()
        self._run("--force")
        self._run("--force")
        self.assertEqual(self._vn(), [])

    # 5. legacy migration preserved
    def test_legacy_migration_one_time(self):
        (self.vi / "visual-identity.pdf").write_bytes(b"%PDF legacy")
        self.assertEqual(self._run(), 0)
        self.assertTrue(self._pdf().exists())
        self.assertFalse((self.vi / "visual-identity.pdf").exists(), "legacy renamed away")
        self.assertEqual(self._vn(), [], "migration is a rename, not a .vN backup")

    def test_legacy_not_clobbering_existing(self):
        # if brand-book.pdf already exists, legacy is left untouched (no clobber)
        self._run()
        (self.vi / "visual-identity.pdf").write_bytes(b"%PDF legacy")
        self._run()  # unchanged -> skip, migration must not fire
        self.assertTrue((self.vi / "visual-identity.pdf").exists())

    def test_sidecar_written(self):
        self._run()
        self.assertTrue((self.vi / g.HASH_SIDECAR).is_file())


if __name__ == "__main__":
    unittest.main(verbosity=2)
