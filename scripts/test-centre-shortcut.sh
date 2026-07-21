#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/centre-shortcut.sh"
source "$SCRIPT_DIR/lib/python.sh"

assert_true() {
    local condition="$1"
    local message="$2"

    if [[ "$condition" != "true" ]]; then
        printf 'Assertion failed: %s\n' "$message" >&2
        exit 1
    fi
}

assert_equal() {
    local expected="$1"
    local actual="$2"
    local message="$3"

    if [[ "$expected" != "$actual" ]]; then
        printf 'Assertion failed: %s\nExpected: %s\nActual:   %s\n' "$message" "$expected" "$actual" >&2
        exit 1
    fi
}

assert_contains() {
    local text="$1"
    local expected_text="$2"
    local message="$3"

    if [[ "$text" != *"$expected_text"* ]]; then
        printf 'Assertion failed: %s\nMissing: %s\n' "$message" "$expected_text" >&2
        exit 1
    fi
}

parse_powershell_status_json_for_test() {
    local status_json="$1"
    local parsed_output=""

    parsed_output="$(
        printf '%s' "$status_json" | "${PYTHON_CMD[@]}" -c 'import json, sys
data = json.loads(sys.stdin.read() or "{}")
print("true" if data.get("shortcuts_detected") else "false")
print("true" if data.get("mismatch_detected") else "false")
print(data.get("current_shortcut_path", ""))
print(data.get("expected_shortcut_path", ""))
print("true" if data.get("is_legacy_projects_layout") else "false")'
    )"

    TEST_PS_SHORTCUT_DETECTED="$(printf '%s\n' "$parsed_output" | sed -n '1p')"
    TEST_PS_SHORTCUT_MISMATCH="$(printf '%s\n' "$parsed_output" | sed -n '2p')"
    TEST_PS_CURRENT_PATH="$(printf '%s\n' "$parsed_output" | sed -n '3p')"
    TEST_PS_EXPECTED_PATH="$(printf '%s\n' "$parsed_output" | sed -n '4p')"
    TEST_PS_LEGACY_LAYOUT="$(printf '%s\n' "$parsed_output" | sed -n '5p')"
}

if ! resolve_python_cmd; then
    printf 'Python 3 is required for test-centre-shortcut.sh\n' >&2
    exit 1
fi

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agentic-os-centre-shortcut.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

export HOME="$TEST_ROOT/home"
mkdir -p "$HOME/.config/fish"
export SHELL="/bin/bash"

centre_script="$SCRIPT_DIR/centre.sh"
bash_rc="$HOME/.bashrc"

# Fresh install should create a managed block in the current shell profile.
agentic_os_centre_install_current_unix_shortcut "$centre_script"
assert_equal "added" "$AGENTIC_OS_CENTRE_LAST_ACTION" "Fresh install should add a shortcut block."
fresh_content="$(cat "$bash_rc")"
assert_contains "$fresh_content" "$AGENTIC_OS_CENTRE_BLOCK_START" "Fresh install should use the managed block start marker."
assert_contains "$fresh_content" "$centre_script" "Fresh install should point to the current repo launcher."

# Running it again should be idempotent.
agentic_os_centre_install_current_unix_shortcut "$centre_script"
assert_equal "unchanged" "$AGENTIC_OS_CENTRE_LAST_ACTION" "Installing twice should not rewrite the profile."

# Legacy marker content should migrate to the managed block.
legacy_script="/tmp/legacy/projects/agentic-os/scripts/centre.sh"
cat > "$bash_rc" <<EOF
$AGENTIC_OS_CENTRE_LEGACY_MARKER
alias centre='bash "$legacy_script"'
EOF

agentic_os_centre_install_current_unix_shortcut "$centre_script"
assert_equal "updated" "$AGENTIC_OS_CENTRE_LAST_ACTION" "Legacy marker content should be updated."
migrated_content="$(cat "$bash_rc")"
assert_contains "$migrated_content" "$AGENTIC_OS_CENTRE_BLOCK_END" "Migrated content should use the managed block end marker."
assert_true "$([[ "$migrated_content" == *"$legacy_script"* ]] && printf 'false' || printf 'true')" "Migrated content should remove the old script path."

# Scan should detect mismatches and older projects-folder layouts.
cat > "$bash_rc" <<EOF
$AGENTIC_OS_CENTRE_BLOCK_START
alias centre='bash "$legacy_script"'
$AGENTIC_OS_CENTRE_BLOCK_END
EOF

agentic_os_centre_scan_unix_shortcuts "$centre_script"
assert_equal "1" "$AGENTIC_OS_CENTRE_SCAN_COUNT" "Scan should find the managed shortcut."
assert_equal "$legacy_script" "${AGENTIC_OS_CENTRE_SCAN_CURRENT[0]}" "Scan should report the stale script path."
assert_equal "false" "${AGENTIC_OS_CENTRE_SCAN_MATCHES[0]}" "Scan should flag a mismatched repo path."
assert_equal "true" "${AGENTIC_OS_CENTRE_SCAN_LEGACY_LAYOUT[0]}" "Scan should flag older projects-folder layouts."

# Repair should rewrite detected shortcuts to the current repo path.
agentic_os_centre_repair_detected_unix_shortcuts "$centre_script"
assert_equal "1" "$AGENTIC_OS_CENTRE_REPAIR_UPDATED_COUNT" "Repair should update the detected shortcut."
repaired_content="$(cat "$bash_rc")"
assert_contains "$repaired_content" "$centre_script" "Repair should point the shortcut to the current repo."
assert_true "$([[ "$repaired_content" == *"$legacy_script"* ]] && printf 'false' || printf 'true')" "Repair should remove the stale repo path."

# PowerShell status parser should keep the mismatch paths and legacy-layout flag.
status_json='{"shortcuts_detected": true, "mismatch_detected": true, "current_shortcut_path": "C:\\legacy\\projects\\agentic-os\\scripts\\centre.ps1", "expected_shortcut_path": "C:\\current\\agentic-os\\scripts\\centre.ps1", "is_legacy_projects_layout": true}'
parse_powershell_status_json_for_test "$status_json"
assert_equal "true" "$TEST_PS_SHORTCUT_DETECTED" "PowerShell parser should report that a shortcut exists."
assert_equal "true" "$TEST_PS_SHORTCUT_MISMATCH" "PowerShell parser should report mismatch_detected=true."
assert_equal "C:\\legacy\\projects\\agentic-os\\scripts\\centre.ps1" "$TEST_PS_CURRENT_PATH" "PowerShell parser should keep the stale current path."
assert_equal "C:\\current\\agentic-os\\scripts\\centre.ps1" "$TEST_PS_EXPECTED_PATH" "PowerShell parser should keep the expected repo path."
assert_equal "true" "$TEST_PS_LEGACY_LAYOUT" "PowerShell parser should keep the legacy projects-folder flag."

printf '  [OK] test-centre-shortcut.sh passed\n'
