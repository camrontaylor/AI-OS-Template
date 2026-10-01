#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac

# Run from inside a client workspace, report the skills that client actually
# sees. Shared skills are inherited from the AI-OS root, so the root is
# the list worth showing; the client's own folder only adds to it.
CLIENT_SLUG=""
CLIENT_DIR=""
CLIENT_SKILLS_DIR=""
if [[ "$(basename "$(dirname "$REPO_ROOT")")" == "clients" ]]; then
  CLIENT_SLUG="$(basename "$REPO_ROOT")"
  CLIENT_DIR="$REPO_ROOT"
  CLIENT_SKILLS_DIR="${REPO_ROOT}/.claude/skills"
  REPO_ROOT="$(cd "${REPO_ROOT}/../.." && pwd)"
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
fi

source "$REPO_ROOT/scripts/lib/python.sh"
CATALOG="$REPO_ROOT/.claude/skills/_catalog/catalog.json"
SKILLS_DIR="$REPO_ROOT/.claude/skills"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

if [[ ! -f "$CATALOG" ]]; then
  echo "Error: catalog.json not found at $CATALOG" >&2
  exit 1
fi

if ! resolve_python_cmd; then
  echo "Error: Python 3 is required to list skills." >&2
  exit 1
fi

# Skills this client turned off via skillOverrides in settings.local.json.
# That file belongs to the user and may be absent or hand-edited, so any
# read or parse problem just means "no overrides".
CLIENT_OFF_SKILLS=""
if [[ -n "$CLIENT_SLUG" && -f "${CLIENT_DIR}/.claude/settings.local.json" ]]; then
  CLIENT_OFF_SKILLS="$("${PYTHON_CMD[@]}" -c "
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8-sig') as f:
        overrides = json.load(f).get('skillOverrides', {})
except (OSError, ValueError):
    sys.exit(0)
if isinstance(overrides, dict):
    for name in sorted(overrides):
        if overrides[name] == 'off':
            print(name)
" "${CLIENT_DIR}/.claude/settings.local.json" 2>/dev/null || true)"
fi

echo ""
echo -e "${CYAN}AI-OS — Installed Skills${NC}"
echo "============================="
echo ""

"${PYTHON_CMD[@]}" -c "
import json, sys, os

catalog_path = sys.argv[1]
skills_dir = sys.argv[2]
off_names = set()
if len(sys.argv) > 3 and sys.argv[3].strip():
    off_names = {line.strip() for line in sys.argv[3].splitlines() if line.strip()}

with open(catalog_path) as f:
    catalog = json.load(f)

core_skills = catalog.get('core_skills', [])
optional_skills = catalog.get('skills', {})

installed = []
available = []

# Core skills — always shown as installed
for name in sorted(core_skills):
    installed.append((name, True))

# Optional skills — check if directory exists on disk
for name in sorted(optional_skills.keys()):
    skill_dir = os.path.join(skills_dir, name)
    info = optional_skills[name]
    services = info.get('requires_services', [])
    desc = info.get('description', '')
    if os.path.isdir(skill_dir):
        installed.append((name, False))
    else:
        available.append((name, desc, services))

# Print installed
print('INSTALLED:')
for name, is_core in installed:
    tag = ' (core)' if is_core else ''
    if name in off_names:
        print(f'  \033[1;33m✗\033[0m {name}{tag} — off for this client (skillOverrides)')
    else:
        print(f'  \033[0;32m✓\033[0m {name}{tag}')

# Print available
if available:
    print()
    print('AVAILABLE:')
    # Calculate padding for alignment
    max_len = max(len(name) for name, _, _ in available) if available else 0
    for name, desc, services in available:
        svc_str = ', '.join(services)
        if desc and services:
            hint = f' — {desc} (needs {svc_str})'
        elif desc:
            hint = f' — {desc}'
        elif services:
            hint = f' — (needs {svc_str})'
        else:
            hint = ''
        padding = ' ' * (max_len - len(name))
        print(f'  \033[1;33m○\033[0m {name}{padding}  {hint}')
else:
    print()
    print('All skills are installed.')

print()
" "$CATALOG" "$SKILLS_DIR" "$CLIENT_OFF_SKILLS"

if [[ -n "$CLIENT_SLUG" ]]; then
  echo -e "${CYAN}Client: ${CLIENT_SLUG}${NC}"
  echo "  The skills above are inherited from the AI-OS root."
  echo ""

  own_skills=""
  own_overrides=""
  if [[ -d "$CLIENT_SKILLS_DIR" ]]; then
    for client_skill in "$CLIENT_SKILLS_DIR"/*/; do
      [[ -d "$client_skill" ]] || continue
      skill_name=$(basename "$client_skill")
      if [[ -f "${client_skill}/SKILL.md" ]]; then
        if [[ -d "${SKILLS_DIR}/${skill_name}" ]]; then
          own_skills="${own_skills}    $(printf '%b' "${YELLOW}●${NC}") ${skill_name}  — overrides the root skill of the same name"$'\n'
        else
          own_skills="${own_skills}    $(printf '%b' "${GREEN}●${NC}") ${skill_name}"$'\n'
        fi
      fi
      if [[ -f "${client_skill}/SKILL.local.md" ]]; then
        own_overrides="${own_overrides}    $(printf '%b' "${CYAN}+${NC}") ${skill_name}"$'\n'
      fi
    done
  fi

  if [[ -n "$own_skills" ]]; then
    echo "  Client-only skills:"
    printf '%s' "$own_skills"
    echo ""
  fi

  if [[ -n "$own_overrides" ]]; then
    echo "  Local overrides on root skills (SKILL.local.md):"
    printf '%s' "$own_overrides"
    echo ""
  fi

  if [[ -n "$CLIENT_OFF_SKILLS" ]]; then
    echo "  Hidden from this client (skillOverrides in .claude/settings.local.json):"
    while IFS= read -r off_name; do
      [[ -n "$off_name" ]] || continue
      echo -e "    ${YELLOW}✗${NC} ${off_name}"
    done <<< "$CLIENT_OFF_SKILLS"
    echo ""
  fi

  if [[ -z "$own_skills" && -z "$own_overrides" && -z "$CLIENT_OFF_SKILLS" ]]; then
    echo "  No client-only skills or local overrides yet."
    echo ""
  fi
  echo ""
  echo "  To hide a root skill from this client, add it to .claude/settings.local.json:"
  echo '    { "skillOverrides": { "skill-name": "off" } }'
  echo ""
fi
