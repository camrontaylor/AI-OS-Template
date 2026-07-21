#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-load-memory-snapshot-test"
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
    "$TEST_ROOT/repo/.claude/hooks" \
    "$TEST_ROOT/repo/scripts/lib" \
    "$TEST_ROOT/repo/context/memory" \
    "$TEST_ROOT/repo/clients/acme/.claude" \
    "$TEST_ROOT/repo/clients/acme/context/memory" \
    "$TEST_ROOT/repo/clients/acme/projects/sample"

  cp "$REAL_REPO/.claude/hooks/load-memory-snapshot.js" "$TEST_ROOT/repo/.claude/hooks/load-memory-snapshot.js"

  cat > "$TEST_ROOT/repo/AGENTS.md" <<'EOF'
# Root
EOF
  cat > "$TEST_ROOT/repo/context/SOUL.md" <<'EOF'
ROOT SOUL MARKER
EOF
  cat > "$TEST_ROOT/repo/context/USER.md" <<'EOF'
ROOT USER MARKER
EOF
  cat > "$TEST_ROOT/repo/context/MEMORY.md" <<'EOF'
ROOT MEMORY MARKER
EOF
  cat > "$TEST_ROOT/repo/context/current-state.md" <<'EOF'
ROOT CURRENT STATE MARKER
EOF
  cat > "$TEST_ROOT/repo/context/memory/$TODAY.md" <<'EOF'
ROOT DAILY MARKER
EOF

  cat > "$TEST_ROOT/repo/clients/acme/AGENTS.md" <<'EOF'
# Client: Acme
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" <<'EOF'
CLIENT MEMORY MARKER
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/current-state.md" <<'EOF'
CLIENT CURRENT STATE MARKER
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/memory/$TODAY.md" <<'EOF'
CLIENT DAILY MARKER
EOF
}

run_hook() {
  local cwd="$1"
  printf '{"cwd":"%s"}' "$cwd" | node "$TEST_ROOT/repo/.claude/hooks/load-memory-snapshot.js"
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq "$expected" "$file" || fail "Expected '$expected' in $file"
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq "$unexpected" "$file"; then
    fail "Did not expect '$unexpected' in $file"
  fi
}

test_root_loads_root_context() {
  make_fake_repo
  run_hook "$TEST_ROOT/repo" > "$TEST_ROOT/out.txt"
  assert_contains "$TEST_ROOT/out.txt" "ROOT SOUL MARKER"
  assert_contains "$TEST_ROOT/out.txt" "ROOT USER MARKER"
  assert_contains "$TEST_ROOT/out.txt" "ROOT MEMORY MARKER"
  assert_contains "$TEST_ROOT/out.txt" "ROOT DAILY MARKER"
  assert_not_contains "$TEST_ROOT/out.txt" "ROOT CURRENT STATE MARKER"
  assert_not_contains "$TEST_ROOT/out.txt" "CLIENT CURRENT STATE MARKER"
  ok "root startup loads root context"
}

test_client_inherits_root_identity_and_client_memory() {
  make_fake_repo
  run_hook "$TEST_ROOT/repo/clients/acme" > "$TEST_ROOT/out.txt"
  assert_contains "$TEST_ROOT/out.txt" "ROOT SOUL MARKER"
  assert_contains "$TEST_ROOT/out.txt" "ROOT USER MARKER"
  assert_contains "$TEST_ROOT/out.txt" "CLIENT MEMORY MARKER"
  assert_contains "$TEST_ROOT/out.txt" "CLIENT CURRENT STATE MARKER"
  assert_contains "$TEST_ROOT/out.txt" "CLIENT DAILY MARKER"
  assert_not_contains "$TEST_ROOT/out.txt" "ROOT MEMORY MARKER"
  assert_not_contains "$TEST_ROOT/out.txt" "ROOT CURRENT STATE MARKER"
  assert_not_contains "$TEST_ROOT/out.txt" "ROOT DAILY MARKER"
  ok "client startup inherits root identity and client memory"
}

test_nested_client_project_uses_client_memory() {
  make_fake_repo
  run_hook "$TEST_ROOT/repo/clients/acme/projects/sample" > "$TEST_ROOT/out.txt"
  assert_contains "$TEST_ROOT/out.txt" "ROOT SOUL MARKER"
  assert_contains "$TEST_ROOT/out.txt" "ROOT USER MARKER"
  assert_contains "$TEST_ROOT/out.txt" "CLIENT MEMORY MARKER"
  assert_contains "$TEST_ROOT/out.txt" "CLIENT CURRENT STATE MARKER"
  assert_not_contains "$TEST_ROOT/out.txt" "ROOT MEMORY MARKER"
  ok "nested client project startup uses client memory"
}

info "Running load memory snapshot tests..."
test_root_loads_root_context
test_client_inherits_root_identity_and_client_memory
test_nested_client_project_uses_client_memory
ok "load memory snapshot tests passed"
