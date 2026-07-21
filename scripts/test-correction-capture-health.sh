#!/usr/bin/env bash
# Tests the detect/report arm: PROMOTION GAP, SILENT, and OK states.
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

TODAY="$(date +%F)"
TMP="${TMPDIR:-/tmp}/cc-health-test.$$"
mkdir -p "$TMP/.claude" "$TMP/context/memory" "$TMP/clients/acme/context/memory" \
         "$TMP/scripts" "$TMP/cron/jobs"
printf '# AI-OS\n' > "$TMP/AGENTS.md"
printf '# Client: Acme\n' > "$TMP/clients/acme/AGENTS.md"
# active cron job so cron_state = active (not the reason for a GAP)
printf -- "---\nname: Daily Correction Distill\nactive: 'true'\nrunner: shell\n---\n" \
  > "$TMP/cron/jobs/daily-correction-distill.md"
cp "$REAL_REPO/scripts/capture-correction.sh" "$TMP/scripts/"
cp "$REAL_REPO/scripts/correction-distill.sh" "$TMP/scripts/"
HEALTH="$REAL_REPO/scripts/correction-capture-health.sh"
cleanup() { trash "$TMP" 2>/dev/null || /bin/rm -rf "$TMP"; }
trap cleanup EXIT

info "Running correction-capture-health tests..."

# --- Scenario SILENT: no corrections anywhere, cron active ---
out="$(bash "$HEALTH" --root "$TMP")"
[[ "$out" == *"Loop status: SILENT"* ]] || fail "empty workspace should be SILENT, got: $(echo "$out" | grep 'Loop status')"
ok "no corrections -> SILENT"

# --- Scenario PROMOTION GAP: a recorded correction not in learnings ---
cat > "$TMP/context/memory/$TODAY.md" <<EOF
# $TODAY
## Session 1
<!-- aios-session-id: t -->
### Corrections
- Wrong: I said the moon is cheese. Actual: it is rock. Lesson: verify GAPMARKER claims.
### Open threads
- x
EOF
out="$(bash "$HEALTH" --root "$TMP")"
[[ "$out" == *"Loop status: PROMOTION GAP"* ]] || fail "unpromoted correction should be PROMOTION GAP"
[[ "$out" == *"1 recorded"* ]] || fail "should count 1 recorded root correction"
[[ "$out" == *"GAPMARKER"* ]] || fail "should surface the first gap example"
ok "recorded-but-unpromoted -> PROMOTION GAP (with example)"

# --- Scenario OK: run the distill to promote it, then re-check ---
bash "$TMP/scripts/correction-distill.sh" "$TMP" >/dev/null
out="$(bash "$HEALTH" --root "$TMP")"
[[ "$out" == *"Loop status: OK"* ]] || fail "after distill it should be OK, got: $(echo "$out" | grep 'Loop status')"
[[ "$out" == *"0 gap(s)"* ]] || fail "after distill gaps should be 0"
ok "after distill promotes it -> OK, 0 gaps"

# --- Scenario cron missing -> PROMOTION GAP even with no gaps ---
trash "$TMP/cron/jobs/daily-correction-distill.md" 2>/dev/null || /bin/rm -f "$TMP/cron/jobs/daily-correction-distill.md"
out="$(bash "$HEALTH" --root "$TMP")"
[[ "$out" == *"daily-correction-distill: MISSING"* ]] || fail "should detect missing cron job"
[[ "$out" == *"Loop status: PROMOTION GAP"* ]] || fail "missing cron should flag PROMOTION GAP"
ok "missing/disabled cron job -> flagged"

# --- report file written ---
[[ -f "$TMP/projects/ops-cron/correction-capture-health_$TODAY.md" ]] \
  || fail "did not write the dated report file"
ok "writes a dated report to projects/ops-cron/"

ok "correction-capture-health tests passed"
