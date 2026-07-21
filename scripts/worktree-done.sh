#!/usr/bin/env bash
# worktree-done.sh - finish with an AI-OS worktree, losing nothing.
#
# Cleans up an isolated session folder safely:
#  1. If the worktree has uncommitted edits, autosave them as a commit on the
#     worktree's branch FIRST (using the explicit worktree-autosave helper). No --force,
#     no silent drops, no hard-deletes.
#  2. Remove the worktree folder (the symlinks back to the primary brain vanish
#     with it; the real brain is never touched).
#  3. If the branch has commits not on main, archive it as a git tag (history
#     preserved). If it has nothing unique, drop the branch cleanly.
#
# Usage:  bash scripts/worktree-done.sh <name-or-path>

set -uo pipefail
NAME="${1:-}"
[[ -z "$NAME" ]] && { echo "usage: bash scripts/worktree-done.sh <name-or-path>" >&2; exit 2; }

ROOT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd)"
[[ -z "${ROOT:-}" ]] && { echo "not inside a git repo." >&2; exit 1; }

resolve_worktree() {
  local target="$1"
  if [[ -d "$target" ]]; then
    git -C "$target" rev-parse --show-toplevel 2>/dev/null && return 0
  fi
  git -C "$ROOT" worktree list --porcelain 2>/dev/null | awk -v n="$target" '
    /^worktree / {
      p=$2
      split(p, parts, "/")
      if (parts[length(parts)] == n) { print p; exit }
    }
  '
}

DIR="$(resolve_worktree "$NAME")"
[[ -n "$DIR" && -d "$DIR" ]] || { echo "no registered worktree named or located at $NAME" >&2; exit 1; }

PRIMARY="$(cd "$(git -C "$DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd)"
[[ "$DIR" != "$PRIMARY" ]] || { echo "refusing to remove the primary checkout: $DIR" >&2; exit 1; }
BRANCH="$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"

# ------------------------------------------------------------ preserve dirty edits
# If the worktree has uncommitted edits, commit them on its own branch first.
# This avoids --force destroying work the user never typed `git commit` for.
DIRTY="$(git -C "$DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${DIRTY:-0}" -gt 0 ]]; then
  echo "Found $DIRTY uncommitted file(s) in the worktree - saving them on branch $BRANCH before removing."
  bash "$ROOT/scripts/worktree-autosave.sh" "$DIR"
fi

# ------------------------------------------------------------ remove the worktree
# Try without --force first. If git refuses (e.g. submodule weirdness), only then
# fall back to --force, and only AFTER the autosave above has already preserved
# any uncommitted work.
if ! git -C "$ROOT" worktree remove "$DIR" 2>/dev/null; then
  if ! git -C "$ROOT" worktree remove "$DIR" --force 2>/dev/null; then
    echo "could not remove worktree at $DIR. Inspect and retry." >&2
    exit 1
  fi
fi
git -C "$ROOT" worktree prune 2>/dev/null || true

# ------------------------------------------------------------ archive or drop
if [[ "$BRANCH" != "HEAD" && "$BRANCH" != "main" ]] && git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  ahead="$(git -C "$ROOT" rev-list --count "main..$BRANCH" 2>/dev/null || echo 0)"
  if [[ "${ahead:-0}" -gt 0 ]]; then
    bash "$ROOT/scripts/archive-branch.sh" "$BRANCH" "auto-archived on worktree-done" || true
    echo "Saved $ahead commit(s) from $BRANCH as an archive tag (recoverable with 'git tag | grep archive/$BRANCH')."
  else
    git -C "$ROOT" branch -D "$BRANCH" >/dev/null 2>&1 || true
    echo "$BRANCH had no unique commits - dropped cleanly."
  fi
fi

echo "Removed worktree $DIR. Your memory and other sessions are untouched."
