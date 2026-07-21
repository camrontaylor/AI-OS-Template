#!/usr/bin/env bash
# base-return-to-main.sh - at SessionStart, return PRIMARY to main when safe,
# or surface a clear plain-English message about why it cannot.
#
# Why: a non-developer should always see "the folder" as main. If the primary
# was left on a side branch (by another session, an experiment, a worktree-done
# that missed), the next interactive session would commit work onto that branch
# - work the user cannot find. This script keeps the primary on main when it can,
# and tells the user (via a memory note Claude reads at startup) when it cannot.
#
# Hard rules: this is OBSERVE-AND-INFORM at SessionStart, with narrow
# safety-net recovery paths.
#   - Only acts in the primary checkout; no-op in worktrees.
#   - Skips when AI_OS_AUTONOMOUS=1 (cron / headless).
#   - Single-instance via the same lock as base-autosave (mkdir).
#   - Does NOT commit anything at SessionStart. If the tree is dirty, it leaves
#     it dirty and writes a note for the user. SessionEnd will autosave later.
#   - Switches to main when: clean tree, not detached, no mid-op, main exists,
#     and either HEAD is an ancestor of main OR the current branch is an
#     autosave-recovery/* branch. Autosave recovery branches are already saved
#     snapshots, and ancestor branches have no branch-only commits, so returning
#     the primary folder to main does not abandon saved work.
#   - Messages go to .command-centre/branch-state.log so the next interactive
#     session can surface them. Stderr alone is swallowed by Claude's hook surface.

set -uo pipefail

# ------------------------------------------------------------ headless skip
[ "${AI_OS_AUTONOMOUS:-}" = "1" ] && exit 0

# ------------------------------------------------------------ locate primary
COMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
[ -n "$COMMON" ] || exit 0
BASE="$(cd "$COMMON/.." 2>/dev/null && pwd)" || exit 0
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ "$BASE" = "$TOP" ] || exit 0    # worktree -> leave it alone

cd "$BASE" || exit 0
LOGDIR="$BASE/.command-centre"
mkdir -p "$LOGDIR" 2>/dev/null

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
[ "$BRANCH" = "HEAD" ] && exit 0
[ "$BRANCH" = "main" ] && exit 0  # already home -> silent no-op

GITDIR="$(git rev-parse --path-format=absolute --git-dir 2>/dev/null)" || exit 0
for marker in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD; do
  if [ -e "$GITDIR/$marker" ]; then
    printf '[%s] mid-operation on %s (merge or rebase in progress); not switching\n' \
      "$(date '+%Y-%m-%d %H:%M')" "$BRANCH" >> "$LOGDIR/branch-state.log"
    exit 0
  fi
done

git show-ref --verify --quiet refs/heads/main || exit 0

# ------------------------------------------------------------ lock
LOCK="$LOGDIR/autosave.lock"
# Same stale-lock healing as base-autosave.sh: a killed run leaves the lock
# behind forever, silently disabling this script. Take over locks older than
# 10 minutes.
if [ -d "$LOCK" ]; then
  LOCK_NOW="$(date +%s)"
  LOCK_TS="$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo "$LOCK_NOW")"
  if [ "$((LOCK_NOW - LOCK_TS))" -gt 600 ]; then
    rmdir "$LOCK" 2>/dev/null || true
    printf '[%s] removed stale autosave.lock (age %ss)\n' "$(date '+%Y-%m-%d %H:%M')" "$((LOCK_NOW - LOCK_TS))" \
      >> "$LOGDIR/branch-state.log"
  fi
fi
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

BRANCH_HAS_UNIQUE_COMMITS=1
if git merge-base --is-ancestor HEAD main 2>/dev/null; then
  BRANCH_HAS_UNIQUE_COMMITS=0
fi

# ------------------------------------------------------------ dirty tree?
# Do NOT auto-commit at SessionStart. If the branch has no branch-only commits,
# let git carry the unsaved edits back to main. If it cannot do that cleanly,
# leave the folder as-is and surface the reason.
if [ -n "$(git status --porcelain --ignore-submodules=all 2>/dev/null)" ]; then
  COUNT="$(git status --porcelain --ignore-submodules=all 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$BRANCH_HAS_UNIQUE_COMMITS" -eq 0 ]; then
    if git checkout --quiet main 2>/dev/null; then
      printf '[%s] switched folder back to main from %s with %s uncommitted change(s) carried over; no branch-only commits abandoned\n' \
        "$(date '+%Y-%m-%d %H:%M')" "$BRANCH" "$COUNT" \
        >> "$LOGDIR/branch-state.log"
    else
      printf '[%s] folder is on side branch %s with %s uncommitted change(s); git could not carry them to main cleanly, so it stayed on %s\n' \
        "$(date '+%Y-%m-%d %H:%M')" "$BRANCH" "$COUNT" "$BRANCH" \
        >> "$LOGDIR/branch-state.log"
    fi
    exit 0
  fi
  printf '[%s] folder is on side branch %s with %s uncommitted change(s) and branch-only commits; not switching to main automatically. SessionEnd will save them on %s.\n' \
    "$(date '+%Y-%m-%d %H:%M')" "$BRANCH" "$COUNT" "$BRANCH" \
    >> "$LOGDIR/branch-state.log"
  exit 0
fi

# ------------------------------------------------------------ autosave recovery check
# Autosave recovery branches are saved snapshots. If the tree is clean, switch
# the primary folder back to main and leave the recovery branch intact for later
# review. This prevents SessionEnd from repeatedly saving unrelated work onto a
# recovery branch while preserving every commit.
case "$BRANCH" in
  autosave-recovery/*)
    AHEAD="$(git rev-list --count main..HEAD 2>/dev/null || echo unknown)"
    if git checkout --quiet main 2>/dev/null; then
      printf '[%s] switched folder back to main from saved recovery branch %s (%s commit(s) preserved on that branch)\n' \
        "$(date '+%Y-%m-%d %H:%M')" "$BRANCH" "$AHEAD" \
        >> "$LOGDIR/branch-state.log"
    fi
    exit 0
    ;;
esac

# ------------------------------------------------------------ ancestor check
# If a normal side branch has commits ahead of main, do NOT silently switch
# because that hides deliberate feature/topic work from the user's view.
if [ "$BRANCH_HAS_UNIQUE_COMMITS" -ne 0 ]; then
  AHEAD="$(git rev-list --count main..HEAD 2>/dev/null || echo unknown)"
  printf '[%s] folder is on side branch %s with %s commit(s) ahead of main. Ask: "bring that work onto main" to merge it, or "archive that branch" to set it aside.\n' \
    "$(date '+%Y-%m-%d %H:%M')" "$BRANCH" "$AHEAD" \
    >> "$LOGDIR/branch-state.log"
  exit 0
fi

# ------------------------------------------------------------ safe switch
git checkout --quiet main 2>/dev/null || exit 0
printf '[%s] switched folder back to main (was on %s; no commits abandoned)\n' \
  "$(date '+%Y-%m-%d %H:%M')" "$BRANCH" \
  >> "$LOGDIR/branch-state.log"
exit 0
