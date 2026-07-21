#!/usr/bin/env python3
"""
thread-to-notion.py - mirror parked-work cards in projects/_threads/ into the Notion Tasks database.

For each card (projects/_threads/*.md except README.md), if a task with the same title does NOT
already exist in the Notion Tasks database, create it as a to-do. Existing titles are skipped, so
running this repeatedly is safe (no duplicates).

Status mapping (from a card line like "- Status: parked, attend soon"):
  contains "today" or "now"      -> Notion status "Today"
  contains "someday" or "later"  -> Notion status "Someday"
  anything else (default)        -> Notion status "Next"

Needs NOTION_API_KEY in the environment or in .env (a Notion internal integration token that has
access to the Tasks database). No third-party packages required (uses urllib).

Run manually:   python3 scripts/thread-to-notion.py
Wire it later:  call it from a daily cron job, or from a hook when projects/_threads/ changes.
"""
import os
import re
import sys
import json
import urllib.request
import urllib.error
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
THREADS = ROOT / "projects" / "_threads"
DB_ID = "19ec6192-c266-8096-bc19-e9100ae25509"  # Notion "Tasks" database
NOTION_VERSION = "2022-06-28"
API = "https://api.notion.com/v1"


def load_key():
    k = os.environ.get("NOTION_API_KEY")
    if k:
        return k.strip()
    envf = ROOT / ".env"
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.startswith("NOTION_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def api(method, path, key, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Notion-Version", NOTION_VERSION)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def find_props(key):
    db = api("GET", "/databases/" + DB_ID, key)
    title_prop = None
    status_prop = None
    for name, p in db["properties"].items():
        if p["type"] == "title":
            title_prop = name
        if p["type"] == "status":
            status_prop = name
    return title_prop, status_prop


def existing_titles(key, title_prop):
    titles = set()
    cursor = None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        res = api("POST", "/databases/" + DB_ID + "/query", key, body)
        for row in res["results"]:
            parts = row["properties"].get(title_prop, {}).get("title", [])
            if parts:
                titles.add("".join(x.get("plain_text", "") for x in parts).strip())
        if not res.get("has_more"):
            break
        cursor = res["next_cursor"]
    return titles


def parse_card(path):
    title = None
    status = "Next"
    for line in path.read_text().splitlines():
        if title is None and line.startswith("# "):
            title = line[2:].strip()
        m = re.match(r"\s*-\s*Status:\s*(.+)", line, re.I)
        if m:
            s = m.group(1).lower()
            if "today" in s or "now" in s:
                status = "Today"
            elif "someday" in s or "later" in s:
                status = "Someday"
            else:
                status = "Next"
    return title, status


def main():
    key = load_key()
    if not key:
        print("NOTION_API_KEY not set (env or .env). Nothing synced.")
        return 0
    if not THREADS.is_dir():
        print("No projects/_threads/ folder. Nothing to sync.")
        return 0
    title_prop, status_prop = find_props(key)
    have = existing_titles(key, title_prop)
    created = 0
    for card in sorted(THREADS.glob("*.md")):
        if card.name.lower() == "readme.md":
            continue
        title, status = parse_card(card)
        if not title:
            continue
        if title in have:
            print("exists, skip: " + title)
            continue
        props = {title_prop: {"title": [{"text": {"content": title}}]}}
        if status_prop:
            props[status_prop] = {"status": {"name": status}}
        api("POST", "/pages", key, {"parent": {"database_id": DB_ID}, "properties": props})
        print("created: " + title + " [" + status + "]")
        created += 1
    print("done. created " + str(created) + " new task(s).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.HTTPError as e:
        print("Notion API error " + str(e.code) + ": " + e.read().decode("utf-8", "ignore"))
        sys.exit(1)
