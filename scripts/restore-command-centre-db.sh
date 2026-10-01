#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

usage() {
    cat <<'EOF'
Restore Command Centre history from an older AI-OS install.

Usage:
  bash scripts/restore-command-centre-db.sh ../AI-OS-backup

This restores only .command-centre/data.db and its SQLite sidecar files.
It does not copy runtime files such as locks, ports, or launcher state.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

if [[ $# -ne 1 ]]; then
    usage >&2
    exit 1
fi

OLD_INSTALL="$1"

if [[ -f "$SCRIPT_DIR/stop-crons.sh" ]]; then
    bash "$SCRIPT_DIR/stop-crons.sh" >/dev/null 2>&1 || true
fi

printf "  [!] Close any running Command Centre window before continuing.\n"

case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
        if command -v cygpath >/dev/null 2>&1; then
            REPO_ROOT="$(cygpath -m "$REPO_ROOT")"
            OLD_INSTALL="$(cygpath -m "$OLD_INSTALL")"
        fi
        ;;
esac

source "$SCRIPT_DIR/lib/python.sh"
if ! resolve_python_cmd; then
    printf "Python 3 is required to restore Command Centre history.\n" >&2
    exit 1
fi

"${PYTHON_CMD[@]}" "$SCRIPT_DIR/lib/command-centre-db-restore.py" \
    --old-install "$OLD_INSTALL" \
    --new-install "$REPO_ROOT"
