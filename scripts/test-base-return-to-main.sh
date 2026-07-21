#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/base-return-to-main.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

make_repo() {
  local dir="$1"
  git -C "$dir" init -b main >/dev/null
  git -C "$dir" config user.name Test
  git -C "$dir" config user.email test@example.com
  printf 'base\n' > "$dir/file.txt"
  git -C "$dir" add file.txt
  git -C "$dir" commit -m base >/dev/null
}

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/aios-return-main.XXXXXX")"
cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT INT TERM

info "Running base return-to-main tests..."

autosave_repo="$tmp_root/autosave"
mkdir -p "$autosave_repo"
make_repo "$autosave_repo"
git -C "$autosave_repo" checkout -b autosave-recovery/test >/dev/null 2>&1
printf 'saved\n' >> "$autosave_repo/file.txt"
git -C "$autosave_repo" add file.txt
git -C "$autosave_repo" commit -m saved >/dev/null

(cd "$autosave_repo" && bash "$SCRIPT")
[[ "$(git -C "$autosave_repo" branch --show-current)" == "main" ]] ||
  fail "autosave recovery branch did not return to main"
git -C "$autosave_repo" show-ref --verify --quiet refs/heads/autosave-recovery/test ||
  fail "autosave recovery branch was not preserved"
ok "clean autosave recovery branch returns to main and stays preserved"

feature_repo="$tmp_root/feature"
mkdir -p "$feature_repo"
make_repo "$feature_repo"
git -C "$feature_repo" checkout -b feature/test >/dev/null 2>&1
printf 'feature\n' >> "$feature_repo/file.txt"
git -C "$feature_repo" add file.txt
git -C "$feature_repo" commit -m feature >/dev/null

(cd "$feature_repo" && bash "$SCRIPT")
[[ "$(git -C "$feature_repo" branch --show-current)" == "feature/test" ]] ||
  fail "normal feature branch should not auto-return to main"
ok "normal side branch with unique commits stays on that branch"

dirty_repo="$tmp_root/dirty-no-unique"
mkdir -p "$dirty_repo"
make_repo "$dirty_repo"
git -C "$dirty_repo" checkout -b review/parked-workspace-edits-test >/dev/null 2>&1
printf 'dirty\n' >> "$dirty_repo/file.txt"

(cd "$dirty_repo" && bash "$SCRIPT")
[[ "$(git -C "$dirty_repo" branch --show-current)" == "main" ]] ||
  fail "dirty branch with no unique commits did not return to main"
[[ -n "$(git -C "$dirty_repo" status --porcelain --ignore-submodules=all)" ]] ||
  fail "dirty edits were not carried back to main"
ok "dirty parking branch with no unique commits returns to main with edits carried over"

dirty_autosave_repo="$tmp_root/dirty-autosave"
mkdir -p "$dirty_autosave_repo"
make_repo "$dirty_autosave_repo"
git -C "$dirty_autosave_repo" checkout -b autosave-recovery/dirty >/dev/null 2>&1
printf 'saved\n' >> "$dirty_autosave_repo/file.txt"
git -C "$dirty_autosave_repo" add file.txt
git -C "$dirty_autosave_repo" commit -m saved >/dev/null
printf 'dirty\n' >> "$dirty_autosave_repo/file.txt"

(cd "$dirty_autosave_repo" && bash "$SCRIPT")
[[ "$(git -C "$dirty_autosave_repo" branch --show-current)" == "autosave-recovery/dirty" ]] ||
  fail "dirty autosave recovery branch with unique commits should not auto-return to main"
ok "dirty autosave recovery branch with unique commits stays put until edits are saved"

ok "base return-to-main tests passed"
