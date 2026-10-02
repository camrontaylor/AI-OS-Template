#!/usr/bin/env python3
"""Portable Solo workspace saving and worktrees; protected refs stay PR-only."""
import argparse
from contextlib import contextmanager
from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
import uuid

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).with_name('workspace-maintenance.py'))
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)


class WorkspaceError(ValueError):
    pass


def git(repo, *args, data=None, check=True, timeout=15):
    try:
        return subprocess.run(['git', '-C', str(repo), *args], input=data,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'},
                              check=check, timeout=timeout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        # Git stderr can contain remote credentials. Keep it out of hook logs.
        raise WorkspaceError('Git operation failed or timed out; work is retained.') from None


def value(repo, *args):
    return os.fsdecode(git(repo, *args).stdout).strip()


def repository(cwd):
    top = Path(value(cwd, 'rev-parse', '--show-toplevel')).resolve()
    entries = git(top, 'worktree', 'list', '--porcelain', '-z').stdout.split(b'\0')
    roots = [Path(os.fsdecode(e[9:])).resolve() for e in entries if e.startswith(b'worktree ')]
    if not roots or top not in roots:
        raise WorkspaceError('Run in a registered Git worktree.')
    return top, roots[0], roots


def scope(cwd, top, primary):
    relative = Path(cwd).resolve().relative_to(top)
    parts = relative.parts
    if len(parts) >= 2 and parts[0] == 'clients':
        selected = primary / 'clients' / parts[1]
        if (not selected.resolve().is_relative_to(primary)
                or any(p.is_symlink() for p in (selected, *selected.parents)
                       if p != primary and p.is_relative_to(primary))):
            raise WorkspaceError('Client scope leaves this workspace.')
        return selected
    return primary


def state(primary):
    directory = primary / '.command-centre'
    if directory.is_symlink():
        raise WorkspaceError('Workspace state directory must be local to the primary checkout.')
    directory.mkdir(exist_ok=True)
    return directory


def note(primary, message):
    file = state(primary) / 'branch-state.log'
    if file.is_symlink():
        raise WorkspaceError('Workspace log must be a local file.')
    with file.open('a', encoding='utf-8') as output:
        output.write(f'[{datetime.now():%Y-%m-%d %H:%M}] {message}\n')
    print(message)


@contextmanager
def locked(primary):
    lock = state(primary) / 'workspace-git.lock'
    if lock.is_symlink() or lock.is_dir():
        raise WorkspaceError('Workspace lock needs review; no Git changes made.')
    # OS ownership is released on process exit; no age/PID reclamation race.
    with lock.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            if stream.seek(0, 2) == 0:
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise WorkspaceError('Another workspace operation is running; try again later.') from None
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise WorkspaceError('Another workspace operation is running; try again later.') from None
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def branch(repo):
    current = value(repo, 'symbolic-ref', '--quiet', '--short', 'HEAD')
    if not current:
        raise WorkspaceError('Detached checkout; save and branch explicitly.')
    directory = Path(value(repo, 'rev-parse', '--absolute-git-dir'))
    if any((directory / name).exists() for name in
           ('MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer')):
        raise WorkspaceError('Merge, rebase or cherry-pick in progress; finish it before workspace saving.')
    return current


SECRET = re.compile(
    rb'(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{30,}'
    rb'|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b'
    rb'|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
    rb'|https?://[^\s/<]+:[^\s/@]+@[^\s/]+'
    rb'|(?i:(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*["\']?[^\s"\']*[0-9][^\s"\']{7,})')


def staged_safe(repo):
    checker = Path(__file__).with_name('staged-size-check.py')
    result = subprocess.run([sys.executable, str(checker), str(repo)], stdout=subprocess.PIPE)
    if result.returncode:
        raise WorkspaceError('Autosave held for size review; staged files and disk edits are intact.')
    # Read both old and new blobs. Deleting a credential file does not remove it
    # from commit ancestry, so an automatic backup still needs manual review.
    rows = git(repo, 'diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z').stdout.split(b'\0')
    for index in range(0, len(rows) - 1, 2):
        metadata = rows[index].split()
        if len(metadata) != 5:
            raise WorkspaceError('Staged batch is unreadable; no commit made.')
        for mode, oid in ((metadata[0][1:], metadata[2]), (metadata[1], metadata[3])):
            if oid == b'0' * len(oid):
                continue
            if mode == b'160000':
                raise WorkspaceError('Autosave held for submodule review; staged files are intact.')
            payload = git(repo, 'cat-file', 'blob', os.fsdecode(oid)).stdout
            if SECRET.search(payload):
                raise WorkspaceError('Autosave held for possible credentials; redact and commit deliberately.')
            if mode == b'120000':
                target = os.fsdecode(payload)
                destination = repo / os.fsdecode(rows[index + 1])
                if os.path.isabs(target) or not (destination.parent / target).resolve().is_relative_to(repo):
                    raise WorkspaceError('Autosave held for an absolute or escaping link; no commit made.')


def save(repo, primary):
    current = branch(repo)
    if not git(repo, 'status', '--porcelain', '-z').stdout:
        print('No unsaved Git changes.')
        return
    git(repo, 'add', '-A')
    if git(repo, 'diff', '--cached', '--quiet', check=False).returncode == 0:
        print('No tracked changes to save.')
        return
    staged_safe(repo)
    if current == 'main':
        current = 'autosave-recovery/' + datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:8]
        git(repo, 'switch', '-c', current)
        note(primary, 'Work from main is being saved on recovery branch ' + current + '; main is unchanged.')
    git(repo, 'commit', '-m', f'chore: workspace autosave [{datetime.now():%Y-%m-%d %H:%M}]')
    note(primary, 'Saved work locally on ' + current + '.')
    backup(repo, primary, current)


