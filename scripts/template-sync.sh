#!/usr/bin/env bash
# template-sync.sh - propagate systemic (ai_os_owned) changes from this install
# OUT to the public AI-OS template repo, safely and automatically.
#
# The update direction AI-OS already had is template -> install (scripts/update.sh
# pulls). This is the missing reverse: install -> template, so a systemic change
# made and documented here reaches the template every time, without being dodged.
#
# SAFE BY CONSTRUCTION:
#   * Only files matching config/update-manifest.json "ai_os_owned" are copied,
#     minus anything matching "user_owned" (clients, memory, brand, projects, env).
#   * Every staged file is scanned for private/client strings and credential-
#     shaped values. Hits are held back without printing secret values.
#   * Changes land on a rolling branch (template-sync/main) with ONE open PR,
#     never straight onto the template's protected main.
#   * DISARMED BY DEFAULT. This script ships in the template, so every install
#     gets it; only an install with the arm flag (user-owned, gitignored) pushes.
#     That stops a downstream install from ever pushing to the maintainer's template.
#
# Usage:
#   bash scripts/template-sync.sh --arm        # one-time: authorize THIS install to push
#   bash scripts/template-sync.sh --disarm     # revoke
#   bash scripts/template-sync.sh --dry-run    # show what would propagate, no writes
#   bash scripts/template-sync.sh              # sync now (needs arm), push branch + PR
#   bash scripts/template-sync.sh --no-push    # stage+commit in mirror, do not push
#   bash scripts/template-sync.sh --auto       # hook mode: quiet, never blocks, no-op if disarmed/clean
#   bash scripts/template-sync.sh --status     # show arm state + last run

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/.." && pwd))"
MANIFEST="$ROOT/config/update-manifest.json"
STATE_DIR="$ROOT/.command-centre"                 # user-owned, gitignored
ARM_FLAG="$STATE_DIR/template-sync-armed"
ALLOW_FILE="$STATE_DIR/template-sync-allow"        # optional: file paths to skip in scan
MIRROR="$ROOT/.backup/template-mirror"             # gitignored (.backup/)
LOG_DIR="$ROOT/.backup/template-sync"
LOG="$LOG_DIR/last-run.log"
DEFAULT_TEMPLATE="https://github.com/camrontaylor/AI-OS-Template.git"
EXPECTED_SLUG="camrontaylor/AI-OS-Template"
SYNC_BRANCH="template-sync/main"
BASE_BRANCH="${AI_OS_TEMPLATE_BRANCH:-main}"

MODE="run"
PUSH=1
for arg in "$@"; do
  case "$arg" in
    --arm) MODE="arm" ;;
    --disarm) MODE="disarm" ;;
    --status) MODE="status" ;;
    --dry-run|--check|--preview) MODE="dry" ; PUSH=0 ;;
    --no-push) PUSH=0 ;;
    --auto) MODE="auto" ;;
    -h|--help) MODE="help" ;;
    *) echo "Unknown option: $arg" >&2 ; exit 64 ;;
  esac
done

# --auto must never break a session: any hard failure exits 0.
AUTO=0; [ "$MODE" = "auto" ] && AUTO=1
say() { printf '%s\n' "$*"; }
soft_exit() { [ "$AUTO" -eq 1 ] && exit 0 || exit "${1:-1}"; }
mkdir -p "$LOG_DIR" "$STATE_DIR" 2>/dev/null || true

resolve_template_url() {
  local url
  url="$(git -C "$ROOT" remote get-url upstream 2>/dev/null || true)"
  case "$url" in *"$EXPECTED_SLUG"*) echo "$url"; return 0 ;; esac
  # fall back to any remote pointing at the template slug
  local r
  for r in $(git -C "$ROOT" remote 2>/dev/null); do
    url="$(git -C "$ROOT" remote get-url "$r" 2>/dev/null || true)"
    case "$url" in *"$EXPECTED_SLUG"*) echo "$url"; return 0 ;; esac
  done
  echo "$DEFAULT_TEMPLATE"
}

if [ "$MODE" = "help" ]; then
  sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ "$MODE" = "arm" ]; then
  url="$(resolve_template_url)"
  say "Arming template auto-sync for this install."
  say "  Template: $url"
  say "  Rolling branch: $SYNC_BRANCH (never pushes to $BASE_BRANCH directly)"
  printf '%s\n' "armed $(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$ARM_FLAG"
  say "Armed. Future systemic changes will propagate automatically at session end and wrap-up."
  say "Disarm any time: bash scripts/template-sync.sh --disarm"
  exit 0
