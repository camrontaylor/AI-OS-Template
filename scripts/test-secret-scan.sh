#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-secret-scan-test"
trap 'rm -rf "$TEST_ROOT"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

info "Running secret scanner tests..."
rm -rf "$TEST_ROOT"
mkdir -p "$TEST_ROOT"

token="sk-$(printf 'a%.0s' {1..32})"
password="$(printf 'actual%s%d' 'Secret' 987)"
printf 'MORPH_API_KEY = "%s"\n' "$token" > "$TEST_ROOT/secret-config.toml"
printf 'password = "%s"\n' "$password" > "$TEST_ROOT/secret-password.env"
printf '%s\n' "-----BEGIN OPENSSH PRIVATE"" KEY-----" > "$TEST_ROOT/private-key.txt"
printf '%s\n' 'MORPH_API_KEY = "sk-placeholder-replace-this-value"' > "$TEST_ROOT/placeholders.env.example"
printf '%s\n' 'api_key: ACME_SYNKIT_API_KEY' > "$TEST_ROOT/environment-reference.yaml"
printf '%s\n' 'const taskId = "task-sk-abcdefghijklmnopqrstuvwxyz012345";' > "$TEST_ROOT/false-positive.js"

if python3 "$ROOT/scripts/lib/secret-scan.py" "$TEST_ROOT" \
  secret-config.toml secret-password.env private-key.txt > "$TEST_ROOT/hits.out"; then
  fail "scanner accepted credential-shaped values"
fi
grep -Fq 'secret-config.toml:1:token-prefix' "$TEST_ROOT/hits.out" || fail "token prefix was not detected"
grep -Fq 'secret-password.env:1:credential-assignment' "$TEST_ROOT/hits.out" || fail "password assignment was not detected"
grep -Fq 'private-key.txt:1:private-key' "$TEST_ROOT/hits.out" || fail "private key was not detected"
if grep -Fq "$token" "$TEST_ROOT/hits.out" || grep -Fq "$password" "$TEST_ROOT/hits.out"; then
  fail "scanner output exposed the secret value"
fi
ok "credential-shaped values fail without being echoed"

if ! python3 "$ROOT/scripts/lib/secret-scan.py" "$TEST_ROOT" \
  placeholders.env.example environment-reference.yaml false-positive.js > "$TEST_ROOT/clean.out"; then
  fail "scanner rejected placeholders or an embedded task identifier"
fi
[[ ! -s "$TEST_ROOT/clean.out" ]] || fail "clean scan should not emit findings"
ok "placeholders and embedded non-secret identifiers pass"

grep -Fq 'secret-scan.py' "$ROOT/scripts/template-sync.sh" || fail "template sync does not call the secret scanner"
grep -Fq 'secret-scan.py' "$ROOT/scripts/template-release-check.sh" || fail "template release check does not call the secret scanner"
ok "template sync and release checks both enforce the scanner"

ok "secret scanner tests passed"
