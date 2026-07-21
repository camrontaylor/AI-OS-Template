#!/usr/bin/env bash
# correction-distill.sh - passive backend of the Correction Capture (Learning Loop).
#
# Judgment already happened in-session: confirmed mistakes were auto-tracked as
# bullets under `### Corrections` in the day's context/memory/{date}.md session
# blocks (see AGENTS.md "Correction Capture" + CLAUDE.md "Auto-Tracking"). This
# script is pure plumbing: it reads those bullets from today's and yesterday's
# logs (root and every client) and promotes each into the scope-correct
# context/learnings.md via capture-correction.sh (append-only, deduped).
#
# Deterministic, no LLM. Called nightly by cron/jobs/daily-correction-distill.md.
# Safe to re-run: capture-correction.sh skips duplicates.
set -euo pipefail

# --- locate workspace root (has AGENTS.md, .claude, clients) ---
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

ROOT="${1:-$(find_root "$PWD" || true)}"
if [[ -z "$ROOT" || ! -d "$ROOT" ]]; then
  echo "correction-distill: could not find AI-OS workspace root" >&2
  exit 1
fi

WRITER="$ROOT/scripts/capture-correction.sh"
if [[ ! -f "$WRITER" ]]; then
  echo "correction-distill: writer not found at $WRITER" >&2
  exit 1
fi

# --- today and yesterday (BSD date first, GNU fallback) ---
TODAY="$(date +%F)"
YESTERDAY="$(date -v-1d +%F 2>/dev/null || date -d 'yesterday' +%F 2>/dev/null || echo "$TODAY")"

# --- extract bullets from a named `### <Section>` in a session-log file ---
extract_section() {
  local file="$1" section="$2"
  [[ -f "$file" ]] || return 0
  awk -v sec="^### ${section}[[:space:]]*$" '
    $0 ~ sec { insec=1; next }
    /^#+[[:space:]]/ { insec=0 }
    insec && /^[[:space:]]*[-*][[:space:]]+/ {
      line=$0
      sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line != "") print line
    }
  ' "$file"
}

extract_corrections() { extract_section "$1" "Corrections"; }
extract_preferences() { extract_section "$1" "Preferences"; }

# --- a bullet is real only if it is not a placeholder or template hint ---
is_real_lesson() {
  local text="$1"
  [[ -n "$text" ]] || return 1
  [[ "$text" == "["* ]] && return 1                       # [template hint]
  shopt -s nocasematch
  case "$text" in
    "none yet"*|"none"|"session in progress"*|"n/a"|"nothing"*) shopt -u nocasematch; return 1 ;;
  esac
  if [[ "$text" == *"Only when you were confirmed wrong"* ]]; then shopt -u nocasematch; return 1; fi
  shopt -u nocasematch
  return 0
}

captured=0
dups=0
processed=0
MAX=60

# --- one scope: read its today+yesterday logs, promote each real bullet ---
# Sweeps BOTH capture surfaces the sessions auto-track: `### Corrections`
# (confirmed mistakes -> lessons) and `### Preferences` (the user's do's,
# don'ts, and taste -> the Preferences section). Same judgment-in-session,
# dumb-plumbing-here design for both.
distill_scope() {
  local scope_flag="$1"   # e.g. "--scope root" or "--client acme"
  local memdir="$2"
  local label="$3"
  local f bullet out kind
  for f in "$memdir/$TODAY.md" "$memdir/$YESTERDAY.md"; do
    [[ -f "$f" ]] || continue
    for kind in correction preference; do
      local extractor="extract_corrections"
      [[ "$kind" == "preference" ]] && extractor="extract_preferences"
      while IFS= read -r bullet; do
        [[ -z "$bullet" ]] && continue
        is_real_lesson "$bullet" || continue
        processed=$((processed + 1))
        if [[ "$processed" -gt "$MAX" ]]; then
          echo "correction-distill: hit cap of $MAX bullets in one run; stopping (re-run is safe)."
          return 0
        fi
        # shellcheck disable=SC2086
        out="$(bash "$WRITER" --cwd "$ROOT" $scope_flag --kind "$kind" --lesson "$bullet" 2>&1 || true)"
        if [[ "$out" == *"duplicate lesson already logged"* ]]; then
          dups=$((dups + 1))
        elif [[ "$out" == *"logged to"* ]]; then
          captured=$((captured + 1))
          echo "  [$label/$kind] $bullet"
        fi
      done < <("$extractor" "$f")
    done
  done
}

# root
distill_scope "--scope root" "$ROOT/context/memory" "root"

# every client
if [[ -d "$ROOT/clients" ]]; then
  for cdir in "$ROOT"/clients/*/; do
    [[ -d "${cdir}context/memory" ]] || continue
    slug="$(basename "$cdir")"
    distill_scope "--client $slug" "${cdir}context/memory" "$slug"
  done
fi

echo "correction-distill $TODAY: ${captured} captured, ${dups} duplicates skipped."
[[ "$captured" -eq 0 ]] && echo "[SILENT]"
exit 0
