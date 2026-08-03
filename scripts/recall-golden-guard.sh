#!/usr/bin/env bash
# recall-golden-guard.sh - snapshot / verify / restore net for golden recall sets.
#
# The daily-recall-self-improve job edits golden sets autonomously. This gives it
# a deterministic undo point that does not depend on git (autosave would happily
# commit a corrupt set). Contract for the job:
#   1. `snapshot`  BEFORE any edit  - copies every golden set to a dated backup.
#   2. ... make edits ...
#   3. `verify`    AFTER edits       - validates every set; on failure it AUTO-
#                                      RESTORES from the snapshot and exits non-zero.
# `restore` is also available manually. Snapshots live in .backup/recall-golden/
# (gitignored backup tree) and never hard-delete anything.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
BACKUP_ROOT="$ROOT/.backup/recall-golden"
STAMP_FILE="$BACKUP_ROOT/.last-snapshot"

golden_sets() {
  # The shared base, plus every per-client overlay (real independent files). The
  # clients/*/scripts/lib path is a symlink back to base, so it is NOT listed
  # separately - it is the same file as base.
  echo "$ROOT/scripts/lib/recall-golden-set.json"
  ls "$ROOT"/clients/*/.recall/golden-additions.json 2>/dev/null || true
}

rel() { echo "${1#"$ROOT"/}"; }

snapshot() {
  local dest="$BACKUP_ROOT/$(date +%Y-%m-%dT%H-%M-%S)"
  mkdir -p "$dest"
  local n=0
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    local key; key="$(rel "$f" | tr '/' '__')"
    cp "$f" "$dest/$key"
    n=$((n+1))
  done < <(golden_sets)
  echo "$dest" > "$STAMP_FILE"
  echo "snapshot: $n golden sets -> $(rel "$dest")"
}

restore() {
  local src; src="$(cat "$STAMP_FILE" 2>/dev/null || true)"
  if [ -z "$src" ] || [ ! -d "$src" ]; then
    echo "restore: no snapshot recorded, cannot restore" >&2
    return 1
  fi
  local n=0
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    local key; key="$(rel "$f" | tr '/' '__')"
    if [ -e "$src/$key" ]; then
      cp "$src/$key" "$f"
      n=$((n+1))
    fi
  done < <(golden_sets)
  echo "restore: reverted $n golden sets from $(rel "$src")"
}

check() {
  # Architecture confirmed 2026-07-29: a client's scripts/lib is a plain directory
  # SYMLINK to root's (add-client.sh: "Link shared scripts from root, symlink never
  # copy"). So the base golden file is physically shared across every scope - by
  # design, and correct for system-recall cases. Per-CLIENT recall lives in an
  # independent overlay outside that symlink. This reports the layout so the acting
  # layer routes writes correctly: system cases -> shared base (root scope only);
  # client cases -> that client's own overlay (always safe).
  local base="$ROOT/scripts/lib/recall-golden-set.json"
  echo "base (shared, system cases): $(rel "$base")"
  local root_inode; root_inode="$(stat -f '%i' "$base" 2>/dev/null || stat -c '%i' "$base")"
  local n=0
  for f in "$ROOT"/clients/*/.recall/golden-additions.json; do
    [ -e "$f" ] || continue
    local inode; inode="$(stat -f '%i' "$f" 2>/dev/null || stat -c '%i' "$f")"
    if [ "$inode" = "$root_inode" ]; then
      echo "WARNING: $(rel "$f") shares base's inode - overlay is NOT independent"
      return 1
    fi
    echo "overlay (independent): $(rel "$f")"
    n=$((n+1))
  done
  echo "check: $n independent client overlays over 1 shared base - routing is safe"
  return 0
}

verify() {
  if python3 "$ROOT/scripts/recall-golden-validate.py" --all; then
    echo "verify: golden sets valid"
    return 0
  fi
  echo "verify: FAILED validation - auto-restoring from snapshot" >&2
  restore
  return 1
}

case "${1:-}" in
  snapshot) snapshot ;;
  check)    check ;;
  verify)   verify ;;
  restore)  restore ;;
  *) echo "usage: bash scripts/recall-golden-guard.sh {snapshot|check|verify|restore}" >&2; exit 2 ;;
esac
