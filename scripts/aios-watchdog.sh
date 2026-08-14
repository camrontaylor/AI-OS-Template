#!/usr/bin/env bash
# aios-watchdog.sh - the independent failsafe that watches the watcher.
#
# Everything else in AI-OS's self-monitoring is itself a cron job: the health
# rollup, the escalation, the audits. If the cron daemon dies, none of them run,
# and the only prior signal was a Claude Code SessionStart hook - which needs the
# user to open a session. This script closes that gap. It runs every ~30 min from
# its OWN launchd agent (com.aios.watchdog), fully independent of the cron daemon,
# and each tick it:
#
#   1. Checks the cron daemon heartbeat. If dead/wedged, it RESTARTS the daemon
#      and pages out-of-band (notify.sh -> phone + macOS), throttled.
#   2. Regenerates the health rollup itself, so the monitoring loop no longer
#      single-points on the daily-health-rollup cron job.
#   3. Runs the escalation pass, so a broken loop reaches the user out-of-band
#      within 30 min instead of waiting for an interactive session.
#
# Read-mostly and self-healing. Always exits 0 so launchd never marks it failed.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" 2>/dev/null || exit 0

STATE_DIR="$ROOT/.command-centre"
LOCKJSON="$STATE_DIR/cron-runtime-lock.json"
ROLLUP="$STATE_DIR/health-rollup.md"
LOG="$STATE_DIR/watchdog.log"
NSTATE="$STATE_DIR/watchdog-notify.json"
LABEL="com.aios.cron-daemon"
UID_NUM="$(id -u)"
HEARTBEAT_STALE_SECS="${AIOS_WATCHDOG_HEARTBEAT_STALE:-300}"
ROLLUP_STALE_HOURS="${AIOS_WATCHDOG_ROLLUP_STALE_HOURS:-48}"
HERMES_CRON_MANIFEST="$ROOT/integrations/hermes/cron-migration/manifest.json"
mkdir -p "$STATE_DIR" 2>/dev/null || true

log() { printf '%s %s\n' "$(date +'%Y-%m-%dT%H:%M:%S%z')" "$*" >> "$LOG" 2>/dev/null || true; }

# notify_throttled KEY THROTTLE_SECS TITLE MESSAGE [PRIORITY]
# Sends via notify.sh at most once per THROTTLE_SECS per KEY, so a crash-loop or a
# persistent outage does not spam. State lives in watchdog-notify.json.
notify_throttled() {
  local key="$1" throttle="$2" title="$3" message="$4" prio="${5:-1}" now last
  now="$(date +%s)"
  last="$(python3 - "$NSTATE" "$key" <<'PY' 2>/dev/null || echo 0
import json, sys
try:
    print(int(json.load(open(sys.argv[1])).get(sys.argv[2], 0)))
except Exception:
    print(0)
PY
)"
  if [ $(( now - last )) -lt "$throttle" ]; then
    log "notify [$key] throttled (${message})"
    return 0
  fi
  bash "$ROOT/scripts/notify.sh" "$title" "$message" "$prio" >/dev/null 2>&1 || true
  python3 - "$NSTATE" "$key" "$now" <<'PY' 2>/dev/null || true
import json, sys
p, k, v = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    d = json.load(open(p))
except Exception:
    d = {}
d[k] = v
json.dump(d, open(p, "w"), indent=2, sort_keys=True)
PY
  log "notify [$key] sent: $message"
}

# --- 1. Cron daemon liveness ------------------------------------------------
heartbeat_age() {
  python3 - "$LOCKJSON" "$HEARTBEAT_STALE_SECS" <<'PY' 2>/dev/null || echo -1
import datetime, json, sys
try:
    d = json.load(open(sys.argv[1]))
    dt = datetime.datetime.fromisoformat(str(d.get("heartbeatAt")).replace("Z", "+00:00"))
    now = datetime.datetime.now(datetime.timezone.utc)
    print(int((now - dt).total_seconds()))
except Exception:
    print(-1)
PY
}

age="$(heartbeat_age)"
daemon_dead=0
runtime_repair_finding=""
hermes_cron_bridge=0
if [ "${AIOS_HERMES_CRON_BRIDGE:-}" = "1" ] || [ -f "$HERMES_CRON_MANIFEST" ]; then
  hermes_cron_bridge=1
fi

