#!/usr/bin/env bash
# Shared entrypoint for Bash and Git Bash; Python resolution matches the installer.
set -euo pipefail
AIOS_GIT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$AIOS_GIT_SCRIPT_DIR/lib/python.sh"
if ! resolve_python_cmd; then
    echo "Workspace saving needs Python 3; files are unchanged." >&2
    exit 1
fi
exec "${PYTHON_CMD[@]}" "$AIOS_GIT_SCRIPT_DIR/workspace-git.py" "$@"
