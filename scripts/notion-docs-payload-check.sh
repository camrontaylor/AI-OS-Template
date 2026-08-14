#!/usr/bin/env bash
# Validate the body-only Notion docs payload package before any external write.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])

map_rel = "docs/notion-template-docs-map.md"
drafts_rel = "projects/briefs/2026-06-29_ai-os-docs-notion-page-drafts.md"
payloads_rel = "projects/briefs/2026-08-04_ai-os-docs-notion-body-payloads.md"
manifest_rel = "projects/briefs/2026-08-04_ai-os-docs-notion-write-manifest.md"

failures = []
passes = []

def read(rel):
    path = root / rel
    if not path.exists():
        failures.append(f"missing required file: {rel}")
        return ""
    return path.read_text(encoding="utf-8", errors="replace")

def ok(message):
    passes.append(message)

def fail(message):
    failures.append(message)

map_text = read(map_rel)
drafts_text = read(drafts_rel)
payloads_text = read(payloads_rel)
manifest_text = read(manifest_rel)

map_pages = []
for line in map_text.splitlines():
    if not line.startswith("| `"):
        continue
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if len(cells) < 4:
        continue
    page = cells[0].strip("`")
    if page == "Notion page":
        continue
    map_pages.append(page)

payload_rows = []
for line in payloads_text.splitlines():
    if not line.startswith("| `") or "https://app.notion.com/p/" not in line:
        continue
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if len(cells) < 3:
        continue
    payload_rows.append({
        "title": cells[0].strip("`"),
        "url": cells[1].strip("`"),
        "section": cells[2].strip("`"),
    })

heading_matches = list(re.finditer(r"^## (.+)$", drafts_text, flags=re.MULTILINE))
draft_sections = {}
for index, match in enumerate(heading_matches):
    name = match.group(1).strip()
    start = match.end()
    end = heading_matches[index + 1].start() if index + 1 < len(heading_matches) else len(drafts_text)
    draft_sections[name] = drafts_text[start:end].strip()

if len(map_pages) == 28:
    ok("map declares 28 Notion pages")
else:
    fail(f"map declares {len(map_pages)} Notion pages, expected 28")

if len(payload_rows) == 28:
    ok("payload map declares 28 page updates")
else:
    fail(f"payload map declares {len(payload_rows)} page updates, expected 28")

if len(draft_sections) == 28:
    ok("draft bundle contains exactly 28 top-level page sections")
else:
    fail(f"draft bundle contains {len(draft_sections)} top-level page sections, expected 28")

urls = [row["url"] for row in payload_rows]
if len(set(urls)) == len(urls):
    ok("payload page URLs are unique")
else:
    fail("payload page URLs are not unique")

payload_titles = {row["title"] for row in payload_rows}
payload_sections = {row["section"] for row in payload_rows}
for page in map_pages:
    if page not in payload_titles and page not in payload_sections:
        fail(f"mapped page is missing from payload title/section map: {page}")

for row in payload_rows:
    section = row["section"]
    body = draft_sections.get(section)
    if body is None:
        fail(f"payload section missing from draft bundle: {section}")
        continue
    if not body:
        fail(f"payload section is empty: {section}")
    if body.lstrip().startswith("#"):
        fail(f"payload body starts with a heading marker, meaning extraction likely included a page title: {section}")
    if row["title"] != "AI-OS Docs" and "<page url=" in body:
        fail(f"child page payload contains a subpage tag: {row['title']}")

root_body = draft_sections.get("AI-OS Docs", "")
root_tags = re.findall(r'<page url="([^"]+)">([^<]+)</page>', root_body)
manifest_root_tags = re.findall(r'<page url="([^"]+)">([^<]+)</page>', manifest_text)
child_rows = payload_rows[1:]
child_urls = [row["url"] for row in child_rows]
root_urls = [url for url, _title in root_tags]
manifest_root_urls = [url for url, _title in manifest_root_tags]

if len(root_tags) == 27:
    ok("root payload contains 27 child page tags")
else:
    fail(f"root payload contains {len(root_tags)} child page tags, expected 27")

if set(root_urls) == set(child_urls):
    ok("root child page tags match payload URL set")
else:
    fail("root child page tags do not match payload URL set")

if root_urls == manifest_root_urls:
    ok("root child page tag order matches preserved live order")
else:
    fail("root child page tag order does not match preserved live order")

for url in child_urls:
    if root_urls.count(url) != 1:
        fail(f"root payload does not contain child URL exactly once: {url}")

for required in ["Claude Code", "Codex", "Cursor", "Hermes"]:
    if required in drafts_text:
        ok(f"drafts mention {required}")
    else:
        fail(f"drafts do not mention {required}")

stale_patterns = {
    "vendor/tooling detour": r"\b(LangSmith|Langfuse|LangChain|LangGraph|Pinecone|Zilliz|Milvus|MemSearch)\b",
    "stale Claude-only wording": r"Claude-first|The first Claude command|Claude, Codex, or other",
    "stale reply-footer wording": r"Most replies end|Next Actions block",
    "loose approval wording": r"Approval cue|magic phrase",
    "page-creation wording": r"Create one new child page|create one new child page|new child page|new page",
    "AI writing tells": r"\b(leverage|utilize|streamline|robust|delve|transformative|game-changer|pivotal|crucial)\b",
    "dash characters": r"[—–]",
}

case_sensitive_labels = {"vendor/tooling detour"}
for label, pattern in stale_patterns.items():
    flags = 0 if label in case_sensitive_labels else re.IGNORECASE
    match = re.search(pattern, drafts_text, flags=flags)
    if match:
        fail(f"draft bundle contains {label}: {match.group(0)!r}")
    else:
        ok(f"draft bundle avoids {label}")

if failures:
    print("Notion docs payload check failed:")
    for item in failures:
        print(f"- {item}")
    print("")
    print(f"Passed checks before failure: {len(passes)}")
    sys.exit(1)

print(f"Notion docs payload check passed: {len(passes)} checks.")
print("Pages: 28")
print("Root child page tags: 27")
print("Mode: body-only payloads, no titles or page structure changed.")
PY
