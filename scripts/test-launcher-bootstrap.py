#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parent / "launcher-bootstrap.py"


class LauncherBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)

        (self.repo_root / ".claude" / "skills" / "_catalog").mkdir(parents=True, exist_ok=True)
        (self.repo_root / ".claude" / "skills" / "meta-skill-creator").mkdir(parents=True, exist_ok=True)
        (self.repo_root / ".claude" / "skills" / "mkt-brand-voice").mkdir(parents=True, exist_ok=True)
        (self.repo_root / "context").mkdir(parents=True, exist_ok=True)

        catalog = {
            "version": "1.0.0",
            "core_skills": ["meta-skill-creator"],
            "skills": {
                "mkt-brand-voice": {},
                "tool-humanizer": {},
            },
        }
        (self.repo_root / ".claude" / "skills" / "_catalog" / "catalog.json").write_text(
            json.dumps(catalog, indent=2) + "\n",
            encoding="utf-8",
        )
        (self.repo_root / ".env.example").write_text("OPENAI_API_KEY=\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_helper(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--repo-root", str(self.repo_root), *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def run_helper_json(self, *args: str) -> dict:
        result = self.run_helper(*args)
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        return json.loads(result.stdout)

    def test_bootstrap_repair_creates_missing_files(self) -> None:
        result = self.run_helper_json("bootstrap-repair")
        self.assertTrue(result["bootstrap_valid"])
        self.assertIn("env", result["created"])
        self.assertIn("context_user", result["created"])
        self.assertIn("context_learnings", result["created"])
        self.assertIn("installed_json", result["created"])
        self.assertTrue((self.repo_root / ".env").is_file())
        self.assertTrue((self.repo_root / "context" / "USER.md").is_file())
        self.assertTrue((self.repo_root / "context" / "learnings.md").is_file())
        self.assertTrue((self.repo_root / ".claude" / "skills" / "_catalog" / "installed.json").is_file())

    def test_state_status_detects_legacy_install_after_bootstrap_repair(self) -> None:
        self.run_helper_json("bootstrap-repair")
        state = self.run_helper_json("state-status")
        self.assertFalse(state["state_exists"])
        self.assertTrue(state["legacy_install_detected"])
        self.assertTrue(state["guided_install_completed"])
        self.assertEqual(state["decisions"]["github_backup"], "legacy-unknown")

    def test_state_migrate_legacy_writes_state_file(self) -> None:
        self.run_helper_json("bootstrap-repair")
        migrated = self.run_helper_json("state-migrate-legacy")
        self.assertTrue(migrated["state_exists"])
        self.assertFalse(migrated["legacy_install_detected"])
        self.assertTrue((self.repo_root / ".command-centre" / "launcher-state.json").is_file())

    def test_state_mark_guided_records_one_time_decisions(self) -> None:
        self.run_helper_json("bootstrap-repair")
        guided = self.run_helper_json(
            "state-mark-guided",
            "--github",
            "configured",
            "--gsd",
            "installed",
            "--launcher",
            "skipped",
            "--memory",
            "configured",
            "--bootstrap-valid",
            "true",
        )
        self.assertTrue(guided["guided_install_completed"])
        self.assertTrue(guided["state_exists"])
        self.assertEqual(guided["decisions"]["github_backup"], "configured")
        self.assertEqual(guided["decisions"]["gsd_install"], "installed")
        self.assertEqual(guided["decisions"]["launcher_alias"], "skipped")
        self.assertEqual(guided["decisions"]["memory_setup"], "configured")

    def test_state_mark_repair_updates_repair_timestamp(self) -> None:
        self.run_helper_json("bootstrap-repair")
        repaired = self.run_helper_json("state-mark-repair", "--bootstrap-valid", "true")
        self.assertTrue(repaired["state_exists"])
        self.assertTrue(repaired["bootstrap_valid"])
        self.assertIsNotNone(repaired["bootstrap_last_repaired_at"])


if __name__ == "__main__":
    unittest.main()
