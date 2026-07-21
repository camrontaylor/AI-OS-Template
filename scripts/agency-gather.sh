#!/usr/bin/env bash
# agency-gather.sh - the executed backstop for Agency Discipline (AGENTS.md).
#
# Puts the load-bearing context in front of the model so it cannot "forget to
# look". It does NOT dump whole folders: it refreshes and prints the curated
# brief plus a small set of hot files, then a manifest (filename, size, first
# heading) of everything else, so the model issues targeted reads. There is a
# hard character budget so a large client folder can never rot the context.
#
# Usage:
#   bash scripts/agency-gather.sh <slug>     # client mode
#   bash scripts/agency-gather.sh            # auto-detect from cwd, else system mode
#   bash scripts/agency-gather.sh --system   # force system mode
#
# Read-only. Never fails hard on a missing file; it is a helper, not a gate.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(git -C "$SCRIPT_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$ROOT" ] && ROOT="$SCRIPT_ROOT"

CHAR_BUDGET="${AGENCY_GATHER_BUDGET:-40000}"
SPENT=0

heading_of() { grep -m1 '^#' "$1" 2>/dev/null | sed 's/^#\+ *//' | head -c 100; }
size_of() { wc -c < "$1" 2>/dev/null | tr -d ' '; }

# Print a file body if the budget allows; otherwise list it as manifest-only.
emit_file() {
  local f="$1"
  [ -f "$f" ] || return 0
  local sz; sz="$(size_of "$f")"; [ -z "$sz" ] && sz=0
  local rel="${f#"$ROOT"/}"
  if [ "$((SPENT + sz))" -le "$CHAR_BUDGET" ]; then
    echo "----- BEGIN $rel ($sz chars) -----"
    cat "$f"
    echo "----- END $rel -----"
    echo
    SPENT="$((SPENT + sz))"
  else
    echo "- $rel ($sz chars) : $(heading_of "$f")   [over budget, read on demand]"
  fi
}

# Print a manifest line for a file (never inlines).
manifest_line() {
  local f="$1"; [ -f "$f" ] || return 0
  local rel="${f#"$ROOT"/}"
  echo "- $rel ($(size_of "$f") chars) : $(heading_of "$f")"
}

manifest_dir() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  # Sorted, files only, recursive, markdown and text.
  find "$dir" -type f \( -name '*.md' -o -name '*.txt' \) 2>/dev/null | sort | while read -r f; do
    manifest_line "$f"
  done
}

# ---- mode detection ----
MODE=""
SLUG=""
ARG="${1:-}"

if [ "$ARG" = "--system" ]; then
  MODE="system"
elif [ -n "$ARG" ] && [ -d "$ROOT/clients/$ARG" ]; then
  MODE="client"; SLUG="$ARG"
elif [ -z "$ARG" ]; then
  # auto-detect from cwd: inside clients/<slug>/ ?
  CWD="$(pwd)"
  case "$CWD" in
    "$ROOT"/clients/*)
      SLUG="$(echo "${CWD#"$ROOT"/clients/}" | cut -d/ -f1)"
      [ -n "$SLUG" ] && [ -d "$ROOT/clients/$SLUG" ] && MODE="client"
      ;;
  esac
  [ -z "$MODE" ] && MODE="system"
else
  echo "agency-gather: no client folder 'clients/$ARG'. Running system mode." >&2
  MODE="system"
fi

echo "# Agency gather - mode: $MODE${SLUG:+ (client: $SLUG)}"
echo "# Budget: $CHAR_BUDGET chars for inlined bodies; the rest is manifest-only, read on demand."
echo

if [ "$MODE" = "client" ]; then
  CDIR="$ROOT/clients/$SLUG"

  # Refresh the curated brief first (the layer that already indexes the folder).
  if [ -x "$ROOT/scripts/client-memory-maintenance.sh" ]; then
    bash "$ROOT/scripts/client-memory-maintenance.sh" --mode brief --client "$SLUG" >/dev/null 2>&1 \
      || bash "$ROOT/scripts/client-memory-maintenance.sh" --mode brief >/dev/null 2>&1 || true
  fi

  echo "## Hot files (read these; they are already curated)"
  echo
  emit_file "$CDIR/context/current-state.md"
  emit_file "$CDIR/context/MEMORY.md"
  emit_file "$CDIR/context/learnings.md"
  # Client overview, if present.
  for ov in "$CDIR"/context/*overview*.md; do emit_file "$ov"; done

  echo "## Manifest: clients/$SLUG/context/  (targeted-read what the job needs)"
  manifest_dir "$CDIR/context"
  echo
  echo "## Manifest: clients/$SLUG/brand_context/"
  manifest_dir "$CDIR/brand_context"
  echo
  echo "## Taste calls learned so far"
  emit_file "$CDIR/context/learnings.md" >/dev/null 2>&1 || true
  grep -A20 '## Taste calls' "$CDIR/context/learnings.md" 2>/dev/null || echo "- none recorded yet"

else
  # system mode
  echo "## Hot files (root working memory)"
  echo
  emit_file "$ROOT/context/MEMORY.md"

  echo "## Recent session logs (most recent first; read the relevant ones)"
  find "$ROOT/context/memory" -maxdepth 1 -type f -name '*.md' 2>/dev/null \
    | sort -r | head -5 | while read -r f; do manifest_line "$f"; done
  echo
  echo "## System-work grounding reminder"
  echo "- Read the file(s) the prompt names before asserting anything about them."
  echo "- Matching skills: .claude/skills/<name>/SKILL.md   |   hooks: .claude/hooks/<name>.js"
  echo "- Design source of truth for 'why is it built this way': docs/meta/"
  echo "- Standing rule: CLAUDE.local.md 2026-06-16 (ground before you assert)."
  echo
  echo "## Taste / workflow calls learned so far (root)"
  grep -A20 '## Taste calls' "$ROOT/context/learnings.md" 2>/dev/null || echo "- none recorded yet"
fi

echo
echo "# Inlined ~$SPENT chars. Everything above the budget is listed in the manifest; issue targeted reads."
