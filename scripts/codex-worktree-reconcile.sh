#!/usr/bin/env bash
# codex-worktree-reconcile.sh - audit or repair Codex-visible AI-OS worktrees.
#
# Default is read-only dry run. --apply re-links the shared AI-OS brain, copies
# missing or stale Codex adapter files from the primary checkout, and adds local
# exclude rules for shared-brain symlinks. It updates adapter files only, never
# user content.

set -uo pipefail

MODE="dry-run"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry-run" ;;
    --apply) MODE="apply" ;;
    -h|--help)
      cat <<'EOF'
Usage:
  bash scripts/codex-worktree-reconcile.sh --dry-run
  bash scripts/codex-worktree-reconcile.sh --apply

Audits every non-primary git worktree for AI-OS brain links and Codex adapter
presence. --apply runs scripts/worktree-link.sh, repairs missing or stale Codex
adapter files from the current AI-OS checkout, and adds local exclude rules. It
updates adapter files only, never user content.
EOF
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODE_ROOT="$(dirname "$SCRIPT_DIR")"
COMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
  echo "not inside a git repo." >&2
  exit 1
}
PRIMARY="$(cd "$COMMON/.." 2>/dev/null && pwd)" || exit 1

critical_paths=(
  ".env"
  ".command-centre"
  ".memsearch"
  "context/MEMORY.md"
  "context/learnings.md"
  "context/memory"
)

exclude_patterns=(
  ".env"
  ".mcp.json"
  ".claude/settings.local.json"
  ".claude/skills/_catalog/installed.json"
  ".command-centre"
  ".memsearch"
  "context/MEMORY.md"
  "context/learnings.md"
  "context/memory"
  "context/_private"
  "context/notion"
  "context/transcripts"
  "clients/*/context/MEMORY.md"
  "clients/*/context/learnings.md"
  "clients/*/context/memory"
  "clients/*/context/_private"
)

status_for_path() {
  local wt="$1"
  local rel="$2"
  local src="$PRIMARY/$rel"
  local dst="$wt/$rel"

  if [[ ! -e "$src" ]]; then printf "source-missing"; return; fi
  if [[ -L "$dst" ]]; then
    if [[ "$(readlink "$dst")" == "$src" ]]; then printf "linked"; else printf "wrong-link -> %s" "$(readlink "$dst")"; fi
    return
  fi

  if [[ -d "$src" && -d "$dst" ]]; then
    local child name total=0 linked=0
    while IFS= read -r child; do
      [[ -z "$child" ]] && continue
      name="$(basename "$child")"
      [[ "$name" == ".gitkeep" ]] && continue
      total=$((total + 1))
      if [[ -L "$dst/$name" && "$(readlink "$dst/$name")" == "$child" ]]; then
        linked=$((linked + 1))
      fi
    done < <(find "$src" -mindepth 1 -maxdepth 1 2>/dev/null)
    if [[ "$total" -gt 0 && "$linked" -eq "$total" ]]; then printf "linked-children"; elif [[ "$total" -eq 0 ]]; then printf "source-empty"; else printf "real-dir-unlinked (%s/%s children linked)" "$linked" "$total"; fi
    return
  fi

  if [[ -e "$dst" ]]; then printf "real-path-present"; else printf "missing"; fi
}

adapter_status() {
  local wt="$1"
  local rel="$2"
  local src="$PRIMARY/$rel"
  local dst="$wt/$rel"
  local freshness=""
  if [[ -f "$src" && -f "$dst" ]] && ! cmp -s "$src" "$dst" 2>/dev/null; then
    freshness="stale-"
  fi
  if [[ -f "$dst" ]]; then
    if [[ "$rel" != ".codex/hooks.json" ]]; then printf "%spresent" "$freshness"; return; fi
    if grep -q "scripts/codex-hook.sh" "$dst" 2>/dev/null; then
      printf "%sportable" "$freshness"
    else
      printf "%spresent-nonportable" "$freshness"
    fi
  elif [[ -L "$dst" ]]; then
    if [[ "$(readlink "$dst")" == "$src" ]]; then printf "linked"; else printf "wrong-link -> %s" "$(readlink "$dst")"; fi
  else
    printf "missing"
  fi
}

