#!/usr/bin/env python3
"""Filter memory search results by AI-OS workspace scope."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def source_for(item: dict[str, Any]) -> str:
    return str(item.get("source") or item.get("source_path") or item.get("path") or "")


def rel_source(source: str, root: Path) -> str:
    if not source:
        return ""
    path = Path(source).expanduser()
    try:
        if path.is_absolute():
            return path.resolve().relative_to(root).as_posix()
    except (OSError, ValueError):
        pass
    return source.replace("\\", "/").lstrip("./")


def include(rel: str, scope: str, client: str) -> bool:
    if scope == "all":
        return True
    if scope == "root":
        return not rel.startswith("clients/")
    if scope == "clients":
        return rel.startswith("clients/")
    if scope == "client":
        return bool(client) and rel.startswith(f"clients/{client}/")
    return True


def main() -> int:
    if len(sys.argv) != 5:
        print("Usage: filter-memory-results.py ROOT SCOPE CLIENT JSON_FILE", file=sys.stderr)
        return 64

    root = Path(sys.argv[1]).expanduser().resolve()
    scope = sys.argv[2]
    client = sys.argv[3]
    json_file = Path(sys.argv[4])

    try:
        data = json.loads(json_file.read_text(encoding="utf-8"))
    except Exception:
        print("[]")
        return 0

    if not isinstance(data, list):
        print("[]")
        return 0

    filtered = [
        item
        for item in data
        if isinstance(item, dict) and include(rel_source(source_for(item), root), scope, client)
    ]
    print(json.dumps(filtered, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
