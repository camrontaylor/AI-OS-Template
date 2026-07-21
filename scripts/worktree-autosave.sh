#!/usr/bin/env bash
# worktree-autosave.sh - save dirty edits inside a non-primary AI-OS worktree.
#
# base-autosave.sh intentionally no-ops in worktrees. This helper is the explicit
# worktree counterpart used by worktree cleanup paths after the user approves
# saving isolated-session work.

set -uo pipefail
TARGET="${1:-}"
MAX_BYTES=$((5 * 1024 * 1024))

if [[ -z "$TARGET" ]]; then
  echo "usage: bash scripts/worktree-autosave.sh <worktree-name-or-path>" >&2
  exit 2
fi

COMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
  echo "not inside a git repo." >&2
  exit 1
}
ROOT="$(cd "$COMMON/.." 2>/dev/null && pwd)" || exit 1

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

DIR="$(resolve_worktree "$TARGET")"
if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "could not locate worktree: $TARGET" >&2
  exit 1
fi

WT_COMMON="$(git -C "$DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 1
PRIMARY="$(cd "$WT_COMMON/.." 2>/dev/null && pwd)" || exit 1
TOP="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null)" || exit 1
if [[ "$TOP" == "$PRIMARY" ]]; then
  echo "refusing worktree autosave in the primary checkout; use base-autosave.sh" >&2
  exit 1
fi

BRANCH="$(git -C "$TOP" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
if [[ "$BRANCH" == "HEAD" ]]; then
  echo "refusing autosave in detached worktree: $TOP" >&2
  exit 1
fi

GITDIR="$(git -C "$TOP" rev-parse --path-format=absolute --git-dir 2>/dev/null)" || exit 1
for marker in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD; do
  if [[ -e "$GITDIR/$marker" ]]; then
    echo "refusing autosave during merge/rebase/cherry-pick in $TOP" >&2
    exit 1
  fi
done

DIRTY="$(git -C "$TOP" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${DIRTY:-0}" -eq 0 ]]; then
  echo "worktree $(basename "$TOP") is already clean"
  exit 0
fi

git -C "$TOP" add -A 2>/dev/null || exit 1

skipped=""
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ -f "$TOP/$f" ]] || continue
  sz="$(wc -c < "$TOP/$f" 2>/dev/null | tr -d ' ')"
  if [[ "${sz:-0}" -gt "$MAX_BYTES" ]]; then
    git -C "$TOP" reset -q HEAD -- "$f" 2>/dev/null || true
    skipped="${skipped}${f} "
  fi
done < <(git -C "$TOP" diff --cached --name-only 2>/dev/null)

if [[ -n "$skipped" ]]; then
  echo "skipped files over 5MB: $skipped"
fi

if git -C "$TOP" diff --cached --quiet 2>/dev/null; then
  echo "nothing small enough to autosave in worktree $(basename "$TOP")"
  exit 0
fi

COUNT="$(git -C "$TOP" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
TS="$(date +'%Y-%m-%d %H:%M')"
git -C "$TOP" commit -q -m "chore: worktree autosave [$TS]" 2>/dev/null || exit 1
echo "saved $COUNT file(s) in worktree $(basename "$TOP") on $BRANCH"
