#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "$REAL_REPO/.tmp-update-processes.XXXXXX")"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info() { printf "  ${CYAN}%b${NC}\n" "$1"; }
ok() { printf "  ${GREEN}✓ %b${NC}\n" "$1"; }
warn() { printf "  ${YELLOW}→ %b${NC}\n" "$1"; }
bullet() { printf "    ${DIM}•${NC} %b\n" "$1"; }
fail() {
    printf "  ${RED}✗ %b${NC}\n" "$1"
    exit 1
}

cleanup_pid() {
    local target_pid="${1:-}"
    [[ "$target_pid" =~ ^[0-9]+$ ]] || return 0
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            powershell.exe -NoProfile -NonInteractive -Command \
                "Stop-Process -Id $target_pid -Force -ErrorAction SilentlyContinue" \
                >/dev/null 2>&1 || true
            ;;
        *)
            kill -KILL "$target_pid" >/dev/null 2>&1 || true
            ;;
    esac
}

SCOPED_PID=""
UNRELATED_PID=""
cleanup() {
    cleanup_pid "$SCOPED_PID"
    cleanup_pid "$UNRELATED_PID"
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

source "$REAL_REPO/scripts/lib/python.sh"
resolve_python_cmd >/dev/null || fail "Python 3 is required"

REPO_ROOT="$TEST_ROOT/workspace"
mkdir -p "$REPO_ROOT"
source "$REAL_REPO/scripts/lib/update-processes.sh"

reset_process_state() {
    UPDATE_PROCESS_STATE_CAPTURED=false
    UPDATE_PROCESS_PREPARED=false
    UPDATE_BACKGROUND_RESTORED=false
    UPDATE_MEMORY_WATCH_WAS_RUNNING=false
    UPDATE_CRON_WAS_RUNNING=false
    UPDATE_COMMAND_CENTRE_WAS_RUNNING=false
}

create_task_database() {
    local database="$1"
    local status="$2"
    mkdir -p "$(dirname "$database")"
    "${PYTHON_CMD[@]}" - "$database" "$status" <<'PYEOF'
import sqlite3
import sys

database, status = sys.argv[1:]
connection = sqlite3.connect(database)
connection.execute(
    "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, updatedAt TEXT)"
)
connection.execute(
    "INSERT INTO tasks VALUES ('task-1', 'Important update test', ?, '2026-07-24T12:00:00Z')",
    (status,),
)
connection.commit()
connection.close()
PYEOF
}

info "Checking active-task preflight..."
create_task_database "$REPO_ROOT/.command-centre/data.db" "running"
create_task_database "$REPO_ROOT/.command-centre/profiles/abcdef/data.db" "queued"
active_output="$(scan_active_update_tasks)"
[[ "$active_output" == *$'solo\trunning\ttask-1\tImportant update test'* ]] ||
    fail "Solo running task was not detected"
[[ "$active_output" == *$'abcdef\tqueued\ttask-1\tImportant update test'* ]] ||
    fail "Team profile queued task was not detected"

process_list_marker="$TEST_ROOT/process-list-called"
list_scoped_node_processes() {
    printf 'called\n' > "$process_list_marker"
}
if prepare_update_processes > "$TEST_ROOT/active.out" 2>&1; then
    fail "Update preflight should block active tasks"
fi
[[ ! -e "$process_list_marker" ]] || fail "Processes were inspected after active work was found"
grep -Fq "Nothing was changed and no processes were stopped" "$TEST_ROOT/active.out" ||
    fail "Active-task message was not shown"
ok "Queued and running tasks block before process shutdown"

info "Checking scoped shutdown and restoration..."
rm -rf "$REPO_ROOT/.command-centre"
reset_process_state
mock_processes="$TEST_ROOT/mock-processes"
mock_log="$TEST_ROOT/mock-actions.log"
printf '101\tmemory-watcher\n102\tcron\n103\tcommand-centre\n104\tscoped-node\n' > "$mock_processes"

remove_mock_pid() {
    local target_pid="$1"
    awk -F '\t' -v pid="$target_pid" '$1 != pid' "$mock_processes" > "$mock_processes.tmp"
    mv "$mock_processes.tmp" "$mock_processes"
}
list_scoped_node_processes() {
    [[ -f "$mock_processes" ]] && cat "$mock_processes"
}
stop_memory_watcher_for_update() {
    printf 'stop-memory\n' >> "$mock_log"
    remove_mock_pid 101
}
stop_cron_for_update() {
    printf 'stop-cron\n' >> "$mock_log"
    remove_mock_pid 102
}
force_stop_scoped_node_pid() {
    printf 'stop-pid-%s\n' "$1" >> "$mock_log"
    remove_mock_pid "$1"
}
wait_for_scoped_nodes_to_stop() {
    [[ ! -s "$mock_processes" ]]
}
restart_memory_watcher_after_update() {
    printf 'restart-memory\n' >> "$mock_log"
}
restart_cron_after_update() {
    printf 'restart-cron\n' >> "$mock_log"
}

prepare_update_processes > "$TEST_ROOT/idle.out" 2>&1 ||
    fail "Idle scoped processes should stop successfully"
restore_update_background_services 0 >> "$TEST_ROOT/idle.out" 2>&1 ||
    fail "Background services should restore successfully"

for expected in stop-memory stop-cron stop-pid-103 stop-pid-104 restart-memory restart-cron; do
    grep -Fqx "$expected" "$mock_log" || fail "Missing process action: $expected"
done
grep -Fq "Reopen it when you're ready" "$TEST_ROOT/idle.out" ||
    fail "Command Centre reopen message was not shown"
ok "Only previous background services restart; Command Centre stays closed"

info "Checking recovery after an update failure..."
reset_process_state
UPDATE_PROCESS_STATE_CAPTURED=true
UPDATE_MEMORY_WATCH_WAS_RUNNING=true
UPDATE_CRON_WAS_RUNNING=true
UPDATE_COMMAND_CENTRE_WAS_RUNNING=true
restore_update_background_services 7 > "$TEST_ROOT/failure-restore.out" 2>&1 ||
    fail "Background restoration should be attempted after failure"
grep -Fq "closed before the update failed" "$TEST_ROOT/failure-restore.out" ||
    fail "Failed-update reopen message was not shown"
ok "Background services are restored after update failure"

info "Checking safe failure behavior..."
reset_process_state
printf '201\tscoped-node\n' > "$mock_processes"
force_stop_scoped_node_pid() {
    return 2
}
if prepare_update_processes > "$TEST_ROOT/stop-failure.out" 2>&1; then
    fail "Shutdown should abort when scoped ownership cannot be stopped safely"
fi
grep -Fq "Could not safely stop Command Centre process PID 201" "$TEST_ROOT/stop-failure.out" ||
    fail "Safe shutdown failure message was not shown"
ok "Unstoppable or unverified processes abort the update"

info "Checking stale watcher lock cleanup..."
stale_root="$TEST_ROOT/stale"
mkdir -p "$stale_root/.command-centre/memory.watch.lock"
printf '999999999\n' > "$stale_root/.command-centre/memory.watch.lock/pid"
AI_OS_DIR="$stale_root" node "$REAL_REPO/command-centre/scripts/memory-watch-stop.cjs" \
    > "$TEST_ROOT/stale.out"
[[ ! -d "$stale_root/.command-centre/memory.watch.lock" ]] ||
    fail "Stale memory watcher lock was not removed"
ok "Stale watcher locks are cleaned safely"

info "Checking real installation scoping..."
scoped_root="$TEST_ROOT/scoped-install"
unrelated_root="$TEST_ROOT/unrelated-install"
mkdir -p "$scoped_root/command-centre" "$unrelated_root"
printf 'setInterval(() => {}, 1000);\n' > "$scoped_root/command-centre/hold-open.cjs"
printf 'setInterval(() => {}, 1000);\n' > "$unrelated_root/hold-open.cjs"

node "$scoped_root/command-centre/hold-open.cjs" &
SCOPED_PID=$!
node "$unrelated_root/hold-open.cjs" &
UNRELATED_PID=$!
sleep 1

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        scoped_root_for_helper="$(cygpath -m "$scoped_root")"
        unrelated_root_for_helper="$(cygpath -m "$unrelated_root")"
        SCOPED_PID="$(AI_OS_TEST_PROCESS_PATH="$scoped_root_for_helper/command-centre/hold-open.cjs" \
            powershell.exe -NoProfile -NonInteractive -Command \
            '$needle = $env:AI_OS_TEST_PROCESS_PATH.Replace("/", "\"); (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and ([string]$_.CommandLine).Replace("/", "\").IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 -ExpandProperty ProcessId)')"
        UNRELATED_PID="$(AI_OS_TEST_PROCESS_PATH="$unrelated_root_for_helper/hold-open.cjs" \
            powershell.exe -NoProfile -NonInteractive -Command \
            '$needle = $env:AI_OS_TEST_PROCESS_PATH.Replace("/", "\"); (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and ([string]$_.CommandLine).Replace("/", "\").IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 -ExpandProperty ProcessId)')"
        ;;
    *) scoped_root_for_helper="$scoped_root" ;;
