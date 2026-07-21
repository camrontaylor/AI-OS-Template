#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/scripts/cron/cron-daemon.cjs"
source "$REPO_ROOT/scripts/lib/cron-ui.sh"

agentic_os_cron_banner \
    "Showing cron daemon logs" \
    "Press Ctrl+C to stop following the live stream."
agentic_os_cron_info "Streaming the daemon output..."

if node "$SCRIPT_PATH" logs "$@"; then
    agentic_os_cron_success "Log stream finished."
else
    exit_code=$?
    agentic_os_cron_fail "Failed to read cron daemon logs."
    exit "$exit_code"
fi
