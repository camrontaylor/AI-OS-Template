#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  OK %s${NC}\n" "$1"; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }
fail() { printf "${RED}FAIL %s${NC}\n" "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash scripts/skill-evals.sh [memory-recall] [meta-memory-write] [memory-boundaries] [ops-versioning]

With no arguments, runs all current skill evals.
EOF
}

contains() {
  local file="$1"
  local expected="$2"
  grep -Fq "$expected" "$file" || fail "$file is missing expected contract: $expected"
}

run_memory_recall() {
  info "Running memory-recall eval..."
  bash "$ROOT/scripts/test-memory-search.sh"
  bash "$ROOT/scripts/test-memsearch-search.sh"
  bash "$ROOT/scripts/test-memsearch-reindex.sh"
  ok "memory-recall eval passed"
}

run_meta_memory_write() {
  info "Running meta-memory-write eval..."
  local skill="$ROOT/.claude/skills/meta-memory-write/SKILL.md"
  contains "$skill" "## Active Threads"
  contains "$skill" "## Environment Notes"
  contains "$skill" "## Pending Decisions"
  contains "$skill" "Never exceed 2,500 characters"
  contains "$skill" "Always check for duplicates"
  contains "$skill" "Prefer **replace** over **add**"
  contains "$skill" "Always confirm with the user before **remove**"
  contains "$skill" "Never quote secret values"
  contains "$skill" "next session"
  ok "meta-memory-write eval passed"
}

run_memory_boundaries() {
  info "Running memory-boundaries eval..."
  bash "$ROOT/scripts/test-memory-target-resolver.sh"
  bash "$ROOT/scripts/test-load-memory-snapshot.sh"
  bash "$ROOT/scripts/test-session-memory-block.sh"
  bash "$ROOT/scripts/test-client-routing-guard.sh"
  bash "$ROOT/scripts/test-client-sync.sh"
  bash "$ROOT/scripts/test-client-memory-maintenance.sh"
  ok "memory-boundaries eval passed"
}

run_ops_versioning() {
  info "Running ops-versioning eval..."
  local tmp target list_before list_after
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/aios-ops-versioning-eval.XXXXXX")"
  trap 'rm -rf "$tmp"' RETURN
  target="$tmp/brief.md"

  printf 'first draft\n' > "$target"
  bash "$ROOT/.claude/skills/ops-versioning/scripts/snapshot.sh" "$target" "initial" >/dev/null

  printf 'second draft\n' > "$target"
  bash "$ROOT/.claude/skills/ops-versioning/scripts/snapshot.sh" "$target" "changed" >/dev/null

  printf 'unsaved working copy\n' > "$target"
  list_before="$(bash "$ROOT/.claude/skills/ops-versioning/scripts/list.sh" "$target")"
  printf '%s\n' "$list_before" | grep -Fq "initial" || fail "initial snapshot missing from list output"
  printf '%s\n' "$list_before" | grep -Fq "changed" || fail "changed snapshot missing from list output"

  bash "$ROOT/.claude/skills/ops-versioning/scripts/restore.sh" "$target" 1 >/dev/null
  grep -Fxq "first draft" "$target" || fail "restore did not return the selected saved version"

  list_after="$(bash "$ROOT/.claude/skills/ops-versioning/scripts/list.sh" "$target")"
  printf '%s\n' "$list_after" | grep -Fq "auto before restore" || fail "restore did not save the current copy first"
  ok "ops-versioning eval passed"
}

if [ "$#" -eq 0 ]; then
  set -- memory-recall meta-memory-write memory-boundaries ops-versioning
fi

for target in "$@"; do
  case "$target" in
    memory-recall)
      run_memory_recall
      ;;
    meta-memory-write)
      run_meta_memory_write
      ;;
    memory-boundaries)
      run_memory_boundaries
      ;;
    ops-versioning)
      run_ops_versioning
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "unknown eval target: $target"
      ;;
  esac
done

ok "skill evals complete"
