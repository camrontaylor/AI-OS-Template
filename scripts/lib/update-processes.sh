#!/usr/bin/env bash
# Safe Command Centre shutdown and background-service recovery for update.sh.
# This file is sourced after scripts/lib/python.sh has resolved PYTHON_CMD.

UPDATE_PROCESS_STATE_CAPTURED="${UPDATE_PROCESS_STATE_CAPTURED:-false}"
UPDATE_PROCESS_PREPARED="${UPDATE_PROCESS_PREPARED:-false}"
UPDATE_BACKGROUND_RESTORED="${UPDATE_BACKGROUND_RESTORED:-false}"
UPDATE_MEMORY_WATCH_WAS_RUNNING="${UPDATE_MEMORY_WATCH_WAS_RUNNING:-false}"
UPDATE_CRON_WAS_RUNNING="${UPDATE_CRON_WAS_RUNNING:-false}"
UPDATE_COMMAND_CENTRE_WAS_RUNNING="${UPDATE_COMMAND_CENTRE_WAS_RUNNING:-false}"
UPDATE_PROCESSES_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_PROCESSES_POWERSHELL="$UPDATE_PROCESSES_LIB_DIR/update-processes.ps1"

scan_active_update_tasks() {
    "${PYTHON_CMD[@]}" - "$REPO_ROOT" <<'PYEOF'
import sqlite3
import sys
from pathlib import Path

root = Path(sys.argv[1])
data_root = root / ".command-centre"
databases = [data_root / "data.db"]
profiles_root = data_root / "profiles"
if profiles_root.is_dir():
    databases.extend(sorted(profiles_root.glob("*/data.db")))

active = []
for database in databases:
    if not database.is_file():
        continue
    try:
        connection = sqlite3.connect(str(database), timeout=2)
        try:
            connection.execute("PRAGMA query_only = ON")
            has_tasks = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'"
            ).fetchone()
            if not has_tasks:
                continue
            rows = connection.execute(
                """
                SELECT id, title, status
                FROM tasks
                WHERE status IN ('queued', 'running')
                ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END
                """
            ).fetchall()
            profile = "solo" if database == data_root / "data.db" else database.parent.name[:12]
            for task_id, title, status in rows:
                clean_title = " ".join(str(title or "Untitled task").split())
                active.append((profile, str(status), str(task_id), clean_title))
        finally:
            connection.close()
    except sqlite3.Error as error:
        print(f"Could not inspect task database {database}: {error}", file=sys.stderr)
        raise SystemExit(2)

for profile, status, task_id, title in active:
    print(f"{profile}\t{status}\t{task_id}\t{title}")
PYEOF
}

assert_no_active_update_tasks() {
    local active_output=""
    local scan_status=0

    set +e
    active_output="$(scan_active_update_tasks)"
    scan_status=$?
    set -e

    if [[ $scan_status -ne 0 ]]; then
        warn "Could not verify whether Command Centre has active tasks."
        warn "The update was stopped before changing files or processes."
        return 1
    fi

    if [[ -n "$active_output" ]]; then
        echo ""
        printf "${YELLOW}${BOLD}Command Centre has active work${NC}\n"
        warn "Finish or cancel these queued/running tasks before updating:"
        while IFS=$'\t' read -r profile status task_id title; do
            [[ -n "$task_id" ]] || continue
            bullet "${title} ${DIM}(${status}, ${profile}, ${task_id})${NC}"
        done <<< "$active_output"
        echo ""
        info "Nothing was changed and no processes were stopped."
        return 1
    fi

    return 0
}

list_scoped_node_processes_windows() {
    if [[ ! -f "$UPDATE_PROCESSES_POWERSHELL" ]]; then
        warn "Windows process helper was not found: $UPDATE_PROCESSES_POWERSHELL"
        return 1
    fi
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
        -File "$UPDATE_PROCESSES_POWERSHELL" -Action List -Root "$REPO_ROOT" |
        tr -d '\r'
}