esac

[[ "$SCOPED_PID" =~ ^[0-9]+$ ]] || fail "Could not resolve the scoped Node PID"
[[ "$UNRELATED_PID" =~ ^[0-9]+$ ]] || fail "Could not resolve the unrelated Node PID"

(
    REPO_ROOT="$scoped_root_for_helper"
    source "$REAL_REPO/scripts/lib/update-processes.sh"
    scoped_inventory="$(list_scoped_node_processes)"
    [[ "$scoped_inventory" == *"$SCOPED_PID"$'\tscoped-node'* ]] ||
        fail "Scoped Node process was not detected"
    [[ "$scoped_inventory" != *"$UNRELATED_PID"$'\t'* ]] ||
        fail "Unrelated Node process was included"
    force_stop_scoped_node_pid "$SCOPED_PID"
)
sleep 1

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        powershell.exe -NoProfile -NonInteractive -Command \
            "if (-not (Get-Process -Id $UNRELATED_PID -ErrorAction SilentlyContinue)) { exit 1 }" ||
            fail "Unrelated Node process was stopped"
        ;;
    *)
        kill -0 "$UNRELATED_PID" >/dev/null 2>&1 || fail "Unrelated Node process was stopped"
        ;;
esac
SCOPED_PID=""
ok "Process ownership is limited to the selected installation"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        sharp_path="$REAL_REPO/command-centre/node_modules/sharp"
        if [[ -d "$sharp_path" ]]; then
            info "Checking detection through the locked Sharp DLL..."
            real_repo_for_helper="$(cygpath -m "$REAL_REPO")"
            baseline="$(
                powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
                    -File "$REAL_REPO/scripts/lib/update-processes.ps1" \
                    -Action List -Root "$real_repo_for_helper"
            )"

            TEST_SHARP_PATH="$(cygpath -m "$sharp_path")" \
                node -e 'require(process.env.TEST_SHARP_PATH); setInterval(() => {}, 1000)' &
            sleep 2

            inventory="$(
                powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
                    -File "$REAL_REPO/scripts/lib/update-processes.ps1" \
                    -Action List -Root "$real_repo_for_helper"
            )"
            new_entry="$(comm -13 \
                <(printf '%s\n' "$baseline" | sort) \
                <(printf '%s\n' "$inventory" | sort) | head -n 1)"
            SCOPED_PID="${new_entry%%$'\t'*}"
            [[ "$SCOPED_PID" =~ ^[0-9]+$ ]] ||
                fail "Sharp DLL owner was not detected from its loaded modules"

            powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
                -File "$REAL_REPO/scripts/lib/update-processes.ps1" \
                -Action Stop -Root "$real_repo_for_helper" -ProcessId "$SCOPED_PID"
            SCOPED_PID=""
            ok "Sharp/libvips DLL owners are detected and released"
        else
            warn "Sharp is not installed; skipping the loaded-DLL integration check."
        fi
        ;;
esac

printf "\n${GREEN}${BOLD}All updater process tests passed.${NC}\n"
