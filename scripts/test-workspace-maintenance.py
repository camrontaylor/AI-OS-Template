#!/usr/bin/env python3
"""Check the maintenance CLI on isolated Solo and Team fixtures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('workspace-maintenance.py')


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'workspace'
        self.root.mkdir()
        self.env = {**os.environ, 'AI_OS_TEAM_CONFIG_DIR': str(self.root / 'team-config')}
        for key in ('AI_OS_WORK_MODE', 'AI_OS_TEAM_ENRICHMENT', 'AI_OS_CONTEXT_OVERLAY_DIR',
                    'AI_OS_HOSTED_MODE', 'TEAM_OS_HOSTED_MODE', 'AI_OS_MODE'):
            self.env.pop(key, None)
        self.write('AGENTS.md', '# Shared rules\n')
        self.write('.claude/skills/_catalog/catalog.json', '{"skills": {"mkt-copywriting": {}}}')
        self.write('.claude/skills/mkt-copywriting/SKILL.md', '---\nname: mkt-copywriting\n---\n')
        self.write('context/MEMORY.md', '# Memory\n')
        self.write('context/learnings.md', '# Learnings\n\n## general\n\n## mkt-copywriting\n')

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        return path

    def run_cli(self, command, *args, scope=None):
        return subprocess.run([sys.executable, str(SCRIPT), command, '--scope', str(scope or self.root), *args],
                              env=self.env, capture_output=True, text=True)

    def test_corrections_promote_once_without_changing_the_source(self):
        source = self.write('context/memory/2026-10-01.md',
                            '# Day\n## Session 1\n### Corrections\n'
                            '- [mkt-copywriting] Use the agreed offer.\n'
                            '### Decisions\n- A new plan is not a correction.\n')
        original = source.read_bytes()
        result = self.run_cli('corrections', '--date', '2026-10-01')
        self.assertEqual(result.returncode, 0, result.stderr)
        learned = self.root / 'context/learnings.md'
        self.assertIn('- 2026-10-01: Use the agreed offer.', learned.read_text())
        self.assertNotIn('A new plan', learned.read_text())
        stamp = learned.stat().st_mtime_ns
        self.assertEqual(self.run_cli('corrections', '--date', '2026-10-01').returncode, 0)
        self.assertEqual(learned.stat().st_mtime_ns, stamp)
        self.assertEqual(source.read_bytes(), original)

    def test_check_reports_missing_lessons_without_writing(self):
        self.write('context/memory/2026-10-01.md', '### Corrections\n- [general] Check the live result.\n')
        learned = self.root / 'context/learnings.md'
        original = learned.read_bytes()
        result = self.run_cli('corrections', '--date', '2026-10-01', '--check')
        self.assertEqual(result.returncode, 1)
        self.assertIn('1 awaiting promotion', result.stdout)
        self.assertEqual(learned.read_bytes(), original)
        self.assertEqual(self.run_cli('corrections', '--date', '2026-10-01').returncode, 0)
        self.write('context/memory/2026-10-02.md', '### Corrections\n- [general] Check the live result.\n')
        self.assertEqual(self.run_cli('corrections', '--date', '2026-10-02', '--check').returncode, 0)

    def test_client_corrections_stay_client_local(self):
        client = self.root / 'clients/one'
        self.write('clients/one/AGENTS.md', '# Client\n')
        self.write('clients/one/context/memory/2026-10-01.md',
                   '### Corrections\n- [general] Keep this client lesson here.\n')
        self.write('clients/two/AGENTS.md', '# Other client\n')
        other = self.write('clients/two/context/learnings.md', 'Other client\n')
        root_learnings = (self.root / 'context/learnings.md').read_bytes()
        result = self.run_cli('corrections', '--date', '2026-10-01', scope=client)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('Keep this client lesson here.', (client / 'context/learnings.md').read_text())
        self.assertEqual((self.root / 'context/learnings.md').read_bytes(), root_learnings)
        self.assertEqual(other.read_text(), 'Other client\n')

    def test_bad_corrections_are_rejected_before_any_promotion(self):
        original = (self.root / 'context/learnings.md').read_bytes()
        for bad in ('- no target', '- [missing-skill] Unknown routing.',
                    '- [general] https://user' + ':password@example.invalid/path'):
            with self.subTest(bad=bad):
                self.write('context/memory/2026-10-01.md',
                           '### Corrections\n- [general] A valid first entry.\n' + bad + '\n')
                result = self.run_cli('corrections', '--date', '2026-10-01')
                self.assertEqual(result.returncode, 2)
                self.assertNotIn('password', result.stdout + result.stderr)
                self.assertEqual((self.root / 'context/learnings.md').read_bytes(), original)

    def test_team_modes_block_all_commands_before_context_access(self):
        config = self.root / 'team-config/team-context.json'
        for mode in ('saved', 'expired', 'corrupt', 'env', 'overlay', 'conversation_only'):
            with self.subTest(mode=mode):
                config.unlink(missing_ok=True)
                for key in ('AI_OS_WORK_MODE', 'AI_OS_CONTEXT_OVERLAY_DIR', 'AI_OS_TEAM_ENRICHMENT'):
                    self.env.pop(key, None)
                if mode in ('saved', 'expired', 'corrupt'):
                    self.write('team-config/team-context.json', 'invalid' if mode == 'corrupt' else
                               json.dumps({'apiUrl': 'https://example.invalid', 'token': 'private-login-value',
                                           'expiresAt': '2000-01-01'}))
                else:
                    key = {'env': 'AI_OS_WORK_MODE', 'overlay': 'AI_OS_CONTEXT_OVERLAY_DIR',
                           'conversation_only': 'AI_OS_TEAM_ENRICHMENT'}[mode]
                    self.env[key] = {'env': 'team', 'overlay': str(self.root),
                                     'conversation_only': 'conversation_only'}[mode]
                for command in ('corrections', 'brief', 'health'):
                    original = {p: p.read_bytes() for p in (self.root / 'context').rglob('*') if p.is_file()}
                    result = self.run_cli(command, '--date', '2026-10-01')
                    self.assertEqual(result.returncode, 2, result.stdout)
                    self.assertNotIn('private-login-value', result.stdout + result.stderr)
                    self.assertEqual({p: p.read_bytes() for p in (self.root / 'context').rglob('*') if p.is_file()}, original)

    def test_context_symlink_cannot_cross_scopes(self):
        sibling = self.write('clients/two/private.md', 'Private sibling content\n')
        (self.root / 'context/MEMORY.md').unlink()
        (self.root / 'context/MEMORY.md').symlink_to(sibling)
        for command in ('brief', 'health'):
            result = self.run_cli(command)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn('Private sibling content', result.stdout)
        self.assertFalse((self.root / 'context/current-state.md').exists())

    def test_brief_links_to_local_sources_and_is_idempotent(self):
        client = self.root / 'clients/one'
        self.write('clients/one/AGENTS.md', '# Client\n')
        self.write('clients/one/context/MEMORY.md', 'Client memory\n')
        self.write('clients/one/context/memory/2026-10-01.md',
                   '## Session 1\n### Goal\nFinish the agreed brief.\n### Decisions\n- Keep the small scope.\n'
                   '### Open threads\n- Check source facts.\n')
        self.write('clients/two/context/MEMORY.md', 'Sibling secret\n')
        self.write('context/memory/2026-10-01.md', 'Root-only goal\n')
        result = self.run_cli('brief', scope=client)
        self.assertEqual(result.returncode, 0, result.stdout)
        path = client / 'context/current-state.md'
        body = path.read_text()
        self.assertIn('Finish the agreed brief.', body)
        self.assertIn('(memory/2026-10-01.md)', body)
        self.assertIn('Keep the small scope.', body)
        self.assertNotIn('Sibling secret', body)
        self.assertNotIn('Root-only goal', body)
        self.assertNotIn('[current-state.md]', body)
        stamp = path.stat().st_mtime_ns
        self.assertEqual(self.run_cli('brief', scope=client).returncode, 0)
        self.assertEqual(path.stat().st_mtime_ns, stamp)

    def test_health_is_read_only_and_reports_unverified_services(self):
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', '-C', str(self.root), 'config', 'remote.backup.url',
                        'https://example.invalid/private.git'], check=True)
        links = self.root / '.agents/skills'
        links.mkdir(parents=True)
        (links / 'mkt-copywriting').symlink_to('../../.claude/skills/mkt-copywriting', target_is_directory=True)
        self.write('.env', 'LOCAL_SECRET=do-not-print-this-value\n')
        self.write('cron/jobs/example.md', "---\nactive: 'false'\n---\nPaused\n")
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}
        result = self.run_cli('health', '--date', '2026-10-01')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('Recall quality is untested', result.stdout)
        self.assertIn('freshness and privacy need a live check', result.stdout)
        self.assertNotIn('do-not-print', result.stdout + result.stderr)
        self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}, before)

    def test_health_flags_missing_discovery_and_active_jobs(self):
        self.write('cron/jobs/example.md', "---\nactive: 'true'\n---\nExample\n")
        self.write('context/MEMORY.md', 'x' * 2501)
        result = self.run_cli('health')
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn('discovery needs repair', result.stdout)
        self.assertIn('1 active jobs', result.stdout)
        self.assertIn('2501', result.stdout)
        self.assertIn('NEEDS ATTENTION', result.stdout)

    def test_invalid_date_does_not_escape_memory_folder(self):
        result = self.run_cli('corrections', '--date', '../learnings')
        self.assertEqual(result.returncode, 2)

    def test_client_parent_symlink_cannot_escape_root(self):
        outside = Path(self.temp.name) / 'outside'
        (outside / 'one/context').mkdir(parents=True)
        (outside / 'one/AGENTS.md').write_text('# Client\n')
        (outside / 'one/context/MEMORY.md').write_text('Outside private state\n')
        (self.root / 'clients').symlink_to(outside, target_is_directory=True)
        for command in ('corrections', 'brief', 'health'):
            result = self.run_cli(command, scope=self.root / 'clients/one')
            self.assertEqual(result.returncode, 2, result.stdout)
            self.assertNotIn('Outside private state', result.stdout)
        self.assertFalse((outside / 'one/context/current-state.md').exists())

    def test_brief_preserves_existing_user_owned_file(self):
        path = self.write('context/current-state.md', '# My current notes\nKeep my decisions.\n')
        original = path.read_bytes()
        result = self.run_cli('brief')
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertEqual(path.read_bytes(), original)

    def test_hosted_modes_block_local_commands(self):
        for key, value in (('AI_OS_HOSTED_MODE', 'true'), ('TEAM_OS_HOSTED_MODE', 'true'),
                           ('AI_OS_MODE', 'hosted')):
            self.env[key] = value
            for command in ('corrections', 'brief', 'health'):
                result = self.run_cli(command)
                self.assertEqual(result.returncode, 2, result.stdout)
            self.env.pop(key)
        self.assertFalse((self.root / 'context/current-state.md').exists())

    def test_root_brief_rejects_symlinked_client_log(self):
        sibling = self.write('clients/two/context/memory/2026-10-01.md',
                             '### Goal\nPrivate client goal\n')
        source = self.root / 'context/memory/2026-10-01.md'
        source.parent.mkdir(parents=True)
        source.symlink_to(sibling)
        result = self.run_cli('brief')
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertFalse((self.root / 'context/current-state.md').exists())


if __name__ == '__main__':
    unittest.main()
