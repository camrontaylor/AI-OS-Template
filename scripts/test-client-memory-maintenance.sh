#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-client-memory-maintenance-test"
TODAY="$(date +%F)"
trap 'rm -rf "$TEST_ROOT"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

make_fake_repo() {
  rm -rf "$TEST_ROOT"
  mkdir -p \
    "$TEST_ROOT/repo/scripts" \
    "$TEST_ROOT/repo/context" \
    "$TEST_ROOT/repo/clients/acme/context/memory" \
    "$TEST_ROOT/repo/clients/acme/projects/acme-launch"
  cp "$REAL_REPO/scripts/client-memory-maintenance.sh" "$TEST_ROOT/repo/scripts/client-memory-maintenance.sh"
  cp "$REAL_REPO/scripts/memory-search.sh" "$TEST_ROOT/repo/scripts/memory-search.sh"
  cp "$REAL_REPO/scripts/memory-search.py" "$TEST_ROOT/repo/scripts/memory-search.py"
  cat > "$TEST_ROOT/repo/context/MEMORY.md" <<'EOF'
# Root Memory

## Active Threads
- Root must not be touched.
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" <<'EOF'
# Client Memory

## Active Threads
- Old resolved thread shipped
- Duplicate thread with source: `context/acme-map.md`; next: confirm owner
- Duplicate thread with source: `context/acme-map.md`; next: confirm owner

## Operating Notes
- Existing operating note

## Pending Decisions
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/memory/$TODAY.md" <<'EOF'
# Today

## Session 1

### Open threads
- Acme proposal needs pricing review
- Session in progress.

### Decisions
- Decide whether Acme launch uses Option A
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/acme-map.md" <<'EOF'
# Acme Map

Current source of truth for Acme launch ownership and next steps.
EOF
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" ]] || fail "Missing file: $file"
  grep -Fq "$expected" "$file" || fail "Expected '$expected' in $file"
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq "$unexpected" "$file"; then
    fail "Did not expect '$unexpected' in $file"
  fi
}

test_client_distill_and_curate_stay_client_scoped() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/client-memory-maintenance.sh --mode distill --client acme > /tmp/aios-client-memory-distill.out
    bash scripts/client-memory-maintenance.sh --mode gaps --client acme > /tmp/aios-client-memory-gaps.out
    bash scripts/client-memory-maintenance.sh --mode curate --client acme > /tmp/aios-client-memory-curate.out
  )

  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" "$TODAY: Acme proposal needs pricing review"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" "$TODAY: Decide whether Acme launch uses Option A"
  assert_file_not_contains "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" "Old resolved thread shipped"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" "## Environment Notes"
  assert_file_not_contains "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" "## Operating Notes"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" "Existing operating note"
  [[ "$(grep -Fc "Duplicate thread with source" "$TEST_ROOT/repo/clients/acme/context/MEMORY.md")" -eq 1 ]] || fail "Expected duplicate active thread to be merged"
  assert_file_contains "$TEST_ROOT/repo/context/MEMORY.md" "Root must not be touched."
  assert_file_not_contains "$TEST_ROOT/repo/context/MEMORY.md" "Acme proposal needs pricing review"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/memory/${TODAY}_gap-analysis.md" 'Client: `acme`'
  ok "client memory maintenance writes only client memory"
}

test_client_health_flags_quality_issues() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    AI_OS_SKIP_RECALL_HEALTH=1 bash scripts/client-memory-maintenance.sh --mode evaluate --client acme --stdout > "$TEST_ROOT/health.md"
  )

  assert_file_contains "$TEST_ROOT/health.md" "Status: **NEEDS CURATION**"
  assert_file_contains "$TEST_ROOT/health.md" "memory headings do not match the official three-section shape"
  assert_file_contains "$TEST_ROOT/health.md" "active threads are missing source pointers"
  assert_file_contains "$TEST_ROOT/health.md" "active threads are missing next-step markers"
  assert_file_contains "$TEST_ROOT/health.md" "duplicate bullets are present"
  ok "client memory health flags useful-current-brief quality issues"
}

test_client_brief_generation() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/client-memory-maintenance.sh --mode distill --client acme >/tmp/aios-client-memory-distill.out
    bash scripts/client-memory-maintenance.sh --mode curate --client acme >/tmp/aios-client-memory-curate.out
    bash scripts/client-memory-maintenance.sh --mode brief --client acme >/tmp/aios-client-memory-brief.out
  )

  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/current-state.md" "# Acme Current State"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/current-state.md" "## Where We Are"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/current-state.md" "## What Matters Now"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/current-state.md" "## Key Source Files"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/current-state.md" '`context/acme-map.md` - Acme Map'
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/current-state.md" "## Source Map"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/current-state.md" '`projects/acme-launch`'
  ok "client current-state brief is generated from client context"
}

info "Running client memory maintenance tests..."
test_client_distill_and_curate_stay_client_scoped
test_client_health_flags_quality_issues
test_client_brief_generation
ok "client memory maintenance tests passed"
