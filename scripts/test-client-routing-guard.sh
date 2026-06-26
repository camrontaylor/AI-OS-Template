#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-client-routing-guard-test"
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
  mkdir -p "$TEST_ROOT/repo/.claude" "$TEST_ROOT/repo/context" "$TEST_ROOT/repo/clients"
  cat > "$TEST_ROOT/repo/AGENTS.md" <<'EOF'
# Root
EOF

  for name in acme beta gamma-studio; do
    mkdir -p "$TEST_ROOT/repo/clients/$name/context"
  done
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

make_many_client_repo() {
  make_fake_repo
  for i in $(seq 1 35); do
    slug="client-$i"
    mkdir -p "$TEST_ROOT/repo/clients/$slug/context"
    cat > "$TEST_ROOT/repo/clients/$slug/AGENTS.md" <<EOF
# Client: Client $i
EOF
  done
}

run_hook() {
  local cwd="$1"
  local prompt="$2"
  printf '{"session_id":"route-test","cwd":"%s","prompt":"%s"}' "$cwd" "$prompt" \
    | node "$REAL_REPO/.claude/hooks/client-routing-guard.js"
}

assert_contains() {
  local haystack="$1"
  local expected="$2"
  [[ "$haystack" == *"$expected"* ]] || fail "Expected output to contain: $expected"
}

assert_empty() {
  local value="$1"
  [[ -z "$value" ]] || fail "Expected empty hook output, got: $value"
}

test_single_client_prompt_gets_guard() {
  make_fake_repo
  out="$(run_hook "$TEST_ROOT/repo" "Update the Acme homepage copy")"

  assert_contains "$out" "client routing hard stop"
  assert_contains "$out" "clients/acme"
  ok "single client prompt from root gets routing guard"
}

test_many_clients_are_discovered_generically() {
  make_many_client_repo
  out="$(run_hook "$TEST_ROOT/repo" "Update Client 27 onboarding notes")"

  assert_contains "$out" "client routing hard stop"
  assert_contains "$out" "clients/client-27"
  ok "routing guard discovers many client folders generically"
}

test_all_client_prompt_is_root_work() {
  make_fake_repo
  out="$(run_hook "$TEST_ROOT/repo" "Audit all client folders including Acme and Beta")"

  assert_empty "$out"
  ok "all-client prompt does not ask for one-client confirmation"
}

test_client_cwd_does_not_guard() {
  make_fake_repo
  out="$(run_hook "$TEST_ROOT/repo/clients/beta" "Update the Beta website notes")"

  assert_empty "$out"
  ok "client cwd proceeds without root routing guard"
}

test_shared_aios_prompt_does_not_guard() {
  make_fake_repo
  out="$(run_hook "$TEST_ROOT/repo" "Move old Acme memory from AI-OS into the right client folder")"

  assert_empty "$out"
  ok "shared AI-OS migration prompt does not trigger one-client guard"
}

test_explicit_client_path_does_not_guard() {
  make_fake_repo
  out="$(run_hook "$TEST_ROOT/repo" "Update clients/acme/projects/brief.md")"

  assert_empty "$out"
  ok "explicit client path is already scoped"
}

info "Running client routing guard tests..."
test_single_client_prompt_gets_guard
test_many_clients_are_discovered_generically
test_all_client_prompt_is_root_work
test_client_cwd_does_not_guard
test_shared_aios_prompt_does_not_guard
test_explicit_client_path_does_not_guard
ok "client routing guard tests passed"