def github_remote(repo, remote):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', remote):
        raise WorkspaceError('Choose a named Git remote.')
    urls = value(repo, 'remote', 'get-url', '--push', '--all', remote).splitlines()
    if len(urls) != 1:
        raise WorkspaceError('Choose a remote with exactly one push destination; no backup made.')
    url = urls[0]
    match = re.fullmatch(r'(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?', url)
    if not match:
        raise WorkspaceError('Automatic backup supports a verified private GitHub remote only.')
    owner, name = match.groups()
    if owner.lower() == 'camrontaylor' and name.lower().startswith('ai-os-template'):
        raise WorkspaceError('Automatic backup cannot target the maintainer template.')
    return url, owner + '/' + name


def private_remote(repo, remote):
    url, slug = github_remote(repo, remote)
    # Git credential helpers are optional; no token is written to config or logs.
    credential = git(repo, 'credential', 'fill', data=b'protocol=https\nhost=github.com\n\n', timeout=10).stdout
    fields = dict(line.split(b'=', 1) for line in credential.splitlines() if b'=' in line)
    token = fields.get(b'password', b'').decode()
    if not token:
        raise WorkspaceError('Private backup verification needs an existing GitHub credential helper.')
    request = urllib.request.Request('https://api.github.com/repos/' + slug,
                                    headers={'Authorization': 'Bearer ' + token,
                                             'Accept': 'application/vnd.github+json', 'User-Agent': 'AI-OS'})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.load(response)
    except Exception:
        raise WorkspaceError('Private backup verification unavailable; saved work stays local.') from None
    if data.get('private') is not True or data.get('full_name', '').lower() != slug.lower():
        raise WorkspaceError('Backup remote is not verified private; no push made.')
    return url


def backup_file(primary):
    file = state(primary) / 'workspace-backup.json'
    if file.is_symlink():
        raise WorkspaceError('Backup configuration must be local.')
    return file


def backup(repo, primary, current):
    file = backup_file(primary)
    if not file.exists():
        return
    try:
        data = json.loads(file.read_text())
        remote = data['remote']
        if private_remote(repo, remote) != data['url']:
            raise WorkspaceError('Backup remote changed; re-enable it after review.')
        git(repo, '-c', 'push.followTags=false', 'push', '--no-follow-tags', remote,
            'HEAD:refs/heads/autosave/' + current, timeout=30)
        note(primary, 'Private backup updated on autosave/' + current + '.')
    except (OSError, ValueError, KeyError, WorkspaceError):
        note(primary, 'Private backup deferred; local commits are retained. Run backup explicitly to retry.')


