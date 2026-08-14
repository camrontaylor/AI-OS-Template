#!/usr/bin/env bash
# audit.sh - meta-worktree audit. Inspects the AI-OS folder, worktrees, branches,
# stashes, recovery state, surfaced logs, and orphan files. Emits ONE JSON
# document on stdout. The SKILL.md instructs Claude to translate findings into
# plain English and present them with the action IDs included here.
#
# Pure read-only. No side effects beyond `git fetch --quiet` (best-effort).

set -uo pipefail

# ------------------------------------------------------------ locate primary
COMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
  printf '{"error":"not inside a git repo","findings":[]}\n'; exit 0
}
BASE="$(cd "$COMMON/.." 2>/dev/null && pwd)"
TOP="$(git -C "$BASE" rev-parse --show-toplevel 2>/dev/null)"

cd "$BASE" || exit 0

# best-effort fetch so ahead/behind is accurate; never error out on failure.
# Bound it so a slow network cannot make the local workspace check hang.
( git fetch origin --quiet 2>/dev/null ) &
fetch_pid=$!
for _ in 1 2 3 4 5 6 7 8; do
  if ! kill -0 "$fetch_pid" 2>/dev/null; then
    wait "$fetch_pid" 2>/dev/null || true
    fetch_pid=""
    break
  fi
  sleep 1
done
if [ -n "${fetch_pid:-}" ]; then
  kill "$fetch_pid" 2>/dev/null || true
  wait "$fetch_pid" 2>/dev/null || true
fi

# ------------------------------------------------------------ collectors
findings_file="$(mktemp)"
trap 'rm -f "$findings_file" 2>/dev/null || true' EXIT

# Helper: emit one finding object. Args: id, category, severity, title, detail, action_label
emit() {
  local id="$1" cat="$2" sev="$3" title="$4" detail="$5" action="$6"
  # json-escape: minimal — newlines and quotes
  local esc_title esc_detail esc_action
  esc_title=$(printf '%s' "$title" | python3 -c 'import sys,json; sys.stdout.write(json.dumps(sys.stdin.read()))')
  esc_detail=$(printf '%s' "$detail" | python3 -c 'import sys,json; sys.stdout.write(json.dumps(sys.stdin.read()))')
  esc_action=$(printf '%s' "$action" | python3 -c 'import sys,json; sys.stdout.write(json.dumps(sys.stdin.read()))')
  printf '{"id":"%s","category":"%s","severity":"%s","title":%s,"detail":%s,"action_label":%s},\n' \
    "$id" "$cat" "$sev" "$esc_title" "$esc_detail" "$esc_action" >> "$findings_file"
}

# ------------------------------------------------------------ snapshot
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
dirty_count="$(git status --porcelain --ignore-submodules=all 2>/dev/null | wc -l | tr -d ' ')"
ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
wt_count="$(git worktree list --porcelain 2>/dev/null | grep -c '^worktree ' || echo 0)"
backup_ref="$(git branch -r --contains HEAD 2>/dev/null | sed 's/^[* ]*//' | grep '^origin/backup/' | head -1 | sed 's#^origin/##')"

# ------------------------------------------------------------ checks

