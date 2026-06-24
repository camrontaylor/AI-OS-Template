#!/usr/bin/env bash
# act.sh - meta-worktree action executor. Takes one or more action IDs (from
# audit.sh findings) and runs the safe action for each. Refuses anything
# destructive that the SKILL.md flagged as needs-call - those go back to the
# user as a question, never auto-executed here.
#
# Usage: bash act.sh <id1> [id2 ...]
#
# Idempotent and verbose: each action prints a single line of what it did.

set -uo pipefail
COMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || { echo "not in a git repo"; exit 1; }
BASE="$(cd "$COMMON/.." 2>/dev/null && pwd)"
cd "$BASE" || exit 1

[ "$#" -eq 0 ] && { echo "usage: act.sh <id1> [id2 ...]"; exit 2; }

for id in "$@"; do
  case "$id" in

    base-off-main)
      bash "$BASE/scripts/base-return-to-main.sh"
      echo "tried to return base to main. New branch: $(git rev-parse --abbrev-ref HEAD)"
      ;;

    base-dirty)
      bash "$BASE/scripts/base-autosave.sh"
      echo "saved current edits on $(git rev-parse --abbrev-ref HEAD). $(git log -1 --format='%s')"
      ;;

    main-ahead)
      ts="$(date +%F)"
      if git push origin "HEAD:refs/heads/backup/$ts-autosave" --force-with-lease 2>&1 | tail -1 | grep -qE '(new branch|->)'; then
        echo "backed up to GitHub on branch backup/$ts-autosave"
      else
        echo "backup push had no effect (already up to date or push failed - check GitHub)"
      fi
      ;;

    main-behind)
      if git pull origin main --ff-only 2>&1 | tail -1; then
        echo "pulled in updates from GitHub"
      else
        echo "could not pull cleanly. Tell the user: 'an update needs reconciliation - I will look at it'"
      fi
      ;;

    recovery-old)
      cutoff=$(($(date +%s) - 30*86400))
      removed=0
      while read -r b ts; do
        [ -z "$b" ] && continue
        [ "$ts" -lt "$cutoff" ] || continue
        if git branch -D "$b" >/dev/null 2>&1; then removed=$((removed+1)); fi
      done < <(git for-each-ref --format='%(refname:short) %(committerdate:unix)' refs/heads/autosave-recovery)
      echo "removed $removed safety snapshot(s) older than 30 days"
      ;;

    log-pending|log-branch-state|info|fyi)
      echo "$id: informational only, no action taken"
      ;;

    wt-stale-*)
      name="${id#wt-stale-}"
      if [ -f "$BASE/scripts/worktree-done.sh" ]; then
        bash "$BASE/scripts/worktree-done.sh" "$name"
      else
        echo "worktree-done.sh missing; cannot close worktree '$name'"
      fi
      ;;

    wt-dirty-*)
      name="${id#wt-dirty-}"
      # find the worktree path and run autosave there
      dir="$(git worktree list --porcelain 2>/dev/null | awk -v n="$name" '/^worktree /{p=$2} p && index(p,"/"n)==length(p)-length(n){print p; exit}')"
      if [ -n "$dir" ] && [ -d "$dir" ]; then
        ( cd "$dir" && bash "$BASE/scripts/base-autosave.sh" )
        echo "saved unsaved edits in worktree '$name'"
      else
        echo "could not locate worktree '$name'"
      fi
      ;;

    wt-orphan-*)
      name="${id#wt-orphan-}"
      d="$HOME/Desktop/Worktrees/$(basename "$BASE")/$name"
      if [ -d "$d" ]; then
        # don't rm: respect the no-hard-delete value. Move to trash via macOS-aware path.
        if command -v trash >/dev/null 2>&1; then trash "$d" && echo "moved orphan '$name' to Trash"
        else mv "$d" "$HOME/.Trash/$name.$(date +%s)" 2>/dev/null && echo "moved orphan '$name' to Trash" || echo "could not move '$d' to Trash"
        fi
      else
        echo "orphan folder '$name' not found (already gone?)"
      fi
      ;;

    branch-*|stash-*|recovered-files)
      # These are 'needs-call' items. The SKILL.md tells Claude to ASK the user,
      # not call act.sh blindly. If they reach here, bail with guidance.
      echo "'$id' needs the user to choose. The skill should ask, not auto-act."
      ;;

    *)
      echo "unknown action id: $id"
      ;;
  esac
done
