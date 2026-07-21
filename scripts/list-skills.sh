#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
source "$REPO_ROOT/scripts/lib/python.sh"
CATALOG="$REPO_ROOT/.claude/skills/_catalog/catalog.json"
SKILLS_DIR="$REPO_ROOT/.claude/skills"

if ! resolve_python_cmd; then
  echo "Error: Python 3 is required to list skills." >&2
  exit 1
fi

"${PYTHON_CMD[@]}" - "$SKILLS_DIR" "$CATALOG" <<'PY'
import json
import re
import sys
from pathlib import Path

skills_dir = Path(sys.argv[1])
catalog_path = Path(sys.argv[2])

def frontmatter(path: Path) -> tuple[str, str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"^---\s*\n(.*?)\n---", text, re.S)
    block = match.group(1) if match else text[:1500]
    name_match = re.search(r"^name:\s*(.+)$", block, re.M)
    desc_match = re.search(r"^description:\s*(.+?)(?:\n[a-zA-Z_]+:|\Z)", block, re.S | re.M)
    name = name_match.group(1).strip().strip("\"'") if name_match else path.parent.name
    desc = " ".join(desc_match.group(1).split()).strip().strip("\"'").lstrip("> ") if desc_match else ""
    if len(desc) > 110:
        desc = desc[:107].rsplit(" ", 1)[0] + "..."
    return name, desc

setup = {}
core = set()
if catalog_path.is_file():
    try:
        data = json.loads(catalog_path.read_text(encoding="utf-8"))
        setup = data.get("skills", {})
        core = set(data.get("core_skills", []))
    except (json.JSONDecodeError, OSError):
        pass

live = []
for skill_md in sorted(skills_dir.glob("*/SKILL.md")):
    if skill_md.parent.name.startswith("_"):
        continue
    name, desc = frontmatter(skill_md)
    live.append((name, desc, name in core))

live_names = {name for name, _, _ in live}
available = [
    (name, info.get("description", ""), info.get("requires_services", []))
    for name, info in sorted(setup.items())
    if name not in live_names
]

print()
print("AI-OS - Live Skills")
print("====================")
for name, desc, is_core in live:
    tags = " [core]" if is_core else ""
    suffix = f" - {desc}" if desc else ""
    print(f"  {name}{tags}{suffix}")
print(f"\n{len(live)} live skill(s), discovered from .claude/skills/*/SKILL.md.")

if available:
    print("\nAvailable In First-Run Menu")
    print("===========================")
    for name, desc, services in available:
        needs = f" [needs {', '.join(services)}]" if services else ""
        suffix = f" - {desc}" if desc else ""
        print(f"  {name}{needs}{suffix}")
    print("\nThis second list is setup inventory, not the live registry.")
PY
