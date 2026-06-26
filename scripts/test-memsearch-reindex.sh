#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-memsearch-reindex-test"
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
    "$TEST_ROOT/repo/scripts/lib" \
    "$TEST_ROOT/repo/context/memory" \
    "$TEST_ROOT/repo/context/notion" \
    "$TEST_ROOT/repo/context/transcripts" \
    "$TEST_ROOT/repo/.memsearch/memory" \
    "$TEST_ROOT/repo/clients/acme/context/memory" \
    "$TEST_ROOT/repo/clients/acme/brand_context" \
    "$TEST_ROOT/repo/clients/acme/context/transcripts" \
    "$TEST_ROOT/repo/clients/acme/.memsearch/memory" \
    "$TEST_ROOT/repo/clients/beta/context" \
    "$TEST_ROOT/bin"

  cp "$REAL_REPO/scripts/memsearch-reindex.sh" "$TEST_ROOT/repo/scripts/memsearch-reindex.sh"
  cat > "$TEST_ROOT/repo/scripts/lib/memsearch-collection.sh" <<'EOF'
#!/usr/bin/env bash
echo "test_collection"
EOF
  chmod +x "$TEST_ROOT/repo/scripts/lib/memsearch-collection.sh"

  cat > "$TEST_ROOT/repo/context/MEMORY.md" <<'EOF'
# Root Memory
EOF
  cat > "$TEST_ROOT/repo/context/memory/2026-06-25.md" <<'EOF'
# Root Daily
EOF
  cat > "$TEST_ROOT/repo/context/notion/root-reference.md" <<'EOF'
# Root Notion Reference
EOF
  cat > "$TEST_ROOT/repo/context/transcripts/root-transcript.md" <<'EOF'
# Root Transcript
EOF
  cat > "$TEST_ROOT/repo/.memsearch/memory/root-shadow.md" <<'EOF'
# Root Shadow
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" <<'EOF'
# Acme Memory
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/memory/2026-06-25.md" <<'EOF'
# Acme Daily
EOF
  cat > "$TEST_ROOT/repo/clients/acme/brand_context/reference.md" <<'EOF'
# Acme Brand Reference
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/transcripts/client-transcript.md" <<'EOF'
# Acme Transcript
EOF
  cat > "$TEST_ROOT/repo/clients/acme/.memsearch/memory/client-shadow.md" <<'EOF'
# Acme Shadow
EOF
  cat > "$TEST_ROOT/repo/clients/beta/context/learnings.md" <<'EOF'
# Beta Learnings
EOF

  cat > "$TEST_ROOT/bin/memsearch" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  index)
    shift
    printf '%s\n' "$*" > "${MEMSEARCH_INDEX_LOG:?}"
    ;;
  stats)
    echo "Total indexed chunks: 42"
    ;;
  --version|version)
    echo "memsearch, version test"
    ;;
esac
EOF
  chmod +x "$TEST_ROOT/bin/memsearch"
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$file" || fail "Expected '$expected' in $file"
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "$unexpected" "$file"; then
    fail "Did not expect '$unexpected' in $file"
  fi
}

test_reindex_lists_root_and_all_client_memory_sources() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    export PATH="$TEST_ROOT/bin:$PATH"
    export MEMSEARCH_INDEX_LOG="$TEST_ROOT/index-args.txt"
    bash scripts/memsearch-reindex.sh > "$TEST_ROOT/out.txt"
  )

  assert_contains "$TEST_ROOT/index-args.txt" "context/MEMORY.md"
  assert_contains "$TEST_ROOT/index-args.txt" "context/memory/"
  assert_contains "$TEST_ROOT/index-args.txt" "clients/acme/context/MEMORY.md"
  assert_contains "$TEST_ROOT/index-args.txt" "clients/acme/context/memory/"
  assert_contains "$TEST_ROOT/index-args.txt" "clients/beta/context/learnings.md"
  assert_not_contains "$TEST_ROOT/index-args.txt" "context/notion/"
  assert_not_contains "$TEST_ROOT/index-args.txt" "context/transcripts/"
  assert_not_contains "$TEST_ROOT/index-args.txt" ".memsearch/memory/"
  assert_not_contains "$TEST_ROOT/index-args.txt" "clients/acme/context/transcripts"
  assert_not_contains "$TEST_ROOT/index-args.txt" "clients/acme/brand_context"
  assert_not_contains "$TEST_ROOT/index-args.txt" "clients/acme/.memsearch/memory"
  assert_contains "$TEST_ROOT/index-args.txt" "--collection test_collection"
  ok "reindex lists root plus all discovered client memory sources"
}

info "Running memsearch reindex tests..."
test_reindex_lists_root_and_all_client_memory_sources
ok "memsearch reindex tests passed"