list_scoped_node_processes_unix() {
    local command_centre_prefix="${REPO_ROOT%/}/command-centre/"
    local pid args role

    ps -eo pid=,args= 2>/dev/null | while read -r pid args; do
        [[ "$pid" =~ ^[0-9]+$ ]] || continue
        [[ "$args" == *"$command_centre_prefix"* ]] || continue

        role="scoped-node"
        case "$args" in
            *"/memory-watch.cjs"*) role="memory-watcher" ;;
            *"/cron-daemon.cjs"*) role="cron" ;;
            *"/next-run.cjs"*|*"/node_modules/next/dist/bin/next"*) role="command-centre" ;;
        esac
        printf '%s\t%s\n' "$pid" "$role"
    done
}

list_scoped_node_processes() {
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) list_scoped_node_processes_windows ;;
        *) list_scoped_node_processes_unix ;;
    esac
}

scoped_process_is_running() {
    local target_pid="$1"
    local processes=""
    processes="$(list_scoped_node_processes)" || return 2
    printf '%s\n' "$processes" |
        awk -F '\t' -v pid="$target_pid" '$1 == pid { found = 1 } END { exit !found }'
}

force_stop_scoped_node_pid() {
    local target_pid="$1"
    local ownership_status=0

    set +e
    scoped_process_is_running "$target_pid"
    ownership_status=$?
    set -e
    if [[ $ownership_status -eq 1 ]]; then
        return 0
    fi
    [[ $ownership_status -eq 0 ]] || return 1

    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
                -File "$UPDATE_PROCESSES_POWERSHELL" -Action Stop -Root "$REPO_ROOT" -ProcessId "$target_pid" \
                >/dev/null 2>&1
            ;;
        *)
            kill -TERM "$target_pid" >/dev/null 2>&1 || true
            local attempt target_status
            for attempt in 1 2 3 4 5; do
                set +e
                scoped_process_is_running "$target_pid"
                target_status=$?
                set -e
                [[ $target_status -eq 1 ]] && return 0
                [[ $target_status -eq 0 ]] || return 1
                sleep 1
            done
            kill -KILL "$target_pid" >/dev/null 2>&1
            ;;
    esac
}

stop_memory_watcher_for_update() {
    local helper="$REPO_ROOT/command-centre/scripts/memory-watch-stop.cjs"
    [[ -f "$helper" ]] || return 0
    AI_OS_DIR="$REPO_ROOT" node "$helper"
}

stop_cron_for_update() {
    local helper="$REPO_ROOT/command-centre/scripts/cron-daemon.cjs"
    [[ -f "$helper" ]] || return 0
    AI_OS_DIR="$REPO_ROOT" node "$helper" stop
}

wait_for_scoped_nodes_to_stop() {
    local attempt processes
    for attempt in 1 2 3 4 5 6 7 8; do
        processes="$(list_scoped_node_processes)" || return 1
        [[ -z "$processes" ]] && return 0
        sleep 1
    done
    processes="$(list_scoped_node_processes)" || return 1
    [[ -z "$processes" ]]
}

capture_update_process_state() {
    local processes="$1"
    UPDATE_PROCESS_STATE_CAPTURED=true

    if printf '%s\n' "$processes" | awk -F '\t' '$2 == "memory-watcher" { found = 1 } END { exit !found }'; then
        UPDATE_MEMORY_WATCH_WAS_RUNNING=true
    fi
    if printf '%s\n' "$processes" | awk -F '\t' '$2 == "cron" { found = 1 } END { exit !found }'; then
        UPDATE_CRON_WAS_RUNNING=true
    fi
    if printf '%s\n' "$processes" | awk -F '\t' '$2 == "command-centre" { found = 1 } END { exit !found }'; then
        UPDATE_COMMAND_CENTRE_WAS_RUNNING=true
    fi
}

