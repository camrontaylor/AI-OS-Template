#!/usr/bin/env python3
"""Fail publication checks without printing any credential values."""
from pathlib import Path
import os
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).split(b'\0')
patterns = {
    'GitHub credential': rb'(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{30,}',
    'provider credential': rb'\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b',
    'private key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'credential in URL': rb'https?://[^\s/<]+:[^\s/@]+@(?:github\.com|[^\s/]+)',
    'personal machine path': rb'(?:/Users|/home)/(?!me\b|example\b)[A-Za-z][A-Za-z0-9_.-]*(?:/|$)',
    'retired branding': rb'(?i)\x73kool|\x73imon|\x73crapes|\x61gentic(?:[-_ ]os)?|\b\x73capes\b|a\s+g\s+e\s+n\s+t\s+i\s+c',
}
failures = []
for raw in paths:
    if not raw:
        continue
    name = os.fsdecode(raw)
    path = root / name
    if path.is_symlink():
        target = path.resolve()
        if not target.is_relative_to(root) or not target.exists():
            failures.append((name, 'broken or escaping discovery link'))
        continue
    content = path.read_bytes()
    if len(content) > 50 * 1024 * 1024:
        failures.append((name, 'oversized distribution file'))
    for label, pattern in patterns.items():
        if name == 'scripts/check-public-template.py' and label not in ('personal machine path', 'retired branding'):
            continue  # Credential detector syntax necessarily contains credential examples.
        if re.search(pattern, content):
            failures.append((name, label))
    if re.search(r'(^|/)(?:node_modules|\.next|\.command-centre|\.AI-OS|backups)(/|$)', name):
        failures.append((name, 'local runtime artifact'))
    if name.startswith('cron/jobs/') and path.suffix == '.md':
        if not re.search(rb"(?m)^active:\s*['\"]?false['\"]?\s*$", content):
            failures.append((name, 'example job must start paused'))

skill_files = list((root / '.claude/skills').glob('*/SKILL.md'))
if len(skill_files) != 93:
    failures.append(('.claude/skills', f'expected 93 shipped definitions, found {len(skill_files)}'))
for path in skill_files:
    source = path.read_text()
    parts = source.split('---', 2)
    name_match = re.search(r'^name:\s*(.+)$', parts[1], re.M) if len(parts) == 3 else None
    if not name_match or name_match.group(1).strip() != path.parent.name:
        failures.append((str(path.relative_to(root)), 'skill name does not match folder'))
    if len(parts) == 3 and len(parts[1]) > 1024:
        failures.append((str(path.relative_to(root)), 'skill frontmatter exceeds 1024 characters'))

if failures:
    for name, label in failures:
        print(f'ERROR: {name}: {label}')
    sys.exit(1)
print(f'Public template checks passed: {len(paths)-1} paths, 93 skills, paused jobs, valid discovery links, no credential or retired-brand patterns.')
