#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

run_hook() {
  local prompt="$1"
  # Unique session id per case: the hook fires once per session by design
  # (2026-07-16 audit fix), so reusing one id would suppress later cases.
  local sid="blocker-gate-test-${RANDOM}${RANDOM}"
  printf '{"session_id":"%s","cwd":"%s","prompt":"%s"}' "$sid" "$REAL_REPO" "$prompt" \
    | node "$REAL_REPO/.claude/hooks/blocker-research-gate.js"
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

test_feasibility_prompt_triggers() {
  out="$(run_hook "Can I close my laptop while Codex and Claude keep running? What are my options?")"

  assert_contains "$out" "AI-OS blocker research gate"
  assert_contains "$out" "q-question"
  assert_contains "$out" "Composio"
  assert_contains "$out" "A bare 'no' is allowed only"
  ok "feasibility prompt triggers blocker research gate"
}

test_blocker_prompt_triggers() {
  out="$(run_hook "This integration is blocked because the tool says it is unsupported. Find a workaround.")"

  assert_contains "$out" "native support"
  assert_contains "$out" "workaround"
  ok "blocker prompt triggers blocker research gate"
}

test_resolve_this_prompt_triggers() {
  out="$(run_hook "You resolve this. use Browser if you need to")"

  assert_contains "$out" "AI-OS blocker research gate"
  assert_contains "$out" "Composio"
  assert_contains "$out" "web/local fallback"
  ok "resolve-this prompt with tool context triggers blocker research gate"
}

test_trivial_prompt_does_not_trigger() {
  out="$(run_hook "thanks")"

  assert_empty "$out"
  ok "trivial prompt stays silent"
}

test_plain_status_prompt_does_not_trigger() {
  out="$(run_hook "What branch am I on?")"

  assert_empty "$out"
  ok "plain status prompt stays silent"
}

info "Running blocker research gate tests..."
test_feasibility_prompt_triggers
test_blocker_prompt_triggers
test_resolve_this_prompt_triggers
test_trivial_prompt_does_not_trigger
test_plain_status_prompt_does_not_trigger
ok "blocker research gate tests passed"