if [ "$age" -lt 0 ] 2>/dev/null; then
  daemon_dead=1
  reason="no readable heartbeat"
elif [ "$age" -gt "$HEARTBEAT_STALE_SECS" ] 2>/dev/null; then
  daemon_dead=1
  reason="heartbeat ${age}s stale"
fi

if [ "$hermes_cron_bridge" -eq 1 ] && [ "$daemon_dead" -eq 1 ]; then
  log "cron daemon intentionally stopped; Hermes cron bridge owns scheduling ($reason)"
elif [ "$hermes_cron_bridge" -eq 1 ]; then
  log "cron daemon active while Hermes cron bridge owns scheduling; stopping standalone daemon"
  if bash "$ROOT/scripts/stop-crons.sh" >/dev/null 2>&1; then
    log "cron daemon stopped for Hermes cron bridge"
  else
    log "cron daemon stop FAILED for Hermes cron bridge"
    notify_throttled "cron-daemon-hermes-stop-failed" 3600 "AI-OS watchdog" \
      "Hermes owns scheduling, but the standalone AI-OS cron daemon could not be stopped." 1
  fi
elif [ "$daemon_dead" -eq 1 ]; then
  log "cron daemon looks DOWN ($reason); attempting restart"
  restarted="restart FAILED"
  if launchctl kickstart -k "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
    restarted="kickstarted via launchd"
  elif bash "$ROOT/scripts/start-crons.sh" >/dev/null 2>&1; then
    restarted="revived via start-crons.sh"
  fi
  log "cron daemon: $restarted"
  runtime_repair_finding="cron-runtime:daemon|Cron daemon was down ($reason). Watchdog action: $restarted."
  notify_throttled "cron-daemon-down" 3600 "AI-OS watchdog" \
    "Cron daemon was down ($reason). Action: $restarted. Scheduled self-maintenance had stopped." 1
else
  log "cron daemon healthy (heartbeat ${age}s)"
fi

# --- 2. Regenerate the rollup (do not depend on its own cron job) ------------
if [ -f "$ROOT/scripts/health-rollup.py" ]; then
  if python3 "$ROOT/scripts/health-rollup.py" >/dev/null 2>&1; then
    log "health-rollup regenerated"
  else
    log "health-rollup regeneration errored"
  fi
fi

# Belt and braces: if the rollup is somehow still stale, the whole loop is wedged.
rollup_age_h="$(python3 -c "import os,time;p='$ROLLUP';print(round((time.time()-os.path.getmtime(p))/3600,2) if os.path.exists(p) else 9999)" 2>/dev/null || echo 9999)"
if python3 -c "import sys;sys.exit(0 if float('$rollup_age_h')>float('$ROLLUP_STALE_HOURS') else 1)" 2>/dev/null; then
  notify_throttled "rollup-stale" 86400 "AI-OS watchdog" \
    "Health rollup is ${rollup_age_h}h stale and could not be regenerated; the monitoring loop is wedged." 1
fi

# --- 3. Out-of-band escalation pass -----------------------------------------
if [ -f "$ROOT/scripts/health-escalate.py" ]; then
  if python3 "$ROOT/scripts/health-escalate.py" >/dev/null 2>&1; then
    log "escalation pass ran"
  else
    log "escalation pass errored"
  fi
fi

# --- 4. Repair-session dispatch --------------------------------------------
# The rollup/escalation path tells the user. This path opens the repair lane:
# a complete context packet, and optionally a Codex/Hermes repair session when
# AIOS_CRON_REPAIR_MODE allows it. It is deduped by finding/day.
if [ -f "$ROOT/scripts/cron-repair-dispatch.py" ] && [ "${AIOS_CRON_REPAIR_DISABLE:-0}" != "1" ]; then
  if [ -n "$runtime_repair_finding" ]; then
    if AIOS_CRON_REPAIR_EXTRA_FINDING="$runtime_repair_finding" python3 "$ROOT/scripts/cron-repair-dispatch.py" >/dev/null 2>&1; then
      log "repair dispatch pass ran with runtime finding"
    else
      log "repair dispatch pass errored with runtime finding"
    fi
  else
    if python3 "$ROOT/scripts/cron-repair-dispatch.py" >/dev/null 2>&1; then
      log "repair dispatch pass ran"
    else
      log "repair dispatch pass errored"
    fi
  fi
fi

exit 0
