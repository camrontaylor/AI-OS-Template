#!/usr/bin/env python3
"""Public CLI checks in disposable repositories; no network or private context."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('workspace-git.py')
ROOT = SCRIPT.parent.parent


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name) / 'AI OS'
        self.repo.mkdir()
        self.env = {**os.environ, 'AI_OS_TEAM_CONFIG_DIR': str(Path(self.temp.name) / 'team'),
                    'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'}
        for key in ('TEAM_OS_MEMORY_MODE', 'AI_OS_WORK_MODE', 'AI_OS_TEAM_ENRICHMENT', 'AI_OS_CONTEXT_OVERLAY_DIR',
                    'AI_OS_MODE', 'AI_OS_HOSTED_MODE', 'TEAM_OS_HOSTED_MODE', 'AI_OS_AUTONOMOUS'):
            self.env.pop(key, None)
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.com')
        self.write('.gitignore', '.command-centre/\n.worktrees/\n.env\n.memsearch/\n')
        self.write('file.txt', 'base\n')
        self.write('context/MEMORY.md', 'Tracked scaffold\n')
        self.git('add', '.')
        self.git('commit', '-m', 'base')
        self.head = self.git('rev-parse', 'HEAD')

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args, repo=None, check=True):
        r = subprocess.run(['git', '-C', str(repo or self.repo), *args], env=self.env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)
        return r.stdout.decode().strip()

    def write(self, name, text, repo=None):
        path = (repo or self.repo) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def cli(self, command, target=None, cwd=None, success=True):
        r = subprocess.run([sys.executable, str(SCRIPT), command, *([str(target)] if target else []),
                            '--cwd', str(cwd or self.repo)], env=self.env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if success:
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        else:
            self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        return r

    def worktree(self, name='example'):
        self.cli('new', name)
        return self.repo / '.worktrees' / name

    def test_main_autosave_preserves_main_and_returns_with_recovery_intact(self):
        self.write('file.txt', 'changed\n')
        self.cli('save')
        recovery = self.git('branch', '--show-current')
        self.assertTrue(recovery.startswith('autosave-recovery/'))
        self.assertEqual(self.git('rev-parse', 'main'), self.head)
        self.assertEqual(self.git('show', recovery + ':file.txt'), 'changed')
        self.assertFalse(self.git('status', '--porcelain'))
        self.cli('return-main')
        self.assertEqual(self.git('branch', '--show-current'), 'main')
        self.assertEqual(self.git('show', recovery + ':file.txt'), 'changed')

    def test_dev_and_feature_saves_stay_on_their_branch_without_push(self):
        backup = Path(self.temp.name) / 'remote.git'
        subprocess.run(['git', 'init', '--bare', str(backup)], check=True, capture_output=True)
        self.git('remote', 'add', 'origin', str(backup))
        for name in ('dev', 'feature/test'):
            self.git('switch', '-c', name)
            self.write('file.txt', name + '\n')
            self.cli('save')
            self.assertEqual(self.git('branch', '--show-current'), name)
            self.assertEqual(self.git('show', 'HEAD:file.txt'), name)
        self.assertFalse(self.git('show-ref', repo=backup, check=False))

    def test_secret_hold_keeps_files_and_index_and_does_not_switch(self):
        secret = 'gh' + 'p_' + 'a' * 40
        self.write('secret.txt', secret)
        r = self.cli('save', success=False)
        self.assertNotIn(secret, r.stdout + r.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.head)
        self.assertEqual(self.git('branch', '--show-current'), 'main')
        self.assertIn('secret.txt', self.git('diff', '--cached', '--name-only'))
        self.assertEqual((self.repo / 'secret.txt').read_text(), secret)

    def test_large_payload_hold_retains_staged_work(self):
        self.write('large.txt', 'a' * (5 * 1024 * 1024 + 1))
        self.cli('save', success=False)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.head)
        self.assertIn('large.txt', self.git('diff', '--cached', '--name-only'))

    def test_deleted_secret_is_held_before_automatic_history_backup(self):
        p = self.write('secret.txt', 'api_key=' + 'x' * 8 + '1' + 'z' * 20)
        self.git('add', '.')
        self.git('commit', '-m', 'unsafe fixture')
        old = self.git('rev-parse', 'HEAD')
        p.unlink()
        self.cli('save', success=False)
        self.assertEqual(self.git('rev-parse', 'HEAD'), old)

    def test_absolute_symlink_is_held(self):
        (self.repo / 'bad-link').symlink_to(Path(self.temp.name))
        self.cli('save', success=False)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.head)

    def test_mid_operation_and_detached_checkouts_remain_untouched(self):
        self.write('file.txt', 'unfinished\n')
        marker = self.repo / '.git/MERGE_HEAD'
        marker.write_text(self.head)
        self.cli('save', success=False)
        self.cli('return-main', success=False)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.head)
        marker.unlink()
        self.git('checkout', '--detach')
        self.cli('save', success=False)
        self.assertEqual((self.repo / 'file.txt').read_text(), 'unfinished\n')

    def test_dirty_ancestor_returns_main_with_changes(self):
        self.git('switch', '-c', 'parked')
        self.write('file.txt', 'unsaved\n')
        self.cli('return-main')
        self.assertEqual(self.git('branch', '--show-current'), 'main')
        self.assertEqual((self.repo / 'file.txt').read_text(), 'unsaved\n')

    def test_unique_or_dirty_recovery_work_is_never_hidden(self):
        self.write('file.txt', 'saved\n')
        self.cli('save')
        recovery = self.git('branch', '--show-current')
        self.write('file.txt', 'more edits\n')
        self.cli('return-main')
        self.assertEqual(self.git('branch', '--show-current'), recovery)
        self.git('switch', '-c', 'feature/unique')
        self.cli('save')
        self.cli('return-main')
        self.assertEqual(self.git('branch', '--show-current'), 'feature/unique')

    def test_new_uses_dev_and_links_only_ignored_state_preserving_real_files(self):
        self.git('branch', 'dev')
        self.git('switch', 'dev')
        self.write('dev-only.txt', 'dev\n')
        self.git('add', '.')
        self.git('commit', '-m', 'dev')
        source = self.write('.env', 'local-only')
        wt = self.worktree()
        self.assertTrue((wt / 'dev-only.txt').exists())
        self.assertTrue((wt / '.env').is_symlink())
        self.assertEqual((wt / '.env').resolve(), source)
        self.assertFalse((wt / 'context/MEMORY.md').is_symlink())
        (wt / '.env').unlink()
        self.write('.env', 'worktree-owned', repo=wt)
        self.cli('link', cwd=wt)
        self.assertEqual((wt / '.env').read_text(), 'worktree-owned')
        self.assertEqual(source.read_text(), 'local-only')

    def test_tracked_memory_context_resolves_primary_and_same_client_only(self):
        wt = self.worktree()
        self.write('context/MEMORY.md', 'Current primary memory\n')
        result = json.loads(self.cli('context', cwd=wt).stdout)
        self.assertEqual(result['scope'], str(self.repo))
        self.assertEqual((Path(result['scope']) / 'context/MEMORY.md').read_text(), 'Current primary memory\n')
        client = wt / 'clients/example'
        client.mkdir(parents=True)
        self.write('clients/example/context/MEMORY.md', 'Client memory\n')
        result = json.loads(self.cli('context', cwd=client).stdout)
        self.assertEqual(result['scope'], str(self.repo / 'clients/example'))
        self.cli('save', cwd=client, success=False)
        self.cli('new', 'other', cwd=client, success=False)

    def test_base_commands_leave_worktree_branch_untouched(self):
        wt = self.worktree()
        self.write('file.txt', 'worktree edits\n', repo=wt)
        self.cli('save', cwd=wt)
        self.cli('return-main', cwd=wt)
        self.assertEqual(self.git('branch', '--show-current', repo=wt), 'work/example')
        self.assertEqual(self.git('rev-parse', 'HEAD', repo=wt), self.head)

    def test_cleanup_saves_archives_and_preserves_primary_memory(self):
        self.write('.env', 'private')
        wt = self.worktree()
        self.write('file.txt', 'keep this work\n', repo=wt)
        self.cli('done', 'example')
        self.assertFalse(wt.exists())
        tags = self.git('tag', '-l', 'archive/work/example-*').splitlines()
        self.assertEqual(len(tags), 1)
        self.assertEqual(self.git('show', tags[0] + ':file.txt'), 'keep this work')
        self.assertEqual((self.repo / '.env').read_text(), 'private')
        self.assertFalse(self.git('branch', '--list', 'work/example'))

    def test_failed_save_blocks_cleanup_and_keeps_branch_and_files(self):
        wt = self.worktree()
        self.write('secret.txt', 'gh' + 'p_' + 'b' * 40, repo=wt)
        self.cli('done', 'example', success=False)
        self.assertTrue(wt.exists())
        self.assertTrue(self.git('branch', '--list', 'work/example'))
        self.assertTrue((wt / 'secret.txt').exists())
        self.assertFalse(self.git('tag', '-l', 'archive/*'))

    def test_cleanup_preserves_real_ignored_worktree_files(self):
        wt = self.worktree()
        self.write('.env', 'unique-local-file', repo=wt)
        self.cli('done', 'example', success=False)
        self.assertTrue(wt.exists())
        self.assertEqual((wt / '.env').read_text(), 'unique-local-file')

    def test_foreign_worktrees_and_primary_cannot_be_removed(self):
        self.cli('done', self.repo, success=False)
        self.cli('done', Path(self.temp.name), success=False)
        self.assertTrue(self.repo.exists())

    def test_invalid_names_do_not_create_branches_or_folders(self):
        for name in ('../escape', '/absolute', 'bad name', '--option'):
            self.cli('new', name, success=False)
        self.assertFalse(self.git('branch', '--list', 'work/*'))

    def test_team_hosted_and_corrupt_login_block_before_state_writes(self):
        self.write('file.txt', 'unsaved\n')
        for key, value in (('AI_OS_WORK_MODE', 'team'), ('AI_OS_HOSTED_MODE', '1'), ('AI_OS_MODE', 'hosted')):
            self.env[key] = value
            self.cli('save', success=False)
            self.cli('context', success=False)
            self.assertFalse((self.repo / '.command-centre').exists())
            self.env.pop(key)
        login = Path(self.env['AI_OS_TEAM_CONFIG_DIR']) / 'team-context.json'
        login.parent.mkdir()
        for content in ('broken', '{"token":"expired","apiUrl":"https://example.com"}'):
            login.write_text(content)
            self.cli('start', success=False)
            self.assertFalse((self.repo / '.command-centre').exists())

    def test_live_lock_is_never_reclaimed(self):
        self.write('.command-centre/workspace-git.lock/pid', 'legacy unknown owner')
        self.write('file.txt', 'unsaved\n')
        self.cli('save', success=False)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.head)
        self.assertTrue((self.repo / '.command-centre/workspace-git.lock').exists())

    def test_backup_rejects_template_public_or_unverified_remote_and_defaults_off(self):
        self.git('remote', 'add', 'template', 'https://github.com/camrontaylor/AI-OS-Template.git')
        self.cli('enable-backup', 'template', success=False)
        self.git('remote', 'add', 'local', str(Path(self.temp.name) / 'backup.git'))
        self.cli('enable-backup', 'local', success=False)
        self.assertFalse((self.repo / '.command-centre/workspace-backup.json').exists())
        self.cli('disable-backup')

    def test_multi_push_remote_is_rejected_before_authentication(self):
        self.git('remote', 'add', 'backup', 'https://github.com/example/private.git')
        self.git('remote', 'set-url', '--add', '--push', 'backup', 'https://github.com/example/private.git')
        self.git('remote', 'set-url', '--add', '--push', 'backup', 'https://github.com/example/public.git')
        result = self.cli('enable-backup', 'backup', success=False)
        self.assertIn('exactly one push destination', result.stderr)
        self.assertFalse((self.repo / '.command-centre/workspace-backup.json').exists())

    def test_symlinked_client_does_not_select_a_sibling(self):
        wt = self.worktree()
        self.write('clients/beta/AGENTS.md', '# Beta', repo=wt)
        self.write('clients/beta/AGENTS.md', '# Beta')
        (wt / 'clients/alpha').symlink_to('beta', target_is_directory=True)
        self.cli('context', cwd=wt / 'clients/alpha', success=False)
        self.cli('start', cwd=wt / 'clients/alpha', success=False)
        self.assertFalse((self.repo / 'clients/alpha').exists())

    def test_unreadable_team_login_stops_local_snapshot_adapter(self):
        self.write('AGENTS.md', '# Fixture')
        self.write('CLAUDE.md', '@AGENTS.md')
        (self.repo / '.claude').mkdir(exist_ok=True)
        self.write('context/USER.md', 'PRIVATE USER MARKER')
        login = Path(self.env['AI_OS_TEAM_CONFIG_DIR']) / 'team-context.json'
        login.parent.mkdir()
        for content in ('invalid json', '{"token":"expired","apiUrl":"https://example.com"}'):
            login.write_text(content)
            result = subprocess.run(['node', str(ROOT / '.claude/hooks/load-memory-snapshot.js')],
                                    input=json.dumps({'cwd': str(self.repo)}), text=True,
                                    env=self.env, capture_output=True)
            self.assertNotIn('PRIVATE USER MARKER', result.stdout + result.stderr)
            self.assertEqual(result.returncode, 0)

    def test_snapshot_adapter_uses_current_primary_memory_in_worktree(self):
        self.write('AGENTS.md', '# Fixture')
        self.write('CLAUDE.md', '@AGENTS.md')
        self.write('.claude/placeholder', 'fixture')
        self.git('add', '.')
        self.git('commit', '-m', 'root markers')
        wt = self.worktree()
        self.write('context/USER.md', 'CURRENT PRIMARY PROFILE')
        result = subprocess.run(['node', str(ROOT / '.claude/hooks/load-memory-snapshot.js')],
                                input=json.dumps({'cwd': str(wt)}), text=True,
                                env=self.env, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn('CURRENT PRIMARY PROFILE', result.stdout)
        self.assertFalse((wt / 'context/USER.md').exists())

    def test_os_lock_serializes_saves_and_releases_when_owner_exits(self):
        # A real pre-commit hook holds the first saver while the second CLI runs.
        ready, release = self.repo / '.git/ready', self.repo / '.git/release'
        hook = self.repo / '.git/hooks/pre-commit'
        hook.write_text('#!/bin/sh\ntouch .git/ready\nwhile [ ! -f .git/release ]; do sleep 0.05; done\n')
        hook.chmod(0o755)
        self.write('file.txt', 'first saved work\n')
        process = subprocess.Popen([sys.executable, str(SCRIPT), 'save', '--cwd', str(self.repo)],
                                   env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            import time
            deadline = time.monotonic() + 5
            while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(ready.exists())
            result = self.cli('save', success=False)
            self.assertIn('Another workspace operation', result.stderr)
            release.touch()
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, stdout + stderr)
            self.cli('save')
            self.assertEqual(self.git('show', 'HEAD:file.txt'), 'first saved work')
        finally:
            release.touch()
            if process.poll() is None:
                process.terminate()
                process.communicate(timeout=5)

    def test_downloaded_workspace_context_works_without_git_initialization(self):
        root = Path(self.temp.name) / 'Downloaded'
        self.write('AGENTS.md', '# Fixture', repo=root)
        self.write('.claude/skills/_catalog/catalog.json', '{}', repo=root)
        self.write('context/USER.md', 'Downloaded profile', repo=root)
        result = json.loads(self.cli('context', cwd=root).stdout)
        self.assertEqual(result['scope'], str(root))
        self.assertFalse(result['worktree'])
        self.assertFalse((root / '.command-centre').exists())

    def test_valid_team_capture_and_consolidation_keep_server_routes(self):
        self.write('command-centre/scripts/memory-capture.cjs', '// Fixture')
        self.write('command-centre/scripts/memory-consolidation-tick.cjs', '// Fixture')
        login = Path(self.env['AI_OS_TEAM_CONFIG_DIR']) / 'team-context.json'
        login.parent.mkdir()
        login.write_text('{"token":"fixture-token","apiUrl":"https://example.com"}')
        hooks = ROOT / '.claude/hooks'
        code = "const path = require('path'); const root = process.argv[1]; const cwd = process.argv[2]; "
        code += "const cap = require(path.join(root,'memory-capture.js')); "
        code += "const tick = require(path.join(root,'memory-consolidation-tick.js')); "
        code += "const input=JSON.stringify({cwd,session_id:'fixture',transcript_path:'fixture'}); "
        code += "console.log(JSON.stringify([Boolean(cap.buildCaptureSpawn(input)),Boolean(tick.buildTickSpawn(input))]));"
        result = subprocess.run(['node', '-e', code, str(hooks), str(self.repo)],
                                env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [True, True])
        self.assertFalse((self.repo / '.command-centre').exists())
        for expiry in ('2000-01-01T00:00:00Z', 'invalid-expiry'):
            login.write_text(json.dumps({'token':'fixture-token','apiUrl':'https://example.com','expiresAt':expiry}))
            result = subprocess.run(['node', '-e', code, str(hooks), str(self.repo)],
                                    env=self.env, text=True, capture_output=True)
            self.assertEqual(json.loads(result.stdout), [False, False])
        login.write_text('{"token":"fixture-token","apiUrl":"https://example.com"}')
        self.env['TEAM_OS_MEMORY_MODE'] = 'local'
        result = subprocess.run(['node', '-e', code, str(hooks), str(self.repo)],
                                env=self.env, text=True, capture_output=True)
        self.assertEqual(json.loads(result.stdout), [False, False])

    def test_verified_private_backup_pushes_only_autosave_ref_with_follow_tags_enabled(self):
        # Fake only the external credential/API/destination transport. Real Git
        # still receives the production push arguments and checks the refspec.
        import shutil
        remote = Path(self.temp.name) / 'private-backup.git'
        subprocess.run(['git', 'init', '--bare', str(remote)], check=True, capture_output=True)
        url = 'https://github.com/example/private-backup.git'
        self.git('remote', 'add', 'backup', url)
        self.git('config', 'push.followTags', 'true')
        self.git('tag', '-a', 'archive/example', '-m', 'must stay local')
        shim = Path(self.temp.name) / 'bin'
        shim.mkdir()
        code = '#!' + sys.executable + '\nimport os,sys\n'
        code += 'args=sys.argv[1:]\n'
        code += "if 'credential' in args and 'fill' in args:\n print('username=fixture\\npassword=fixture-token\\n'); sys.exit(0)\n"
        code += 'args=[' + repr(str(remote)) + ' if x in (' + repr(url) + ', "backup") and "push" in args else x for x in args]\n'
        code += 'os.execv(' + repr(shutil.which('git')) + ', ["git",*args])\n'
        (shim / 'git').write_text(code)
        (shim / 'git').chmod(0o755)
        env = {**self.env, 'PATH': str(shim) + os.pathsep + self.env['PATH']}
        driver = Path(self.temp.name) / 'backup-fixture.py'
        code = "import importlib.util,io,json,sys,urllib.request\n"
        code += 'spec=importlib.util.spec_from_file_location("workspace",' + repr(str(SCRIPT)) + ')\n'
        code += 'module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)\n'
        code += "urllib.request.urlopen=lambda request,timeout: io.BytesIO(json.dumps({'private':True,'full_name':'example/private-backup'}).encode())\n"
        code += 'sys.argv=["workspace-git.py",*sys.argv[1:]]; sys.exit(module.main())\n'
        driver.write_text(code)
        for command in (['enable-backup','backup'], ['backup']):
            result = subprocess.run([sys.executable, str(driver), *command, '--cwd', str(self.repo)],
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.git('for-each-ref','--format=%(refname)',repo=remote), 'refs/heads/autosave/main')
        self.assertEqual(self.git('rev-parse','refs/heads/autosave/main',repo=remote), self.head)
        self.assertEqual(self.git('rev-parse','main'), self.head)
        self.cli('disable-backup')
        self.assertFalse((self.repo / '.command-centre/workspace-backup.json').exists())

    def test_shell_and_claude_adapters_use_same_safe_flow(self):
        self.write('file.txt', 'hook-saved\n')
        r = subprocess.run(['node', str(ROOT / '.claude/hooks/workspace-lifecycle.js'), 'end'],
                           input=json.dumps({'cwd': str(self.repo)}), text=True,
                           env=self.env, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.git('show', 'HEAD:file.txt'), 'hook-saved')
        self.assertEqual(self.git('rev-parse', 'main'), self.head)
        r = subprocess.run(['bash', str(ROOT / 'scripts/base-return-to-main.sh'), '--cwd', str(self.repo)],
                           text=True, env=self.env, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.git('branch', '--show-current'), 'main')


if __name__ == '__main__':
    unittest.main()
