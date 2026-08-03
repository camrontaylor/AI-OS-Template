#!/usr/bin/env bash
# claude-cron-wrapper.sh
#
# Runs the real `claude` binary with headless authentication, so scheduled cron
# jobs can log in. Without this, the cron daemon spawns the bare binary, which has
# no credential and dies with:
#   API Error: 401 authentication_error "Invalid authentication credentials"
#
# Point the cron runtime at this wrapper with:
#   AI_OS_CLAUDE_BIN=/path/to/AI-OS/scripts/claude-cron-wrapper.sh
# (set in the launchd plist env; cron-runtime.js honors AI_OS_CLAUDE_BIN).
#
# AUTH, in order of preference:
#   1. CLAUDE_CODE_OAUTH_TOKEN (the right answer). A long-lived (~1 year) token from
#      `claude setup-token`. Headless, survives reboots. Store it in
#      ~/.config/claude-code-oauth-token (chmod 600) or the launchd env. Run
#      `bash scripts/enable-cron.sh <token>` to wire it up.
#   2. Bare binary. Works only if ~/.claude/.credentials.json exists from `/login`.
set -euo pipefail

# Keep the Mac awake for the duration of THIS job only, so an idle-sleep timer cannot
# cut a job off mid-run. caffeinate -i blocks idle sleep while the job runs, then lets
# the Mac sleep normally again. It does not fight a closed-lid clamshell sleep. We
# re-exec the wrapper under caffeinate once (guarded so it does not loop).
if command -v caffeinate >/dev/null 2>&1 && [[ -z "${_AIOS_CAFFEINATED:-}" ]]; then
  export _AIOS_CAFFEINATED=1
  exec caffeinate -i "$0" "$@"
fi

# Resolve the claude binary. Explicit override wins; otherwise take the newest on
# PATH (the launchd plist puts the nvm bin first, so the daemon gets the current
# version, not the old /usr/local/bin/claude 2.0.76 that had the tool_use-id bug).
REAL_CLAUDE="${REAL_CLAUDE_BIN:-$(command -v claude 2>/dev/null || echo /usr/local/bin/claude)}"
ENV_FILE="${AI_KEYS_ENV_FILE:-$HOME/.config/ai-keys.env}"
OAUTH_TOKEN_FILE="${CLAUDE_OAUTH_TOKEN_FILE:-$HOME/.config/claude-code-oauth-token}"

# Concurrency gate: serialize claude cron sessions so a catch-up replay cannot
# storm the machine into a timeout cluster (see scripts/lib/cron-claude-lock.py).
# launch_claude routes through the gate when it is available and falls open to a
# direct exec otherwise, so a missing helper can never block a job.
WRAPPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_HELPER="$WRAPPER_DIR/lib/cron-claude-lock.py"
launch_claude() {
  if [[ "${AIOS_CRON_CLAUDE_LOCK_DISABLE:-}" != "1" && -f "$LOCK_HELPER" ]] \
     && command -v python3 >/dev/null 2>&1; then
    exec python3 "$LOCK_HELPER" "$REAL_CLAUDE" "$@"
  fi
  exec "$REAL_CLAUDE" "$@"
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line name value
    line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    [[ "$line" == *=* ]] || continue

    name="${line%%=*}"
    value="${line#*=}"
    name="${name%"${name##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    if [[ -z "${!name:-}" ]]; then
      export "$name=$value"
    fi
  done < "$file"
}

# Load integration keys before the Claude OAuth fast path. Previously the wrapper
# skipped this when CLAUDE_CODE_OAUTH_TOKEN was present, so scheduled Claude runs
# could authenticate to Anthropic but still miss NOTION_API_KEY and other MCP/API keys.
load_env_file "$ENV_FILE"

# 1. Long-lived OAuth token (preferred). From `claude setup-token`.
if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" && -f "$OAUTH_TOKEN_FILE" ]]; then
  export CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '[:space:]' < "$OAUTH_TOKEN_FILE")"
fi
if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  launch_claude "$@"
fi

# 2. Bare binary (works only if OAuth /login credentials exist).
launch_claude "$@"
