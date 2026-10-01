#!/usr/bin/env python3
"""Solo workspace corrections, current-state briefs and read-only health checks."""
import argparse
from datetime import date
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import quote

class MaintenanceError(ValueError):
    pass


BRIEF_MARKER = '<!-- ai-os:generated-current-state:v1 -->'


def local(scope, name):
    candidate = scope / name
    path = candidate.resolve()
    if (not path.is_relative_to(scope)
            or any(p.is_symlink() for p in (candidate, *candidate.parents)
                   if p != scope and p.is_relative_to(scope))):
        raise MaintenanceError('A workspace path leaves its scope; no files changed.')
    return path


def resolve_scope(start):
    start = start.absolute()
    root = next((p for p in (start, *start.parents)
                 if (p / 'AGENTS.md').is_file()
                 and (p / '.claude/skills/_catalog/catalog.json').is_file()), None)
    if root is None:
        raise MaintenanceError('Run inside an AI-OS workspace.')
    parts = start.relative_to(root).parts
    scope = root / 'clients' / parts[1] if len(parts) >= 2 and parts[0] == 'clients' else root
    if (not scope.resolve().is_relative_to(root.resolve())
            or not start.resolve().is_relative_to(scope.resolve())
            or any(p.is_symlink() for p in (scope, *scope.parents)
                   if p != root and p.is_relative_to(root))):
        raise MaintenanceError('Workspace directory leaves the selected scope.')
    if scope != root and not (scope / 'AGENTS.md').is_file():
        raise MaintenanceError('Client workspace has no AGENTS.md.')
    return root.resolve(), scope.resolve()


def require_solo():
    if (os.environ.get('AI_OS_WORK_MODE') == 'team'
            or os.environ.get('AI_OS_TEAM_ENRICHMENT') == 'conversation_only'
            or os.environ.get('AI_OS_CONTEXT_OVERLAY_DIR')
            or os.environ.get('AI_OS_MODE', '').strip().lower() == 'hosted'
            or any(os.environ.get(key, '').strip().lower() in ('1', 'true', 'yes', 'on', 'hosted', 'team')
                   for key in ('AI_OS_HOSTED_MODE', 'TEAM_OS_HOSTED_MODE'))):
        raise MaintenanceError('Team mode requires the authoritative snapshot; Solo maintenance is disabled.')
    directory = Path(os.environ.get('AI_OS_TEAM_CONFIG_DIR', str(Path.home() / '.AI-OS')))
    config = directory / 'team-context.json'
    if config.exists() or config.is_symlink():
        try:
            data = json.loads(config.read_text(encoding='utf-8'))
            if not isinstance(data, dict):
                raise ValueError()
        except (OSError, ValueError):
            raise MaintenanceError('Team login state is unreadable; Solo maintenance is disabled.') from None
        if data.get('token') or data.get('apiUrl'):
            # An expired or unavailable login still owns the Team boundary.
            raise MaintenanceError('Saved Team login detected; use the connected runtime for maintenance.')


def read(scope, name):
    path = local(scope, name)
    return path.read_text(encoding='utf-8') if path.is_file() else ''


