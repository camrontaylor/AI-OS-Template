#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.claude/hooks/aios-authority-guard.js"

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

run_hook() {
  local command="$1"
  printf '{"tool_name":"Bash","tool_input":{"command":%s},"cwd":%s}\n' \
    "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$command")" \
    "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$ROOT")" |
    node "$HOOK"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" == *"$needle"* ]] || fail "Expected output to contain: $needle"
}

assert_empty() {
  local value="$1"
  [[ -z "$value" ]] || fail "Expected empty hook output, got: $value"
}

info "Running AI-OS authority guard tests..."

raw_out="$(run_hook 'memsearch search "Acme Ops" --top-k 5 --json-output')"
assert_contains "$raw_out" "permissionDecision"
assert_contains "$raw_out" "AI-OS memory guard"
assert_contains "$raw_out" "scripts/memsearch-search.sh"
ok "raw memsearch search is denied with wrapper guidance"

uvx_out="$(run_hook 'uvx memsearch stats --collection ms_ai_os_c11344b8_aios')"
assert_contains "$uvx_out" "AI-OS memory guard"
ok "uvx raw memsearch command is denied"

env_out="$(run_hook 'GLOG_minloglevel=3 GRPC_VERBOSITY=NONE memsearch search "Acme Ops" --top-k 5')"
assert_contains "$env_out" "AI-OS memory guard"
ok "env-prefixed raw memsearch command is denied"

wrapper_out="$(run_hook 'bash scripts/memsearch-search.sh "Acme Ops" 10')"
assert_empty "$wrapper_out"
ok "AI-OS recall wrapper is allowed"

index_wrapper_out="$(run_hook 'bash scripts/memsearch-reindex.sh')"
assert_empty "$index_wrapper_out"
ok "AI-OS reindex wrapper is allowed"

ok "AI-OS authority guard tests passed"
