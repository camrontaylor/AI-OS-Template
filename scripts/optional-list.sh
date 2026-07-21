#!/usr/bin/env bash
# optional-list.sh - list dormant AI-OS optional capabilities.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
source "$REPO_ROOT/scripts/lib/python.sh"

if ! resolve_python_cmd; then
  echo "Error: Python 3 is required to list optional capabilities." >&2
  exit 1
fi

"${PYTHON_CMD[@]}" - "$REPO_ROOT" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
optional_dir = root / ".aios" / "optional"
enabled_dir = root / ".aios" / "enabled"

print()
print("AI-OS Optional Capabilities")
print("===========================")
print()

if not optional_dir.is_dir():
    print("No optional capability registry found.")
    sys.exit(0)

rows = []
for manifest_path in sorted(optional_dir.glob("*/manifest.json")):
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        rows.append((manifest_path.parent.name, "invalid", str(exc), ""))
        continue
    name = data.get("name", manifest_path.parent.name)
    status = data.get("status", "available")
    enabled = (enabled_dir / f"{name}.json").exists()
    state = "enabled" if enabled else "available"
    desc = data.get("description", "")
    rows.append((name, state, status, desc))

if not rows:
    print("No optional capabilities registered.")
    sys.exit(0)

name_width = max(len(row[0]) for row in rows)
state_width = max(len(row[1]) for row in rows)
status_width = max(len(row[2]) for row in rows)

for name, state, status, desc in rows:
    print(f"{name.ljust(name_width)}  {state.ljust(state_width)}  {status.ljust(status_width)}  {desc}")

print()
print("Inspect one:  bash scripts/optional-status.sh <capability>")
print("Enable one:   bash scripts/optional-enable.sh <capability>")
PY