def return_main(repo, primary):
    if repo != primary or os.environ.get('AI_OS_AUTONOMOUS') == '1':
        return
    current = branch(repo)
    if current == 'main':
        return
    if git(repo, 'show-ref', '--verify', '--quiet', 'refs/heads/main', check=False).returncode:
        return
    ancestor = git(repo, 'merge-base', '--is-ancestor', 'HEAD', 'main', check=False).returncode == 0
    dirty = bool(git(repo, 'status', '--porcelain', '-z').stdout)
    if not ancestor and (dirty or not current.startswith('autosave-recovery/')):
        note(primary, 'Folder remains on ' + current + '; it has work outside main. Review before merging.')
        return
    # Git carries dirty edits only when they can be kept without overwriting.
    if git(repo, 'switch', 'main', check=False).returncode:
        note(primary, 'Could not safely return to main; edits and branch are unchanged.')
    else:
        note(primary, 'Returned to main; work on ' + current + ' is preserved.')


def target_worktree(primary, roots, target):
    candidate = Path(target)
    candidate = candidate.resolve() if candidate.is_dir() else (primary / '.worktrees' / target).resolve()
    if candidate not in roots or candidate == primary:
        raise WorkspaceError('Choose a registered non-primary worktree of this repository.')
    return candidate


def link_context(repo, primary, cwd):
    if repo == primary:
        return
    selected = scope(cwd, repo, primary)
    relative = selected.relative_to(primary)
    shared = ['context/MEMORY.md', 'context/learnings.md', 'context/memory', 'context/transcripts',
              'context/_private', 'context/notion', '.env', '.mcp.json', '.claude/settings.local.json']
    if selected == primary:
        shared += ['.command-centre', '.memsearch', '.claude/skills/_catalog/installed.json']
    for name in shared:
        src, dst = selected / name, repo / relative / name
        if not src.exists() or src.is_symlink() or not src.resolve().is_relative_to(selected):
            continue
        # Template identity and daily-memory scaffolds may be tracked. They stay
        # real files. Context readers use the primary instead of replacing them.
        tracked = git(repo, 'ls-files', '-z', '--', str(relative / name)).stdout
        ignored = git(repo, 'check-ignore', '--quiet', '--', str(relative / name), check=False).returncode == 0
        if tracked or not ignored:
            continue
        if dst.exists() or dst.is_symlink():
            continue
        if not dst.parent.resolve().is_relative_to(repo):
            raise WorkspaceError('Worktree link parent leaves the workspace.')
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.symlink_to(src, target_is_directory=src.is_dir())
    print('Ignored local state linked; tracked context reads and writes use ' + str(selected) + '.')


def cleanup(repo, primary):
    current = branch(repo)
    if current in ('main', 'dev'):
        raise WorkspaceError('Cannot retire a worktree holding main or dev; move its work to a feature branch first.')
    save(repo, primary)  # Any hold or failure aborts cleanup.
    if git(repo, 'status', '--porcelain', '-z').stdout:
        raise WorkspaceError('Worktree still has unsaved changes; folder retained.')
    # Git permits deleting ignored files with a clean worktree. Keep any real
    # local-only files; links to the primary are disposable, their targets stay.
    ignored = git(repo, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z').stdout.split(b'\0')
    for name in filter(None, ignored):
        path = repo / os.fsdecode(name)
        if not any(p.is_symlink() for p in (path, *path.parents) if p != repo and p.is_relative_to(repo)):
            raise WorkspaceError('Worktree has local-only ignored files; move them to the primary before cleanup.')
    tag = 'archive/' + current + '-' + datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:8]
    git(primary, 'tag', '-a', tag, current, '-m', 'Preserved worktree branch before cleanup')
    git(primary, 'worktree', 'remove', str(repo))  # No --force, even after saving.
    git(primary, 'branch', '-D', current)
    note(primary, 'Worktree removed; saved commits retained at local tag ' + tag + '.')


