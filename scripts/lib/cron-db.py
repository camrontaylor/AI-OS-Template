#!/usr/bin/env python3

import json
import sqlite3
import sys
import uuid
from pathlib import Path

DELIVERABLE_EXTENSIONS = {
    "md",
    "txt",
    "pdf",
    "csv",
    "json",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "webp",
    "mp4",
    "mp3",
    "wav",
    "html",
    "xml",
}


def load_payload() -> tuple[str, dict]:
    if len(sys.argv) not in {2, 3} or sys.argv[1] not in {"start", "finish"}:
        raise SystemExit("usage: cron-db.py <start|finish> [payload_file]")

    if len(sys.argv) == 3:
        with open(sys.argv[2], "r", encoding="utf-8-sig") as f:
            return sys.argv[1], json.load(f)

    return sys.argv[1], json.load(sys.stdin)


def connect(db_path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def insert_start(payload: dict) -> dict:
    task_id = str(uuid.uuid4())

    with connect(payload["db_path"]) as connection:
        cursor = connection.cursor()
        cursor.execute(
            "INSERT INTO cron_runs (jobSlug, startedAt, result) VALUES (?, ?, 'running')",
            (payload["job_slug"], payload["started_at"]),
        )
        cron_run_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO tasks (
              id, title, description, status, level, columnOrder,
              createdAt, updatedAt, startedAt, cronJobSlug
            ) VALUES (?, ?, ?, 'running', 'task', 0, ?, ?, ?, ?)
            """,
            (
                task_id,
                payload["job_name"],
                payload.get("description") or "Scheduled cron job",
                payload["started_at"],
                payload["started_at"],
                payload["started_at"],
                payload["job_slug"],
            ),
        )
        connection.commit()

    return {"taskId": task_id, "cronRunId": cron_run_id}


def record_outputs(connection: sqlite3.Connection, payload: dict) -> None:
    project_dir = Path(payload["project_dir"])
    projects_dir = project_dir / "projects"
    if not projects_dir.exists():
        return

    start_epoch = int(payload["start_epoch"]) - 2
    end_epoch = int(payload["end_epoch"]) + 2
    task_id = payload["task_id"]
    completed_at = payload["completed_at"]

    for file_path in projects_dir.rglob("*"):
        if not file_path.is_file():
            continue

        relative = file_path.relative_to(project_dir).as_posix()
        # Ignore the old in-project Command Centre location if a user still has
        # that legacy folder after updating.
        if "/briefs/command-centre/" in relative or "/node_modules/" in relative:
            continue
        if any(part.startswith(".") for part in file_path.relative_to(project_dir).parts):
            continue

        extension = file_path.suffix.lower().lstrip(".")
        if extension not in DELIVERABLE_EXTENSIONS:
            continue

        modified_epoch = int(file_path.stat().st_mtime)
        if modified_epoch < start_epoch or modified_epoch > end_epoch:
            continue

        already_recorded = connection.execute(
            "SELECT 1 FROM task_outputs WHERE filePath = ? LIMIT 1",
            (str(file_path),),
        ).fetchone()
        if already_recorded:
            continue

        connection.execute(
            """
            INSERT INTO task_outputs (
              id, taskId, fileName, filePath, relativePath, extension, sizeBytes, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                task_id,
                file_path.name,
                str(file_path),
                relative,
                extension,
                file_path.stat().st_size,
                completed_at,
            ),
        )


def update_finish(payload: dict) -> dict:
    result = payload["result"]
    task_status = "done" if result == "success" else "review"
    error_message = None
    if result == "timeout":
        error_message = f"Timed out after {payload['timeout']}"
    elif result != "success":
        error_message = f"Exit code {payload['exit_code']}"

    with connect(payload["db_path"]) as connection:
        cursor = connection.cursor()
        updated = cursor.execute(
            """
            UPDATE cron_runs
            SET taskId = COALESCE(taskId, ?),
                completedAt = ?,
                result = ?,
                durationSec = ?,
                exitCode = ?,
                trigger = COALESCE(trigger, 'scheduled')
            WHERE id = ?
            """,
            (
                payload["task_id"],
                payload["completed_at"],
                result,
                payload["duration_sec"],
                payload["exit_code"],
                payload["cron_run_id"],
            ),
        ).rowcount

        if updated == 0:
            cursor.execute(
                """
                INSERT INTO cron_runs (
                  jobSlug, taskId, startedAt, completedAt, result, durationSec, exitCode, trigger
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')
                """,
                (
                    payload["job_slug"],
                    payload["task_id"],
                    payload["started_at"],
                    payload["completed_at"],
                    result,
                    payload["duration_sec"],
                    payload["exit_code"],
                ),
            )

        cursor.execute(
            """
            UPDATE tasks
            SET status = ?,
                completedAt = ?,
                updatedAt = ?,
                durationMs = ?,
                errorMessage = ?
            WHERE id = ?
            """,
            (
                task_status,
                payload["completed_at"],
                payload["completed_at"],
                int(payload["duration_sec"]) * 1000,
                error_message,
                payload["task_id"],
            ),
        )

        record_outputs(connection, payload)
        connection.commit()

    return {"updated": True}


def main() -> None:
    action, payload = load_payload()
    if action == "start":
        result = insert_start(payload)
    else:
        result = update_finish(payload)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
