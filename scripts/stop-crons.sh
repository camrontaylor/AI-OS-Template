#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/command-centre/scripts/cron-daemon.cjs"
source "$REPO_ROOT/scripts/lib/cron-ui.sh"

ai_os_cron_banner \
    "Stopping managed cron daemon" \
    "This ends the background scheduler for the current workspace."
ai_os_cron_info "Shutting down the daemon..."

if node "$SCRIPT_PATH" stop "$@"; then
    ai_os_cron_success "Managed cron daemon stopped."
else
    exit_code=$?
    ai_os_cron_fail "Failed to stop the managed cron daemon."
    exit "$exit_code"
fi