prepare_update_processes() {
    local processes remaining pid role

    [[ "$UPDATE_PROCESS_PREPARED" == true ]] && return 0

    echo ""
    info "Preparing Command Centre for a safe update..."
    assert_no_active_update_tasks || return 1

    if ! processes="$(list_scoped_node_processes)"; then
        warn "Could not inspect Command Centre processes safely."
        warn "The update was stopped before changing repository files."
        return 1
    fi
    capture_update_process_state "$processes"

    if [[ -z "$processes" ]]; then
        UPDATE_PROCESS_PREPARED=true
        ok "Command Centre processes: already stopped"
        return 0
    fi

    if [[ "$UPDATE_MEMORY_WATCH_WAS_RUNNING" == true ]]; then
        stop_memory_watcher_for_update || warn "The memory watcher did not stop gracefully; a scoped stop will be attempted."
    elif [[ -f "$REPO_ROOT/.command-centre/memory.watch.lock/pid" ]]; then
        stop_memory_watcher_for_update || true
    fi

    if [[ "$UPDATE_CRON_WAS_RUNNING" == true ]]; then
        stop_cron_for_update || warn "The cron daemon did not stop gracefully; a scoped stop will be attempted."
    fi

    if ! remaining="$(list_scoped_node_processes)"; then
        warn "Could not verify Command Centre process ownership after graceful shutdown."
        return 1
    fi
    while IFS=$'\t' read -r pid role; do
        [[ "$pid" =~ ^[0-9]+$ ]] || continue
        if ! force_stop_scoped_node_pid "$pid"; then
            warn "Could not safely stop Command Centre process PID $pid."
            return 1
        fi
    done <<< "$remaining"

    if ! wait_for_scoped_nodes_to_stop; then
        warn "A Command Centre process from this installation is still running."
        warn "The update was stopped before changing repository files."
        return 1
    fi

    UPDATE_PROCESS_PREPARED=true
    ok "Command Centre processes: stopped"
    return 0
}

restart_memory_watcher_after_update() {
    local hook="$REPO_ROOT/.claude/hooks/memory-watch-start.js"
    [[ -f "$hook" ]] || return 1
    CLAUDE_PROJECT_DIR="$REPO_ROOT" AI_OS_DIR="$REPO_ROOT" node "$hook" </dev/null
}

restart_cron_after_update() {
    local helper="$REPO_ROOT/command-centre/scripts/cron-daemon.cjs"
    [[ -f "$helper" ]] || return 1
    AI_OS_DIR="$REPO_ROOT" node "$helper" start
}

restore_update_background_services() {
    local exit_status="${1:-0}"
    local restore_failed=false

    [[ "$UPDATE_PROCESS_STATE_CAPTURED" == true ]] || return 0
    [[ "$UPDATE_BACKGROUND_RESTORED" != true ]] || return 0
    UPDATE_BACKGROUND_RESTORED=true

    if [[ "$UPDATE_MEMORY_WATCH_WAS_RUNNING" == true ]]; then
        if restart_memory_watcher_after_update >/dev/null 2>&1; then
            ok "Memory watcher restarted"
        else
            restore_failed=true
            warn "The memory watcher could not be restarted automatically."
        fi
    fi

    if [[ "$UPDATE_CRON_WAS_RUNNING" == true ]]; then
        if restart_cron_after_update >/dev/null 2>&1; then
            ok "Cron daemon restarted"
        else
            restore_failed=true
            warn "The cron daemon could not be restarted automatically."
        fi
    fi

    if [[ "$UPDATE_COMMAND_CENTRE_WAS_RUNNING" == true ]]; then
        echo ""
        if [[ "$exit_status" -eq 0 ]]; then
            info "Command Centre was closed for the update. Reopen it when you're ready."
        else
            warn "Command Centre was closed before the update failed. Reopen it when you're ready."
        fi
    fi

    [[ "$restore_failed" == false ]]
}
