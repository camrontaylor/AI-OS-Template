#!/usr/bin/env bash
set -euo pipefail

host="${AIOS_VPS_HOST:-aios-vps}"
ssh_config="${AIOS_VPS_SSH_CONFIG:-$HOME/.ssh/config}"
command_centre_port="${AIOS_VPS_COMMAND_CENTRE_PORT:-3000}"
hermes_port="${AIOS_VPS_HERMES_PORT:-9119}"
hermes_oauth_port="${AIOS_VPS_HERMES_OAUTH_PORT:-8642}"
codex_login_port="${AIOS_VPS_CODEX_LOGIN_PORT:-1455}"

printf 'AI-OS VPS tunnel\n'
printf '  Command Centre: http://127.0.0.1:%s\n' "$command_centre_port"
printf '  Hermes backend: http://127.0.0.1:%s\n' "$hermes_port"
printf '  Host: %s\n\n' "$host"

exec ssh -F "$ssh_config" \
  -o ExitOnForwardFailure=yes \
  -N \
  -L "${command_centre_port}:127.0.0.1:3000" \
  -L "${hermes_port}:127.0.0.1:9119" \
  -L "${hermes_oauth_port}:127.0.0.1:8642" \
  -L "${codex_login_port}:127.0.0.1:1455" \
  "$host"