def write_changed(path, text):
    if path.is_file() and path.read_text(encoding='utf-8') == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         delete=False) as output:
            temporary = Path(output.name)
            output.write(text)
        if path.exists():
            temporary.chmod(path.stat().st_mode & 0o777)
        temporary.replace(path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return True


def sections(text, heading):
    active = False
    values = []
    for line in text.splitlines():
        if line.startswith('#'):
            active = line.strip() == '### ' + heading
        elif active and line.strip():
            values.append(line.strip())
    return values


def correction_entries(root, scope, day):
    source = read(scope, 'context/memory/' + day + '.md')
    installed = {p.parent.name for p in (root / '.claude/skills').glob('*/SKILL.md')}
    installed.update(p.parent.name for p in (scope / '.claude/skills').glob('*/SKILL.md'))
    entries = []
    for line in sections(source, 'Corrections'):
        match = re.fullmatch(r'- \[([a-z0-9-]+)\] (\S.*)', line)
        if not match or match[1] not in installed | {'general'}:
            raise MaintenanceError('Correction format or skill scope is invalid; no lessons changed.')
        if re.search(r'(?:gh[pousr]_|github_pat_|sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{24,}'
                     r'|-----BEGIN .*PRIVATE KEY|https?://[^\s/]+:[^\s/@]+@', match[2]):
            raise MaintenanceError('Correction contains a possible secret; redact it before promotion.')
        if (match[1], match[2]) not in entries:
            entries.append((match[1], match[2]))
    return entries


def has_lesson(text, skill, lesson):
    match = re.search(r'^## ' + re.escape(skill) + r'\s*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
    return bool(match and any(re.sub(r'^- \d{4}-\d{2}-\d{2}: ', '', line).strip() == lesson
                              for line in match[1].splitlines()))


def corrections(root, scope, day, check):
    entries = correction_entries(root, scope, day)
    learned = read(scope, 'context/learnings.md') or '# Learnings Journal\n'
    missing = [(skill, lesson) for skill, lesson in entries if not has_lesson(learned, skill, lesson)]
    if check:
        print(f'Corrections: {len(entries)} recorded, {len(missing)} awaiting promotion.')
        return 1 if missing else 0
    for skill, lesson in missing:
        heading = re.search(r'^## ' + re.escape(skill) + r'\s*\n', learned, re.M)
        if not heading:
            learned = learned.rstrip() + '\n\n## ' + skill + '\n'
            heading = re.search(r'^## ' + re.escape(skill) + r'\s*\n', learned, re.M)
        next_heading = re.search(r'^## ', learned[heading.end():], re.M)
        end = heading.end() + next_heading.start() if next_heading else len(learned)
        learned = (learned[:end].rstrip() + '\n- ' + day + ': ' + lesson + '\n\n'
                   + learned[end:])
    if missing:
        write_changed(local(scope, 'context/learnings.md'), learned)
    print(f'Corrections: {len(missing)} promoted; {len(entries) - len(missing)} already saved.')
    return 0


def brief(scope):
    previous = read(scope, 'context/current-state.md')
    if previous and BRIEF_MARKER not in previous.splitlines()[:3]:
        raise MaintenanceError('Existing current-state.md is user-owned; preserve it before generating a brief.')
    lines = ['# Current State', BRIEF_MARKER, '', 'Generated from local sources. Recheck sources before relying on a claim.',
             'Regenerate this file rather than editing it; keep accepted decisions in the source logs.', '']
    memory = read(scope, 'context/MEMORY.md')
    if memory:
        lines += ['## Working Memory', '', memory[:2500], '', 'Source: [MEMORY.md](MEMORY.md)', '']
    directory = local(scope, 'context/memory')
    logs = sorted((p for p in directory.glob('*.md')
                   if re.fullmatch(r'\d{4}-\d{2}-\d{2}\.md', p.name)), reverse=True)[:3]
    for source in logs:
        text = local(scope, 'context/memory/' + source.name)
        body = text.read_text(encoding='utf-8')
        lines += ['## ' + source.stem, '', f'Source: [session log](memory/{source.name})', '']
        for heading in ('Goal', 'Decisions', 'Open threads'):
            values = sections(body, heading)
            if values:
                lines += ['### ' + heading, '', *values[-12:], '']
                if len(values) > 12:
                    lines += ['Earlier entries remain in the linked source.', '']
    lines += ['## Context Sources', '']
    for path in sorted(local(scope, 'context').glob('*.md')):
        if path.name not in ('current-state.md', 'MEMORY.md'):
            local(scope, 'context/' + path.name)
            lines.append(f'- [{path.name}]({path.name})')
    lines += ['', '## Projects', '']
    projects = local(scope, 'projects')
    folders = sorted(p for p in projects.glob('*') if p.is_dir())
    for folder in folders[:12]:
        local(scope, 'projects/' + folder.name)
        label = folder.name.replace('[', '').replace(']', '')
        lines.append(f'- [{label}](../projects/{quote(folder.name)}/)')
    if len(folders) > 12:
        lines.append('- More project folders are available under projects/.')
    changed = write_changed(local(scope, 'context/current-state.md'), '\n'.join(lines).rstrip() + '\n')
    print('Current-state brief refreshed.' if changed else 'Current-state brief unchanged.')
    return 0


def health(root, scope, day):
    problems = []

    def report(level, text):
        print(level + ': ' + text)
        if level in ('ERROR', 'WARN'):
            problems.append(text)

    for tool in ('git', 'node'):
        report('OK' if shutil.which(tool) else 'WARN', tool + ' is available.' if shutil.which(tool)
               else tool + ' is missing; install it for version history or Command Centre.')
    memory = read(scope, 'context/MEMORY.md')
    report('OK' if memory and len(memory) <= 2500 else 'WARN',
           f'Working memory: {len(memory)} characters; limit 2500. Missing or large memory needs review.'
           if not memory or len(memory) > 2500 else f'Working memory: {len(memory)}/2500 characters.')
    for path in (root / '.claude/settings.json', scope / '.claude/settings.local.json'):
        if path.exists():
            if not path.resolve().is_relative_to(scope if path.parent == scope / '.claude' else root):
                raise MaintenanceError('Settings path leaves its scope.')
            try:
                json.loads(path.read_text(encoding='utf-8'))
                report('OK', 'Agent settings contain valid JSON.')
            except (OSError, ValueError):
                report('ERROR', 'Agent settings are invalid; repair the JSON without replacing user preferences.')
    skills = sorted((root / '.claude/skills').glob('*/SKILL.md'))
    for skill in skills:
        link = root / '.agents/skills' / skill.parent.name / 'SKILL.md'
        if not link.is_file() or link.resolve() != skill.resolve():
            report('WARN', 'Shared skill discovery needs repair: run python3 scripts/sync-agent-skills.py.')
            break
    else:
        report('OK' if skills else 'WARN', f'{len(skills)} shared skills checked for matching agent discovery.')
    if scope != root:
        for skill in (scope / '.claude/skills').glob('*/SKILL.md'):
            local(scope, str(skill.relative_to(scope)))
            link = scope / '.agents/skills' / skill.parent.name / 'SKILL.md'
            if not link.is_file() or link.resolve() != skill.resolve():
                report('WARN', 'Client skill discovery needs repair: run the root skill sync script.')
    result = subprocess.run(['git', '-C', str(root), 'config', '--get-regexp', r'^remote\..*\.url$'],
                            capture_output=True, text=True, timeout=10) if shutil.which('git') else None
    remotes = result.stdout.splitlines() if result else []
    if not remotes or all(re.search(r'[:/]camrontaylor/AI-OS-Template(?:\.git)?$', r) for r in remotes):
        report('WARN', 'No separate backup remote found. Set up a private backup when needed.')
    else:
        report('INFO', 'A separate remote is configured. Backup freshness and privacy need a live check.')
    config = read(scope, 'context/memory-config.json')
    if config:
        try:
            json.loads(config)
            report('OK', 'Memory configuration contains valid JSON.')
        except ValueError:
            report('ERROR', 'Memory configuration is invalid; review its JSON.')
    report('INFO', 'Recall quality is untested here. Run the existing memory status and recall commands.')
    active = 0
    for job in local(scope, 'cron/jobs').glob('*.md'):
        body = read(scope, str(job.relative_to(scope)))
        front = body.split('---', 2)[1] if body.startswith('---') else ''
        active += bool(re.search(r'^active:\s*[\'\"]?true[\'\"]?\s*$', front, re.M))
    report('WARN' if active else 'OK', f'{active} active jobs; verify live runtime with the existing cron status command.'
           if active else 'All example jobs in this scope are paused; no scheduler is required.')
    entries = correction_entries(root, scope, day)
    learned = read(scope, 'context/learnings.md')
    missing = sum(not has_lesson(learned, skill, lesson) for skill, lesson in entries)
    report('WARN' if missing else 'OK', f'{missing} recorded corrections await promotion.'
           if missing else 'Today\'s recorded corrections have no promotion gap.')
    print('NEEDS ATTENTION' if problems else 'CHECKS PASSED; live backup, recall and scheduler behavior remain unverified.')
    return 1 if problems else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('corrections', 'brief', 'health'))
    parser.add_argument('--scope', type=Path, default=Path.cwd(), help='Root or one active client workspace')
    parser.add_argument('--date', default=date.today().isoformat(), help='Session date, YYYY-MM-DD')
    parser.add_argument('--check', action='store_true', help='Report correction gaps without writing')
    args = parser.parse_args()
    try:
        date.fromisoformat(args.date)
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.date):
            raise MaintenanceError('Use a YYYY-MM-DD date.')
        if args.check and args.command != 'corrections':
            raise MaintenanceError('--check applies only to corrections.')
        require_solo()
        root, scope = resolve_scope(args.scope)
        if args.command == 'corrections':
            return corrections(root, scope, args.date, args.check)
        return brief(scope) if args.command == 'brief' else health(root, scope, args.date)
    except MaintenanceError as error:
        print('Maintenance stopped: ' + str(error))
        return 2
    except (OSError, ValueError, subprocess.SubprocessError):
        # Report the boundary without printing file contents, keys or remote URLs.
        print('Maintenance stopped: invalid input, unsafe scope, Team mode, or unreadable local state. '
              'Review the scope and mode; no automatic repair was attempted.')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
