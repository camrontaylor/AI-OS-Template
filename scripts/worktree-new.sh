#!/usr/bin/env bash
# worktree-new.sh - start a fresh, isolated AI-OS session folder in one step.
#
# Creates a git worktree on its own branch (branched from main so it starts clean),
# then links the shared brain (memory, secrets, runtime state) into it. Open the
# printed folder in Claude or Cursor: it can never collide with your other
# sessions, and it shares the same memory as every other session.
#
# Usage:  bash scripts/worktree-new.sh <name>     (e.g. worktree-new.sh redesign)

set -uo pipefail
NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "usage: bash scripts/worktree-new.sh <name>   (e.g. worktree-new.sh redesign)" >&2
  exit 2
fi

ROOT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd)"
[[ -z "${ROOT:-}" ]] && { echo "not inside a git repo." >&2; exit 1; }
REPO="$(basename "$ROOT")"
DIR="$ROOT/.worktrees/$NAME"
BRANCH="work/$NAME"

# Base the worktree on main so it starts clean; fall back to current branch.
BASEREF="main"
git -C "$ROOT" show-ref --verify --quiet "refs/heads/main" || BASEREF="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"

if git -C "$ROOT" worktree add -b "$BRANCH" "$DIR" "$BASEREF" 2>/dev/null; then
  bash "$ROOT/scripts/worktree-link.sh" "$DIR" || true
  echo ""
  echo "Isolated session ready (branch $BRANCH, based on $BASEREF):"
  echo "  $DIR"
  echo ""
  echo "Open THAT folder in Claude or Cursor. It shares your memory but cannot collide."
  echo "When finished:  bash scripts/worktree-done.sh $NAME"
else
  echo "Could not create it - branch '$BRANCH' or folder '$DIR' may already exist. Try another name." >&2
  exit 1
fi
