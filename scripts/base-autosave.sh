#!/usr/bin/env bash
# base-autosave.sh - keep the PRIMARY checkout clean by committing leftover work.
#
# Shared, tool-neutral logic: Claude SessionEnd and any other tool's
# session-end adapter call this so the "clean primary" guarantee is not Claude-only.
#
# Why: the Claude Desktop stash prompt (#62142) fires on a dirty checkout. Keeping
# the primary committed means the next session always opens clean and is never
# blocked. The user never has to commit by hand.
#
# Safe by construction:
#   - Only runs in the primary checkout; no-op in worktrees (disposable).
#   - Skips when AI_OS_AUTONOMOUS=1 (cron / headless runs) so autonomous jobs
#     never commit onto the interactive user's history.
#   - Single-instance lock via mkdir so concurrent sessions cannot race on the
#     git index (multiple session-end hooks in the same primary).
#   - Rate-limited to one run per 60 seconds so a tool whose Stop fires per-turn
#     does not reproduce the per-turn commit flood.
#   - No-op on a clean tree, detached HEAD, or mid merge/rebase/cherry-pick.
#   - `git add -A` respects .gitignore (brain, .env, .command-centre stay out).
#   - Skips files larger than MAX_BYTES (5 MB) using a cross-platform size check.
#     SKIPPED FILES ARE LOGGED to .command-centre/autosave-pending.log so the next
#     session can surface them to the user instead of dropping them in silence.
#   - If HEAD is NOT main on the primary, the commit still happens (the work is
#     preserved) but a warning is logged to .command-centre/branch-state.log so
#     the next session can surface "your folder is on branch X, not main".
#   - Never deletes, never stashes, never switches branch. Pushes ONLY to the
#     autosave/<branch> backup ref on the backup remote, never to main itself.

set -uo pipefail
MAX_BYTES=$((5 * 1024 * 1024))    # skip files larger than 5 MB
MIN_INTERVAL=60                   # at most one autosave per 60 seconds

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

# ------------------------------------------------------------ rate limit
STAMP="$LOGDIR/autosave-last-run"
NOW="$(date +%s)"
if [ -f "$STAMP" ]; then
  LAST="$(cat "$STAMP" 2>/dev/null || echo 0)"
  if [ "$((NOW - LAST))" -lt "$MIN_INTERVAL" ]; then exit 0; fi
fi

# ------------------------------------------------------------ lock (mkdir is atomic)
LOCK="$LOGDIR/autosave.lock"
# A lock left behind by a killed run (SIGKILL and the hook's hard timeout skip
# the trap) would disable autosave forever - that exact failure silently killed
# autosave from Jul 1 to Jul 16 2026. Treat a lock older than 10 minutes as
# stale: no healthy run holds it that long, so take it over and log it.
if [ -d "$LOCK" ]; then
  LOCK_TS="$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo "$NOW")"
  if [ "$((NOW - LOCK_TS))" -gt 600 ]; then
    rmdir "$LOCK" 2>/dev/null || true
    printf '[%s] removed stale autosave.lock (age %ss)\n' "$(date '+%Y-%m-%d %H:%M')" "$((NOW - LOCK_TS))" \
      >> "$LOGDIR/autosave-push.log"
  fi
fi
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

# ------------------------------------------------------------ pre-commit safety
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
[ "$BRANCH" = "HEAD" ] && exit 0

GITDIR="$(git rev-parse --path-format=absolute --git-dir 2>/dev/null)" || exit 0
for marker in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD; do
  [ -e "$GITDIR/$marker" ] && exit 0
done

[ -z "$(git status --porcelain 2>/dev/null)" ] && exit 0

git add -A 2>/dev/null || exit 0

# ------------------------------------------------------------ size guard (portable)
skipped=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  # wc -c works on macOS, Linux, and Git Bash; stat flags vary between them.
  sz="$(wc -c < "$f" 2>/dev/null | tr -d ' ')"
  if [ "${sz:-0}" -gt "$MAX_BYTES" ]; then
    git reset -q HEAD -- "$f" 2>/dev/null || true
    skipped="${skipped}${f} "
  fi
done < <(git diff --cached --name-only 2>/dev/null)

if [ -n "$skipped" ]; then
  # Log to a file the next SessionStart can surface to the user. Stderr alone
  # gets swallowed by Claude's hook surface, so we persist instead.
  printf '[%s] skipped over 5MB on branch %s: %s\n' "$(date '+%Y-%m-%d %H:%M')" "$BRANCH" "$skipped" \
    >> "$LOGDIR/autosave-pending.log"
fi

