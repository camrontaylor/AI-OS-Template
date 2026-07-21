#!/usr/bin/env python3
"""Read-only Notion Notes health check for AI-OS resource sync."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


NOTES_DATABASE_ID = "19ec6192c26680139071c6f3071a89f8"
NOTES_COLLECTION = "collection://19ec6192-c266-8046-8e22-000ba054e4ea"
NOTION_VERSION = "2022-06-28"
DEFAULT_API_BASE = "https://api.notion.com/v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check Notion Notes reachability.")
    parser.add_argument("--no-memory", action="store_true", help="Do not update context/MEMORY.md.")
    parser.add_argument("--quiet", action="store_true", help="Print only the report path.")
    return parser.parse_args()


def repo_root() -> Path:
    return Path(os.environ.get("AI_OS_DIR", Path(__file__).resolve().parents[1])).resolve()


def report_date() -> str:
    return os.environ.get("AI_OS_NOTION_HEALTH_REPORT_DATE") or datetime.now().strftime("%Y-%m-%d")


def report_path(root: Path) -> Path:
    return root / "projects" / "system-health" / f"{report_date()}_notion-resource-health.md"


def notion_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def classify_http_error(status: int, body: str) -> tuple[str, str]:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        parsed = {}

    code = str(parsed.get("code") or "").strip()
    message = str(parsed.get("message") or body or f"HTTP {status}").strip()

    if code:
        return code, message
    if status == 401:
        return "invalid_api_key", message
    if status == 403:
        return "missing_permission", message
    if status == 404:
        return "object_not_found", message
    return f"http_{status}", message


def query_notes(api_key: str) -> dict[str, Any]:
    api_base = os.environ.get("AI_OS_NOTION_HEALTH_API_BASE", DEFAULT_API_BASE).rstrip("/")
    url = f"{api_base}/databases/{NOTES_DATABASE_ID}/query"
    body = json.dumps({"page_size": 1}).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=notion_headers(api_key), method="POST")

    try:
      with urllib.request.urlopen(request, timeout=30) as response:
          payload = response.read().decode("utf-8")
          return {"ok": True, "data": json.loads(payload)}
    except urllib.error.HTTPError as exc:
      detail = exc.read().decode("utf-8", errors="replace")
      error_class, message = classify_http_error(exc.code, detail)
      return {"ok": False, "error_class": error_class, "message": message}
    except (urllib.error.URLError, TimeoutError) as exc:
      return {"ok": False, "error_class": "network_error", "message": str(exc)}


def plain_text(parts: list[dict[str, Any]]) -> str:
    return "".join(str(part.get("plain_text") or "") for part in parts).strip()


def property_title(page: dict[str, Any]) -> str:
    for prop in page.get("properties", {}).values():
        if prop.get("type") == "title":
            return plain_text(prop.get("title") or [])
    return ""


def property_status(page: dict[str, Any]) -> str:
    for prop in page.get("properties", {}).values():
        prop_type = prop.get("type")
        if prop_type == "status" and prop.get("status"):
            return str(prop["status"].get("name") or "")
        if prop_type == "select" and prop.get("select"):
            return str(prop["select"].get("name") or "")
        if prop_type == "rich_text":
            value = plain_text(prop.get("rich_text") or [])
            if value:
                return value
    return ""


def write_report(root: Path, result: dict[str, Any]) -> Path:
    path = report_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)

    query = f'SELECT id, Name, Status FROM "{NOTES_COLLECTION}" LIMIT 1'
    lines = [
        f"# Notion Resource Health - {report_date()}",
        "",
        f"Status: {'OK' if result['ok'] else 'BLOCKED'}",
        "",
        "## Target",
        "",
        f"- Data source: `{NOTES_COLLECTION}`",
        "- Title: Notes",
        f"- Database ID (REST API): `{NOTES_DATABASE_ID}`",
        "",
        "## Readiness Proof",
        "",
        f"Query attempted: `{query}`",
        "",
    ]

    if result["ok"]:
        rows = result["data"].get("results", [])
        row_count = len(rows)
        lines.extend([
            "Query status: **Succeeded**",
            "",
            f"Row count returned: `{row_count}`",
        ])
        # Never echo row content into the report: Notion rows can hold
        # credentials, and this report sits on the autosave commit path.
        if rows:
            lines.append("- Sample row fetched successfully (content not shown)")
        lines.extend([
            "",
            "## Resource Sync Readiness",
            "",
            "Queued resource sync can safely query this data source.",
        ])
    else:
        lines.extend([
            "Query status: **Failed**",
            "",
            f"Error class: `{result['error_class']}`",
            "",
            f"Error message: {result['message']}",
            "",
            "## Resource Sync Readiness",
            "",
            "**Queued resource sync is BLOCKED.** Cannot proceed with resource processing until Notion access is restored.",
            "",
            "## Fix Required",
            "",
            "1. Ensure `NOTION_API_KEY` is available to the cron subprocess environment.",
            "2. Ensure the Notes database is shared with the Notion integration behind that key.",
            "3. Rerun `bash scripts/run-job.sh notion-resource-health` and confirm this report says `Status: OK`.",
        ])

    lines.extend([
        "",
        "## Boundary",
        "",
        "This check did not create, update, or delete any Notion pages.",
        "",
    ])

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def update_memory(root: Path, result: dict[str, Any]) -> None:
    memory_path = root / "context" / "MEMORY.md"
    if result["ok"] or not memory_path.exists():
        return

    text = memory_path.read_text(encoding="utf-8", errors="replace")
    line = (
        f"- **NOTION BLOCKER ({report_date()}):** Cron Notion jobs cannot reach the Notes "
        f"data source: `{result['error_class']}`. Fix Notion key/share access before resource sync."
    )
    output_lines = []
    inserted = False
    for existing in text.splitlines():
        if "**NOTION BLOCKER" in existing or "NOTION RESOURCE SYNC BLOCKED" in existing:
            if not inserted:
                output_lines.append(line)
                inserted = True
            continue
        output_lines.append(existing)

    if not inserted:
        for index, existing in enumerate(output_lines):
            if existing.strip() == "## Active Threads":
                output_lines.insert(index + 1, line)
                inserted = True
                break

    if inserted:
        memory_path.write_text("\n".join(output_lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    root = repo_root()
    api_key = os.environ.get("NOTION_API_KEY", "").strip()

    if not api_key:
        result = {
            "ok": False,
            "error_class": "missing_api_key",
            "message": "NOTION_API_KEY not found in the cron subprocess environment",
        }
    else:
        result = query_notes(api_key)

    path = write_report(root, result)
    if not args.no_memory:
        update_memory(root, result)

    if args.quiet:
        print(path)
    else:
        print(f"Notion Resource Health: {'OK' if result['ok'] else 'BLOCKED'}")
        print(f"Report: {path}")
        if not result["ok"]:
            print(f"Error class: {result['error_class']}")

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
