#!/usr/bin/env bash
# (Re)establish the agent's dashboard session by reading a fresh dashboard invite from its own inbox and completing the join.
# No password. Run on first setup or whenever the session has expired.
# Exit: 0 ok | 2 no invite found / join failed | 3 ops-agent-email unavailable
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$DIR/_common.sh"
require_agent_browser

info "Reading the latest dashboard invite for $CD_EMAIL from the agent inbox and re-joining..."
if cd_relogin; then
  ok "Agent dashboard session established: $(ab get url 2>/dev/null)"
  cd_close
  exit 0
fi
rc=$?
cd_close
exit "$rc"