def run(args):
    maintenance.require_solo()  # Team / hosted / unreadable login blocks before Git/context access.
    cwd = Path(os.path.abspath(args.cwd))
    try:
        repo, primary, roots = repository(cwd)
    except WorkspaceError:
        # Downloaded Solo workspaces can load context before Git is initialized.
        # This fallback still applies the shared scope and Team guards.
        if args.command == 'context' and git(cwd, 'rev-parse', '--is-inside-work-tree', check=False).returncode:
            if any((parent / 'AGENTS.md').is_file()
                   and (parent / '.claude/skills/_catalog/catalog.json').is_file()
                   for parent in (cwd, *cwd.parents)):
                root, selected = maintenance.resolve_scope(cwd)
            else:
                # Existing capture/tick adapters also support minimal non-Git
                # workspaces. Keep their original cwd/root discovery behavior.
                root = selected = cwd
            print(json.dumps({'primary': str(root), 'scope': str(selected), 'worktree': False}))
            return
        raise
    if (not cwd.is_relative_to(repo)
            or any(p.is_symlink() for p in (cwd, *cwd.parents)
                   if p != repo and p.is_relative_to(repo))):
        raise WorkspaceError('Working directory changes scope through a link; use its real workspace path.')
    selected = scope(cwd, repo, primary)
    if args.command == 'context':
        print(json.dumps({'primary': str(primary), 'scope': str(selected), 'worktree': repo != primary}))
        return
    if args.command == 'list':
        print(git(repo, 'worktree', 'list', '--porcelain').stdout.decode())
        return
    if selected != primary and args.command not in ('start', 'link'):
        raise WorkspaceError('Repository-wide saving and cleanup must be run from the root, outside clients.')
    with locked(primary):
        if args.command == 'start':
            link_context(repo, primary, cwd)
            if selected == primary:
                return_main(repo, primary)
            print('Solo memory, identity and learnings use primary scope: ' + str(selected))
            log = state(primary) / 'branch-state.log'
            if log.exists() and not log.is_symlink():
                print('\n'.join(log.read_text().splitlines()[-5:]))
        elif args.command == 'return-main':
            return_main(repo, primary)
        elif args.command == 'save':
            if repo == primary:
                save(repo, primary)
        elif args.command == 'new':
            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', args.target or ''):
                raise WorkspaceError('Use a short worktree name with letters, numbers, underscores or hyphens.')
            destination = primary / '.worktrees' / args.target
            if not destination.parent.resolve().is_relative_to(primary):
                raise WorkspaceError('Worktree directory leaves the primary checkout.')
            base = 'dev' if git(repo, 'show-ref', '--verify', '--quiet', 'refs/heads/dev', check=False).returncode == 0 else 'main'
            git(primary, 'worktree', 'add', '-b', 'work/' + args.target, str(destination), base)
            link_context(destination, primary, destination)
            print('Open isolated worktree: ' + str(destination))
        elif args.command in ('link', 'worktree-save', 'done'):
            target = target_worktree(primary, roots, args.target) if args.target else repo
            if target == primary:
                raise WorkspaceError('Choose a non-primary worktree.')
            if args.command == 'link':
                link_context(target, primary, cwd if target == repo else target)
            elif args.command == 'worktree-save':
                save(target, primary)
            else:
                cleanup(target, primary)
        elif args.command == 'enable-backup':
            url = private_remote(repo, args.target or '')
            backup_file(primary).write_text(json.dumps({'remote': args.target, 'url': url}) + '\n')
            print('Private backup enabled; only autosave/* refs will be pushed. Disable with disable-backup.')
        elif args.command == 'disable-backup':
            backup_file(primary).unlink(missing_ok=True)
            print('Automatic remote backup disabled; local autosave remains enabled.')
        elif args.command == 'backup':
            backup(repo, primary, branch(repo))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['start', 'save', 'return-main', 'new', 'list', 'link',
                                           'worktree-save', 'done', 'context', 'enable-backup', 'disable-backup', 'backup'])
    parser.add_argument('target', nargs='?')
    parser.add_argument('--cwd', default=os.getcwd())
    args = parser.parse_args()
    try:
        run(args)
        return 0
    except maintenance.MaintenanceError:
        print('Local workspace access is disabled by Team authority.', file=sys.stderr)
        return 2
    except (WorkspaceError, OSError, ValueError) as error:
        message = str(error) if isinstance(error, (WorkspaceError, maintenance.MaintenanceError)) else 'Workspace operation failed; review local files before retrying.'
        print(message, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
