#!/usr/bin/env python3
"""Expose canonical AI-OS skills to Codex without duplicating methodology.

Only relative symlinks owned by this adapter are changed. Real directories and
user-created links are preserved. Claude Code continues using .claude/skills.
"""
import argparse
import json
import os
from pathlib import Path


def sync_scope(scope):
    source = scope / '.claude' / 'skills'
    destination = scope / '.agents' / 'skills'
    manifest_path = scope / '.agents' / 'ai-os-skill-links.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    owned = previous.get('links', {})
    skills = {p.parent.name: p for p in sorted(source.glob('*/SKILL.md')) if not p.parent.name.startswith('_')}
    desired = {name: os.path.relpath(p.parent, destination) for name, p in skills.items()}
    destination.mkdir(parents=True, exist_ok=True)
    updated, conflicts = {}, []
    for name, target in owned.items():
        link = destination / name
        if name not in desired and link.is_symlink() and os.readlink(link) == target:
            link.unlink()
    for name, target in desired.items():
        link = destination / name
        if link.is_symlink() and os.readlink(link) == target:
            updated[name] = target
        elif link.is_symlink() and owned.get(name) == os.readlink(link):
            link.unlink()
            link.symlink_to(target, target_is_directory=True)
            updated[name] = target
        elif link.exists() or link.is_symlink():
            conflicts.append(name)
        else:
            link.symlink_to(target, target_is_directory=True)
            updated[name] = target
    payload = {'version': 1, 'links': updated}
    content = json.dumps(payload, indent=2) + '\n'
    if not manifest_path.exists() or manifest_path.read_text() != content:
        manifest_path.write_text(content)
    return {'scope': str(scope), 'linked_skills': len(updated), 'preserved_conflicts': conflicts}


def synchronize(root):
    root = root.resolve()
    scopes = [root]
    clients = root / 'clients'
    if clients.is_dir():
        scopes.extend(p for p in sorted(clients.iterdir()) if p.is_dir() and (p / 'AGENTS.md').is_file())
    return [sync_scope(scope) for scope in scopes]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(json.dumps(synchronize(args.root), indent=2))