# ------------------------------------------------------------ secrets gate
# Cron-written reports once carried a plaintext password onto this exact
# commit-and-push path (2026-07-16 audit, MYOB incident). Before committing,
# scan staged report files for credential-shaped content; hold hits back from
# the commit (left dirty on disk, never rewritten) and log them where the next
# SessionStart surfaces the note. Conservative patterns; a held false positive
# costs one manual commit, a missed real secret goes to GitHub.
# Scope: report/output text files at ANY depth under root projects/ AND under
# every clients/*/projects/ (client deliverables are where client credentials
# actually appear). One python process scans the whole batch, so a catch-up
# morning with dozens of staged reports stays far inside the 12s hook budget.
held_secrets=""
scan_list="$LOGDIR/.autosave-scan-list.$$"
git diff --cached --name-only 2>/dev/null | while IFS= read -r f; do
  case "$f" in
    projects/*.md|projects/*.txt|projects/*.json|projects/*.log|\
    clients/*/projects/*.md|clients/*/projects/*.txt|clients/*/projects/*.json|clients/*/projects/*.log)
      [ -f "$f" ] && printf '%s\n' "$f" ;;
  esac
done > "$scan_list"

if [ -s "$scan_list" ]; then
  held_secrets="$(python3 - "$scan_list" <<'PY' 2>/dev/null
import re, sys
# a value blob must contain a digit or symbol, so prose words never match
blob = r"[A-Za-z0-9!@#$%^&*+/_-]*[0-9!@#$%^&*+/][A-Za-z0-9!@#$%^&*+/_-]{7,}"
patterns = [
    re.compile(rf"(?i)\b(password|passwd|recovery[ _-]?code)\b[^A-Za-z0-9\n]{{0,10}}{blob}"),
    re.compile(
        r"\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
        r"|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}"
        r"|ntn_[A-Za-z0-9]{20,}|secret_[A-Za-z0-9]{20,})\b"
    ),
]
hits = []
for path in open(sys.argv[1], encoding="utf-8").read().splitlines():
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        continue
    if any(p.search(text) for p in patterns):
        hits.append(path)
print("\n".join(hits))
PY
)"
fi
rm -f "$scan_list" 2>/dev/null || true

if [ -n "$held_secrets" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] && git reset -q HEAD -- "$f" 2>/dev/null || true
  done <<< "$held_secrets"
  printf '[%s] HELD from autosave (credential-shaped content - redact, then commit by hand): %s\n' \
    "$(date '+%Y-%m-%d %H:%M')" "$(printf '%s' "$held_secrets" | tr '\n' ' ')" >> "$LOGDIR/autosave-pending.log"
fi

# Nothing left after the size guard -> stop.
git diff --cached --quiet 2>/dev/null && { date +%s > "$STAMP" 2>/dev/null || true; exit 0; }

# ------------------------------------------------------------ off-main warning
# If the primary is on a non-main branch, the work is preserved (it is still
# committed) but we tell the next session so the user is not surprised by
# "where is my work" - they will see a plain note that says "you are on X".
if [ "$BRANCH" != "main" ]; then
  printf '[%s] autosaved %s file(s) on side branch %s (not main)\n' \
    "$(date '+%Y-%m-%d %H:%M')" \
    "$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')" \
    "$BRANCH" \
    >> "$LOGDIR/branch-state.log"
fi

TS="$(date +'%Y-%m-%d %H:%M')"
git commit -q -m "chore: autosave [$TS]" 2>/dev/null || true

# Record the run BEFORE the push: the hook wrapper kills this script at 12s,
# and a slow push must not erase the fact that the commit already happened.
date +%s > "$STAMP" 2>/dev/null || true

# ------------------------------------------------------------ online backup (GitHub)
# After the local commit, mirror the work up to the GitHub backup remote so it is
# safe off this Mac and every past version stays restorable online. Fully non-fatal:
# the local commit above already preserved the work, so a deferred/failed push never
# blocks a session or loses anything, and it retries next session. Never force-pushes
# (a force could drop history, which would defeat restore). Opt out any time with
# AIOS_AUTOSAVE_NO_PUSH=1 or by creating a "$LOGDIR/no-autopush" marker file.
# Backs up to a dedicated "autosave/<branch>" backup ref, NEVER to the default
# branch itself, so it does not bypass the PR review that main is meant to get.
# The backup ref mirrors the branch's full history, so any past version stays
# restorable from GitHub.
# Prefer a dedicated "github" backup remote if the user has one, otherwise fall
# back to "origin" (the normal GitHub remote). Earlier this only ever tried
# "github", so installs without that remote silently never backed up off-machine.
BACKUP_REMOTE=""
if git remote get-url github >/dev/null 2>&1; then
  BACKUP_REMOTE="github"
elif git remote get-url origin >/dev/null 2>&1; then
  BACKUP_REMOTE="origin"
fi
if [ -z "${AIOS_AUTOSAVE_NO_PUSH:-}" ] && [ ! -e "$LOGDIR/no-autopush" ] \
   && [ -n "$BACKUP_REMOTE" ]; then
  if PUSH_ERR="$(git push -q "$BACKUP_REMOTE" "HEAD:refs/heads/autosave/$BRANCH" 2>&1 >/dev/null)"; then
    printf '[%s] backed up %s to GitHub (%s autosave/%s)\n' "$TS" "$BRANCH" "$BACKUP_REMOTE" "$BRANCH" >> "$LOGDIR/autosave-push.log"
  else
    # Capture the real reason instead of swallowing it, so a deferral is never
    # silent again (2026-07-20: 3 days of blind "deferred" hid the true cause).
    REASON="$(printf '%s' "$PUSH_ERR" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-200)"
    printf '[%s] GitHub backup deferred for %s (retries next session): %s\n' "$TS" "$BRANCH" "${REASON:-push exited non-zero with no stderr (likely killed by hook timeout)}" \
      >> "$LOGDIR/autosave-push.log"
  fi
fi

exit 0
