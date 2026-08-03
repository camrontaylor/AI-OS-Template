#!/usr/bin/env bash
# deadman-check.sh - independent dead-man's switch for AI-OS cron.
#
# Runs under its OWN launchd schedule (com.aios.cron-deadman), separate from the
# cron daemon, so it can detect the cron system being DEAD - the one failure a
# cron job can never report about itself (daemon crashed, Mac was off for days,
# or the leader is wedged).
#
# Signal: has ANY cron job completed in the last MAX_AGE_H hours? This tolerates
# normal overnight laptop sleep (jobs still run daily) but catches genuine death.
# On a problem it pushes to the phone via notify-push.js, de-duped so it alerts
# at most once per RENOTIFY_H window instead of every run.
#
# Never fails the launchd job: all paths exit 0.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CC="$REPO/.command-centre"
STATUS_DIR="$REPO/cron/status"
MAX_AGE_H="${AIOS_DEADMAN_MAX_AGE_H:-26}"
RENOTIFY_H="${AIOS_DEADMAN_RENOTIFY_H:-12}"
STATE="$CC/deadman-state"
now="$(date +%s)"

newest=0
if [ -d "$STATUS_DIR" ]; then
  for f in "$STATUS_DIR"/*.json; do
    [ -e "$f" ] || continue
    m="$(stat -f %m "$f" 2>/dev/null || echo 0)"
    [ "$m" -gt "$newest" ] && newest="$m"
  done
fi

age_h=999
[ "$newest" -gt 0 ] && age_h=$(( (now - newest) / 3600 ))

# Healthy: a job completed within the window. Reset state, stay silent.
if [ "$newest" -gt 0 ] && [ "$age_h" -lt "$MAX_AGE_H" ]; then
  echo "0" > "$STATE" 2>/dev/null || true
  echo "healthy: newest cron job completed ${age_h}h ago (threshold ${MAX_AGE_H}h)"
  exit 0
fi

# Unhealthy. De-dup: skip if we already alerted within RENOTIFY_H.
last_alert=0
[ -f "$STATE" ] && last_alert="$(cat "$STATE" 2>/dev/null || echo 0)"
if [ "$last_alert" -gt 0 ] && [ $(( (now - last_alert) / 3600 )) -lt "$RENOTIFY_H" ]; then
  echo "unhealthy (~${age_h}h) but alerted $(( (now - last_alert) / 3600 ))h ago; skip re-notify"
  exit 0
fi

msg="No AI-OS cron job has completed in ~${age_h}h (threshold ${MAX_AGE_H}h). The scheduler may be down - daemon crashed, Mac was off, or the leader is stuck. Check: bash scripts/status-crons.sh"
NODE_BIN="$(command -v node || echo node)"
AIOS_WORKSPACE_DIR="$REPO" "$NODE_BIN" "$REPO/scripts/cron/notify-push.js" \
  "AI-OS cron may be DOWN" "$msg" "urgent" >/dev/null 2>&1 || true
echo "$now" > "$STATE" 2>/dev/null || true
echo "ALERTED: $msg"
exit 0
