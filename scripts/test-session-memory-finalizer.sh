#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-session-memory-finalizer-test"
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
    "$TEST_ROOT/repo/.claude" \
    "$TEST_ROOT/repo/context/memory" \
    "$TEST_ROOT/repo/clients/acme/context/memory"

  cat > "$TEST_ROOT/repo/AGENTS.md" <<'EOF'
# Root
EOF
  cat > "$TEST_ROOT/repo/clients/acme/AGENTS.md" <<'EOF'
# Client: Acme
EOF
}

write_session_block() {
  local file="$1"
  local session_id="$2"
  local goal="$3"
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<EOF
# $TODAY

## Session 1
<!-- aios-session-id: $session_id -->

### Title
Pending Title

### Goal
$goal

### Deliverables
- None yet.

### Decisions
- None yet.

### Open threads
- Session in progress.
EOF
}

run_finalizer() {
  local session_id="$1"
  local cwd="$2"
  local message_file="$3"
  SESSION_ID="$session_id" CWD_VALUE="$cwd" MESSAGE_FILE="$message_file" python3 - <<'PY' \
    | node "$REAL_REPO/.claude/hooks/session-memory-finalizer.js"
import json
import os
from pathlib import Path

print(json.dumps({
    "session_id": os.environ["SESSION_ID"],
    "cwd": os.environ["CWD_VALUE"],
    "last_assistant_message": Path(os.environ["MESSAGE_FILE"]).read_text(),
}))
PY
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" ]] || fail "Expected file to exist: $file"
  if ! grep -Fq -- "$expected" "$file"; then
    sed -n '1,220p' "$file" >&2
    fail "Expected '$expected' in $file"
  fi
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "$unexpected" "$file"; then
    sed -n '1,220p' "$file" >&2
    fail "Did not expect '$unexpected' in $file"
  fi
}

test_root_block_gets_useful_stop_summary() {
  make_fake_repo
  local memory_file="$TEST_ROOT/repo/context/memory/$TODAY.md"
  write_session_block "$memory_file" "root-finalize-$$" "Why does AI-OS memory not help?"
  cat > "$TEST_ROOT/response.md" <<EOF
**Diagnosis**

AI-OS memory exists, but it was not getting useful context into sessions.

Changed:
- [diagnosis report]($TEST_ROOT/repo/projects/meta-audit/report.md:1)
- [startup hook]($TEST_ROOT/repo/.claude/hooks/load-memory-snapshot.js:104)

**Next Actions**

1. Curate Acme and Globex memory.
2. Add the session finalizer.
3. Clean duplicate skill files.
EOF

  run_finalizer "root-finalize-$$" "$TEST_ROOT/repo" "$TEST_ROOT/response.md"

  assert_file_contains "$memory_file" "<!-- aios-auto-finalized: true -->"
  assert_file_contains "$memory_file" "### Title"
  # Titles are derived from the goal's own words now; the old hardcoded
  # topic branches titled 86 sessions "Memory Diagnosis" (2026-07-16 audit).
  assert_file_contains "$memory_file" "Why Does Memory"
  assert_file_contains "$memory_file" "- \`projects/meta-audit/report.md\`"
  assert_file_contains "$memory_file" "- \`.claude/hooks/load-memory-snapshot.js\`"
  assert_file_not_contains "$memory_file" "mentioned in assistant response"
  assert_file_contains "$memory_file" "- Curate Acme and Globex memory."
  assert_file_not_contains "$memory_file" "Pending Title"
  assert_file_not_contains "$memory_file" "None yet."
  assert_file_not_contains "$memory_file" "Session in progress."
  assert_file_not_contains "$memory_file" "### Decisions"
  ok "root session block gets useful Stop summary"
}

test_chat_only_response_does_not_invent_deliverables_or_open_threads() {
  make_fake_repo
  local memory_file="$TEST_ROOT/repo/context/memory/$TODAY.md"
  write_session_block "$memory_file" "chat-finalize-$$" "What does this setting mean?"
  cat > "$TEST_ROOT/chat-response.md" <<'EOF'
It controls whether the local cache is refreshed at startup.
EOF

  run_finalizer "chat-finalize-$$" "$TEST_ROOT/repo" "$TEST_ROOT/chat-response.md"

  assert_file_not_contains "$memory_file" "### Deliverables"
  assert_file_not_contains "$memory_file" "### Open threads"
  assert_file_not_contains "$memory_file" "Assistant response:"
  assert_file_not_contains "$memory_file" "Awaiting next user input"
  ok "chat-only response does not invent memory artifacts"
}

