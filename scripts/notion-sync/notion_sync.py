#!/usr/bin/env python3
"""
notion_sync.py — credit-free Notion to markdown sync for AI-OS.

This script talks to the Notion REST API directly. It does NOT use the Claude
model or any MCP server, so a scheduled run costs zero model credits.

What it does, per configured database (Stack and Resources; the Notes database
is intentionally excluded - see DATABASES below):
  - pages through every row via the Notion REST API
  - resolves the Global Tags relation IDs to readable tag names (one fetch of
    the Global Tags database, cached as an ID to name map)
  - writes one markdown file per item to
      context/notion/items/{db}/{slug}.md
    with YAML frontmatter (name, url, resolved Global Tag names, date) and a
    trimmed body (clipped marketing boilerplate and images stripped, the
    Description field and the user's own notes kept)
  - writes one index file per global tag to
      context/notion/tags/{tag}.md
    listing every item carrying that tag, so each tag is its own category
  - writes a top-level context/notion/_index.md

It is idempotent: files are overwritten in place by slug. context/notion/ is
gitignored and fully rebuildable from Notion, so a wipe-and-resync is safe.

Incremental by default: each run records a per-database last-sync timestamp in
.sync-state.json and, on the next run, asks Notion only for pages edited since
then (a last_edited_time filter). The first run, or any run with --full, fetches
everything. Each item stores its Notion page id in frontmatter so incremental
runs write back to the same file. Note: deletions/archives in Notion are not
pruned locally; run with --full periodically if you want to reconcile removals.

Auth: reads NOTION_API_KEY from the environment, or from the repo .env if the
environment variable is not set. Create a Notion internal integration and share
the Stack and Resources databases with it. See README.md for setup.

Standard library only — no pip install required.
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration — database IDs are REST API database IDs (32 hex chars).
# Add or remove entries here as databases join or leave the Global Tags
# taxonomy. The key becomes the {db} folder name under context/notion/items/.
# ---------------------------------------------------------------------------

# Only the two databases the catalog is built from. The Notes database
# (19ec6192c26680139071c6f3071a89f8) is deliberately NOT synced: it holds client
# and personal material and does not belong in this catalog pipeline.
DATABASES = {
    "stack": "188c6192c266805c8c77d6ff2ce28728",
    "resources": "17ec6192c2668099b853c9074f1c5abb",
    # Add further databases that share the Global Tags relation here, e.g.:
    # "people": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
}

# The Global Tags database — fetched once to build an ID to name map.
GLOBAL_TAGS_DB = "19ec6192c26680acae31ed9eed5c89c1"

# Notion API
NOTION_VERSION = "2022-06-28"
API_BASE = "https://api.notion.com/v1"

# Output root, relative to the repo root (two levels up from this file:
# scripts/notion-sync/ -> scripts/ -> repo root).
REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = REPO_ROOT / "context" / "notion"

# Per-database last-sync timestamps, used for incremental syncs. This is
# per-machine runtime state: gitignored and safe to delete (deleting it just
# forces the next run to do a full resync).
STATE_PATH = Path(__file__).resolve().parent / ".sync-state.json"

# Rate limiting / retries. Notion's published limit is ~3 requests/second.
REQUEST_SLEEP = 0.34          # seconds between requests (~3 rps)
MAX_RETRIES = 6               # for 429 / 5xx / transient network errors
PAGE_SIZE = 100               # Notion max page size

# Boilerplate filtering for trimmed bodies.
# Lines matching any of these (case-insensitive substring) are dropped. These
# are the usual clipped marketing-page leftovers from a web clipper.
BOILERPLATE_SUBSTRINGS = [
    "cookie", "accept all", "subscribe to our newsletter", "sign up for",
    "all rights reserved", "privacy policy", "terms of service",
    "follow us on", "share this", "skip to content", "back to top",
    "© 20", "request a demo", "book a demo", "start free trial",
    "get started for free", "log in", "sign in", "create account",
]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def load_api_key():
    """Return NOTION_API_KEY from the environment or the repo .env file."""
    key = os.environ.get("NOTION_API_KEY", "").strip()
    if key:
        return key
    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() == "NOTION_API_KEY":
                return value.strip().strip('"').strip("'")
    sys.exit(
        "NOTION_API_KEY is not set. Add it to the environment or to the repo "
        ".env file. See scripts/notion-sync/README.md for setup."
    )


# ---------------------------------------------------------------------------
# HTTP with retry, pagination, rate limiting
# ---------------------------------------------------------------------------

def _request(method, path, api_key, body=None):
    """Single HTTP request to the Notion API with retry on 429 / 5xx."""
    url = path if path.startswith("http") else f"{API_BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }

    attempt = 0
    while True:
        attempt += 1
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = resp.read().decode("utf-8")
                time.sleep(REQUEST_SLEEP)
                return json.loads(payload)
        except urllib.error.HTTPError as exc:
            status = exc.code
            retry_after = exc.headers.get("Retry-After")
            if status == 429 or 500 <= status < 600:
                if attempt > MAX_RETRIES:
                    raise
                wait = float(retry_after) if retry_after else min(2 ** attempt, 30)
                sys.stderr.write(
                    f"  rate limited / server error ({status}); "
                    f"retry {attempt}/{MAX_RETRIES} in {wait:.0f}s\n"
                )
                time.sleep(wait)
                continue
            # Non-retryable (400/401/403/404) — surface the body for debugging.
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Notion API {status} on {method} {url}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt > MAX_RETRIES:
                raise
            wait = min(2 ** attempt, 30)
            sys.stderr.write(
                f"  network error ({exc}); retry {attempt}/{MAX_RETRIES} in {wait:.0f}s\n"
            )
            time.sleep(wait)


def query_database(db_id, api_key, since=None):
    """Yield every page object in a database, handling pagination.

    If `since` (an ISO 8601 timestamp) is given, only pages edited on or after
    that time are returned, via a last_edited_time filter. This is what makes an
    incremental sync cheap: unchanged pages are never fetched.
    """
    cursor = None
    while True:
        body = {"page_size": PAGE_SIZE}
        if since:
            body["filter"] = {
                "timestamp": "last_edited_time",
                "last_edited_time": {"on_or_after": since},
            }
        if cursor:
            body["start_cursor"] = cursor
        result = _request("POST", f"/databases/{db_id}/query", api_key, body)
        for page in result.get("results", []):
            yield page
        if not result.get("has_more"):
            break
        cursor = result.get("next_cursor")


def get_block_children(block_id, api_key):
    """Yield every child block of a page/block, handling pagination."""
    cursor = None
    while True:
        path = f"/blocks/{block_id}/children?page_size={PAGE_SIZE}"
        if cursor:
            path += f"&start_cursor={cursor}"
        result = _request("GET", path, api_key)
        for block in result.get("results", []):
            yield block
        if not result.get("has_more"):
            break
        cursor = result.get("next_cursor")


# ---------------------------------------------------------------------------
# Property extraction helpers
# ---------------------------------------------------------------------------

def rich_text_to_plain(rich):
    """Concatenate a Notion rich_text array to plain text."""
    if not rich:
        return ""
    return "".join(part.get("plain_text", "") for part in rich).strip()


def get_title(props):
    """Return the title property value for a page (first title-typed prop)."""
    for value in props.values():
        if value.get("type") == "title":
            return rich_text_to_plain(value.get("title", []))
    return ""


def get_url_property(props):
    """Return the first url-typed property value, if any."""
    for value in props.values():
        if value.get("type") == "url" and value.get("url"):
            return value["url"]
    return ""


def get_description(props):
    """
    Return the Description field as plain text.

    Looks for a property literally named Description (any case), preferring
    rich_text, then any other rich_text property as a fallback.
    """
    for name, value in props.items():
        if name.strip().lower() == "description" and value.get("type") == "rich_text":
            return rich_text_to_plain(value.get("rich_text", []))
    # Fallback: first non-title rich_text property.
    for value in props.values():
        if value.get("type") == "rich_text":
            text = rich_text_to_plain(value.get("rich_text", []))
            if text:
                return text
    return ""


def get_global_tag_ids(props):
    """
    Return the list of related page IDs from the Global Tags relation.

    Matches a relation property whose name contains 'global tag' or 'tag'. If
    several relations exist, prefers the one named most like Global Tags.
    """
    candidates = []
    for name, value in props.items():
        if value.get("type") != "relation":
            continue
        lname = name.strip().lower()
        score = 0
        if "global tag" in lname:
            score = 2
        elif "tag" in lname:
            score = 1
        if score:
            ids = [rel.get("id") for rel in value.get("relation", []) if rel.get("id")]
            candidates.append((score, ids))
    if not candidates:
        return []
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def get_item_date(page):
    """
    Return a date string for the item.

    Prefers a date-typed property, then the page's last_edited_time, then
    created_time. Output is YYYY-MM-DD.
    """
    for value in page.get("properties", {}).values():
        if value.get("type") == "date" and value.get("date"):
            start = value["date"].get("start")
            if start:
                return start[:10]
    for field in ("last_edited_time", "created_time"):
        stamp = page.get(field)
        if stamp:
            return stamp[:10]
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Global Tags resolution
# ---------------------------------------------------------------------------

def build_tag_map(api_key):
    """Fetch the Global Tags database once and return {page_id: tag_name}."""
    tag_map = {}
    for page in query_database(GLOBAL_TAGS_DB, api_key):
        page_id = page.get("id")
        name = get_title(page.get("properties", {}))
        if page_id and name:
            tag_map[page_id] = name
    return tag_map


# ---------------------------------------------------------------------------
# Block to markdown (trimmed)
# ---------------------------------------------------------------------------

def block_to_text(block):
    """
    Convert a single Notion block to a markdown line, or None to skip it.

    Images, files, embeds, and other binary/media blocks are skipped — we keep
    text only. Headings, lists, quotes, and code are preserved.
    """
    btype = block.get("type")
    if btype in ("image", "file", "pdf", "video", "embed", "bookmark",
                 "link_preview", "unsupported", "child_database", "child_page",
                 "table_of_contents", "divider", "breadcrumb"):
        return None

    data = block.get(btype, {})
    text = rich_text_to_plain(data.get("rich_text", []))

    if btype == "paragraph":
        return text or None
    if btype in ("heading_1", "heading_2", "heading_3"):
        level = {"heading_1": "##", "heading_2": "###", "heading_3": "####"}[btype]
        return f"{level} {text}" if text else None
    if btype == "bulleted_list_item":
        return f"- {text}" if text else None
    if btype == "numbered_list_item":
        return f"1. {text}" if text else None
    if btype == "to_do":
        checked = "x" if data.get("checked") else " "
        return f"- [{checked}] {text}" if text else None
    if btype == "quote":
        return f"> {text}" if text else None
    if btype == "callout":
        return f"> {text}" if text else None
    if btype == "code":
        lang = data.get("language", "")
        return f"```{lang}\n{text}\n```" if text else None
    if btype == "toggle":
        return text or None
    return text or None


def is_boilerplate(line):
    """True if a line looks like clipped marketing/footer boilerplate."""
    low = line.strip().lower()
    if not low:
        return False
    return any(sub in low for sub in BOILERPLATE_SUBSTRINGS)


def collect_body(page_id, api_key):
    """
    Fetch the page body blocks and return trimmed markdown.

    Strips images and media, drops boilerplate lines, and collapses repeated
    blank lines. Recurses one level into toggles/callouts/columns for nested
    notes but keeps things shallow to avoid pulling whole clipped pages.
    """
    lines = []
    for block in get_block_children(page_id, api_key):
        line = block_to_text(block)
        if line and not is_boilerplate(line):
            lines.append(line)
        # One level of nesting for containers that commonly hold real notes.
        if block.get("has_children") and block.get("type") in (
            "toggle", "callout", "bulleted_list_item", "numbered_list_item",
            "column", "column_list", "quote",
        ):
            for child in get_block_children(block["id"], api_key):
                cline = block_to_text(child)
                if cline and not is_boilerplate(cline):
                    lines.append(cline)

    # Collapse 3+ blank lines down to one.
    body = "\n".join(lines)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body


# ---------------------------------------------------------------------------
# Slug + frontmatter
# ---------------------------------------------------------------------------

def slugify(text, fallback):
    """Filesystem-safe, stable slug from a title."""
    text = unicodedata.normalize("NFKD", text or "")
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    text = re.sub(r"-{2,}", "-", text)
    if not text:
        text = fallback
    return text[:80]


def yaml_escape(value):
    """Escape a scalar string for safe single-line YAML output."""
    value = (value or "").replace("\\", "\\\\").replace('"', '\\"')
    value = value.replace("\n", " ").strip()
    return value


def write_frontmatter(name, url, tags, date, notion_id):
    """Build a YAML frontmatter block."""
    lines = ["---"]
    lines.append(f'name: "{yaml_escape(name)}"')
    lines.append(f'url: "{yaml_escape(url)}"')
    if tags:
        lines.append("tags:")
        for tag in tags:
            lines.append(f'  - "{yaml_escape(tag)}"')
    else:
        lines.append("tags: []")
    lines.append(f'date: "{yaml_escape(date)}"')
    lines.append(f'notion_id: "{yaml_escape(notion_id)}"')
    lines.append("---")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Item writing
# ---------------------------------------------------------------------------

def write_item(db_key, page, tag_map, api_key, slug_for_id, used_slugs):
    """
    Write a single item markdown file and return a record for the indexes.

    Record: {db, slug, name, url, tags, date, notion_id, path}

    `slug_for_id` maps an existing page id to its (db, slug) so an incremental
    sync writes back to the same file. `used_slugs` is the set of slugs already
    taken per database, so a genuinely new page never clobbers another's file.
    """
    props = page.get("properties", {})
    page_id = page["id"]
    name = get_title(props) or "untitled"
    url = get_url_property(props)
    description = get_description(props)
    tag_ids = get_global_tag_ids(props)
    tags = sorted({tag_map.get(tid, "") for tid in tag_ids} - {""})
    date = get_item_date(page)
    page_url = page.get("url", "")

    # Reuse the slug already assigned to this page where we know it; otherwise
    # allocate a fresh, collision-free slug against everything already taken.
    prior = slug_for_id.get(page_id)
    if prior and prior[0] == db_key:
        slug = prior[1]
    else:
        base_slug = slugify(name, fallback=page_id.replace("-", "")[:12])
        slug = base_slug
        suffix = 2
        taken = used_slugs.setdefault(db_key, set())
        while slug in taken:
            slug = f"{base_slug}-{suffix}"
            suffix += 1
    used_slugs.setdefault(db_key, set()).add(slug)

    body = collect_body(page_id, api_key)

    out_dir = OUTPUT_ROOT / "items" / db_key
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{slug}.md"

    parts = [write_frontmatter(name, url, tags, date, page_id), "", f"# {name}", ""]
    if tags:
        parts.append("Tags: " + ", ".join(tags))
        parts.append("")
    if description:
        parts.append("## Description")
        parts.append("")
        parts.append(description)
        parts.append("")
    if body:
        parts.append("## Notes")
        parts.append("")
        parts.append(body)
        parts.append("")
    if url:
        parts.append(f"Source: {url}")
        parts.append("")
    if page_url:
        parts.append(f"Notion: {page_url}")
        parts.append("")

    out_path.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")

    return {
        "db": db_key,
        "slug": slug,
        "name": name,
        "url": url,
        "tags": tags,
        "date": date,
        "notion_id": page_id,
        "path": out_path.relative_to(OUTPUT_ROOT).as_posix(),
    }


# ---------------------------------------------------------------------------
# Index writing
# ---------------------------------------------------------------------------

def write_tag_indexes(records):
    """Write one index file per global tag under context/notion/tags/."""
    tags_dir = OUTPUT_ROOT / "tags"
    tags_dir.mkdir(parents=True, exist_ok=True)

    by_tag = {}
    for rec in records:
        for tag in rec["tags"]:
            by_tag.setdefault(tag, []).append(rec)

    for tag, items in sorted(by_tag.items()):
        slug = slugify(tag, fallback="tag")
        items_sorted = sorted(items, key=lambda r: (r["db"], r["name"].lower()))
        lines = [
            "---",
            f'tag: "{yaml_escape(tag)}"',
            f"count: {len(items_sorted)}",
            "---",
            "",
            f"# Tag: {tag}",
            "",
            f"{len(items_sorted)} item(s) carry this tag.",
            "",
        ]
        current_db = None
        for rec in items_sorted:
            if rec["db"] != current_db:
                current_db = rec["db"]
                lines.append(f"## {current_db}")
                lines.append("")
            link = f"../{rec['path']}"
            suffix = f" ({rec['url']})" if rec["url"] else ""
            lines.append(f"- [{rec['name']}]({link}){suffix}")
        lines.append("")
        (tags_dir / f"{slug}.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    return by_tag


def write_top_index(records, by_tag):
    """Write context/notion/_index.md summarising the whole sync."""
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    by_db = {}
    for rec in records:
        by_db.setdefault(rec["db"], []).append(rec)

    lines = [
        "---",
        f'generated: "{now}"',
        f"total_items: {len(records)}",
        f"total_tags: {len(by_tag)}",
        "---",
        "",
        "# Notion sync",
        "",
        "Rebuilt from Notion by scripts/notion-sync/notion_sync.py. This folder "
        "is gitignored and fully rebuildable. Do not hand-edit; changes are "
        "overwritten on the next sync.",
        "",
        f"Last sync: {now}",
        "",
        "## Databases",
        "",
    ]
    for db_key in sorted(by_db):
        lines.append(f"- **{db_key}**: {len(by_db[db_key])} item(s) in `items/{db_key}/`")
    lines.append("")
    lines.append("## Tags")
    lines.append("")
    if by_tag:
        for tag in sorted(by_tag):
            slug = slugify(tag, fallback="tag")
            lines.append(f"- [{tag}](tags/{slug}.md): {len(by_tag[tag])} item(s)")
    else:
        lines.append("_No tags resolved._")
    lines.append("")

    (OUTPUT_ROOT / "_index.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Incremental sync state + disk scan
# ---------------------------------------------------------------------------

def load_state():
    """Return per-database last-sync timestamps, or {} if none recorded yet."""
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


def save_state(state):
    """Persist per-database last-sync timestamps."""
    STATE_PATH.write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def _parse_item_frontmatter(path):
    """Read the frontmatter we wrote ourselves. Returns a dict or None."""
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return None
    if not lines or lines[0].strip() != "---":
        return None
    fm = {"name": "", "url": "", "tags": [], "date": "", "notion_id": ""}
    in_tags = False
    for ln in lines[1:]:
        if ln.strip() == "---":
            break
        m_name = re.match(r'^name:\s*"(.*)"\s*$', ln)
        m_url = re.match(r'^url:\s*"(.*)"\s*$', ln)
        m_date = re.match(r'^date:\s*"(.*)"\s*$', ln)
        m_id = re.match(r'^notion_id:\s*"(.*)"\s*$', ln)
        m_tag = re.match(r'^\s*-\s*"(.*)"\s*$', ln)
        if m_name:
            fm["name"] = m_name.group(1).replace('\\"', '"'); in_tags = False
        elif m_url:
            fm["url"] = m_url.group(1).replace('\\"', '"'); in_tags = False
        elif m_date:
            fm["date"] = m_date.group(1); in_tags = False
        elif m_id:
            fm["notion_id"] = m_id.group(1); in_tags = False
        elif ln.strip() == "tags:":
            in_tags = True
        elif ln.strip() == "tags: []":
            in_tags = False
        elif in_tags and m_tag:
            fm["tags"].append(m_tag.group(1).replace('\\"', '"'))
    return fm


def read_records_from_disk():
    """
    Rebuild the full record list from every item file on disk.

    Indexes must reflect ALL items, not just the ones fetched this run, so an
    incremental sync still produces complete tag and top-level indexes.
    """
    items_root = OUTPUT_ROOT / "items"
    records = []
    if not items_root.exists():
        return records
    for path in sorted(items_root.rglob("*.md")):
        fm = _parse_item_frontmatter(path)
        if fm is None:
            continue
        records.append({
            "db": path.parent.name,
            "slug": path.stem,
            "name": fm["name"] or path.stem,
            "url": fm["url"],
            "tags": fm["tags"],
            "date": fm["date"],
            "notion_id": fm["notion_id"],
            "path": path.relative_to(OUTPUT_ROOT).as_posix(),
        })
    return records


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    full = "--full" in sys.argv[1:]
    api_key = load_api_key()

    run_started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    state = {} if full else load_state()

    sys.stderr.write("Fetching Global Tags map...\n")
    tag_map = build_tag_map(api_key)
    sys.stderr.write(f"  resolved {len(tag_map)} tag(s)\n")

    # A full run regenerates everything from scratch (historical behaviour). An
    # incremental run seeds slug bookkeeping from disk so existing files are
    # reused and new pages never collide with them.
    if full:
        slug_for_id, used_slugs = {}, {}
    else:
        disk = read_records_from_disk()
        slug_for_id = {r["notion_id"]: (r["db"], r["slug"]) for r in disk if r["notion_id"]}
        used_slugs = {}
        for r in disk:
            used_slugs.setdefault(r["db"], set()).add(r["slug"])

    new_state = dict(state)
    fetched = 0
    for db_key, db_id in DATABASES.items():
        since = None if full else state.get(db_key)
        mode = "full" if since is None else f"incremental since {since}"
        sys.stderr.write(f"Syncing database: {db_key} ({db_id}) [{mode}]\n")
        count = 0
        for page in query_database(db_id, api_key, since=since):
            try:
                write_item(db_key, page, tag_map, api_key, slug_for_id, used_slugs)
                count += 1
            except Exception as exc:  # keep going on a single bad row
                sys.stderr.write(f"  skipped a page ({page.get('id')}): {exc}\n")
        fetched += count
        new_state[db_key] = run_started
        sys.stderr.write(f"  fetched {count} changed item(s)\n")

    # Indexes always reflect EVERY item on disk, not just those fetched now.
    records = read_records_from_disk()
    by_tag = write_tag_indexes(records)
    write_top_index(records, by_tag)

    save_state(new_state)

    sys.stderr.write(
        f"Done. {fetched} item(s) fetched this run; {len(records)} on disk; "
        f"{len(by_tag)} tag index(es). Output: {OUTPUT_ROOT}\n"
    )


if __name__ == "__main__":
    main()
