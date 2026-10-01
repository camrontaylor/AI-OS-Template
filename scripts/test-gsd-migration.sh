#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/gsd-migration.sh"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/AI-OS-gsd-test.XXXXXX")"
FAKE_BIN="$TEST_ROOT/bin"
FAKE_LOG="$TEST_ROOT/tool.log"

mkdir -p "$FAKE_BIN"
: > "$FAKE_LOG"
trap 'rm -rf "$TEST_ROOT"' EXIT

cat > "$FAKE_BIN/npm" <<'STUB'
#!/usr/bin/env bash
echo "npm $*" >> "$FAKE_NPM_LOG"

if [[ "$1" == "ls" ]]; then
    if [[ "$*" == *"-g"* ]]; then
        if [[ "${FAKE_NPM_GLOBAL_LEGACY:-0}" == "1" ]]; then
            printf '{"dependencies":{"get-shit-done-cc":{"version":"1.0.0"},"@gsd-build/sdk":{"version":"1.0.0"}}}\n'
        else
            printf '{"dependencies":{}}\n'
        fi
    else
        if [[ "${FAKE_NPM_LOCAL_LEGACY:-0}" == "1" ]]; then
            printf '{"dependencies":{"get-shit-done-redux":{"version":"1.0.0"},"@gsd-redux/sdk":{"version":"1.0.0"}}}\n'
        else
            printf '{"dependencies":{}}\n'
        fi
    fi
    exit 0
fi

if [[ "$1" == "uninstall" ]]; then
    exit 0
fi

exit 0
STUB

cat > "$FAKE_BIN/npx" <<'STUB'
#!/usr/bin/env bash
echo "npx $*" >> "$FAKE_NPM_LOG"
exit 0
STUB

cat > "$FAKE_BIN/node" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

chmod +x "$FAKE_BIN/npm" "$FAKE_BIN/npx" "$FAKE_BIN/node"
export PATH="$FAKE_BIN:$PATH"
export FAKE_NPM_LOG="$FAKE_LOG"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_exists() {
    [[ -e "$1" ]] || fail "Expected path to exist: $1"
}

assert_not_exists() {
    [[ ! -e "$1" ]] || fail "Expected path to be removed: $1"
}

assert_log_contains() {
    grep -Fq "$1" "$FAKE_LOG" || fail "Expected log to contain: $1"
}

assert_log_not_contains() {
    ! grep -Fq "$1" "$FAKE_LOG" || fail "Expected log not to contain: $1"
}

assert_finding_contains() {
    local findings="$1"
    local expected="$2"
    grep -Fxq "$expected" <<< "$findings" || fail "Expected finding: $expected"
}

reset_case() {
    : > "$FAKE_LOG"
    unset FAKE_NPM_GLOBAL_LEGACY
    unset FAKE_NPM_LOCAL_LEGACY
    unset AI_OS_GSD_MIGRATE
    unset AI_OS_GSD_UPDATE_STATUS
    unset AI_OS_GSD_MIGRATION_RESULT
    unset CLAUDE_CONFIG_DIR
}

make_workspace() {
    local name="$1"
    local base="$TEST_ROOT/$name"

    mkdir -p "$base/home" "$base/global-claude" "$base/repo"
    printf "%s\n" "$base"
}

test_fresh_install_no_legacy() {
    reset_case
    local base repo findings
    base="$(make_workspace fresh-no-legacy)"
    repo="$base/repo"

    export HOME="$base/home"
    export CLAUDE_CONFIG_DIR="$base/global-claude"
    findings="$(ai_os_gsd_detect_legacy "$repo")"
    [[ -z "$findings" ]] || fail "Expected no legacy findings, got: $findings"

    ai_os_gsd_install_redux >/dev/null
    assert_log_contains "npx -y @opengsd/get-shit-done-redux@latest --global --claude"
}

