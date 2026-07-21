#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-memsearch-maintain-test"
trap 'rm -rf "$TEST_ROOT"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

make_fixture() {
  local index_status="$1"
  rm -rf "$TEST_ROOT"
  mkdir -p "$TEST_ROOT/repo/scripts/lib"
  [[ -f "$REAL_REPO/scripts/memsearch-maintain.sh" ]] || fail "scripts/memsearch-maintain.sh is missing"
  cp "$REAL_REPO/scripts/memsearch-maintain.sh" "$TEST_ROOT/repo/scripts/memsearch-maintain.sh"

  cat > "$TEST_ROOT/repo/scripts/memsearch-reindex.sh" <<EOF
#!/usr/bin/env bash
printf 'index %s\n' "\$*" >> "\${CALL_LOG:?}"
echo 'Result: Total indexed chunks: 42'
exit $index_status
EOF
  cat > "$TEST_ROOT/repo/scripts/memsearch-health.sh" <<'EOF'
#!/usr/bin/env bash
printf 'health %s\n' "$*" >> "${CALL_LOG:?}"
exit 0
EOF
  cat > "$TEST_ROOT/repo/scripts/test-recall-golden.sh" <<'EOF'
#!/usr/bin/env bash
printf 'quality %s\n' "$*" >> "${CALL_LOG:?}"
echo 'Golden recall at top-3: 20/20 (100%); semantic paraphrase cases: 2/2'
exit 0
EOF
  chmod +x "$TEST_ROOT/repo/scripts/"*.sh
  cat > "$TEST_ROOT/repo/scripts/lib/memsearch-collection.sh" <<'EOF'
#!/usr/bin/env bash
echo 'test_collection'
EOF
  chmod +x "$TEST_ROOT/repo/scripts/lib/memsearch-collection.sh"
}

info "Running semantic memory maintenance ordering tests..."

make_fixture 0
CALL_LOG="$TEST_ROOT/success.log" bash "$TEST_ROOT/repo/scripts/memsearch-maintain.sh"
expected=$'index --strict\nhealth --report\nquality '
actual="$(cat "$TEST_ROOT/success.log")"
[[ "$actual" == "$expected" ]] || fail "expected strict index then health, got: $actual"
state="$TEST_ROOT/repo/.command-centre/semantic-index-last-success.json"
[[ -f "$state" ]] || fail "successful maintenance did not write an index generation record"
grep -Fq '"collection": "test_collection"' "$state" || fail "generation record is missing the collection"
grep -Fq '"total_chunks": 42' "$state" || fail "generation record is missing the chunk count"
grep -Fq '"completed_at":' "$state" || fail "generation record is missing completion time"
ok "health runs only after a successful strict index"
quality_report="$TEST_ROOT/repo/projects/system-health/$(date +%F)_semantic-retrieval-quality.md"
[[ -f "$quality_report" ]] || fail "successful maintenance did not write a retrieval-quality report"
grep -Fq '20/20 (100%)' "$quality_report" || fail "retrieval-quality report is missing benchmark output"
ok "retrieval quality runs after infrastructure health and writes durable proof"

make_fixture 1
if CALL_LOG="$TEST_ROOT/failure.log" bash "$TEST_ROOT/repo/scripts/memsearch-maintain.sh"; then
  fail "maintenance must fail when indexing fails"
fi
grep -Fxq 'index --strict' "$TEST_ROOT/failure.log" || fail "strict index call was not recorded"
if grep -q '^health ' "$TEST_ROOT/failure.log"; then
  fail "health ran after a failed index"
fi
if grep -q '^quality ' "$TEST_ROOT/failure.log"; then
  fail "quality benchmark ran after a failed index"
fi
ok "failed indexing prevents a stale health pass"

ok "semantic memory maintenance ordering tests passed"
