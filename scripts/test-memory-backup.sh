#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-memory-backup-test"
trap 'rm -rf "$TEST_ROOT"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

make_fixture() {
  rm -rf "$TEST_ROOT"
  mkdir -p "$TEST_ROOT/repo/scripts" "$TEST_ROOT/repo/context/memory" \
    "$TEST_ROOT/repo/.command-centre" "$TEST_ROOT/home" "$TEST_ROOT/cloud-parent"
  cp "$REAL_REPO/scripts/backup-memory.sh" "$TEST_ROOT/repo/scripts/backup-memory.sh"
  printf '# Working Memory\n\n- durable fact\n' > "$TEST_ROOT/repo/context/MEMORY.md"
  printf '# Learnings\n\n- durable lesson\n' > "$TEST_ROOT/repo/context/learnings.md"
  printf '# Session\n' > "$TEST_ROOT/repo/context/memory/2026-07-16.md"
  printf '%s\n' "$TEST_ROOT/cloud-parent/aios-brain" > "$TEST_ROOT/repo/.command-centre/brain-backup-dest"
}

info "Running memory backup durability tests..."

make_fixture
HOME="$TEST_ROOT/home" bash "$TEST_ROOT/repo/scripts/backup-memory.sh" >/dev/null
[[ -f "$TEST_ROOT/cloud-parent/aios-brain/.last-mirror" ]] || fail "first backup did not create an off-machine mirror marker"
[[ -f "$TEST_ROOT/cloud-parent/aios-brain/latest/context/MEMORY.md" ]] || fail "mirror is missing live memory"
ok "backup mirrors live memory to the configured off-machine destination"

rm -rf "$TEST_ROOT/cloud-parent/aios-brain"
HOME="$TEST_ROOT/home" bash "$TEST_ROOT/repo/scripts/backup-memory.sh" >/dev/null
[[ -f "$TEST_ROOT/cloud-parent/aios-brain/.last-mirror" ]] || fail "unchanged local snapshot skipped a newly needed mirror"
ok "unchanged snapshots still repair a missing off-machine mirror"

printf '%s\n' "$TEST_ROOT/missing-parent/aios-brain" > "$TEST_ROOT/repo/.command-centre/brain-backup-dest"
if HOME="$TEST_ROOT/home" bash "$TEST_ROOT/repo/scripts/backup-memory.sh" >/dev/null; then
  fail "configured mirror failure was reported as a successful backup"
fi
ok "configured off-machine mirror failures exit non-zero"

ok "memory backup durability tests passed"
