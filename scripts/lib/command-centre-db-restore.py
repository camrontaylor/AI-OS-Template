#!/usr/bin/env python3
"""Restore Command Centre SQLite data from an older AI-OS install."""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


DB_FILES = ("data.db", "data.db-wal", "data.db-shm")
DURABLE_TABLES = (
    "tasks",
    "conversations",
    "projects",
    "cron_runs",
    "task_logs",
    "task_outputs",
    "approval_requests",
    "messages",
    "agent_decisions",
)


def info(message: str) -> None:
    print(message)


def warn(message: str) -> None:
    print(f"[!] {message}")


def fail(message: str) -> None:
    print(f"[X] {message}", file=sys.stderr)
    raise SystemExit(1)


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def resolve_install_path(value: str) -> Path:
    return Path(value).expanduser().resolve()


def command_centre_dir(install_path: Path) -> Path:
    return install_path / ".command-centre"


def database_path(install_path: Path) -> Path:
    return command_centre_dir(install_path) / "data.db"


def validate_old_install(old_install: Path) -> Path:
    old_db = database_path(old_install)
    if not old_install.exists():
        fail(f"Old install path does not exist: {old_install}")
    if not old_db.exists():
        fail(f"Old Command Centre database was not found: {old_db}")
    return old_db


def checkpoint_old_database(old_db: Path) -> None:
    try:
        with sqlite3.connect(str(old_db)) as connection:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        info("Checkpointed old Command Centre database.")
    except sqlite3.Error as error:
        warn(f"Could not checkpoint the old database; continuing with file restore: {error}")


def backup_existing_target(target_dir: Path, backup_root: Path) -> Path | None:
    existing = [target_dir / name for name in DB_FILES if (target_dir / name).exists()]
    if not existing:
        return None

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_dir = backup_root / f"command-centre-db-{timestamp}"
    suffix = 2
    while backup_dir.exists():
        backup_dir = backup_root / f"command-centre-db-{timestamp}-{suffix}"
        suffix += 1
    backup_dir.mkdir(parents=True, exist_ok=False)

    for file_path in existing:
        shutil.copy2(file_path, backup_dir / file_path.name)

    info(f"Backed up existing Command Centre database files to: {backup_dir}")
    return backup_dir


def copy_database_files(old_dir: Path, target_dir: Path) -> list[str]:
    copied: list[str] = []
    for name in DB_FILES:
        source = old_dir / name
        if not source.exists():
            continue
        shutil.copy2(source, target_dir / name)
        copied.append(name)
    return copied


def table_exists(connection: sqlite3.Connection, schema: str, table: str) -> bool:
    schema_sql = quote_identifier(schema)
    row = connection.execute(
        f"SELECT 1 FROM {schema_sql}.sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def table_columns(connection: sqlite3.Connection, schema: str, table: str) -> list[str]:
    schema_sql = quote_identifier(schema)
    rows = connection.execute(f"PRAGMA {schema_sql}.table_info({quote_identifier(table)})").fetchall()
    return [str(row[1]) for row in rows]


def has_durable_tables(target_db: Path) -> bool:
    if not target_db.exists() or target_db.stat().st_size == 0:
        return False
    try:
        with sqlite3.connect(str(target_db)) as connection:
            return any(table_exists(connection, "main", table) for table in DURABLE_TABLES)
    except sqlite3.Error:
        return False


def import_table(connection: sqlite3.Connection, table: str) -> int:
    if not table_exists(connection, "old_db", table):
        return 0
    if not table_exists(connection, "main", table):
        return 0

    old_columns = set(table_columns(connection, "old_db", table))
    target_columns = table_columns(connection, "main", table)
    shared_columns = [column for column in target_columns if column in old_columns]
    if not shared_columns:
        return 0

    table_sql = quote_identifier(table)
    columns_sql = ", ".join(quote_identifier(column) for column in shared_columns)
    before = connection.total_changes
    connection.execute(
        f"INSERT OR REPLACE INTO {table_sql} ({columns_sql}) "
        f"SELECT {columns_sql} FROM old_db.{table_sql}"
    )
    return connection.total_changes - before


def import_database_rows(old_db: Path, target_db: Path) -> dict[str, int]:
    imported: dict[str, int] = {}
    connection = sqlite3.connect(str(target_db))
    attached = False
    began = False
    try:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("ATTACH DATABASE ? AS old_db", (str(old_db),))
        attached = True
        connection.execute("BEGIN")
        began = True
        for table in DURABLE_TABLES:
            count = import_table(connection, table)
            if count:
                imported[table] = count
        connection.execute("COMMIT")
        began = False
    except Exception:
        if began:
            connection.execute("ROLLBACK")
        raise
    finally:
        if attached:
            connection.execute("DETACH DATABASE old_db")
        connection.close()
    return imported


def restore_command_centre_database(old_install: Path, new_install: Path) -> None:
    if old_install == new_install:
        fail("Old install path and new install path must be different.")

    old_db = validate_old_install(old_install)
    old_dir = command_centre_dir(old_install)
    target_dir = command_centre_dir(new_install)
    target_db = target_dir / "data.db"

    target_dir.mkdir(parents=True, exist_ok=True)
    backup_existing_target(target_dir, new_install / ".backup")
    checkpoint_old_database(old_db)

    if has_durable_tables(target_db):
        imported = import_database_rows(old_db, target_db)
        if imported:
            summary = ", ".join(f"{table}: {count}" for table, count in imported.items())
            info(f"Imported Command Centre rows into existing database ({summary}).")
        else:
            warn("Target database exists, but no shared durable rows were imported.")
        return

    copied = copy_database_files(old_dir, target_dir)
    if "data.db" not in copied:
        fail("Restore failed because data.db was not copied.")
    missing = [name for name in DB_FILES if name not in copied]
    if missing:
        warn(f"Optional database sidecar file(s) not present in old install: {', '.join(missing)}")
    info(f"Copied Command Centre database files: {', '.join(copied)}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Restore Command Centre database files from an older AI-OS install."
    )
    parser.add_argument("--old-install", required=True, help="Path to the old AI-OS install.")
    parser.add_argument(
        "--new-install",
        default=".",
        help="Path to the new AI-OS install. Defaults to the current directory.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    old_install = resolve_install_path(args.old_install)
    new_install = resolve_install_path(args.new_install)

    info("Restoring Command Centre history...")
    restore_command_centre_database(old_install, new_install)
    info("Done. Relaunch Command Centre to see restored history.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
