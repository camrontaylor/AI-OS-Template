#!/usr/bin/env bash
# optional-status.sh - inspect AI-OS optional capability state.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
source "$REPO_ROOT/scripts/lib/python.sh"

TARGET="${1:-}"

if [[ "${TARGET:-}" == "-h" || "${TARGET:-}" == "--help" ]]; then
  echo "Usage: bash scripts/optional-status.sh [capability]"
  exit 0
fi

if ! resolve_python_cmd; then
  echo "Error: Python 3 is required to inspect optional capabilities." >&2
  exit 1
fi

"${PYTHON_CMD[@]}" - "$REPO_ROOT" "$TARGET" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
target = sys.argv[2]
optional_dir = root / ".aios" / "optional"
enabled_dir = root / ".aios" / "enabled"

manifests = sorted(optional_dir.glob("*/manifest.json"))
if target:
    manifests = [optional_dir / target / "manifest.json"]

if not manifests:
    print("No optional capability registry found.")
    sys.exit(0)

exit_code = 0
for manifest_path in manifests:
    if not manifest_path.exists():
        print(f"Unknown optional capability: {target}")
        exit_code = 2
        continue

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"{manifest_path}: invalid manifest: {exc}")
        exit_code = 1
        continue

    name = data.get("name", manifest_path.parent.name)
    marker = enabled_dir / f"{name}.json"
    enabled = marker.exists()

    print()
    print(name)
    print("-" * len(name))
    print(f"Description:       {data.get('description', '')}")
    print(f"Status:            {data.get('status', 'available')}")
    print(f"Enabled locally:   {'yes' if enabled else 'no'}")
    print(f"Loads at startup:  {str(data.get('loads_at_startup', False)).lower()}")
    print(f"Activation:        {data.get('activation', 'copy-templates')}")
    print(f"Permission model:  {data.get('permissions', '')}")

    services = data.get("services", [])
    if services:
        print("Services:")
        for service in services:
            print(f"  - {service}")

    commands = data.get("commands", [])
    if commands:
        print("Commands:")
        for command in commands:
            print(f"  - {command}")

    creates = data.get("creates", [])
    if creates:
        print("Created paths:")
        for rel in creates:
            rel_clean = rel.rstrip("/")
            exists = (root / rel_clean).exists()
            print(f"  - {rel} ({'present' if exists else 'absent'})")

    if enabled:
        try:
            marker_data = json.loads(marker.read_text(encoding="utf-8"))
            print(f"Enabled at:        {marker_data.get('enabled_at', 'unknown')}")
        except Exception:
            print(f"Enabled marker:    {marker.relative_to(root)}")

sys.exit(exit_code)
PY
