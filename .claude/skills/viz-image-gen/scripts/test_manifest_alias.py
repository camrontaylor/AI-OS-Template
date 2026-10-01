"""
Tests for the manifest alias contract in render_template.resolve_pool_template
(AIOS-190 manifest seam).

The AI-first ssc-template-builder hand-writes each manifest entry in its NATIVE
schema — ``{slug, status, template_dir, template_html}`` — with NO ``id`` and NO
``file`` key. The renderer reads the canonical ``id``/``file`` schema, so without
the alias layer it fails the id match and KeyErrors on ``entry["file"]``. These
tests build a builder-native fixture and assert resolution works, plus prove the
rule is idempotent against a canonical fixture.

Run:
    uv run --with pillow python -m pytest test_manifest_alias.py
"""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

_HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("render_template", _HERE / "render_template.py")
RT = importlib.util.module_from_spec(spec)
spec.loader.exec_module(RT)

_POOL = "test-pool"
_TEMPLATE_IDS = ("cover-r01", "body-r02")
_TMPL_HTML = (
    "<!doctype html><html><head><meta charset='utf-8'></head>"
    "<body><div data-slot='HEADLINE'>{{{HEADLINE}}}</div></body></html>"
)


def _build_pool_dirs(root: Path) -> Path:
    """Create root/templates/test-pool/{_shared, cover-r01, body-r02} with real files."""
    pool_dir = root / "templates" / _POOL
    shared = pool_dir / "_shared"
    shared.mkdir(parents=True, exist_ok=True)
    (shared / "styles.css").write_text("body{margin:0}", encoding="utf-8")
    for tid in _TEMPLATE_IDS:
        tdir = pool_dir / tid
        (tdir / "assets").mkdir(parents=True, exist_ok=True)
        (tdir / "template.html").write_text(_TMPL_HTML, encoding="utf-8")
    return pool_dir


def _write_builder_native_manifest(pool_dir: Path) -> None:
    """ssc-template-builder Step 7 shape: slug/template_html/template_dir, NO id/file,
    brand_context-rooted paths (mirrors the live test-09-06 manifest)."""
    templates = []
    for tid in _TEMPLATE_IDS:
        base = f"brand_context/templates/{_POOL}/{tid}"
        templates.append({
            "slug": tid,
            "status": "ready",
            "template_dir": base,
            "template_html": f"{base}/template.html",
            "preview_png": f"{base}/preview.png",
        })
    (pool_dir / "manifest.json").write_text(
        json.dumps({"pool": _POOL, "templates": templates}, indent=2), encoding="utf-8")


def _write_canonical_manifest(pool_dir: Path) -> None:
    """Canonical id/file shape."""
    templates = [
        {"id": tid, "file": f"{tid}/template.html", "status": "ready"}
        for tid in _TEMPLATE_IDS
    ]
    (pool_dir / "manifest.json").write_text(
        json.dumps({"templates": templates}, indent=2), encoding="utf-8")


class BuilderNativeResolutionTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.root = Path(self.td.name)
        self.pool_dir = _build_pool_dirs(self.root)
        _write_builder_native_manifest(self.pool_dir)

    def tearDown(self):
        self.td.cleanup()

    def test_resolves_entry_by_slug_without_keyerror(self):
        """Match on slug (id alias) and resolve file without KeyError on entry['file']."""
        entry, html_path, prompt_path, _shared = RT.resolve_pool_template(
            _POOL, "cover-r01", brand_context=self.root)
        self.assertEqual(entry.get("slug"), "cover-r01")
        self.assertIsNone(prompt_path)
        self.assertIsNotNone(html_path)
        self.assertEqual(html_path, (self.pool_dir / "cover-r01" / "template.html").resolve())
        self.assertTrue(html_path.is_file())

    def test_each_template_resolves_to_its_own_file(self):
        for tid in _TEMPLATE_IDS:
            _entry, html_path, _p, _s = RT.resolve_pool_template(
                _POOL, tid, brand_context=self.root)
            self.assertEqual(html_path, (self.pool_dir / tid / "template.html").resolve())

    def test_unknown_id_error_lists_slugs(self):
        with self.assertRaises(SystemExit) as cm:
            RT.resolve_pool_template(_POOL, "does-not-exist", brand_context=self.root)
        # The available-ids list must surface the slug aliases (not blank/crash).
        self.assertIn("cover-r01", str(cm.exception))
        self.assertIn("body-r02", str(cm.exception))


class IdempotencyTests(unittest.TestCase):
    """Canonical and builder-native manifests over the same dirs must resolve to the
    same html_path for the same id."""

    def test_canonical_and_builder_native_resolve_identically(self):
        results = {}
        for kind, writer in (("canonical", _write_canonical_manifest),
                             ("builder", _write_builder_native_manifest)):
            with tempfile.TemporaryDirectory() as td:
                root = Path(td)
                pool_dir = _build_pool_dirs(root)
                writer(pool_dir)
                _e, html_path, _p, _s = RT.resolve_pool_template(
                    _POOL, "cover-r01", brand_context=root)
                # Compare pool-relative path (temp roots differ across the two runs).
                results[kind] = html_path.relative_to(pool_dir.resolve()).as_posix()
        self.assertEqual(results["canonical"], results["builder"])
        self.assertEqual(results["canonical"], "cover-r01/template.html")


if __name__ == "__main__":
    unittest.main()