test_detects_legacy_artifacts() {
    reset_case
    local base repo global findings
    base="$(make_workspace detect-artifacts)"
    repo="$base/repo"
    global="$base/global-claude"

    mkdir -p "$global/commands/gsd" "$global/get-shit-done" "$global/agents" "$repo/.claude/commands"
    : > "$global/agents/gsd-review.md"
    : > "$repo/.claude/commands/gsd-help.md"

    export HOME="$base/home"
    export CLAUDE_CONFIG_DIR="$global"
    findings="$(ai_os_gsd_detect_legacy "$repo")"
    assert_finding_contains "$findings" "file:$global/commands/gsd"
    assert_finding_contains "$findings" "file:$global/get-shit-done"
    assert_finding_contains "$findings" "file:$global/agents/gsd-review.md"
    assert_finding_contains "$findings" "file:$repo/.claude/commands/gsd-help.md"
}

test_redux_install_not_detected_as_legacy() {
    reset_case
    local base repo global findings
    base="$(make_workspace redux-not-legacy)"
    repo="$base/repo"
    global="$base/global-claude"

    # A healthy Redux install: get-shit-done/ holds a VERSION file and Redux
    # deploys agents/gsd-*.md. Neither must be reported as legacy.
    mkdir -p "$global/get-shit-done" "$global/agents"
    printf "1.1.0\n" > "$global/get-shit-done/VERSION"
    : > "$global/agents/gsd-review.md"

    export HOME="$base/home"
    export CLAUDE_CONFIG_DIR="$global"
    findings="$(ai_os_gsd_detect_legacy "$repo")"
    [[ -z "$findings" ]] || fail "Expected no legacy findings for a Redux install, got: $findings"
}

test_redux_present_still_detects_old_command_bundle() {
    reset_case
    local base repo global findings
    base="$(make_workspace redux-plus-legacy-bundle)"
    repo="$base/repo"
    global="$base/global-claude"

    # Redux present, but a genuine legacy commands/gsd/ bundle was left behind.
    # The always-legacy marker must still fire; Redux-owned files must not.
    mkdir -p "$global/get-shit-done" "$global/commands/gsd" "$global/agents"
    printf "1.1.0\n" > "$global/get-shit-done/VERSION"
    : > "$global/agents/gsd-review.md"

    export HOME="$base/home"
    export CLAUDE_CONFIG_DIR="$global"
    findings="$(ai_os_gsd_detect_legacy "$repo")"
    assert_finding_contains "$findings" "file:$global/commands/gsd"
    ! grep -Fq "file:$global/get-shit-done" <<< "$findings" || fail "Redux runtime should not be flagged as legacy"
    ! grep -Fq "file:$global/agents/gsd-review.md" <<< "$findings" || fail "Redux agent file should not be flagged as legacy"
}

test_redux_version_reports_installed() {
    reset_case
    local base repo global version
    base="$(make_workspace redux-version)"
    repo="$base/repo"
    global="$base/global-claude"

    export HOME="$base/home"
    export CLAUDE_CONFIG_DIR="$global"

    # No runtime yet -> helper reports not installed.
    if version="$(ai_os_gsd_redux_version "$repo")"; then
        fail "Expected redux_version to fail when no runtime is present, got: $version"
    fi

    # Redux runtime present -> helper echoes the trimmed version.
    mkdir -p "$global/get-shit-done"
    printf "1.1.0\n" > "$global/get-shit-done/VERSION"
    version="$(ai_os_gsd_redux_version "$repo")" || fail "Expected redux_version to succeed when runtime is present"
    [[ "$version" == "1.1.0" ]] || fail "Expected version 1.1.0, got: $version"
}

