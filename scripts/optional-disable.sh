#!/usr/bin/env bash
# optional-disable.sh - remove one local optional capability marker.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
source "$REPO_ROOT/scripts/lib/python.sh"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/optional-disable.sh <capability> [--dry-run]

Disabling removes only .aios/enabled/<capability>.json.
Created folders are preserved because they may contain user or team work.
EOF
}

CAPABILITY=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$CAPABILITY" ]]; then
        echo "ERROR: unexpected extra argument: $1" >&2
        usage >&2
        exit 2
      fi
      CAPABILITY="$1"
      ;;
  esac
  shift
done

if [[ -z "$CAPABILITY" ]]; then
  usage >&2
  exit 2
fi

if ! resolve_python_cmd; then
  echo "Error: Python 3 is required to disable optional capabilities." >&2
  exit 1
fi

"${PYTHON_CMD[@]}" - "$REPO_ROOT" "$CAPABILITY" "$DRY_RUN" <<'PY'
import sys
from pathlib import Path

root = Path(sys.argv[1])
capability = sys.argv[2]
dry_run = sys.argv[3] == "true"

manifest_path = root / ".aios" / "optional" / capability / "manifest.json"
marker = root / ".aios" / "enabled" / f"{capability}.json"

if not manifest_path.exists():
    print(f"ERROR: unknown optional capability: {capability}", file=sys.stderr)
    print("Run: bash scripts/optional-list.sh", file=sys.stderr)
    sys.exit(2)

if not marker.exists():
    print(f"{capability} is already disabled.")
    sys.exit(0)

if dry_run:
    print(f"Would remove: .aios/enabled/{capability}.json")
    print("Created folders would be preserved.")
    sys.exit(0)

marker.unlink()
print(f"Disabled {capability}.")
print("Created folders were preserved.")
PY