fi

if [ "$MODE" = "disarm" ]; then
  rm -f "$ARM_FLAG"
  say "Disarmed. This install will no longer push to the template."
  exit 0
fi

if [ "$MODE" = "status" ]; then
  if [ -f "$ARM_FLAG" ]; then say "State: ARMED ($(cat "$ARM_FLAG"))"; else say "State: disarmed"; fi
  say "Template: $(resolve_template_url)"
  [ -f "$LOG" ] && { say "Last run:"; tail -n 20 "$LOG"; } || say "No runs logged yet."
  exit 0
fi

# ---- run / dry / auto below need arming (except dry-run, which is always safe) ----
if [ "$MODE" != "dry" ] && [ ! -f "$ARM_FLAG" ]; then
  if [ "$AUTO" -eq 1 ]; then exit 0; fi   # silent no-op when unarmed
  say "Not armed. This install is not authorized to push to the template."
  say "Preview what WOULD propagate:  bash scripts/template-sync.sh --dry-run"
  say "Authorize this install:        bash scripts/template-sync.sh --arm"
  exit 3
fi

# Only ever run from the primary checkout, never a worktree.
if [ "$(git -C "$ROOT" rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ]; then soft_exit 1; fi
GIT_COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
GIT_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
if [ -n "$GIT_COMMON" ] && [ "$GIT_COMMON" != "$GIT_DIR" ]; then
  [ "$AUTO" -eq 1 ] && exit 0 || { say "In a worktree; run template-sync from the primary checkout."; exit 0; }
fi

[ -f "$MANIFEST" ] || { say "Manifest not found: $MANIFEST"; soft_exit 1; }
# shellcheck source=scripts/lib/sanitize-strings.sh
source "$SCRIPT_DIR/lib/sanitize-strings.sh"

# --- Expand the manifest allowlist into a concrete list of tracked files -----
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aios-tsync.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
OWNED_PATTERNS="$TMP/owned.txt"; USER_PATTERNS="$TMP/user.txt"
NEVER_PATTERNS="$TMP/never.txt"
python3 - "$MANIFEST" "$OWNED_PATTERNS" "$USER_PATTERNS" "$NEVER_PATTERNS" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
# Trailing newline is load-bearing: `while read` drops an unterminated final
# line, which silently ignored the LAST allowlist pattern for weeks
# (cron/templates/ never propagated; .github/ was next to vanish).
open(sys.argv[2],"w").write("\n".join(m.get("ai_os_owned",[])) + "\n")
open(sys.argv[3],"w").write("\n".join(m.get("user_owned",[])) + "\n")
open(sys.argv[4],"w").write("\n".join(m.get("never_publish",[])) + "\n")
PY

# match FILE against a pattern list (dir-prefix if ends with /, else bash glob)
matches_any() {
  local file="$1" listfile="$2" pat
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    case "$pat" in
      */) case "$file" in "$pat"*) return 0 ;; esac ;;
      *)  # shellcheck disable=SC2254
          case "$file" in $pat) return 0 ;; esac ;;
    esac
  done < "$listfile"
  return 1
}

FILELIST="$TMP/files.txt"; : > "$FILELIST"
NEVER_HIT=0
while IFS= read -r f; do
  matches_any "$f" "$OWNED_PATTERNS" || continue
  matches_any "$f" "$USER_PATTERNS" && continue   # deny overlay wins
  # Licence deny overlay. Proprietary / unverified-licence vendored subtrees must
  # never reach the public template (skills-library/LICENSES.md says so explicitly).
  # This is a hard exclusion, not a sanitizer hit: no amount of scrubbing makes
  # someone else's all-rights-reserved material republishable.
  if matches_any "$f" "$NEVER_PATTERNS"; then NEVER_HIT=$((NEVER_HIT+1)); continue; fi
  printf '%s\n' "$f" >> "$FILELIST"
done < <(git -C "$ROOT" ls-files)
[ "$NEVER_HIT" -gt 0 ] && say "Excluded $NEVER_HIT file(s) under never_publish (proprietary / unverified licence)."

COUNT="$(wc -l < "$FILELIST" | tr -d ' ')"
if [ "$COUNT" -eq 0 ]; then say "No ai_os_owned tracked files resolved - nothing to propagate."; soft_exit 0; fi

