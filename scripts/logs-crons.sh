#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/command-centre/scripts/cron-daemon.cjs"
source "$REPO_ROOT/scripts/lib/cron-ui.sh"

ai_os_cron_banner \
    "Showing cron daemon logs" \
    "Press Ctrl+C to stop following the live stream."
ai_os_cron_info "Streaming the daemon output..."

if node "$SCRIPT_PATH" logs "$@"; then
    ai_os_cron_success "Log stream finished."
else
    exit_code=$?
    ai_os_cron_fail "Failed to read cron daemon logs."
    exit "$exit_code"
fi
