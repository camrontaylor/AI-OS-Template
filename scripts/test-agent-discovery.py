#!/usr/bin/env python3
"""Behavior checks for shared-source agent discovery; no API calls."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('discovery', Path(__file__).with_name('sync-agent-skills.py'))
discovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(discovery)


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'AI-OS'
        self.root.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def add(self, name, scope=None):
        file = (scope or self.root) / '.claude/skills' / name / 'SKILL.md'
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('---\nname: ' + name + '\ndescription: Fixture\n---\nOriginal method\n')
        return file

    def test_links_follow_edits_and_survive_folder_relocation(self):
        source = self.add('tool-example')
        discovery.synchronize(self.root)
        link = self.root / '.agents/skills/tool-example'
        self.assertFalse(os.path.isabs(os.readlink(link)))
        source.write_text('Updated methodology')
        self.assertEqual((link / 'SKILL.md').read_text(), 'Updated methodology')
        moved = self.root.with_name('Moved AI-OS')
        self.root.rename(moved)
        self.assertEqual((moved / '.agents/skills/tool-example/SKILL.md').read_text(), 'Updated methodology')

    def test_add_remove_refresh_and_idempotence(self):
        source = self.add('tool-one')
        first = discovery.synchronize(self.root)
        manifest = self.root / '.agents/ai-os-skill-links.json'
        stamp = manifest.stat().st_mtime_ns
        self.assertEqual(discovery.synchronize(self.root), first)
        self.assertEqual(stamp, manifest.stat().st_mtime_ns)
        self.add('tool-two')
        shutil.rmtree(source.parent)
        discovery.synchronize(self.root)
        self.assertFalse((self.root / '.agents/skills/tool-one').is_symlink())
        self.assertTrue((self.root / '.agents/skills/tool-two/SKILL.md').is_file())

    def test_preserves_user_owned_folders_and_modified_links(self):
        self.add('tool-user')
        owned = self.root / '.agents/skills/tool-user'
        owned.mkdir(parents=True)
        (owned / 'SKILL.md').write_text('User-owned')
        result = discovery.synchronize(self.root)
        self.assertEqual(result[0]['preserved_conflicts'], ['tool-user'])
        self.assertEqual((owned / 'SKILL.md').read_text(), 'User-owned')
        self.add('tool-link')
        discovery.synchronize(self.root)
        link = owned.with_name('tool-link')
        link.unlink()
        link.symlink_to('../tool-user', target_is_directory=True)
        shutil.rmtree(self.root / '.claude/skills/tool-link')
        discovery.synchronize(self.root)
        self.assertEqual(os.readlink(link), '../tool-user')

    def test_client_only_skills_do_not_leak_into_root_or_siblings(self):
        self.add('tool-shared')
        acme = self.root / 'clients/acme'
        beta = self.root / 'clients/beta'
        for scope in (acme, beta):
            scope.mkdir(parents=True)
            (scope / 'AGENTS.md').write_text('# Client')
        self.add('tool-private', acme)
        discovery.synchronize(self.root)
        self.assertTrue((acme / '.agents/skills/tool-private/SKILL.md').is_file())
        self.assertFalse((self.root / '.agents/skills/tool-private').exists())
        self.assertFalse((beta / '.agents/skills/tool-private').exists())
        self.assertTrue((self.root / '.agents/skills/tool-shared/SKILL.md').is_file())


if __name__ == '__main__':
    # The distribution CI gate also covers scoped maintenance and Git safety.
    for suite in ('test-workspace-maintenance.py', 'test-workspace-git.py'):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name(suite))])
        if result.returncode:
            raise SystemExit(result.returncode)
    unittest.main()
