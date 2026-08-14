#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/scripts/cron/cron-daemon.cjs"
source "$REPO_ROOT/scripts/lib/cron-ui.sh"
source "$REPO_ROOT/scripts/lib/node-runtime.sh"
NODE_BIN="$(aios_resolve_node "$REPO_ROOT")"

# Preflight: the standalone cron runtime needs its own node deps (better-sqlite3).
# Show a clear message instead of a raw "Cannot find module" stack trace.
if [[ ! -d "$REPO_ROOT/scripts/cron/node_modules/better-sqlite3" ]]; then
    agentic_os_cron_fail "Cron runtime dependencies are not installed."
    agentic_os_cron_note "Run:  cd scripts/cron && npm install   (then retry this command)."
    exit 1
fi

agentic_os_cron_banner \
    "Stopping managed cron daemon" \
    "This ends the background scheduler for the current workspace."
agentic_os_cron_info "Shutting down the daemon..."

if "$NODE_BIN" "$SCRIPT_PATH" stop "$@"; then
    agentic_os_cron_success "Managed cron daemon stopped."
else
    exit_code=$?
    agentic_os_cron_fail "Failed to stop the managed cron daemon."
    exit "$exit_code"
fi
