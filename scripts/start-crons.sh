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

# Route the daemon's claude through the auth + stay-awake wrapper, the same way the
# launchd plist (com.aios.cron-daemon) does. Without this, a daemon started by hand from
# a plain shell falls back to the bare `claude` binary and loses BOTH headless OAuth auth
# (jobs 401) and the caffeinate stay-awake (jobs cut off by idle sleep). Defaults apply
# only when not already set, so the launchd plist's own values still win.
CRON_WRAPPER="$REPO_ROOT/scripts/claude-cron-wrapper.sh"
if [[ -z "${AI_OS_CLAUDE_BIN:-}" && -x "$CRON_WRAPPER" ]]; then
    export AI_OS_CLAUDE_BIN="$CRON_WRAPPER"
fi
if [[ -z "${REAL_CLAUDE_BIN:-}" ]]; then
    _cron_real_claude="$(command -v claude 2>/dev/null || true)"
    [[ -n "$_cron_real_claude" ]] && export REAL_CLAUDE_BIN="$_cron_real_claude"
fi

agentic_os_cron_banner \
    "Starting managed cron daemon" \
    "This terminal stays attached while the daemon is running."
agentic_os_cron_info "Launching the shared cron runtime..."

if "$NODE_BIN" "$SCRIPT_PATH" start "$@"; then
    agentic_os_cron_success "Managed cron daemon is running."
    agentic_os_cron_note "Use 'bash scripts/status-crons.sh' to check state or 'bash scripts/logs-crons.sh' to follow logs."
else
    exit_code=$?
    agentic_os_cron_fail "Failed to start the managed cron daemon."
    exit "$exit_code"
fi
