#!/usr/bin/env bash
# optional-enable.sh - activate one dormant AI-OS optional capability.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT")" ;; esac
source "$REPO_ROOT/scripts/lib/python.sh"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/optional-enable.sh <capability> [--dry-run] [--force]

Examples:
  bash scripts/optional-enable.sh team-knowledge
  bash scripts/optional-enable.sh context-farmers --dry-run

Enabling copies starter templates and writes .aios/enabled/<capability>.json.
It does not load the capability into startup context.
EOF
}

CAPABILITY=""
DRY_RUN=false
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --force)
      FORCE=true
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
  echo "Error: Python 3 is required to enable optional capabilities." >&2
  exit 1
fi

"${PYTHON_CMD[@]}" - "$REPO_ROOT" "$CAPABILITY" "$DRY_RUN" "$FORCE" <<'PY'
import filecmp
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1])
capability = sys.argv[2]
dry_run = sys.argv[3] == "true"
force = sys.argv[4] == "true"

cap_dir = root / ".aios" / "optional" / capability
manifest_path = cap_dir / "manifest.json"
enabled_dir = root / ".aios" / "enabled"
marker = enabled_dir / f"{capability}.json"

if not manifest_path.exists():
    print(f"ERROR: unknown optional capability: {capability}", file=sys.stderr)
    print("Run: bash scripts/optional-list.sh", file=sys.stderr)
    sys.exit(2)

try:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
except Exception as exc:
    print(f"ERROR: invalid manifest: {manifest_path}: {exc}", file=sys.stderr)
    sys.exit(1)

name = manifest.get("name", capability)
if name != capability:
    print(f"ERROR: manifest name {name!r} does not match folder {capability!r}", file=sys.stderr)
    sys.exit(1)

template_root = cap_dir / manifest.get("template_root", "templates/root")
files = []
if template_root.is_dir():
    for source in sorted(template_root.rglob("*")):
        if source.is_file():
            rel = source.relative_to(template_root)
            files.append((source, root / rel, rel))

collisions = []
for source, target, rel in files:
    if target.exists() and not filecmp.cmp(source, target, shallow=False) and not force:
        collisions.append(str(rel))

if collisions:
    print("ERROR: enabling would overwrite existing files:", file=sys.stderr)
    for rel in collisions:
        print(f"  - {rel}", file=sys.stderr)
    print("Rerun with --force only if replacing those files is intentional.", file=sys.stderr)
    sys.exit(1)

print()
print(f"Enabling optional capability: {capability}")
if dry_run:
    print("Dry run only - no files will be written.")

if files:
    print()
    print("Templates:")
    for source, target, rel in files:
        if target.exists() and filecmp.cmp(source, target, shallow=False):
            action = "already present"
        elif target.exists():
            action = "replace" if force else "would conflict"
        else:
            action = "create"
        print(f"  - {action}: {rel}")
else:
    print()
    print("No templates to copy.")

if dry_run:
    print()
    print(f"Would write: .aios/enabled/{capability}.json")
    sys.exit(0)

for source, target, rel in files:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and filecmp.cmp(source, target, shallow=False):
        continue
    shutil.copy2(source, target)

enabled_dir.mkdir(parents=True, exist_ok=True)
enabled_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
marker_data = {
    "schema": 1,
    "name": capability,
    "enabled_at": enabled_at,
    "manifest": str(manifest_path.relative_to(root)),
    "creates": manifest.get("creates", []),
}
marker.write_text(json.dumps(marker_data, indent=2) + "\n", encoding="utf-8")

print()
print(f"Enabled. Marker written: .aios/enabled/{capability}.json")
print("This local marker is gitignored; it will not force the capability on for teammates.")
PY
