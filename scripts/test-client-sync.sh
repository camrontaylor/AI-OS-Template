#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-client-sync-test"
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
    "$TEST_ROOT/repo/scripts/lib" \
    "$TEST_ROOT/repo/.claude/commands" \
    "$TEST_ROOT/repo/.claude/hooks" \
    "$TEST_ROOT/repo/.claude/skills/shared-skill" \
    "$TEST_ROOT/repo/clients/acme/.claude/hooks" \
    "$TEST_ROOT/repo/clients/acme/.claude/skills/shared-skill" \
    "$TEST_ROOT/repo/clients/acme/.claude/skills/client-only" \
    "$TEST_ROOT/repo/clients/acme/context" \
    "$TEST_ROOT/repo/cron/templates"

  cp "$REAL_REPO/scripts/update-clients.sh" "$TEST_ROOT/repo/scripts/update-clients.sh"
  cp "$REAL_REPO/scripts/client-sync-audit.sh" "$TEST_ROOT/repo/scripts/client-sync-audit.sh"
  cp "$REAL_REPO/scripts/context-intake.sh" "$TEST_ROOT/repo/scripts/context-intake.sh"
  cp "$REAL_REPO/scripts/base-return-to-main.sh" "$TEST_ROOT/repo/scripts/base-return-to-main.sh"
  cp "$REAL_REPO/scripts/base-autosave.sh" "$TEST_ROOT/repo/scripts/base-autosave.sh"

  cat > "$TEST_ROOT/repo/AGENTS.md" <<'EOF'
# Root
EOF
  cat > "$TEST_ROOT/repo/.claude/skills/shared-skill/SKILL.md" <<'EOF'
root shared skill v2
EOF
  cat > "$TEST_ROOT/repo/.claude/commands/onboarding.md" <<'EOF'
root command
EOF
  cat > "$TEST_ROOT/repo/cron/templates/example.md" <<'EOF'
root cron template
EOF
  cat > "$TEST_ROOT/repo/.claude/settings.json" <<'EOF'
{"rootSetting": true}
EOF
  cat > "$TEST_ROOT/repo/.claude/hooks/session-memory-finalizer.js" <<'EOF'
root finalizer hook
EOF
  cat > "$TEST_ROOT/repo/.claude/hooks/skills-parity-check.js" <<'EOF'
root parity hook
EOF
  cat > "$TEST_ROOT/repo/scripts/codex-hook.sh" <<'EOF'
root codex hook
EOF
  cat > "$TEST_ROOT/repo/scripts/lib/skills-parity-check.sh" <<'EOF'
root skills parity script
EOF
  cat > "$TEST_ROOT/repo/scripts/test-session-memory-finalizer.sh" <<'EOF'
root finalizer test
EOF
  cat > "$TEST_ROOT/repo/clients/acme/AGENTS.md" <<'EOF'
# Client: Acme
EOF
  cat > "$TEST_ROOT/repo/clients/acme/.claude/settings.json" <<'EOF'
{"staleSetting": true}
EOF
  cat > "$TEST_ROOT/repo/clients/acme/.claude/hooks/session-memory-finalizer.js" <<'EOF'
stale finalizer hook
EOF
  cat > "$TEST_ROOT/repo/clients/acme/.claude/hooks/stale-extra.js" <<'EOF'
stale hook that should be removed
EOF
  cat > "$TEST_ROOT/repo/clients/acme/.claude/skills/shared-skill/SKILL.md" <<'EOF'
stale shared skill v1
EOF
  cat > "$TEST_ROOT/repo/clients/acme/.claude/skills/client-only/SKILL.md" <<'EOF'
client-only skill
EOF
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" ]] || fail "Missing file: $file"
  grep -Fq -- "$expected" "$file" || fail "Expected '$expected' in $file"
}

assert_path_exists() {
  local path="$1"
  [[ -e "$path" ]] || fail "Expected path to exist: $path"
}

assert_symlink_to() {
  local link="$1"
  local expected="$2"
  [[ -L "$link" ]] || fail "Expected symlink: $link"
  local actual_path
  local expected_path
  actual_path="$(cd "$(dirname "$link")/$(dirname "$(readlink "$link")")" && pwd -P)/$(basename "$(readlink "$link")")"
  expected_path="$(cd "$(dirname "$expected")" && pwd -P)/$(basename "$expected")"
  [[ "$actual_path" == "$expected_path" ]] || fail "Expected $link to resolve to $expected"
}