# --- Prepare the template mirror ---------------------------------------------
TEMPLATE_URL="$(resolve_template_url)"
if [ ! -d "$MIRROR/.git" ]; then
  rm -rf "$MIRROR"; mkdir -p "$(dirname "$MIRROR")"
  if ! git clone --quiet "$TEMPLATE_URL" "$MIRROR" 2>>"$LOG"; then
    say "Could not clone template ($TEMPLATE_URL). See $LOG"; soft_exit 1
  fi
fi
if ! git -C "$MIRROR" fetch --quiet origin "$BASE_BRANCH" 2>>"$LOG"; then
  say "Could not fetch template/$BASE_BRANCH. See $LOG"; soft_exit 1
fi
# Also refresh the rolling branch's remote-tracking ref, so the
# --force-with-lease push below never runs against a stale lease. Two hook
# runs racing once left the lease stale forever and every later push was
# rejected. The branch may not exist yet on a fresh template, so tolerate.
git -C "$MIRROR" fetch --quiet origin "$SYNC_BRANCH" 2>>"$LOG" || true
git -C "$MIRROR" checkout -q -B "$SYNC_BRANCH" "origin/$BASE_BRANCH" 2>>"$LOG" || { say "checkout failed"; soft_exit 1; }
git -C "$MIRROR" reset -q --hard "origin/$BASE_BRANCH" 2>>"$LOG" || true
git -C "$MIRROR" clean -qfd 2>>"$LOG" || true

# --- Copy allowlisted files into the mirror ----------------------------------
while IFS= read -r f; do
  mkdir -p "$MIRROR/$(dirname "$f")"
  cp -p "$ROOT/$f" "$MIRROR/$f"
done < "$FILELIST"

