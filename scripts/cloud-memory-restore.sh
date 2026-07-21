#!/usr/bin/env bash
#
# cloud-memory-restore.sh - pull the latest live memory into a CLOUD / secondary
# checkout so its session starts with current memory instead of stale or empty
# memory.
#
# WHY THIS EXISTS
#   context/MEMORY.md, context/learnings.md, context/memory/ (and the per-client
#   equivalents) are deliberately gitignored (".gitignore" block "Live
#   operational memory - per-machine, must not fork across branches"), so they
#   are NOT in the main AI-OS repo. A cloud session clones the main repo and
#   therefore starts with no live memory - which reads as "memory is always
#   outdated in the cloud".
#
#   The live memory already has an up-to-date off-machine copy: backup-memory.sh
#   snapshots it and pushes it to the PRIVATE camrontaylor/AI-OS-Brain repo on
#   every session. This script is the missing consumer half: it pulls that fresh
#   memory into a cloud checkout before the session reads it.
#
# PRODUCER vs CONSUMER (so this never clobbers your real local memory)
#   - The PRIMARY machine runs backup-memory.sh and owns ~/.ai-os-memory-backup
#     (the brain git repo). There, local memory is the source of truth, so this
#     script SKIPS by default - it must never overwrite live local memory with a
#     snapshot. Override with AIOS_FORCE_MEMORY_RESTORE=1 (used by the test).
#   - A CLOUD checkout has no local brain producer. This script clones the brain
#     repo and copies memory into place.
#
# SAFETY
#   Non-destructive: any existing memory file is backed up next to itself as
#   "<name>.pre-restore-<stamp>" before being replaced, and nothing is deleted.
#   Idempotent: safe to run every session.
#
# AUTH
#   Reads the brain over HTTPS. In order of preference:
#     1. AIOS_BRAIN_TOKEN in the environment -> https://x-access-token:<token>@...
#        (set this as a cloud environment secret; it is never written to disk).
#     2. The ambient git credential helper (works when the cloud GitHub
#        integration can already read the brain repo).
#   Override the source with AIOS_BRAIN_REPO (a git URL) and AIOS_BRAIN_BRANCH.
#
# USAGE
#   bash scripts/cloud-memory-restore.sh          # restore if this is a consumer
#   AIOS_FORCE_MEMORY_RESTORE=1 bash scripts/cloud-memory-restore.sh
#   AIOS_BRAIN_REPO=/path/to/brain.git bash scripts/cloud-memory-restore.sh  # test

set -euo pipefail

log() { printf 'cloud-memory-restore: %s\n' "$1"; }
err() { printf 'cloud-memory-restore: %s\n' "$1" >&2; }

# --- locate the repo from this script, so it works from any cwd or branch ------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BRAIN_REPO="${AIOS_BRAIN_REPO:-https://github.com/camrontaylor/AI-OS-Brain.git}"
BRAIN_BRANCH="${AIOS_BRAIN_BRANCH:-}"
PRODUCER_MARKER="${AI_OS_MEMORY_BACKUP_DIR:-$HOME/.ai-os-memory-backup}/.git"

# --- producer guard: never pull a snapshot over live local memory --------------
if [ -e "$PRODUCER_MARKER" ] && [ "${AIOS_FORCE_MEMORY_RESTORE:-0}" != "1" ]; then
  log "this is the primary machine (local memory is source of truth) - skipping."
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  err "git not found - cannot pull memory."
  exit 0   # non-fatal: never block a session
fi

# --- build an authenticated clone URL without ever writing the token to disk ---
clone_url="$BRAIN_REPO"
case "$BRAIN_REPO" in
  https://github.com/*)
    if [ -n "${AIOS_BRAIN_TOKEN:-}" ]; then
      clone_url="https://x-access-token:${AIOS_BRAIN_TOKEN}@${BRAIN_REPO#https://}"
    fi
    ;;
esac

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aios-brain-XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

log "fetching latest memory from the brain..."
clone_args=(--depth 1 --quiet)
[ -n "$BRAIN_BRANCH" ] && clone_args+=(--branch "$BRAIN_BRANCH")
if ! git clone "${clone_args[@]}" "$clone_url" "$TMP_DIR/brain" 2>/dev/null; then
  err "could not read the brain repo (auth or network). Memory not refreshed."
  err "Set AIOS_BRAIN_TOKEN as a cloud secret, or grant the cloud GitHub app access to the brain repo."
  exit 0   # non-fatal
fi

# --- find the newest memory tree inside the brain ------------------------------
# The brain store mirrors repo-relative paths under "snapshots/<stamp>/" with a
# "latest" symlink beside them. That symlink is an ABSOLUTE path to the producer
# machine, so it does NOT resolve off-machine - we pick the newest snapshot
# directly instead. Fallbacks: the (rarely resolvable) latest symlink, then a
# flat layout (context/ at the brain root).
BRAIN="$TMP_DIR/brain"
src=""
if [ -d "$BRAIN/snapshots" ]; then
  newest="$(find "$BRAIN/snapshots" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)"
  [ -n "$newest" ] && [ -d "$newest/context" ] && src="$newest"
fi
if [ -z "$src" ] && [ -d "$BRAIN/latest/context" ]; then
  src="$BRAIN/latest"
fi
if [ -z "$src" ] && [ -d "$BRAIN/context" ]; then
  src="$BRAIN"
fi

if [ -z "$src" ]; then
  err "brain repo has no recognizable memory snapshot - nothing to restore."
  exit 0
fi

# --- copy memory into the working tree, backing up anything we replace ---------
stamp="$(date +%Y-%m-%d_%H%M%S)"
restored=0

restore_file() {
  local rel="$1"
  local from="$src/$rel"
  local to="$REPO_ROOT/$rel"
  [ -f "$from" ] || return 0
  mkdir -p "$(dirname "$to")"
  if [ -f "$to" ] && ! cmp -s "$from" "$to"; then
    cp -p "$to" "$to.pre-restore-$stamp"
  fi
  cp -p "$from" "$to"
  restored=$((restored + 1))
}

# Walk every memory file present in the snapshot (root + clients/*), mirroring
# its relative path. This is data-driven: whatever the brain holds, we place.
while IFS= read -r abs; do
  rel="${abs#"$src"/}"
  case "$rel" in
    context/MEMORY.md|context/learnings.md|context/memory/*) restore_file "$rel" ;;
    clients/*/context/MEMORY.md|clients/*/context/learnings.md|clients/*/context/memory/*) restore_file "$rel" ;;
  esac
done < <(find "$src" -type f 2>/dev/null)

if [ "$restored" -gt 0 ]; then
  log "restored $restored memory file(s) from the brain into this checkout."
else
  log "no memory files found to restore."
fi
exit 0
