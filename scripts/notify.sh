#!/usr/bin/env bash
# notify.sh - the one notification entry point for AI-OS scripts.
#
# Usage: bash scripts/notify.sh "Title" "Message" [priority]
#   priority: 0 normal (default), 1 high (bypasses quiet hours),
#             2 emergency (repeats until acknowledged) - Pushover semantics.
#
# Channels, in order:
#   1. Pushover (reaches the phone when away from the Mac) - fires only when
#      PUSHOVER_TOKEN and PUSHOVER_USER exist in the root .env. Setup is a
#      one-time ~10 minutes; see docs/connectors.md "Notifications".
#   2. macOS notification (always, when on macOS) - covers at-the-Mac.
# Never fails the caller: exit 0 always.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TITLE="${1:-AI-OS}"
MESSAGE="${2:-notification}"
PRIORITY="${3:-0}"

# Pushover keys are read blind from .env at runtime; values never echo.
PUSHOVER_TOKEN=""
PUSHOVER_USER=""
if [ -f "$ROOT/.env" ]; then
  PUSHOVER_TOKEN="$(sed -n 's/^\(export \)\{0,1\}PUSHOVER_TOKEN=//p' "$ROOT/.env" | head -1 | tr -d '"'"'"'')"
  PUSHOVER_USER="$(sed -n 's/^\(export \)\{0,1\}PUSHOVER_USER=//p' "$ROOT/.env" | head -1 | tr -d '"'"'"'')"
fi

if [ -n "$PUSHOVER_TOKEN" ] && [ -n "$PUSHOVER_USER" ]; then
  extra=()
  [ "$PRIORITY" = "2" ] && extra=(-F "retry=60" -F "expire=1800")
  curl -s --max-time 10 \
    -F "token=$PUSHOVER_TOKEN" -F "user=$PUSHOVER_USER" \
    -F "title=$TITLE" -F "message=$MESSAGE" -F "priority=$PRIORITY" \
    ${extra[@]+"${extra[@]}"} \
    https://api.pushover.net/1/messages.json >/dev/null 2>&1 \
    && echo "notify: sent to phone (Pushover)" \
    || echo "notify: Pushover send failed (offline?); macOS notification still fires" >&2
fi

if [ "$(uname)" = "Darwin" ]; then
  esc_title="$(printf '%s' "$TITLE" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  esc_msg="$(printf '%s' "$MESSAGE" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')"
  osascript -e "display notification \"$esc_msg\" with title \"$esc_title\"" >/dev/null 2>&1 || true
fi
exit 0
