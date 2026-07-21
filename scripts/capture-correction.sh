#!/usr/bin/env bash
# capture-correction.sh - AI-OS Correction Capture (Learning Loop) writer
#
# Appends ONE confirmed correction as a dated lesson to the scope-correct
# context/learnings.md, so the system learns from mistakes over time.
#
# This is the BACKEND writer for the passive Correction Capture loop described in
# AGENTS.md. It is called by the nightly cron job cron/jobs/daily-correction-distill.md,
# which mines the day's session record for confirmed corrections. It is NOT meant
# to be run by the interactive agent mid-conversation. It resolves root-vs-client
# scope, creates learnings.md and the target section if missing, dedups against
# existing entries, and appends in the house format. Append-only: it never edits
# or deletes an existing entry.
#
# Usage:
#   bash scripts/capture-correction.sh \
#     --wrong "what I asserted / believed" \
#     --actual "what is actually true" \
#     --confirmed "how it was confirmed (user agreed / test / file / tool)" \
#     --lesson "the rule to apply next time" \
#     [--skill <skill-folder-name>]   # route to that skill's section
#     [--scope root|client]           # override auto-scope
#     [--client <slug>]               # target a specific client folder
#     [--cwd <dir>]                   # workspace to resolve from (default: PWD)
#     [--prompt "<user text>"]        # helps auto-scope to a named client
#
# Notes:
# - Without --skill, the entry lands under "# General" -> "## What doesn't work well".
# - With --skill, it lands under "# Individual Skills" -> "## {skill}".
# - Scope: if run from inside a clients/<slug> folder, defaults to that client.
#   From root, defaults to root unless --client or a single clear client name is
#   given via --prompt. Shared/AI-OS/all-client facts always stay at root.
set -euo pipefail

WRONG=""
ACTUAL=""
CONFIRMED=""
LESSON=""
SKILL=""
SCOPE=""
CLIENT=""
CWD="$PWD"
PROMPT=""
KIND="correction"   # correction (default) | preference

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wrong) WRONG="${2:-}"; shift 2 ;;
    --actual) ACTUAL="${2:-}"; shift 2 ;;
    --confirmed) CONFIRMED="${2:-}"; shift 2 ;;
    --lesson) LESSON="${2:-}"; shift 2 ;;
    --kind) KIND="${2:-}"; shift 2 ;;
    --skill) SKILL="${2:-}"; shift 2 ;;
    --scope) SCOPE="${2:-}"; shift 2 ;;
    --client) CLIENT="${2:-}"; shift 2 ;;
    --cwd) CWD="${2:-}"; shift 2 ;;
    --prompt) PROMPT="${2:-}"; shift 2 ;;
    *) echo "capture-correction: unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LESSON" ]]; then
  echo "capture-correction: --lesson is required (the rule to apply next time)" >&2
  exit 2
fi

# --- find the workspace root (has AGENTS.md, .claude, clients) ---
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

# --- find the nearest context root (has context/ + AGENTS.md or CLAUDE.md) ---
find_context_root() {
  local dir="$1"
  for _ in $(seq 1 16); do
    if [[ -d "$dir/context" && ( -f "$dir/AGENTS.md" || -f "$dir/CLAUDE.md" ) ]]; then
      echo "$dir"; return 0
    fi
    local parent; parent="$(dirname "$dir")"
    [[ "$parent" == "$dir" ]] && break
    dir="$parent"
  done
  return 1
}

CWD="$(cd "$CWD" 2>/dev/null && pwd || echo "$PWD")"
WORKSPACE_ROOT="$(find_root "$CWD" || true)"
CONTEXT_ROOT="$(find_context_root "$CWD" || true)"

if [[ -z "$WORKSPACE_ROOT" ]]; then
  echo "capture-correction: could not find AI-OS workspace root from $CWD" >&2
  exit 1
fi
[[ -z "$CONTEXT_ROOT" ]] && CONTEXT_ROOT="$WORKSPACE_ROOT"

# --- resolve the target folder (root vs a client) ---
TARGET_ROOT="$WORKSPACE_ROOT"

# 1) explicit --client wins
if [[ -n "$CLIENT" ]]; then
  if [[ -d "$WORKSPACE_ROOT/clients/$CLIENT/context" ]]; then
    TARGET_ROOT="$WORKSPACE_ROOT/clients/$CLIENT"
  else
    echo "capture-correction: client '$CLIENT' not found under clients/" >&2
    exit 1
  fi
# 2) explicit --scope root forces root
elif [[ "$SCOPE" == "root" ]]; then
  TARGET_ROOT="$WORKSPACE_ROOT"
# 3) running inside a client folder defaults to that client
elif [[ "$(basename "$(dirname "$CONTEXT_ROOT")")" == "clients" ]]; then
  TARGET_ROOT="$CONTEXT_ROOT"
