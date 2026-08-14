#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-memsearch-health-test"
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
  mkdir -p \
    "$TEST_ROOT/home/.memsearch/milvus.db/collections/test_collection" \
    "$TEST_ROOT/home/.memsearch/milvus.db/collections/stale_collection" \
    "$TEST_ROOT/repo/scripts/lib" \
    "$TEST_ROOT/repo/projects/system-health" \
    "$TEST_ROOT/repo/.command-centre"
  cp "$REAL_REPO/scripts/memsearch-health.sh" "$TEST_ROOT/repo/scripts/memsearch-health.sh"
  cat > "$TEST_ROOT/repo/scripts/lib/memsearch-collection.sh" <<'EOF'
#!/usr/bin/env bash
echo "test_collection"
EOF
  chmod +x "$TEST_ROOT/repo/scripts/lib/memsearch-collection.sh"
  cat > "$TEST_ROOT/repo/.command-centre/semantic-index-last-success.json" <<'EOF'
{
  "completed_at": "2026-07-16T12:00:00Z",
  "collection": "test_collection",
  "total_chunks": 42
}
EOF
}

write_search_result() {
  local mode="$1"
  cat > "$TEST_ROOT/repo/scripts/memsearch-search.sh" <<EOF
#!/usr/bin/env bash
printf '[{"source":"context/MEMORY.md","text":"probe","search_mode":"$mode"}]\n'
EOF
  chmod +x "$TEST_ROOT/repo/scripts/memsearch-search.sh"
}

info "Running semantic memory health exit-contract tests..."

make_fixture
write_search_result semantic
if ! (cd "$TEST_ROOT/repo" && HOME="$TEST_ROOT/home" bash scripts/memsearch-health.sh > "$TEST_ROOT/ok.out"); then
  fail "semantic results should pass the health probe"
fi
grep -Fq 'Status: OK' "$TEST_ROOT/ok.out" || fail "semantic result did not report OK"
grep -Fq 'Index completed: 2026-07-16T12:00:00Z' "$TEST_ROOT/ok.out" || fail "health proof omitted index completion"
grep -Fq 'Collection: test_collection' "$TEST_ROOT/ok.out" || fail "health proof omitted collection"
grep -Fq 'Indexed chunks: 42' "$TEST_ROOT/ok.out" || fail "health proof omitted chunk count"
orphan_line="$(grep -F 'Orphan collections' "$TEST_ROOT/ok.out" || true)"
[[ "$orphan_line" == *"stale_collection"* ]] || fail "health proof omitted real orphan collection"
[[ "$orphan_line" != *"test_collection"* ]] || fail "health proof mislabeled canonical collection as orphan"
ok "semantic result exits successfully"

make_fixture
write_search_result markdown_fallback
if (cd "$TEST_ROOT/repo" && HOME="$TEST_ROOT/home" bash scripts/memsearch-health.sh > "$TEST_ROOT/degraded.out"); then
  fail "fallback-only recall must exit non-zero"
fi
grep -Fq 'Status: DEGRADED' "$TEST_ROOT/degraded.out" || fail "fallback-only result did not report DEGRADED"
ok "degraded recall exits non-zero"

make_fixture
cat > "$TEST_ROOT/repo/scripts/memsearch-search.sh" <<'EOF'
#!/usr/bin/env bash
printf '[]\n'
EOF
chmod +x "$TEST_ROOT/repo/scripts/memsearch-search.sh"
if (cd "$TEST_ROOT/repo" && HOME="$TEST_ROOT/home" bash scripts/memsearch-health.sh > "$TEST_ROOT/attention.out"); then
  fail "empty recall must exit non-zero"
fi
grep -Fq 'Status: NEEDS ATTENTION' "$TEST_ROOT/attention.out" || fail "empty result did not report NEEDS ATTENTION"
ok "needs-attention recall exits non-zero"

ok "semantic memory health exit-contract tests passed"