# --- Prune: owned files present in mirror but gone from source ---------------
PRUNED=0
while IFS= read -r mf; do
  [ -z "$mf" ] && continue
  case "$mf" in .git/*) continue ;; esac
  matches_any "$mf" "$OWNED_PATTERNS" || continue
  matches_any "$mf" "$USER_PATTERNS" && continue
  if ! grep -qxF "$mf" "$FILELIST"; then
    git -C "$MIRROR" rm -q --ignore-unmatch "$mf" >/dev/null 2>&1 && PRUNED=$((PRUNED+1))
  fi
done < <(git -C "$MIRROR" ls-files)

# --- What changed? -----------------------------------------------------------
git -C "$MIRROR" add -A
if git -C "$MIRROR" diff --cached --quiet; then
  say "Template already matches this install's systemic files - nothing to propagate."
  soft_exit 0
fi
CHANGED_LIST="$TMP/changed.txt"
git -C "$MIRROR" diff --cached --name-only > "$CHANGED_LIST"
CHANGED_N="$(wc -l < "$CHANGED_LIST" | tr -d ' ')"

# --- SANITIZER GATE: partition changed files into clean vs held --------------
# A personalized or secret-bearing file is HELD back, not pushed - never silently rewritten, because a
# missed replacement would leak client data to the public template. Clean files
# propagate automatically. This never aborts the whole sync over one dirty file.
NEEDLES="$TMP/needles.txt"
aios_build_needles "$ROOT" "$NEEDLES"
HELD="$TMP/held.txt"; : > "$HELD"

revert_in_mirror() {
  local f="$1"
  if git -C "$MIRROR" cat-file -e "origin/$BASE_BRANCH:$f" 2>/dev/null; then
    git -C "$MIRROR" checkout -q "origin/$BASE_BRANCH" -- "$f" 2>/dev/null || true
  else
    rm -f "$MIRROR/$f"
    git -C "$MIRROR" rm -q --ignore-unmatch --cached "$f" >/dev/null 2>&1 || true
  fi
}

while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! aios_scan_files "$MIRROR" "$NEEDLES" "$ALLOW_FILE" "$f" >/dev/null 2>&1 \
    || ! python3 "$MIRROR/scripts/lib/secret-scan.py" "$MIRROR" "$f" >/dev/null 2>&1; then
    revert_in_mirror "$f"
    printf '%s\n' "$f" >> "$HELD"
  fi
done < "$CHANGED_LIST"

git -C "$MIRROR" add -A
HELD_N="$(grep -c . "$HELD" 2>/dev/null || true)"
[ -n "$HELD_N" ] || HELD_N=0

report_held() {
  [ "$HELD_N" -gt 0 ] || return 0
  say ""
  say "HELD BACK ($HELD_N file(s) changed but carry client, personal, or credential-shaped content - not propagated):"
  sed 's/^/  /' "$HELD"
  say "  -> sanitize these (generic examples, no client names / home path) to let them flow,"
  say "     or add a path to $ALLOW_FILE if it is a false positive."
}

if git -C "$MIRROR" diff --cached --quiet; then
  say "Nothing clean to propagate this run."
  report_held
  git -C "$MIRROR" reset -q --hard "origin/$BASE_BRANCH" 2>/dev/null || true
  soft_exit 0
fi

CLEAN_N="$(git -C "$MIRROR" diff --cached --name-only | grep -c . || true)"
[ -n "$CLEAN_N" ] || CLEAN_N=0

# --- Dry run stops here ------------------------------------------------------
if [ "$MODE" = "dry" ]; then
  say "DRY RUN - would propagate $CLEAN_N clean file(s) to $EXPECTED_SLUG ($SYNC_BRANCH):"
  git -C "$MIRROR" diff --cached --stat | sed 's/^/  /'
  [ "$PRUNED" -gt 0 ] && say "  (includes $PRUNED prune(s))"
  report_held
  say ""
  say "No push performed (dry run)."
  git -C "$MIRROR" reset -q --hard "origin/$BASE_BRANCH" 2>/dev/null || true
  exit 0
fi

# --- Commit -------------------------------------------------------------------
STAMP="$(date -u '+%Y-%m-%d %H:%M UTC')"
git -C "$MIRROR" -c user.name="AI-OS Template Sync" -c user.email="template-sync@ai-os.local" \
  commit -q -m "chore(template-sync): propagate systemic changes [$STAMP]" \
  -m "Automated allowlist-scoped, sanitizer-passed sync from the maintainer install. $CLEAN_N clean file(s), $HELD_N held." \
  2>>"$LOG" || { say "commit failed"; soft_exit 1; }

if [ "$PUSH" -eq 0 ]; then
  say "Committed to mirror $SYNC_BRANCH ($CLEAN_N file(s)); --no-push, not pushed."
  report_held
  exit 0
fi

# --- Push rolling branch + ensure one PR -------------------------------------
# The rolling branch is a deterministic re-derivation of origin/main + owned
# files, so a --force-with-lease rejection means a concurrent sync run (another
# hook or a manual --auto) advanced the remote between our fetch and push, not a
# real conflict. Refresh the lease and retry once; only a second failure is a
# genuine auth/network/permission error.
# ceiling: single retry covers the common two-run race; add backoff if races persist.
push_sync() { git -C "$MIRROR" push --force-with-lease --quiet origin "$SYNC_BRANCH" 2>>"$LOG"; }
if ! push_sync; then
  git -C "$MIRROR" fetch --quiet origin "$SYNC_BRANCH" 2>>"$LOG" || true
  if ! push_sync; then
    say "Push to template failed (auth, network, or permission). Committed locally in mirror. See $LOG"; soft_exit 1
  fi
fi

PR_MSG="opened"
if command -v gh >/dev/null 2>&1; then
  # Only an OPEN PR carries the branch to $BASE_BRANCH. `gh pr view` also matches a
  # closed/merged PR, which left the branch updated but unmergeable (no open PR). List
  # open PRs for the head explicitly, and open a fresh one when none is open.
  if [ -n "$(gh pr list --repo "$EXPECTED_SLUG" --head "$SYNC_BRANCH" --state open --json number -q '.[].number' 2>>"$LOG")" ]; then
    PR_MSG="updated existing PR"
  else
    gh pr create --repo "$EXPECTED_SLUG" --base "$BASE_BRANCH" --head "$SYNC_BRANCH" \
      --title "AI-OS systemic changes (rolling sync)" \
      --body "Automated propagation of ai_os_owned systemic changes from the maintainer install. Allowlist-scoped and sanitizer-passed (client/personal strings held back). Merging lands them on template $BASE_BRANCH. This branch/PR is force-updated on each systemic change." \
      >/dev/null 2>>"$LOG" && PR_MSG="opened PR" || PR_MSG="pushed branch (gh PR step failed - open PR manually)"
  fi
else
  PR_MSG="pushed branch (gh not installed - open PR manually)"
fi

{
  say "Propagated $CLEAN_N clean file(s) to $EXPECTED_SLUG on $SYNC_BRANCH; $PR_MSG. [$STAMP]"
  [ "$HELD_N" -gt 0 ] && say "Held back $HELD_N personalized file(s) - see dry-run for the list."
} | tee -a "$LOG"
report_held
exit 0
