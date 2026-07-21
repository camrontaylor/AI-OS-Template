#!/usr/bin/env bash
# codex-hook.sh - portable bridge from tracked .codex/hooks.json to AI-OS hooks.
#
# Keep Codex project hooks repo-relative. The same adapter must work in the
# primary checkout, a reviewed worktree, and a fresh clone without absolute paths
# back to one machine's primary folder.

set -uo pipefail

TARGET_REL="${1:-}"
if [[ -z "$TARGET_REL" ]]; then
  exit 0
fi

INPUT="$(mktemp "${TMPDIR:-/tmp}/aios-codex-hook.XXXXXX")" || exit 0
trap 'rm -f "$INPUT" 2>/dev/null || true' EXIT INT TERM
cat > "$INPUT" || true

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]] && command -v python3 >/dev/null 2>&1; then
  ROOT="$(python3 - "$INPUT" <<'PY' 2>/dev/null || true
import json
import subprocess
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cwd = json.load(f).get("cwd", "")
except Exception:
    cwd = ""

if cwd:
    try:
        print(subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip())
    except Exception:
        pass
PY
)"
fi

if [[ -z "$ROOT" ]]; then
  exit 0
fi

TARGET="$ROOT/$TARGET_REL"
if [[ ! -f "$TARGET" ]]; then
  exit 0
fi

case "$TARGET" in
  *.js)
    node "$TARGET" < "$INPUT" || true
    ;;
  *.sh)
    bash "$TARGET" < "$INPUT" || true
    ;;
  *)
    bash "$TARGET" < "$INPUT" || true
    ;;
esac

exit 0
