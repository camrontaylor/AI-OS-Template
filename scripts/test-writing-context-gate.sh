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
  local sid="writing-gate-test-${RANDOM}${RANDOM}"
  printf '{"session_id":"%s","cwd":"%s","prompt":"%s"}' "$sid" "$REAL_REPO" "$prompt" \
    | node "$REAL_REPO/.claude/hooks/writing-context-gate.js"
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

test_client_message_triggers() {
  out="$(run_hook "How should I reply to Nick about the ERP questions?")"

  assert_contains "$out" "AI-OS writing context gate"
  assert_contains "$out" "comms-message"
  assert_contains "$out" "agency-gather.sh"
  ok "client reply prompt triggers writing context gate"
}

test_cron_prompt_does_not_trigger() {
  out="$(run_hook "You are running as a scheduled job for AI-OS. Draft and send the daily digest email.")"

  assert_empty "$out"
  ok "scheduled cron prompt stays silent"
}

test_marketing_copy_triggers() {
  out="$(run_hook "Write landing page copy for the new offer")"

  assert_contains "$out" "mkt-copywriting"
  ok "marketing copy prompt triggers writing context gate"
}

test_voice_prompt_triggers() {
  out="$(run_hook "Make this sound more like me and less AI")"

  assert_contains "$out" "mkt-brand-voice"
  ok "voice prompt triggers writing context gate"
}

test_code_prompt_does_not_trigger() {
  out="$(run_hook "Write unit tests for scripts/memory-search.py")"

  assert_empty "$out"
  ok "plain code prompt does not trigger writing context gate"
}

test_status_prompt_does_not_trigger() {
  out="$(run_hook "What branch am I on?")"

  assert_empty "$out"
  ok "non-writing prompt stays silent"
}

info "Running writing context gate tests..."
test_client_message_triggers
test_marketing_copy_triggers
test_voice_prompt_triggers
test_code_prompt_does_not_trigger
test_status_prompt_does_not_trigger
test_cron_prompt_does_not_trigger
ok "writing context gate tests passed"