# 1. base off main
if [ "$branch" != "main" ] && [ "$branch" != "HEAD" ]; then
  unique_count="$(git rev-list --count "main..$branch" 2>/dev/null || echo 0)"
  case "$branch" in
    autosave-recovery/*)
      if [ "$dirty_count" -eq 0 ]; then
        emit "base-off-main" "branch" "essential" \
          "Folder is on saved recovery branch '$branch', not main" \
          "The recovery branch preserves saved work. Because the tree is clean, AI-OS can switch the primary folder back to main without deleting that branch." \
          "return the base folder to main and keep the recovery branch as a saved snapshot"
      else
        emit "base-off-main" "branch" "needs-call" \
          "Folder is on saved recovery branch '$branch' with unsaved edits" \
          "The recovery branch has unsaved edits, so AI-OS should save them before returning to main." \
          "save the edits, then return the base folder to main"
      fi
      ;;
    *)
      if [ "${unique_count:-0}" -eq 0 ]; then
        emit "base-off-main" "branch" "essential" \
          "Folder is on parking branch '$branch', not main" \
          "This branch has no saved commits of its own, so AI-OS can return the primary folder to main without abandoning saved work." \
          "return the base folder to main and carry unsaved edits if Git can do that cleanly"
      else
        emit "base-off-main" "branch" "needs-call" \
          "Folder is on side branch '$branch', not main" \
          "The base normally lives on main. This branch has $unique_count saved thing(s) not in main." \
          "ask the user whether to merge, archive, or leave this branch"
      fi
      ;;
  esac
fi

# 2. unsaved edits in base
if [ "$dirty_count" -gt 0 ]; then
  files="$(git status --porcelain --ignore-submodules=all | head -5 | sed 's/^...//' | tr '\n' ',' | sed 's/,$//')"
  emit "base-dirty" "save" "essential" \
    "$dirty_count unsaved edit(s) in the base folder" \
    "Files: $files" \
    "save them now on $branch"
fi

# 3. ahead of origin (un-pushed)
if [ "$ahead" -gt 0 ]; then
  if [ -n "$backup_ref" ]; then
    emit "main-ahead-backed-up" "backup" "fyi" \
      "$ahead saved thing(s) are backed up, but not on GitHub main" \
      "Local main is $ahead commit(s) ahead of origin/main. Current HEAD is backed up on GitHub at $backup_ref." \
      "(informational - use the release or PR flow when ready)"
  else
    emit "main-ahead" "backup" "optional" \
      "$ahead saved thing(s) not yet backed up to GitHub" \
      "Local main is $ahead commit(s) ahead of origin/main." \
      "push a dated backup branch to GitHub (does NOT touch main on GitHub)"
  fi
fi

# 4. behind origin
if [ "$behind" -gt 0 ]; then
  emit "main-behind" "sync" "optional" \
    "$behind update(s) from GitHub waiting to be pulled in" \
    "origin/main is $behind commit(s) ahead of your local main." \
    "pull the updates"
fi

# 5. side branches with un-merged commits
while IFS= read -r b; do
  [ -z "$b" ] && continue
  c="$(git rev-list --count "main..$b" 2>/dev/null || echo 0)"
  [ "$c" -gt 0 ] || continue
  age="$(git log -1 --format='%cr' "$b" 2>/dev/null || echo unknown)"
  case "$b" in
    feature/*|work/*)
      emit "branch-$b" "branches" "needs-call" \
        "Side branch '$b' has $c saved thing(s) not in main (last touched $age)" \
        "Choices: bring it into main, archive it as a safe snapshot, or leave it." \
        "ask the user which: merge, archive, or leave" ;;
  esac
done < <(git for-each-ref --format='%(refname:short)' refs/heads/feature refs/heads/work 2>/dev/null)

# 6. recovery snapshots older than 30 days
old_recovery="$(git for-each-ref --format='%(refname:short) %(committerdate:unix)' refs/heads/autosave-recovery 2>/dev/null | awk -v cutoff=$(($(date +%s) - 30*86400)) '$2 < cutoff {print $1}' | wc -l | tr -d ' ')"
if [ "$old_recovery" -gt 0 ]; then
  emit "recovery-old" "tidy" "optional" \
    "$old_recovery safety snapshot(s) older than 30 days" \
    "Recovery snapshots are auto-created when an update fails. They pile up." \
    "delete safety snapshots older than 30 days"
fi

# 7. orphan stashes (epitaxy / auto)
stash_lines="$(git stash list 2>/dev/null | grep -ciE 'epitaxy|pre-switch|auto-stash|autosave' || true)"
stash_lines="${stash_lines:-0}"
if [ "$stash_lines" -gt 0 ]; then
  emit "stash-orphan" "save" "needs-call" \
    "$stash_lines shelved item(s) from another session" \
    "These came from a parallel session that switched branches." \
    "show what's in each shelf and offer to restore or drop"
fi

# 8. worktrees
wt_file="$(mktemp)"
git worktree list --porcelain 2>/dev/null > "$wt_file" || true
python3 - "$BASE" "$wt_file" <<'PY' >> "$findings_file"
import sys, os, json, subprocess, time
base = sys.argv[1]
wt_file = sys.argv[2]
entries, cur = [], {}
try:
    fh = open(wt_file, 'r')
except Exception:
    fh = []
for line in fh:
    line = line.rstrip('\n')
    if line.startswith('worktree '):
        if cur: entries.append(cur); cur = {}
        cur['path'] = line[len('worktree '):]
    elif line.startswith('branch '):
        cur['branch'] = line[len('branch '):].replace('refs/heads/','')
    elif line.startswith('HEAD '):
        cur['head'] = line[len('HEAD '):]
    elif line.startswith('prunable '):
        cur['prunable'] = line[len('prunable '):]
    elif line.strip() == '':
        if cur: entries.append(cur); cur = {}
try:
    fh.close()
except Exception:
    pass
if cur: entries.append(cur)
for w in entries:
    if w.get('path') == base: continue  # primary
    p = w.get('path',''); b = w.get('branch','?')
    name = os.path.basename(p.rstrip('/')) or 'unknown'
    if not p or not os.path.isdir(p):
        d = json.dumps(f"Folder: {p}. Branch: {b}. {w.get('prunable','missing from disk')}.")
        a = json.dumps("prune the missing worktree metadata")
        sys.stdout.write(f'{{"id":"wt-prunable-{name}","category":"worktrees","severity":"optional","title":{json.dumps(f"Worktree {name} is registered but missing")},"detail":{d},"action_label":{a}}},\n')
        continue
    try:
        dirty = subprocess.check_output(['git','-C',p,'status','--porcelain','--ignore-submodules=all'], timeout=4).decode().strip()
        dirty_n = len(dirty.splitlines()) if dirty else 0
    except Exception:
        dirty_n = 0
    try:
        last = int(subprocess.check_output(['git','-C',p,'log','-1','--format=%ct','HEAD'], timeout=4).decode().strip() or '0')
    except Exception:
        last = 0
    age_days = (time.time() - last) / 86400 if last else 999
    if dirty_n > 0:
        d = json.dumps(f"Folder: {p}. Unsaved edits: {dirty_n}.")
        a = json.dumps(f"save the unsaved edits on its branch {b}")
        sys.stdout.write(f'{{"id":"wt-dirty-{name}","category":"worktrees","severity":"essential","title":{json.dumps(f"Worktree {name} has {dirty_n} unsaved edit(s)")},"detail":{d},"action_label":{a}}},\n')
    if age_days > 14 and dirty_n == 0:
        d = json.dumps(f"Folder: {p}. Branch: {b}. Last activity: {int(age_days)} days ago.")
        a = json.dumps(f"close the {name} worktree (preserves any commits as an archive tag)")
        sys.stdout.write(f'{{"id":"wt-stale-{name}","category":"worktrees","severity":"optional","title":{json.dumps(f"Worktree {name} untouched for {int(age_days)} days")},"detail":{d},"action_label":{a}}},\n')
    if dirty_n == 0 and age_days <= 14:
        d = json.dumps(f"Folder: {p}. Branch: {b}. Clean and recently active.")
        sys.stdout.write(f'{{"id":"wt-open-{name}","category":"worktrees","severity":"fyi","title":{json.dumps(f"Worktree {name} is open")},"detail":{d},"action_label":"(informational - no action)"}},\n')
PY
rm -f "$wt_file" 2>/dev/null || true

# 9. .recovered files left by coexistence net
rec_files="$(find . -name '*.recovered' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -5 | tr '\n' ',' | sed 's/,$//')"
if [ -n "$rec_files" ]; then
  n="$(printf '%s\n' "$rec_files" | tr ',' '\n' | wc -l | tr -d ' ')"
  emit "recovered-files" "collision" "needs-call" \
    "$n file(s) the safety net set aside (.recovered)" \
    "Another session had shelved these and they came back as backup copies. The user must compare against their current files." \
    "list each .recovered file and ask whether to keep the safety copy or discard it"
fi

# 10. branch-state.log and autosave-pending.log recent lines (informational only)
for f in branch-state.log autosave-pending.log; do
  p="$BASE/.command-centre/$f"
  [ -s "$p" ] || continue
  recent="$(tail -3 "$p" 2>/dev/null | tr '\n' '|' | sed 's/|$//')"
  [ -z "$recent" ] && continue
  case "$f" in
    branch-state.log)
      emit "log-branch-state" "info" "fyi" \
        "Recent branch notes" "$recent" "(informational — no action)" ;;
    autosave-pending.log)
      emit "log-pending" "info" "fyi" \
        "Recent files that were too big to auto-save (>5MB)" "$recent" \
        "decide what to do with each big file (move to a private folder, or convert to a smaller form)" ;;
  esac
done

# 11. orphan worktree folders on disk that git no longer tracks
wt_root="$HOME/Desktop/Worktrees/$(basename "$BASE")"
if [ -d "$wt_root" ]; then
  known="$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')"
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    if ! printf '%s\n' "$known" | grep -qxF "$d"; then
      name="$(basename "$d")"
      emit "wt-orphan-$name" "worktrees" "optional" \
        "Folder '$name' looks like a worktree but git doesn't know it" \
        "Folder: $d" \
        "delete the orphan folder (git already forgot it)"
    fi
  done < <(find "$wt_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
fi

# ------------------------------------------------------------ render JSON
# Python reads the findings file directly. No bash-to-python string passing.
python3 - "$branch" "$dirty_count" "$ahead" "$behind" "$wt_count" "$BASE" "$findings_file" <<'PY'
import json, sys, os
branch, dirty, ahead, behind, wt_count, base, ff = sys.argv[1:8]
items = []
try:
    with open(ff, 'r') as f:
        raw = f.read().strip().rstrip(',')
    if raw:
        items = json.loads("[" + raw + "]")
except Exception as e:
    items = []
out = {
    "base_path": base,
    "branch": branch,
    "dirty_count": int(dirty),
    "ahead": int(ahead),
    "behind": int(behind),
    "worktree_count": int(wt_count),
    "findings": items,
    "summary": {
        "essential": sum(1 for x in items if x.get("severity")=="essential"),
        "needs_call": sum(1 for x in items if x.get("severity")=="needs-call"),
        "optional": sum(1 for x in items if x.get("severity")=="optional"),
        "fyi": sum(1 for x in items if x.get("severity")=="fyi"),
    },
}
print(json.dumps(out, indent=2))
PY
