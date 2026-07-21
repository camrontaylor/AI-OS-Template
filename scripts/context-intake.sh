#!/usr/bin/env bash
# context-intake.sh - review-first intake for AI-OS context inboxes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
ROOT="$(git -C "$SCRIPT_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="$SCRIPT_ROOT"
fi

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/context-intake.sh [--root]
  bash scripts/context-intake.sh --client <slug>
  bash scripts/context-intake.sh --client=<slug>

Options passed through:
  --date YYYY-MM-DD
  --init-only

Defaults:
  - from a client folder, processes that client
  - otherwise processes root context
EOF
}

client_from_path() {
  local path="$1"
  case "$path" in
    "$ROOT"/clients/*)
      local rest="${path#"$ROOT"/clients/}"
      printf '%s\n' "${rest%%/*}"
      ;;
    *)
      return 1
      ;;
  esac
}

PWD_PHYSICAL="$(pwd -P)"
DEFAULT_CLIENT="$(client_from_path "$PWD_PHYSICAL" 2>/dev/null || client_from_path "$SCRIPT_DIR" 2>/dev/null || true)"
HAS_SCOPE=0

for arg in "$@"; do
  case "$arg" in
    --root|--client|--client=*)
      HAS_SCOPE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
  esac
done

SCOPE_ARGS=()
if [ "$HAS_SCOPE" -eq 0 ]; then
  if [ -n "$DEFAULT_CLIENT" ]; then
    SCOPE_ARGS=(--client "$DEFAULT_CLIENT")
  else
    SCOPE_ARGS=(--root)
  fi
fi

exec python3 "$ROOT/scripts/context-intake.py" --workspace "$ROOT" "${SCOPE_ARGS[@]}" "$@"
