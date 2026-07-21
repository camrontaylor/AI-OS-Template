#!/usr/bin/env bash
# correction-capture-health.sh - the detect/report arm of the Correction Capture
# (Learning Loop). AI-OS design philosophy (docs/meta/design-philosophy.md) says a
# self-maintaining change must add a loop that detects and reports and is paired
# with a health check; otherwise it is only a patch. This is that health check.
#
# It answers: is the correction loop actually capturing and promoting, or running
# silent? Deterministic, no LLM.
#
# Signals (root and every client, over a window, default 30 days):
#   - recorded: `### Corrections` and `### Preferences` bullets in daily logs.
#   - promoted: dated "Correction." entries in learnings.md.
#   - gap:      a recorded bullet NOT found in that scope's learnings.md
#               (capture happened but the distill did not promote it).
#   - cron:     is cron/jobs/daily-correction-distill.md present and active.
#
# Status: OK | PROMOTION GAP | SILENT. Prints a scorecard, writes a dated report
# to projects/ops-cron/, and emits [SILENT] when healthy so cron suppresses the
# notification. Honest limit: it cannot see a correction that was never recorded
# in a daily log; verifying capture completeness needs the transcript backstop.
set -euo pipefail

WINDOW=30
ROOT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --window) WINDOW="${2:-30}"; shift 2 ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

find_root() {
  local dir="$1"
  for _ in $(seq 1 16); do
    if [[ -f "$dir/AGENTS.md" && -d "$dir/.claude" && -d "$dir/clients" ]]; then
      echo "$dir"; return 0
    fi
    local parent; parent="$(dirname "$dir")"
    [[ "$parent" == "$dir" ]] && break
    dir="$parent"
  done
  return 1
}

[[ -z "$ROOT" ]] && ROOT="$(find_root "$PWD" || true)"
if [[ -z "$ROOT" || ! -d "$ROOT" ]]; then
  echo "correction-capture-health: could not find AI-OS workspace root" >&2
  exit 1
fi

TODAY="$(date +%F)"
CUTOFF="$(date -v-"${WINDOW}"d +%F 2>/dev/null || date -d "${WINDOW} days ago" +%F 2>/dev/null || echo "0000-00-00")"

# extract real `### Corrections` bullets from one session-log file
extract_corrections() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  awk '
    /^### (Corrections|Preferences)[[:space:]]*$/ { incorr=1; next }
    /^#+[[:space:]]/ { incorr=0 }
    incorr && /^[[:space:]]*[-*][[:space:]]+/ {
      line=$0
      sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      low=tolower(line)
      if (line=="" ) next
      if (low ~ /^none( yet)?\.?$/ || low ~ /^session in progress/ || line ~ /^\[/) next
      if (line ~ /Only when you were confirmed wrong/) next
      print line
    }
  ' "$file"
}

# dash-insensitive distinctive prefix for matching a bullet against learnings.md
match_key() {
  printf '%s' "$1" | sed $'s/[—–]/-/g' | cut -c1-60
}

recorded=0
promoted=0
gaps=0
gap_examples=""
scope_lines=""

scan_scope() {
  local label="$1" memdir="$2" learnings="$3"
  local rec=0 miss=0 f bullet key
  # recorded corrections in window
  if [[ -d "$memdir" ]]; then
    for f in "$memdir"/*.md; do
      [[ -f "$f" ]] || continue
      local base; base="$(basename "$f" .md)"
      [[ "$base" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
      [[ "$base" < "$CUTOFF" ]] && continue
      while IFS= read -r bullet; do
        [[ -z "$bullet" ]] && continue
        rec=$((rec + 1))
        key="$(match_key "$bullet")"
        if [[ -f "$learnings" ]] && grep -Fq "$key" <(sed $'s/[—–]/-/g' "$learnings"); then
          :
        else
          miss=$((miss + 1))
          [[ -z "$gap_examples" ]] && gap_examples="[$label] $bullet"
        fi
      done < <(extract_corrections "$f")
    done
  fi
  # promoted corrections in window
  local prom=0
  if [[ -f "$learnings" ]]; then
    prom=$( { grep -hE '^- 20[0-9]{2}-[0-9]{2}-[0-9]{2}: Correction' "$learnings" 2>/dev/null || true; } \
      | awk -v c="$CUTOFF" '{d=substr($2,1,10); if (d >= c) n++} END{print n+0}')
  fi
  recorded=$((recorded + rec))
  promoted=$((promoted + prom))
  gaps=$((gaps + miss))
  scope_lines="${scope_lines}- ${label}: ${rec} recorded, ${prom} promoted, ${miss} gap(s)\n"
}

scan_scope "root" "$ROOT/context/memory" "$ROOT/context/learnings.md"
if [[ -d "$ROOT/clients" ]]; then
  for cdir in "$ROOT"/clients/*/; do
    [[ -d "${cdir}context/memory" ]] || continue
    scan_scope "$(basename "$cdir")" "${cdir}context/memory" "${cdir}context/learnings.md"
  done
fi

# cron liveness
CRON_JOB="$ROOT/cron/jobs/daily-correction-distill.md"
if [[ ! -f "$CRON_JOB" ]]; then
  cron_state="MISSING"
elif grep -qE "^active:[[:space:]]*'?true'?" "$CRON_JOB"; then
  cron_state="active"
else
  cron_state="INACTIVE"
fi

# status + recommendation
if [[ "$gaps" -gt 0 || "$cron_state" != "active" ]]; then
  status="PROMOTION GAP"
  if [[ "$cron_state" != "active" ]]; then
    rec_line="daily-correction-distill is ${cron_state}. Restore/enable it, then run: bash scripts/correction-distill.sh"
  else
    rec_line="${gaps} recorded correction(s) were not promoted. Run: bash scripts/correction-distill.sh (then re-check)."
  fi
elif [[ "$recorded" -eq 0 ]]; then
  status="SILENT"
  rec_line="No corrections recorded in the last ${WINDOW} days. Either a genuinely clean window, or capture is not firing in-session. If sessions clearly had confirmed mistakes, capture is leaking - consider the transcript backstop."
else
  status="OK"
  rec_line="Loop is live: corrections are being recorded and promoted. No action needed."
fi

REPORT_DIR="$ROOT/projects/ops-cron"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/correction-capture-health_${TODAY}.md"
{
  echo "## Correction Capture Health - ${TODAY}"
  echo
  echo "### Loop status: ${status}"
  echo
  echo "### Capture (last ${WINDOW} days)"
  printf '%b' "$scope_lines"
  echo "- TOTAL: ${recorded} recorded, ${promoted} promoted, ${gaps} gap(s)"
  echo
  echo "### Cron"
  echo "- daily-correction-distill: ${cron_state}"
  echo
  echo "### Recommendation"
  echo "- ${rec_line}"
  [[ -n "$gap_examples" ]] && { echo; echo "### First gap"; echo "- ${gap_examples}"; }
  echo
  echo "> Detects recording->promotion health only. It cannot see a correction that was never recorded in a daily log; verifying capture completeness needs the transcript backstop (not built)."
} | tee "$REPORT"

[[ "$status" == "OK" ]] && echo "[SILENT]"
exit 0