test_repair_mode_removes_known_auto_finalizer_pollution() {
  make_fake_repo
  local memory_file="$TEST_ROOT/repo/context/memory/$TODAY.md"
  cat > "$memory_file" <<EOF
# $TODAY

## Session 1
<!-- aios-session-id: repair-$$ -->
<!-- aios-auto-finalized: true -->

### Title
Memory Diagnosis

### Goal
You are running as a scheduled cron job for AI-OS. Task: Check if any skills have been updated. Steps: scan the catalog.

### Deliverables
- \`projects/system-health/report.md\` - mentioned in assistant response.
- Assistant response: the scan completed.

### Open threads
- Awaiting next user input; run meta-wrap-up for full session finalization.
EOF

  node "$REAL_REPO/.claude/hooks/session-memory-finalizer.js" --repair "$memory_file" >/tmp/aios-session-memory-repair-test.out

  assert_file_contains "$memory_file" "Check Any Skills"
  assert_file_contains "$memory_file" "Check if any skills have been updated."
  assert_file_contains "$memory_file" "- \`projects/system-health/report.md\`"
  assert_file_not_contains "$memory_file" "mentioned in assistant response"
  assert_file_not_contains "$memory_file" "Assistant response:"
  assert_file_not_contains "$memory_file" "Awaiting next user input"
  ok "repair mode removes exact known auto-finalizer pollution"
}

test_client_block_is_found_from_root_cwd() {
  make_fake_repo
  local memory_file="$TEST_ROOT/repo/clients/acme/context/memory/$TODAY.md"
  write_session_block "$memory_file" "client-finalize-$$" "Work on the Acme memory brief"
  cat > "$TEST_ROOT/client-response.md" <<'EOF'
**Done**

Updated the active client brief.

**Next Actions**

1. Review the Acme source map.
EOF

  run_finalizer "client-finalize-$$" "$TEST_ROOT/repo" "$TEST_ROOT/client-response.md"

  assert_file_not_contains "$memory_file" "Pending Title"
  assert_file_contains "$memory_file" "- Review the Acme source map."
  assert_file_not_contains "$TEST_ROOT/repo/context/memory/$TODAY.md" "client-finalize" 2>/dev/null || true
  ok "client session block is found by session id even from root cwd"
}

test_curated_content_survives_later_stops() {
  # Regression for the 2026-07-16 audit critical: once a block was auto-marked,
  # every later Stop deleted real Decisions and overwrote curated Deliverables
  # and Open threads. Curated content must survive, including entries that
  # merely contain the word "none".
  make_fake_repo
  local memory_file="$TEST_ROOT/repo/context/memory/$TODAY.md"
  cat > "$memory_file" <<EOF
# $TODAY

## Session 1
<!-- aios-session-id: curated-$$ -->
<!-- aios-auto-finalized: true -->

### Title
Plugin Cleanup

### Goal
Decide which plugins stay installed

### Deliverables
- \`projects/ops-plugins/review.md\` - the plugin decision write-up

### Decisions
- Decided none of the trial plugins stay; keep only caveman.

### Open threads
- Ask about the Figma plugin license next week.
EOF
  cat > "$TEST_ROOT/late-response.md" <<EOF
Also updated the [helper script]($TEST_ROOT/repo/scripts/plugin-helper.sh:1).

**Next Actions**

1. This footer line must not replace the curated open thread.
EOF

  run_finalizer "curated-$$" "$TEST_ROOT/repo" "$TEST_ROOT/late-response.md"

  assert_file_contains "$memory_file" "- Decided none of the trial plugins stay; keep only caveman."
  assert_file_contains "$memory_file" "- \`projects/ops-plugins/review.md\` - the plugin decision write-up"
  assert_file_contains "$memory_file" "- \`scripts/plugin-helper.sh\`"
  assert_file_contains "$memory_file" "- Ask about the Figma plugin license next week."
  assert_file_not_contains "$memory_file" "This footer line must not replace"
  ok "curated Decisions/Deliverables/Open threads survive later Stops (additive only)"
}

test_missing_session_block_is_noop() {
  make_fake_repo
  cat > "$TEST_ROOT/response.md" <<'EOF'
No matching session exists.
EOF

  run_finalizer "missing-finalize-$$" "$TEST_ROOT/repo" "$TEST_ROOT/response.md"

  [[ ! -f "$TEST_ROOT/repo/context/memory/$TODAY.md" ]] || fail "Expected no root memory file"
  [[ ! -f "$TEST_ROOT/repo/clients/acme/context/memory/$TODAY.md" ]] || fail "Expected no client memory file"
  ok "missing session block is a no-op"
}

info "Running session memory finalizer tests..."
test_root_block_gets_useful_stop_summary
test_client_block_is_found_from_root_cwd
test_chat_only_response_does_not_invent_deliverables_or_open_threads
test_repair_mode_removes_known_auto_finalizer_pollution
test_curated_content_survives_later_stops
test_missing_session_block_is_noop
ok "session memory finalizer tests passed"