test_update_clients_links_shared_runtime_and_preserves_client_only() {
  make_fake_repo
  (
    cd "$TEST_ROOT/repo"
    AIOS_CLIENT_LINK_BACKUP_DIR="$TEST_ROOT/backup" bash scripts/update-clients.sh >/tmp/aios-client-sync-test.out
    bash scripts/client-sync-audit.sh --strict >/tmp/aios-client-sync-audit-test.out
  )

  assert_symlink_to "$TEST_ROOT/repo/clients/acme/.claude/skills/shared-skill" "$TEST_ROOT/repo/.claude/skills/shared-skill"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/.claude/skills/client-only/SKILL.md" "client-only skill"
  assert_symlink_to "$TEST_ROOT/repo/clients/acme/.claude/commands" "$TEST_ROOT/repo/.claude/commands"
  assert_symlink_to "$TEST_ROOT/repo/clients/acme/.claude/settings.json" "$TEST_ROOT/repo/.claude/settings.json"
  assert_symlink_to "$TEST_ROOT/repo/clients/acme/.claude/hooks" "$TEST_ROOT/repo/.claude/hooks"
  assert_symlink_to "$TEST_ROOT/repo/clients/acme/scripts/codex-hook.sh" "$TEST_ROOT/repo/scripts/codex-hook.sh"
  assert_symlink_to "$TEST_ROOT/repo/clients/acme/scripts/lib" "$TEST_ROOT/repo/scripts/lib"
  assert_symlink_to "$TEST_ROOT/repo/clients/acme/scripts/test-session-memory-finalizer.sh" "$TEST_ROOT/repo/scripts/test-session-memory-finalizer.sh"
  assert_symlink_to "$TEST_ROOT/repo/clients/acme/cron/templates" "$TEST_ROOT/repo/cron/templates"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/scripts/run-job.sh" '--client "$CLIENT_SLUG"'
  assert_file_contains "$TEST_ROOT/repo/clients/acme/context/MEMORY.md" "Client-scoped curated scratchpad"
  assert_symlink_to "$TEST_ROOT/repo/clients/acme/scripts/context-intake.sh" "$TEST_ROOT/repo/scripts/context-intake.sh"
  assert_path_exists "$TEST_ROOT/repo/clients/acme/context/inbox/.gitkeep"
  assert_path_exists "$TEST_ROOT/repo/clients/acme/context/reference/.gitkeep"
  assert_path_exists "$TEST_ROOT/repo/clients/acme/context/intake/review/.gitkeep"
  assert_path_exists "$TEST_ROOT/repo/clients/acme/context/intake/parked/.gitkeep"
  assert_path_exists "$TEST_ROOT/backup/clients/acme/.claude/skills/shared-skill/SKILL.md"
  ok "update-clients links shared runtime while preserving client-only skills and a migration backup"
}

test_update_clients_refuses_hidden_client_shared_overrides() {
  make_fake_repo
  cat > "$TEST_ROOT/repo/clients/acme/.claude/skills/shared-skill/SKILL.local.md" <<'EOF'
client local override
EOF

  if (
    cd "$TEST_ROOT/repo"
    AIOS_CLIENT_LINK_BACKUP_DIR="$TEST_ROOT/backup" bash scripts/update-clients.sh >/tmp/aios-client-sync-local-test.out 2>&1
  ); then
    fail "Expected shared client-local override preflight to block migration"
  fi

  [[ ! -L "$TEST_ROOT/repo/clients/acme/.claude/skills/shared-skill" ]] || fail "Expected shared skill copy to remain untouched"
  assert_file_contains "$TEST_ROOT/repo/clients/acme/.claude/skills/shared-skill/SKILL.local.md" "client local override"
  ok "update-clients refuses to hide a client-local override inside a shared skill"
}

info "Running client sync tests..."
test_update_clients_links_shared_runtime_and_preserves_client_only
test_update_clients_refuses_hidden_client_shared_overrides
ok "client sync tests passed"