# 4) from root, a --prompt that clearly names exactly one client routes there
elif [[ -n "$PROMPT" ]]; then
  shared_re='(ai-?os|template|shared|methodology|memory system|memsearch|migration|all[- ]client|multi[- ]client|every client|all clients)'
  if ! echo "$PROMPT" | grep -qiE "$shared_re"; then
    matched=""
    count=0
    if [[ -d "$WORKSPACE_ROOT/clients" ]]; then
      for cdir in "$WORKSPACE_ROOT"/clients/*/; do
        [[ -d "${cdir}context" ]] || continue
        slug="$(basename "$cdir")"
        name="$slug"
        if [[ -f "${cdir}AGENTS.md" ]]; then
          first="$(head -n 1 "${cdir}AGENTS.md" | sed 's/^# Client:[[:space:]]*//')"
          [[ -n "$first" ]] && name="$first"
        fi
        slug_re="$(echo "$slug" | sed 's/[-_]/[ _-]/g')"
        if echo "$PROMPT" | grep -qiE "(^|[^a-z0-9])(${slug_re}|$(echo "$name" | sed 's/[^a-zA-Z0-9]/./g'))([^a-z0-9]|\$)"; then
          matched="$cdir"; count=$((count + 1))
        fi
      done
    fi
    if [[ "$count" -eq 1 ]]; then
      TARGET_ROOT="${matched%/}"
    fi
  fi
fi

LEARNINGS="$TARGET_ROOT/context/learnings.md"
TODAY="$(date +%Y-%m-%d)"

# --- section routing ---
# Preferences (the user's do's, don'ts, and taste, gleaned from sessions) get
# their own General section so "what good looks like" accumulates separately
# from mistakes; a preference naming a skill still routes to that skill.
if [[ -n "$SKILL" ]]; then
  TOP_HEADING="# Individual Skills"
  SUB_HEADING="## $SKILL"
elif [[ "$KIND" == "preference" ]]; then
  TOP_HEADING="# General"
  SUB_HEADING="## Preferences"
else
  TOP_HEADING="# General"
  SUB_HEADING="## What doesn't work well"
fi

# --- ensure learnings.md exists ---
mkdir -p "$TARGET_ROOT/context"
if [[ ! -f "$LEARNINGS" ]]; then
  cat > "$LEARNINGS" <<'EOF'
# Learnings Journal

> Auto-maintained by AI-OS skills. Newest entries at the bottom of each section.
> Skills append here after deliverable feedback. Never delete entries.
> Section headings match skill folder names exactly.

# General
## What works well

## What doesn't work well

# Individual Skills
EOF
fi

# --- build the entry line (fields separated by periods for readability) ---
trim_dot() { printf '%s' "${1%.}"; }
if [[ "$KIND" == "preference" ]]; then
  ENTRY="- ${TODAY}: Preference."
else
  ENTRY="- ${TODAY}: Correction."
fi
[[ -n "$WRONG" ]]     && ENTRY="$ENTRY Wrong: $(trim_dot "$WRONG")."
[[ -n "$ACTUAL" ]]    && ENTRY="$ENTRY Actual: $(trim_dot "$ACTUAL")."
[[ -n "$CONFIRMED" ]] && ENTRY="$ENTRY Confirmed by: $(trim_dot "$CONFIRMED")."
if [[ "$KIND" == "preference" ]]; then
  ENTRY="$ENTRY $(trim_dot "$LESSON")."
else
  ENTRY="$ENTRY Lesson: $(trim_dot "$LESSON")."
fi
# normalise: strip any en/em dashes to a plain hyphen (house rule)
ENTRY="$(printf '%s' "$ENTRY" | sed $'s/—/ - /g; s/–/-/g')"

# --- dedup: skip if the lesson text already appears in this file ---
LESSON_KEY="$(printf '%s' "$LESSON" | tr -s '[:space:]' ' ' | sed 's/[[:space:]]*$//')"
if [[ -n "$LESSON_KEY" ]] && grep -Fq "$LESSON_KEY" "$LEARNINGS" 2>/dev/null; then
  echo "capture-correction: duplicate lesson already logged in $LEARNINGS - skipped."
  exit 0
fi

# --- ensure the top heading exists ---
if ! grep -qxF "$TOP_HEADING" "$LEARNINGS"; then
  printf '\n%s\n' "$TOP_HEADING" >> "$LEARNINGS"
fi

# --- insert the entry under the sub heading, creating the sub heading if needed ---
python3 - "$LEARNINGS" "$TOP_HEADING" "$SUB_HEADING" "$ENTRY" <<'PY'
import sys

path, top, sub, entry = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(path, "r", encoding="utf-8") as f:
    lines = f.read().split("\n")

def is_h1(l): return l.startswith("# ") and not l.startswith("## ")
def is_h2(l): return l.startswith("## ")

# find the top (h1) block range
top_idx = next((i for i, l in enumerate(lines) if l.strip() == top), None)
if top_idx is None:
    lines += ["", top]
    top_idx = len(lines) - 1

# end of the top block = next h1 or EOF
end_idx = len(lines)
for i in range(top_idx + 1, len(lines)):
    if is_h1(lines[i]):
        end_idx = i
        break

# find the sub (h2) inside the top block
sub_idx = next((i for i in range(top_idx + 1, end_idx) if lines[i].strip() == sub), None)
if sub_idx is None:
    insert_at = end_idx
    block = [sub, "", entry, ""]
    lines[insert_at:insert_at] = block
else:
    # end of the sub block = next h2/h1 or end of top block
    sub_end = end_idx
    for i in range(sub_idx + 1, end_idx):
        if is_h2(lines[i]) or is_h1(lines[i]):
            sub_end = i
            break
    insert_at = sub_end
    while insert_at - 1 > sub_idx and lines[insert_at - 1].strip() == "":
        insert_at -= 1
    lines[insert_at:insert_at] = [entry]

with open(path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
PY

echo "capture-correction: logged to $LEARNINGS"
echo "  under $TOP_HEADING > $SUB_HEADING"
echo "  $ENTRY"
