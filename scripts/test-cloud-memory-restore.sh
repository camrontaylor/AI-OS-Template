#!/usr/bin/env bash
#
# test-cloud-memory-restore.sh - proves cloud-memory-restore.sh pulls fresh
# memory into a simulated cloud checkout, non-destructively, without touching
# the real repo or real brain.
#
# Simulates:
#   - a "brain" git repo (what AI-OS-Brain looks like: snapshots/<stamp>/context/*)
#   - a fresh "cloud" checkout of AI-OS with NO live memory (gitignored out)
#   - running the restore against the fake brain
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-cloud-restore-test"
trap 'rm -rf "$TEST_ROOT"' EXIT

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { printf "${GREEN}  ok %s${NC}\n" "$1"; }
fail() { printf "${RED}  FAIL %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

assert_file_contains() {
  [ -f "$1" ] || fail "expected file missing: $1"
  grep -Fq "$2" "$1" || fail "expected '$2' in $1"
}
assert_absent() { [ -e "$1" ] && fail "did not expect to exist: $1" || true; }

build_fake_brain() {
  local brain="$TEST_ROOT/brain"
  mkdir -p "$brain/snapshots/2026-07-20_010101/context/memory"
  mkdir -p "$brain/snapshots/2026-07-21_101010/context/memory"
  # older snapshot (should NOT be the one restored)
  echo "OLD MEMORY MARKER" > "$brain/snapshots/2026-07-20_010101/context/MEMORY.md"
  # newest snapshot (this is the fresh memory cloud should get)
  echo "FRESH MEMORY MARKER"    > "$brain/snapshots/2026-07-21_101010/context/MEMORY.md"
  echo "FRESH LEARNINGS MARKER" > "$brain/snapshots/2026-07-21_101010/context/learnings.md"
  echo "FRESH DAILY MARKER"     > "$brain/snapshots/2026-07-21_101010/context/memory/2026-07-21.md"
  # an absolute "latest" symlink, exactly like the producer writes - must be ignored off-machine
  ln -sfn "$brain/snapshots/2026-07-21_101010" "$brain/latest"
  ( cd "$brain" && git init -q && git add -A \
    && git -c user.name=t -c user.email=t@t commit -qm "brain" )
  echo "$brain"
}

build_fake_cloud_checkout() {
  # unique per call, so tests never share a checkout ($1 = label)
  local repo="$TEST_ROOT/cloud-${1:-default}/AI-OS"
  mkdir -p "$repo/scripts/lib" "$repo/context/memory"
  cp "$REAL_REPO/scripts/cloud-memory-restore.sh" "$repo/scripts/cloud-memory-restore.sh"
  # a fresh cloud clone has NO live memory - context/ exists but memory files do not
  echo "$repo"
}

run_restore() {
  local repo="$1" brain="$2"
  # AIOS_FORCE_MEMORY_RESTORE=1 bypasses the producer guard (this Mac has a real
  # ~/.ai-os-memory-backup). A real cloud VM would not, so the guard is inert there.
  AIOS_FORCE_MEMORY_RESTORE=1 AIOS_BRAIN_REPO="$brain" \
    bash "$repo/scripts/cloud-memory-restore.sh" >/dev/null 2>&1
}

info "1. Fresh cloud checkout with no memory gets the NEWEST snapshot restored"
BRAIN="$(build_fake_brain)"
REPO="$(build_fake_cloud_checkout t1)"
assert_absent "$REPO/context/MEMORY.md"
run_restore "$REPO" "$BRAIN"
assert_file_contains "$REPO/context/MEMORY.md" "FRESH MEMORY MARKER"
assert_file_contains "$REPO/context/learnings.md" "FRESH LEARNINGS MARKER"
assert_file_contains "$REPO/context/memory/2026-07-21.md" "FRESH DAILY MARKER"
grep -Fq "OLD MEMORY MARKER" "$REPO/context/MEMORY.md" && fail "restored the OLD snapshot, not the newest" || true
ok "newest snapshot restored, older snapshot ignored, absolute 'latest' symlink not required"

info "2. Restore is non-destructive: pre-existing memory is backed up, not lost"
REPO2="$(build_fake_cloud_checkout t2)"
echo "STALE CLOUD MEMORY" > "$REPO2/context/MEMORY.md"
run_restore "$REPO2" "$BRAIN"
assert_file_contains "$REPO2/context/MEMORY.md" "FRESH MEMORY MARKER"
backup="$(find "$REPO2/context" -name 'MEMORY.md.pre-restore-*' 2>/dev/null | head -1)"
[ -n "$backup" ] || fail "expected a .pre-restore backup of the replaced file"
assert_file_contains "$backup" "STALE CLOUD MEMORY"
ok "stale memory replaced by fresh, prior copy preserved as .pre-restore backup"

info "3. Idempotent: a second run with no changes leaves a clean tree"
run_restore "$REPO2" "$BRAIN"
n_backups="$(find "$REPO2/context" -name 'MEMORY.md.pre-restore-*' 2>/dev/null | wc -l | tr -d ' ')"
[ "$n_backups" = "1" ] || fail "second identical run should not create another backup (got $n_backups)"
ok "second run made no redundant backup (content already identical)"

info "4. Producer guard: on a machine WITH a local brain, restore skips by default"
REPO3="$(build_fake_cloud_checkout t4)"
FAKE_HOME_BRAIN="$TEST_ROOT/fakehome-brain"; mkdir -p "$FAKE_HOME_BRAIN/.git"
AI_OS_MEMORY_BACKUP_DIR="$FAKE_HOME_BRAIN" AIOS_BRAIN_REPO="$BRAIN" \
  bash "$REPO3/scripts/cloud-memory-restore.sh" >/dev/null 2>&1
assert_absent "$REPO3/context/MEMORY.md"
ok "producer machine skipped (live local memory never overwritten by a snapshot)"

printf "${GREEN}all cloud-memory-restore tests passed${NC}\n"
