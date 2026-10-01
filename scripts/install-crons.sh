#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/cron-ui.sh"

ai_os_cron_banner \
    "install-crons is deprecated" \
    "Starting the managed cron daemon instead."
ai_os_cron_info "Redirecting to start-crons..."
bash "$SCRIPT_DIR/start-crons.sh" "$@"
