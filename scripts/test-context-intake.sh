#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-context-intake-test"
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
    "$TEST_ROOT/repo/config" \
    "$TEST_ROOT/repo/context" \
    "$TEST_ROOT/repo/clients/acme/scripts" \
    "$TEST_ROOT/repo/clients/acme/context/inbox"

  cp "$REAL_REPO/scripts/context-intake.py" "$TEST_ROOT/repo/scripts/context-intake.py"
  cp "$REAL_REPO/scripts/context-intake.sh" "$TEST_ROOT/repo/scripts/context-intake.sh"
  cp "$REAL_REPO/scripts/context-intake.sh" "$TEST_ROOT/repo/clients/acme/scripts/context-intake.sh"
  cp "$REAL_REPO/config/memory-index-policy.json" "$TEST_ROOT/repo/config/memory-index-policy.json"
  chmod +x "$TEST_ROOT/repo/scripts/context-intake.sh" "$TEST_ROOT/repo/clients/acme/scripts/context-intake.sh"
  git -C "$TEST_ROOT/repo" init -q

  cat > "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" <<'EOF'
# Working Memory
EOF

  cat > "$TEST_ROOT/repo/clients/acme/context/inbox/brand-notes.md" <<'EOF'
# Acme Brand Notes
The brand voice should feel sharp, helpful, and direct.
EOF

  cat > "$TEST_ROOT/repo/clients/acme/context/inbox/durable-decision.md" <<'EOF'
# Durable Decision
We decided the Acme dashboard must keep project status visible.
Remember that this is ongoing.
EOF

  cat > "$TEST_ROOT/repo/clients/acme/context/inbox/call-transcript.md" <<'EOF'
# Meeting Transcript
Raw notes from a client call. The transcript includes many details and should be summarized before promotion.
EOF
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$file" || fail "Expected '$expected' in $file"
}

assert_path_exists() {
  local path="$1"
  [ -e "$path" ] || fail "Expected path to exist: $path"
}

test_client_intake_report_is_review_first() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    python3 scripts/context-intake.py --workspace "$TEST_ROOT/repo" --client acme --date 2026-06-29 > "$TEST_ROOT/out.txt"
  )

  local report="$TEST_ROOT/repo/clients/acme/context/intake/review/2026-06-29_acme_promotion-plan.md"
  assert_path_exists "$TEST_ROOT/repo/clients/acme/context/inbox/.gitkeep"
  assert_path_exists "$TEST_ROOT/repo/clients/acme/context/reference/.gitkeep"
  assert_path_exists "$TEST_ROOT/repo/clients/acme/context/intake/parked/.gitkeep"
  assert_path_exists "$report"
  assert_contains "$report" "Files moved: 0"
  assert_contains "$report" "Files promoted: 0"
  assert_contains "$report" "brand_or_positioning_reference"
  assert_contains "$report" "durable_memory_candidate"
  assert_contains "$report" "raw_source_material"
  assert_contains "$report" "Approval required"
  assert_path_exists "$TEST_ROOT/repo/clients/acme/context/inbox/brand-notes.md"
  ok "client intake writes review plan without promoting source files"
}

test_root_intake_init_only_creates_scaffold() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    python3 scripts/context-intake.py --workspace "$TEST_ROOT/repo" --root --date 2026-06-29 --init-only > "$TEST_ROOT/root-out.txt"
  )

  local report="$TEST_ROOT/repo/context/intake/review/2026-06-29_root_promotion-plan.md"
  assert_path_exists "$TEST_ROOT/repo/context/inbox/.gitkeep"
  assert_path_exists "$TEST_ROOT/repo/context/reference/.gitkeep"
  assert_path_exists "$report"
  assert_contains "$report" "No inbox files found"
  ok "root intake scaffold works without source files"
}

test_wrapper_defaults_to_scope() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/context-intake.sh --date 2026-06-29 --init-only > "$TEST_ROOT/wrapper-root-out.txt"
    bash clients/acme/scripts/context-intake.sh --date 2026-06-29 --init-only > "$TEST_ROOT/wrapper-client-out.txt"
  )

  assert_contains "$TEST_ROOT/wrapper-root-out.txt" "context/intake/review/2026-06-29_root_promotion-plan.md"
  assert_contains "$TEST_ROOT/wrapper-client-out.txt" "clients/acme/context/intake/review/2026-06-29_acme_promotion-plan.md"
  ok "context intake wrapper defaults to root or client scope"
}

info "Running context intake tests..."
test_client_intake_report_is_review_first
test_root_intake_init_only_creates_scaffold
test_wrapper_defaults_to_scope
ok "context intake tests passed"
