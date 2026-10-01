#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

source "$SCRIPT_DIR/lib/python.sh"
if ! resolve_python_cmd; then
    echo "Python 3 is required for this test." >&2
    exit 1
fi

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/AI-OS-db-restore.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_exists() {
    [[ -e "$1" ]] || fail "Expected path to exist: $1"
}

assert_not_exists() {
    [[ ! -e "$1" ]] || fail "Expected path not to exist: $1"
}

create_old_db() {
    local db_path="$1"
    "${PYTHON_CMD[@]}" - "$db_path" <<'PY'
import sqlite3
import sys

db_path = sys.argv[1]
connection = sqlite3.connect(db_path)
connection.executescript(
    """
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      level TEXT NOT NULL DEFAULT 'task',
      parentId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE task_logs (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE task_outputs (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      filePath TEXT NOT NULL,
      relativePath TEXT NOT NULL,
      extension TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL
    );
    """
)
connection.execute(
    "INSERT INTO tasks (id, title, status, level, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    ("goal-1", "Restored goal", "backlog", "project", "2026-06-05", "2026-06-05"),
)
connection.execute(
    "INSERT INTO tasks (id, title, status, level, parentId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ("task-1", "Restored child", "done", "task", "goal-1", "2026-06-05", "2026-06-05"),
)
connection.execute(
    "INSERT INTO task_logs (id, taskId, type, timestamp, content) VALUES (?, ?, ?, ?, ?)",
    ("log-1", "task-1", "text", "2026-06-05", "restored activity"),
)
connection.execute(
    "INSERT INTO task_outputs (id, taskId, fileName, filePath, relativePath, extension, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ("output-1", "task-1", "result.md", "/tmp/result.md", "result.md", ".md", "2026-06-05"),
)
connection.commit()
connection.close()
PY
}

create_target_db() {
    local db_path="$1"
    "${PYTHON_CMD[@]}" - "$db_path" <<'PY'
import sqlite3
import sys

db_path = sys.argv[1]
connection = sqlite3.connect(db_path)
connection.executescript(
    """
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      level TEXT NOT NULL DEFAULT 'task',
      parentId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      restoredAt TEXT DEFAULT 'target-default'
    );
    CREATE TABLE task_logs (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      isCollapsed INTEGER DEFAULT 0
    );
    CREATE TABLE task_outputs (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      filePath TEXT NOT NULL,
      relativePath TEXT NOT NULL,
      extension TEXT NOT NULL DEFAULT '',
      sizeBytes INTEGER,
      createdAt TEXT NOT NULL
    );
    """
)
connection.execute(
    "INSERT INTO tasks (id, title, status, level, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    ("existing-1", "Existing target goal", "backlog", "task", "2026-06-05", "2026-06-05"),
)
connection.commit()
connection.close()
PY
}

assert_row_count() {
    local db_path="$1"
    local sql="$2"
    local expected="$3"
    local actual
    actual="$("${PYTHON_CMD[@]}" - "$db_path" "$sql" <<'PY'
import sqlite3
import sys

db_path, sql = sys.argv[1], sys.argv[2]
connection = sqlite3.connect(db_path)
print(connection.execute(sql).fetchone()[0])
connection.close()
PY
)"
    [[ "$actual" == "$expected" ]] || fail "Expected '$sql' to return $expected, got $actual"
}

run_restore() {
    local old_install="$1"
    local new_install="$2"
    "${PYTHON_CMD[@]}" "$REPO_ROOT/scripts/lib/command-centre-db-restore.py" \
        --old-install "$old_install" \
        --new-install "$new_install" >/dev/null
}

test_fresh_target_copies_only_database_files() {
    local old_install="$TEST_ROOT/fresh-old"
    local new_install="$TEST_ROOT/fresh-new"
    mkdir -p "$old_install/.command-centre" "$new_install"
    create_old_db "$old_install/.command-centre/data.db"
    printf "3000\n" > "$old_install/.command-centre/port"
    printf "{}\n" > "$old_install/.command-centre/launcher-state.json"

    run_restore "$old_install" "$new_install"

    assert_exists "$new_install/.command-centre/data.db"
    assert_not_exists "$new_install/.command-centre/port"
    assert_not_exists "$new_install/.command-centre/launcher-state.json"
    assert_row_count "$new_install/.command-centre/data.db" "SELECT COUNT(*) FROM tasks" "2"
    assert_row_count "$new_install/.command-centre/data.db" "SELECT COUNT(*) FROM task_logs" "1"
    assert_row_count "$new_install/.command-centre/data.db" "SELECT COUNT(*) FROM task_outputs" "1"
}

test_existing_target_is_backed_up_and_imported() {
    local old_install="$TEST_ROOT/import-old"
    local new_install="$TEST_ROOT/import-new"
    mkdir -p "$old_install/.command-centre" "$new_install/.command-centre"
    create_old_db "$old_install/.command-centre/data.db"
    create_target_db "$new_install/.command-centre/data.db"

    run_restore "$old_install" "$new_install"

    assert_exists "$(find "$new_install/.backup" -path '*/data.db' -print -quit)"
    assert_row_count "$new_install/.command-centre/data.db" "SELECT COUNT(*) FROM tasks" "3"
    assert_row_count "$new_install/.command-centre/data.db" "SELECT COUNT(*) FROM tasks WHERE restoredAt = 'target-default'" "3"
    assert_row_count "$new_install/.command-centre/data.db" "SELECT COUNT(*) FROM task_logs" "1"
    assert_row_count "$new_install/.command-centre/data.db" "SELECT COUNT(*) FROM task_outputs" "1"
}

test_missing_sidecars_are_optional() {
    local old_install="$TEST_ROOT/sidecar-old"
    local new_install="$TEST_ROOT/sidecar-new"
    mkdir -p "$old_install/.command-centre" "$new_install"
    create_old_db "$old_install/.command-centre/data.db"

    run_restore "$old_install" "$new_install"

    assert_exists "$new_install/.command-centre/data.db"
    assert_not_exists "$new_install/.command-centre/data.db-wal"
    assert_not_exists "$new_install/.command-centre/data.db-shm"
}

test_fresh_target_copies_only_database_files
test_existing_target_is_backed_up_and_imported
test_missing_sidecars_are_optional

echo "Command Centre DB restore tests passed."
