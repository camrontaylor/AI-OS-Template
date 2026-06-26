#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-session-memory-block-test"
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
    "$TEST_ROOT/repo/context/memory" \
    "$TEST_ROOT/repo/clients/acme/context/memory" \
    "$TEST_ROOT/repo/clients/beta/context/memory" \
    "$TEST_ROOT/repo/clients/gamma-studio/context/memory"

  cat > "$TEST_ROOT/repo/AGENTS.md" <<'EOF'
# Root
EOF
  cat > "$TEST_ROOT/repo/clients/acme/AGENTS.md" <<'EOF'
# Client: Acme
EOF
  cat > "$TEST_ROOT/repo/clients/beta/AGENTS.md" <<'EOF'
# Client: Beta
EOF
  cat > "$TEST_ROOT/repo/clients/gamma-studio/AGENTS.md" <<'EOF'
# Client: Gamma Studio
EOF
}

run_hook() {
  local session_id="$1"
  local cwd="$2"
  local prompt="$3"
  printf '{"session_id":"%s","cwd":"%s","prompt":"%s"}' "$session_id" "$cwd" "$prompt" \
    | node "$REAL_REPO/.claude/hooks/session-memory-block.js"
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" ]] || fail "Expected file to exist: $file"
  grep -Fq -- "$expected" "$file" || fail "Expected '$expected' in $file"
}

assert_file_missing() {
  local file="$1"
  [[ ! -f "$file" ]] || fail "Expected file to be missing: $file"
}

test_single_client_prompt_routes_from_root() {
  make_fake_repo
  run_hook "route-acme-$$" "$TEST_ROOT/repo" "Work on the Acme proposal"

  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/memory/$TODAY.md" "Work on the Acme proposal"
  assert_file_missing "$TEST_ROOT/repo/context/memory/$TODAY.md"
  ok "single client prompt from root routes to that client memory"
}

test_all_clients_prompt_stays_root() {
  make_fake_repo
  run_hook "route-all-$$" "$TEST_ROOT/repo" "Audit all client folders including Acme and Beta"

  assert_file_contains "$TEST_ROOT/repo/context/memory/$TODAY.md" "Audit all client folders"
  assert_file_missing "$TEST_ROOT/repo/clients/acme/context/memory/$TODAY.md"
  assert_file_missing "$TEST_ROOT/repo/clients/beta/context/memory/$TODAY.md"
  ok "all-client prompt stays in root memory"
}

test_client_cwd_stays_client_local() {
  make_fake_repo
  run_hook "route-beta-$$" "$TEST_ROOT/repo/clients/beta" "Update the website notes"

  assert_file_contains "$TEST_ROOT/repo/clients/beta/context/memory/$TODAY.md" "Update the website notes"
  assert_file_missing "$TEST_ROOT/repo/context/memory/$TODAY.md"
  ok "client cwd writes to local client memory"
}

test_display_name_alias_routes_generically() {
  make_fake_repo
  run_hook "route-gamma-$$" "$TEST_ROOT/repo" "Fix the Gamma Studio website email"

  assert_file_contains "$TEST_ROOT/repo/clients/gamma-studio/context/memory/$TODAY.md" "Fix the Gamma Studio website email"
  assert_file_missing "$TEST_ROOT/repo/context/memory/$TODAY.md"
  ok "client display-name alias routes without hard-coded client paths"
}

info "Running session memory block tests..."
test_single_client_prompt_routes_from_root
test_all_clients_prompt_stays_root
test_client_cwd_stays_client_local
test_display_name_alias_routes_generically
ok "session memory block tests passed"
