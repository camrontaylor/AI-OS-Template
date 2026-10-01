#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/command-centre/scripts/cron-daemon.cjs"
source "$REPO_ROOT/scripts/lib/cron-ui.sh"

ai_os_cron_banner \
    "Checking cron runtime status" \
    "This shows whether the CLI daemon or the Command Centre server is leading."
ai_os_cron_info "Reading the shared runtime lock and daemon state..."

if status_output="$(node "$SCRIPT_PATH" status "$@")"; then
    printf "%s\n" "$status_output"
    if printf "%s\n" "$status_output" | grep -q "^warning: "; then
        ai_os_cron_warn "No live cron runtime: scheduled jobs are not running."
    else
        ai_os_cron_success "Status check complete."
    fi
else
    exit_code=$?
    [ -n "${status_output:-}" ] && printf "%s\n" "$status_output"
    ai_os_cron_fail "Failed to read cron runtime status."
    exit "$exit_code"
fi
