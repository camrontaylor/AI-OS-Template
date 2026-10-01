#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/centre-shortcut.sh"

centre_script="$SCRIPT_DIR/centre.sh"

ai_os_centre_scan_unix_shortcuts "$centre_script"
if [[ $AI_OS_CENTRE_SCAN_COUNT -gt 0 ]]; then
    ai_os_centre_repair_detected_unix_shortcuts "$centre_script"
fi

if command -v powershell.exe >/dev/null 2>&1; then
    ps_script="$SCRIPT_DIR/install-centre-alias.ps1"
    if command -v cygpath >/dev/null 2>&1; then
        ps_script="$(cygpath -w "$ps_script")"
    fi

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps_script" -ExistingOnly >/dev/null
fi
