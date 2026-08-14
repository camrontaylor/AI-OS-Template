#!/usr/bin/env python3
"""
Poll Notion Notes database for entries with Status = "Queued".
Used by the daily resource-sync cron job and manually.

Usage:
  python3 notion-poll.py                          # human-readable list
  python3 notion-poll.py --json                   # machine-readable JSON for cron
  python3 notion-poll.py --mark-ready <page-id>   # update status after processing
"""

import os
import sys
import json
import urllib.request
import urllib.error
import argparse
import re

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"
# Raw Notion API UUID for the Notes database
# Page URL: https://app.notion.com/p/19ec6192c26680139071c6f3071a89f8
# MCP collection URL: collection://19ec6192-c266-8046-8e22-000ba054e4ea
DB_ID = "19ec6192-c266-8013-9071-c6f3071a89f8"

YOUTUBE_PATTERN = re.compile(r"(youtube\.com|youtu\.be)", re.IGNORECASE)


def _get_token() -> str:
    token = os.environ.get("NOTION_API_KEY", "")
    if not token:
        # Walk up from scripts/ to find .env at repo root
        base = os.path.dirname(__file__)
        for _ in range(6):
            candidate = os.path.join(base, ".env")
            if os.path.isfile(candidate):
                with open(candidate) as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("NOTION_API_KEY="):
                            token = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
            base = os.path.dirname(base)
    if not token:
        sys.exit("NOTION_API_KEY not found in environment or .env file.")
    return token


def _request(method: str, path: str, body=None, token: str = "") -> dict:
    url = f"{NOTION_API}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        sys.exit(f"Notion API error {e.code}: {body_text}")


def query_queued(token: str) -> list:
    payload = {
        "filter": {
            "property": "Status",
            "status": {"equals": "Queued"},
        },
        "sorts": [{"timestamp": "created_time", "direction": "ascending"}],
        "page_size": 50,
    }
    result = _request("POST", f"/databases/{DB_ID}/query", payload, token)
    return result.get("results", [])


def extract_url(page: dict) -> str:
    return page.get("properties", {}).get("URL", {}).get("url", "") or ""


def extract_name(page: dict) -> str:
    parts = page.get("properties", {}).get("Name", {}).get("title", [])
    return "".join(p.get("plain_text", "") for p in parts) or "(untitled)"


def is_youtube(url: str) -> bool:
    return bool(YOUTUBE_PATTERN.search(url))


def update_status(page_id: str, status: str, token: str) -> None:
    payload = {"properties": {"Status": {"status": {"name": status}}}}
    _request("PATCH", f"/pages/{page_id}", payload, token)
    print(f"Updated {page_id} -> {status}")


def main():
    parser = argparse.ArgumentParser(description="Poll Notion Notes for queued resources")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON (for cron use)")
    parser.add_argument("--mark-ready", metavar="PAGE_ID", help="Set a page status to Ready")
    args = parser.parse_args()

    token = _get_token()

    if args.mark_ready:
        update_status(args.mark_ready, "Ready", token)
        return

    pages = query_queued(token)

    if args.json:
        items = []
        for page in pages:
            url = extract_url(page)
            items.append({
                "id": page["id"],
                "name": extract_name(page),
                "url": url,
                "type": "youtube" if is_youtube(url) else "web",
                "notion_url": f"https://notion.so/{page['id'].replace('-', '')}",
            })
        print(json.dumps(items, indent=2))
        return

    if not pages:
        print("No queued resources in Notion Notes.")
        return

    print(f"Found {len(pages)} queued resource(s):\n")
    for page in pages:
        pid = page["id"]
        name = extract_name(page)
        url = extract_url(page)
        resource_type = "youtube" if is_youtube(url) else "web"
        notion_url = f"https://notion.so/{pid.replace('-', '')}"
        print(f"  [{name}] ({resource_type})")
        print(f"    URL:    {url or '(no URL set)'}")
        print(f"    Notion: {notion_url}")
        if url:
            skill = "/youtube" if resource_type == "youtube" else "/resources"
            print(f"    Run:    {skill} {url}")
        else:
            print(f"    Action: open in Notion and add URL first")
        print()


if __name__ == "__main__":
    main()
