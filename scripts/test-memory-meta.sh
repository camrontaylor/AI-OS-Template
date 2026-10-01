#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
MEMORY_META_BASH="${MEMORY_META_BASH:-$BASH}"

cleanup() {
  if [ -n "${TEST_ROOT:-}" ] && [ -d "$TEST_ROOT" ]; then
    rm -rf "$TEST_ROOT"
  fi
}
trap cleanup EXIT

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq -- "$expected" "$file"; then
    echo "--- $file ---" >&2
    cat "$file" >&2
    fail "Expected output to contain: $expected"
  fi
}

make_repo() {
  local name="$1"
  local repo="$TEST_ROOT/$name"

  mkdir -p "$repo/scripts/lib"
  cp "$REPO_ROOT/scripts/lib/memory-meta.sh" "$repo/scripts/lib/memory-meta.sh"
  printf '%s\n' "$repo"
}

run_report() {
  local repo="$1"
  local output="$2"
  shift 2

  if ! "$MEMORY_META_BASH" "$repo/scripts/lib/memory-meta.sh" "$@" >"$output" 2>&1; then
    echo "--- $output ---" >&2
    cat "$output" >&2
    fail "memory-meta.sh exited with an error"
  fi
}

test_empty_inventory() {
  local repo
  local output="$TEST_ROOT/empty.out"
  repo="$(make_repo empty)"

  run_report "$repo" "$output"

  assert_contains "$output" "MEMORY.md: not found"
  assert_contains "$output" "No session logs found."
}

test_empty_legacy_inventory() {
  local repo
  local output="$TEST_ROOT/empty-legacy.out"
  repo="$(make_repo empty-legacy)"

  run_report "$repo" "$output" --include-legacy

  assert_contains "$output" "No session logs found."
  assert_contains "$output" "No legacy auto-captured logs found."
}

test_single_topic_and_session() {
  local repo
  local output="$TEST_ROOT/single.out"
  repo="$(make_repo single)"

  mkdir -p "$repo/context/memory"
  printf 'Roadmap details.\n' >"$repo/context/memory/2026-07-01.md"

  run_report "$repo" "$output" roadmap

  assert_contains "$output" "Range: 2026-07-01 → 2026-07-01"
  assert_contains "$output" "Count: 1 day(s)"
  assert_contains "$output" "Gaps: none"
  assert_contains "$output" '=== Topic: "roadmap" ==='
  assert_contains "$output" "2026-07-01:"
}

test_ranges_gaps_and_topic_search() {
  local repo
  local output="$TEST_ROOT/populated.out"
  repo="$(make_repo populated)"

  mkdir -p "$repo/context/memory" "$repo/.memsearch/memory"
  printf '# Memory\n\nQuarterly planning is active.\n' >"$repo/context/MEMORY.md"
  printf '# Learnings\n\nQuarterly planning notes.\n' >"$repo/context/learnings.md"
  printf 'Routine notes.\n' >"$repo/context/memory/2026-07-01.md"
  printf 'Automatic capture.\n' >"$repo/context/memory/2026-07-02.aos.md"
  printf 'Quarterly planning session.\n' >"$repo/context/memory/2026-07-05.md"
  printf 'Duplicate date.\n' >"$repo/context/memory/2026-07-05.aos.md"
  printf 'Older notes.\n' >"$repo/.memsearch/memory/2026-06-01.aos.md"
  printf 'Quarterly planning archive.\n' >"$repo/.memsearch/memory/2026-06-03.md"

  run_report "$repo" "$output" --include-legacy quarterly planning

  assert_contains "$output" "Range: 2026-07-01 → 2026-07-05"
  assert_contains "$output" "Count: 3 day(s)"
  assert_contains "$output" "Gaps (>2 days):"
  assert_contains "$output" "2026-07-02 → 2026-07-05 (3 days)"
  assert_contains "$output" "Range: 2026-06-01 → 2026-06-03"
  assert_contains "$output" "Count: 2 day(s)"
  assert_contains "$output" '=== Topic: "quarterly planning" ==='
  assert_contains "$output" "2026-07-05:"
  assert_contains "$output" "2026-06-03:"
  assert_contains "$output" "(current): context/MEMORY.md"
  assert_contains "$output" "(ongoing): context/learnings.md"
}

test_no_gaps_and_missing_topic() {
  local repo
  local output="$TEST_ROOT/no-gaps.out"
  repo="$(make_repo no-gaps)"

  mkdir -p "$repo/context/memory"
  printf 'First day.\n' >"$repo/context/memory/2026-07-01.md"
  printf 'Second day.\n' >"$repo/context/memory/2026-07-02.md"

  run_report "$repo" "$output" absent topic

  assert_contains "$output" "Gaps: none"
  assert_contains "$output" 'No mentions found for "absent topic".'
}

test_help() {
  local repo
  local output="$TEST_ROOT/help.out"
  repo="$(make_repo help)"

  run_report "$repo" "$output" --help

  assert_contains "$output" "Usage: bash scripts/lib/memory-meta.sh"
}

test_empty_inventory
test_empty_legacy_inventory
test_single_topic_and_session
test_ranges_gaps_and_topic_search
test_no_gaps_and_missing_topic
test_help

echo "[PASS] memory-meta.sh tests passed with $("$MEMORY_META_BASH" --version | sed -n '1p')"
