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
    "Checking cron runtime status" \
    "This shows whether the CLI daemon or the Command Centre server is leading."
agentic_os_cron_info "Reading the shared runtime lock and daemon state..."

if "$NODE_BIN" "$SCRIPT_PATH" status "$@"; then
    agentic_os_cron_success "Status check complete."
else
    exit_code=$?
    agentic_os_cron_fail "Failed to read cron runtime status."
    exit "$exit_code"
fi
