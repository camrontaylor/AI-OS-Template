#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/cron-ui.sh"

ai_os_cron_banner \
    "uninstall-crons is deprecated" \
    "Stopping the managed cron daemon instead."
ai_os_cron_info "Redirecting to stop-crons..."
bash "$SCRIPT_DIR/stop-crons.sh" "$@"
