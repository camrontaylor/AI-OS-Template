#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-memory-search-test"
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
    "$TEST_ROOT/repo/context/memory" \
    "$TEST_ROOT/repo/context/transcripts" \
    "$TEST_ROOT/repo/brand_context" \
    "$TEST_ROOT/repo/clients/acme/brand_context" \
    "$TEST_ROOT/repo/clients/acme/context/memory" \
    "$TEST_ROOT/repo/clients/beta/context/memory"
  cp "$REAL_REPO/scripts/memory-search.py" "$TEST_ROOT/repo/scripts/memory-search.py"
  cp "$REAL_REPO/scripts/memory-search.sh" "$TEST_ROOT/repo/scripts/memory-search.sh"
  cat > "$TEST_ROOT/repo/context/MEMORY.md" <<'EOF'
# Working Memory

## Active Threads
- Acme Ops package needs a memory-safe recall path.
EOF
  cat > "$TEST_ROOT/repo/context/memory/2026-06-25.md" <<'EOF'
# 2026-06-25

## Session 1

### Decisions
- Milvus errors in Codex are sandbox issues, not missing memory.
EOF
  cat > "$TEST_ROOT/repo/context/learnings.md" <<'EOF'
# Learnings Journal

## memory-recall
- Use markdown fallback when semantic search cannot start.
EOF
  cat > "$TEST_ROOT/repo/context/transcripts/root-client-transcript.md" <<'EOF'
# Root Transcript

transcriptonlymarker should not appear in routine root memory fallback.
EOF
  cat > "$TEST_ROOT/repo/brand_context/root-reference.md" <<'EOF'
# Root Reference

rootreferenceonlymarker should not appear in routine root memory fallback.
EOF
  cat > "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" <<'EOF'
# Acme Memory

## Active Threads
- Acme has the gantry-pricing client-only recall marker.
EOF
  cat > "$TEST_ROOT/repo/clients/acme/brand_context/reference.md" <<'EOF'
# Acme Reference

Acme has the brand-context client-reference marker.
EOF
  cat > "$TEST_ROOT/repo/clients/beta/context/MEMORY.md" <<'EOF'
# Beta Memory

## Active Threads
- Beta has the gantry-pricing client-only recall marker plus the beta-routing note.
EOF
}

test_markdown_search_returns_ranked_json() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/memory-search.sh "Acme Ops memory recall" 3 > "$TEST_ROOT/out.json"
  )

  python3 - "$TEST_ROOT/out.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
assert data, "expected at least one result"
assert data[0]["source"].endswith("context/MEMORY.md"), data[0]
assert data[0]["search_mode"] == "markdown_fallback", data[0]
assert data[0]["start_line"] >= 1, data[0]
PY
  ok "markdown fallback returns ranked JSON with source lines"
}

test_no_match_returns_empty_array() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/memory-search.sh "zzzz-no-match-token" 3 > "$TEST_ROOT/empty.json"
  )

  python3 - "$TEST_ROOT/empty.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1])) == []
PY
  ok "markdown fallback returns an empty array for no matches"
}

test_specific_terms_outrank_broad_context() {
  make_fake_repo
  cat > "$TEST_ROOT/repo/context/learnings.md" <<'EOF'
# Learnings Journal

## Acme
- Acme Ops project context appears in many broad workspace summaries. Acme Ops project context appears in many broad workspace summaries.

## memory-recall
- Semantic-only recall can be too broad even after escalation. Use hybrid recall so specific terms like attachments, duplicate, preservation, and Make.com outrank generic Acme Ops context.
EOF
  cat > "$TEST_ROOT/repo/context/memory/2026-06-26.md" <<'EOF'
# 2026-06-26

## 15:24
- Acme Ops document attachments require full thread duplicate attachment preservation through Make.com. Preserve `hs_attachment_ids` and classify duplicate documents before workflow actions.
EOF

  (
    cd "$TEST_ROOT/repo"
    bash scripts/memory-search.sh "Acme Ops document attachments Make.com full thread duplicate attachment preservation" 3 > "$TEST_ROOT/specific.json"
  )

  python3 - "$TEST_ROOT/specific.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
assert data, "expected specific result"
top = data[0]
assert top["source"].endswith("context/memory/2026-06-26.md"), top
assert "attachment" in top["content"].lower(), top
PY
  ok "specific attachment memory outranks broad and meta context"
}

test_all_scope_searches_all_client_folders() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/memory-search.sh "gantry-pricing beta-routing" 5 --scope all > "$TEST_ROOT/all-clients.json"
  )

  python3 - "$TEST_ROOT/all-clients.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
sources = {item["source"] for item in data}
assert any("/clients/beta/context/MEMORY.md" in source for source in sources), sources
assert all("clients/example-alpha" not in source and "clients/example-beta" not in source for source in sources), sources
PY
  ok "all scope searches client folders generically"
}

test_client_scope_targets_one_client() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/memory-search.sh "gantry-pricing client-only recall marker" 5 --scope client --client acme > "$TEST_ROOT/client-scope.json"
  )

  python3 - "$TEST_ROOT/client-scope.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
assert data, "expected acme result"
assert all("/clients/acme/" in item["source"] for item in data), data
PY
  ok "client scope targets one client folder"
}

test_root_scope_excludes_clients() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/memory-search.sh "gantry-pricing beta-routing" 5 --scope root > "$TEST_ROOT/root-only.json"
  )

  python3 - "$TEST_ROOT/root-only.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1])) == []
PY
  ok "root scope excludes client folders"
}

test_root_scope_excludes_reference_archives() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/memory-search.sh "transcriptonlymarker rootreferenceonlymarker" 5 --scope root > "$TEST_ROOT/root-reference.json"
  )

  python3 - "$TEST_ROOT/root-reference.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1])) == []
PY
  ok "root scope excludes root transcripts and reference archives"
}

test_client_scope_includes_client_brand_context() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    bash scripts/memory-search.sh "brand-context client-reference marker" 5 --scope client --client acme > "$TEST_ROOT/client-reference.json"
  )

  python3 - "$TEST_ROOT/client-reference.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
sources = {item["source"] for item in data}
assert any("/clients/acme/brand_context/reference.md" in source for source in sources), data
PY
  ok "client scope includes client brand context"
}

info "Running memory search tests..."
test_markdown_search_returns_ranked_json
test_no_match_returns_empty_array
test_specific_terms_outrank_broad_context
test_all_scope_searches_all_client_folders
test_client_scope_targets_one_client
test_root_scope_excludes_clients
test_root_scope_excludes_reference_archives
test_client_scope_includes_client_brand_context
ok "memory search tests passed"