sync_adapter_file() {
  local wt="$1"
  local rel="$2"
  local src="$CODE_ROOT/$rel"
  local dst="$wt/$rel"
  [[ -f "$src" ]] || return 0
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst" 2>/dev/null; then return 0; fi
  if [[ -e "$dst" && ! -f "$dst" ]]; then return 0; fi
  mkdir -p "$(dirname "$dst")" 2>/dev/null || return 0
  cp "$src" "$dst" 2>/dev/null || true
}

repair_hooks_if_stale() {
  local wt="$1"
  local src="$CODE_ROOT/.codex/hooks.json"
  local dst="$wt/.codex/hooks.json"
  [[ -f "$src" ]] || return 0
  if [[ ! -f "$dst" ]]; then
    mkdir -p "$(dirname "$dst")" 2>/dev/null || return 0
    cp "$src" "$dst" 2>/dev/null || true
    return 0
  fi
  grep -q "scripts/codex-hook.sh" "$dst" 2>/dev/null || {
    cp "$src" "$dst" 2>/dev/null || true
    return 0
  }
}

write_excludes() {
  local exclude_file="$1"
  mkdir -p "$(dirname "$exclude_file")" 2>/dev/null || return 0
  touch "$exclude_file" 2>/dev/null || return 0
  local pattern
  for pattern in "${exclude_patterns[@]}"; do
    grep -Fxq "$pattern" "$exclude_file" 2>/dev/null && continue
    printf '%s\n' "$pattern" >> "$exclude_file" 2>/dev/null || true
  done
}

ensure_local_excludes() {
  local wt="$1"
  local gitdir common_gitdir
  gitdir="$(git -C "$wt" rev-parse --path-format=absolute --git-dir 2>/dev/null)" || return 0
  common_gitdir="$(git -C "$wt" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  write_excludes "$gitdir/info/exclude"
  if [[ -n "$common_gitdir" && "$common_gitdir" != "$gitdir" ]]; then
    write_excludes "$common_gitdir/info/exclude"
  fi
}

echo "AI-OS Codex worktree reconcile ($MODE)"
echo "Primary: $PRIMARY"
echo ""

git -C "$PRIMARY" worktree list --porcelain | awk '
  /^worktree / { wt=$2; br="" }
  /^branch / { br=$2; sub(/^refs\/heads\//, "", br) }
  /^prunable / { prunable=$0 }
  /^$/ { if (wt != "") { print wt "\t" br "\t" prunable }; wt=""; br=""; prunable="" }
  END { if (wt != "") { print wt "\t" br "\t" prunable } }
' | while IFS=$'\t' read -r wt branch prunable; do
  [[ -z "$wt" || "$wt" == "$PRIMARY" ]] && continue
  echo "Worktree: $wt"
  echo "Branch:   ${branch:-unknown}"
  [[ -n "$prunable" ]] && echo "State:    $prunable"

  if [[ ! -d "$wt" ]]; then
    echo "  folder missing - run: git worktree prune"
    echo ""
    continue
  fi

  if [[ "$MODE" == "apply" ]]; then
    bash "$CODE_ROOT/scripts/worktree-link.sh" "$wt" >/dev/null 2>&1 || true
    sync_adapter_file "$wt" ".codex/config.toml"
    sync_adapter_file "$wt" ".codex/hooks.json"
    sync_adapter_file "$wt" "scripts/codex-hook.sh"
    repair_hooks_if_stale "$wt"
    ensure_local_excludes "$wt"
  fi

  for rel in "${critical_paths[@]}"; do
    printf "  %-25s %s\n" "$rel" "$(status_for_path "$wt" "$rel")"
  done
  printf "  %-25s %s\n" ".codex/config.toml" "$(adapter_status "$wt" ".codex/config.toml")"
  printf "  %-25s %s\n" ".codex/hooks.json" "$(adapter_status "$wt" ".codex/hooks.json")"
  printf "  %-25s %s\n" "scripts/codex-hook.sh" "$(adapter_status "$wt" "scripts/codex-hook.sh")"
  echo ""
done
