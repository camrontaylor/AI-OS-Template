#!/usr/bin/env bash
# Report whether the shared agent dashboard session is valid (headless, no window). Re-auths from a fresh invite if expired.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; source "$DIR/_common.sh"
require_agent_browser

[ -d "$CD_PROFILE" ] || { warn "no saved session at $CD_PROFILE. Run: bash relogin.sh"; exit 1; }
cd_close
cd_open "$CD_HOST/dashboard" >/dev/null
ab wait 4000 >/dev/null 2>&1 || true
URL="$(ab get url 2>/dev/null || true)"
if cd_authed "$URL"; then
  cd_close; ok "Session valid. Landed on: $URL"
else
  warn "Session expired - trying to re-auth from a fresh invite..."
  if cd_relogin; then ok "Auto-renewed. Landed on: $(ab get url 2>/dev/null)"; cd_close
  else cd_close; err "Could not renew. Run: bash relogin.sh"; exit 2; fi
fi
