#!/usr/bin/env bash
set -euo pipefail

# New clients inherit the skillOverrides every existing client agrees on.
# Consensus travels; per-client decisions stay where they were made.

TEST_ROOT="${TMPDIR:-/tmp}/AI-OS-inherited-overrides-test"
REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_REPO="${TEST_ROOT}/repo"

pass() { printf "  \033[0;32m✓ %s\033[0m\n" "$1"; }
fail() { printf "  \033[0;31m✗ %s\033[0m\n" "$1" >&2; exit 1; }

assert_file_contains() {
  local file="$1"
  local expected="$2"
  local message="$3"
  [[ -f "$file" ]] || fail "$message (file missing: $file)"
  grep -Fq "$expected" "$file" || fail "$message"
  pass "$message"
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"
  local message="$3"
  if [[ -f "$file" ]] && grep -Fq "$unexpected" "$file"; then
    fail "$message"
  fi
  pass "$message"
}

assert_path_absent() {
  local path="$1"
  local message="$2"
  [[ -e "$path" ]] && fail "$message"
  pass "$message"
}

make_fixture() {
  local repo="$1"
  rm -rf "$repo"
  mkdir -p "${repo}/scripts/lib" "${repo}/.claude"
  cp "${REAL_REPO}/scripts/add-client.sh" "${repo}/scripts/add-client.sh"
  cp "${REAL_REPO}/scripts/lib/python.sh" "${repo}/scripts/lib/python.sh"
  printf '{}\n' > "${repo}/.claude/settings.json"
}

write_overrides() {
  local client_dir="$1"
  local json="$2"
  mkdir -p "${client_dir}/.claude"
  printf '%s\n' "$json" > "${client_dir}/.claude/settings.local.json"
}

trap 'rm -rf "$TEST_ROOT"' EXIT
rm -rf "$TEST_ROOT"

echo "Inherited skill overrides test"
echo "=============================="

# --- Scenario 1: consensus travels, per-client decisions do not --------------
make_fixture "$TEST_REPO"
write_overrides "${TEST_REPO}/clients/alpha" '{ "skillOverrides": { "fin-a": "off", "fin-b": "off", "str-x": "off" } }'
write_overrides "${TEST_REPO}/clients/beta"  '{ "skillOverrides": { "fin-a": "off", "fin-b": "off" } }'
mkdir -p "${TEST_REPO}/clients/gamma/.claude"                  # never configured: no vote
write_overrides "${TEST_REPO}/clients/delta" 'not json at all' # broken file: ignored

OUTPUT_FILE="${TEST_ROOT}/consensus.out"
bash "${TEST_REPO}/scripts/add-client.sh" "Consensus Client" > "$OUTPUT_FILE" 2>&1 || {
  cat "$OUTPUT_FILE"
  fail "add-client.sh failed on the consensus scenario"
}

NEW_SETTINGS="${TEST_REPO}/clients/consensus-client/.claude/settings.local.json"
assert_file_contains "$NEW_SETTINGS" '"fin-a": "off"' "consensus override fin-a is inherited"
assert_file_contains "$NEW_SETTINGS" '"fin-b": "off"' "consensus override fin-b is inherited"
assert_file_not_contains "$NEW_SETTINGS" 'str-x' "single-client override str-x is not inherited"
assert_file_contains "$OUTPUT_FILE" "Hidden by default" "creation output reports the inherited overrides"
assert_file_contains "$OUTPUT_FILE" "Hidden in some clients only (not inherited): str-x" "creation output mentions the per-client override it left alone"

# --- Scenario 2: no votes means no file --------------------------------------
make_fixture "$TEST_REPO"
mkdir -p "${TEST_REPO}/clients/quiet/.claude"

OUTPUT_FILE="${TEST_ROOT}/fresh.out"
bash "${TEST_REPO}/scripts/add-client.sh" "Fresh Client" > "$OUTPUT_FILE" 2>&1 || {
  cat "$OUTPUT_FILE"
  fail "add-client.sh failed on the fresh scenario"
}
assert_path_absent "${TEST_REPO}/clients/fresh-client/.claude/settings.local.json" "no consensus means no settings.local.json is created"

echo ""
pass "new clients inherit the consensus skill overrides"
