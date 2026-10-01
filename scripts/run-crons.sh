#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/cron-ui.sh"

ai_os_cron_banner \
    "run-crons is deprecated" \
    "Automatic scheduling no longer uses the OS scheduler."
ai_os_cron_warn "Use 'bash scripts/start-crons.sh' to start the managed daemon."
ai_os_cron_note "You can also keep the Command Centre server running for in-process scheduling."