test_approve_cleanup_installs_redux() {
    reset_case
    local base repo global
    base="$(make_workspace approve-cleanup)"
    repo="$base/repo"
    global="$base/global-claude"

    export FAKE_NPM_GLOBAL_LEGACY=1
    export FAKE_NPM_LOCAL_LEGACY=1
    export AI_OS_GSD_MIGRATE=1

    mkdir -p "$global/commands/gsd" "$global/get-shit-done" "$global/agents" "$repo/.claude/commands" "$repo/.planning" "$repo/projects/briefs/demo/.planning"
    : > "$repo/package.json"
    : > "$global/agents/gsd-review.md"
    : > "$repo/.claude/commands/gsd-help.md"
    : > "$repo/.planning/STATE.md"
    : > "$repo/projects/briefs/demo/.planning/STATE.md"

    export HOME="$base/home"
    export CLAUDE_CONFIG_DIR="$global"
    ai_os_gsd_run_update_migration "$repo" >/dev/null

    assert_not_exists "$global/commands/gsd"
    assert_not_exists "$global/get-shit-done"
    assert_not_exists "$global/agents/gsd-review.md"
    assert_not_exists "$repo/.claude/commands/gsd-help.md"
    assert_exists "$repo/.planning/STATE.md"
    assert_exists "$repo/projects/briefs/demo/.planning/STATE.md"
    assert_log_contains "npm uninstall -g get-shit-done-cc"
    assert_log_contains "npm uninstall -g @gsd-build/sdk"
    assert_log_contains "npm uninstall get-shit-done-redux"
    assert_log_contains "npm uninstall @gsd-redux/sdk"
    assert_log_contains "npx -y @opengsd/get-shit-done-redux@latest --global --claude"
    [[ "${AI_OS_GSD_UPDATE_STATUS:-}" == "migrated to OpenGSD Redux" ]] || fail "Expected migrated update status"
}

test_decline_cleanup_keeps_legacy() {
    reset_case
    local base repo global
    base="$(make_workspace decline-cleanup)"
    repo="$base/repo"
    global="$base/global-claude"

    export AI_OS_GSD_MIGRATE=0
    mkdir -p "$global/commands/gsd" "$repo/.planning"
    : > "$repo/.planning/STATE.md"

    export HOME="$base/home"
    export CLAUDE_CONFIG_DIR="$global"
    ai_os_gsd_run_update_migration "$repo" >/dev/null

    assert_exists "$global/commands/gsd"
    assert_exists "$repo/.planning/STATE.md"
    assert_log_not_contains "npx -y @opengsd/get-shit-done-redux@latest --global --claude"
    [[ "${AI_OS_GSD_UPDATE_STATUS:-}" == "legacy cleanup skipped" ]] || fail "Expected skipped update status"
}

test_update_no_legacy_does_not_install() {
    reset_case
    local base repo
    base="$(make_workspace update-no-legacy)"
    repo="$base/repo"

    export AI_OS_GSD_MIGRATE=1
    export HOME="$base/home"
    export CLAUDE_CONFIG_DIR="$base/global-claude"
    ai_os_gsd_run_update_migration "$repo" >/dev/null

    assert_log_not_contains "npx -y @opengsd/get-shit-done-redux@latest --global --claude"
    [[ -z "${AI_OS_GSD_UPDATE_STATUS:-}" ]] || fail "Expected empty update status when no legacy GSD exists"
}

test_safe_remove_protects_planning() {
    reset_case
    local base repo
    base="$(make_workspace protect-planning)"
    repo="$base/repo"

    mkdir -p "$repo/.planning"
    : > "$repo/.planning/STATE.md"
    ai_os_gsd_safe_remove_path "$repo/.planning" "$repo"

    assert_exists "$repo/.planning/STATE.md"
}

test_fresh_install_no_legacy
test_detects_legacy_artifacts
test_redux_install_not_detected_as_legacy
test_redux_present_still_detects_old_command_bundle
test_redux_version_reports_installed
test_approve_cleanup_installs_redux
test_decline_cleanup_keeps_legacy
test_update_no_legacy_does_not_install
test_safe_remove_protects_planning

echo "GSD migration helper tests passed."
