#!/usr/bin/env bash
# Print body-only Notion docs update payloads from the checked draft bundle.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="json"
PAGE_TITLE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --summary)
      MODE="summary"
      shift
      ;;
    --page)
      [ "$#" -ge 2 ] || { echo "--page requires a title" >&2; exit 64; }
      MODE="page"
      PAGE_TITLE="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  bash scripts/notion-docs-extract-payloads.sh --summary
  bash scripts/notion-docs-extract-payloads.sh
  bash scripts/notion-docs-extract-payloads.sh --page "AI-OS Docs"

Read-only. Prints body-only Notion update payloads from local docs prep files.
Does not contact Notion and does not write files.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 64
      ;;
  esac
done

python3 - "$ROOT" "$MODE" "$PAGE_TITLE" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
mode = sys.argv[2]
page_title = sys.argv[3]

drafts_path = root / "projects/briefs/2026-06-29_ai-os-docs-notion-page-drafts.md"
payloads_path = root / "projects/briefs/2026-08-04_ai-os-docs-notion-body-payloads.md"

drafts_text = drafts_path.read_text(encoding="utf-8", errors="replace")
payloads_text = payloads_path.read_text(encoding="utf-8", errors="replace")

heading_matches = list(re.finditer(r"^## (.+)$", drafts_text, flags=re.MULTILINE))
sections = {}
for index, match in enumerate(heading_matches):
    name = match.group(1).strip()
    start = match.end()
    end = heading_matches[index + 1].start() if index + 1 < len(heading_matches) else len(drafts_text)
    sections[name] = drafts_text[start:end].strip()

pages = []
for line in payloads_text.splitlines():
    if not line.startswith("| `") or "https://app.notion.com/p/" not in line:
        continue
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if len(cells) < 3:
        continue
    title = cells[0].strip("`")
    url = cells[1].strip("`")
    section = cells[2].strip("`")
    body = sections.get(section)
    if body is None:
        raise SystemExit(f"missing draft section: {section}")
    pages.append({
        "title": title,
        "page_id": url,
        "command": "replace_content",
        "section": section,
        "new_str": body,
    })

if mode == "summary":
    print(f"payloads: {len(pages)}")
    for page in pages:
        print(f"- {page['title']}: {len(page['new_str'])} chars")
elif mode == "page":
    for page in pages:
        if page["title"] == page_title or page["section"] == page_title:
            print(json.dumps(page, ensure_ascii=False, indent=2))
            break
    else:
        raise SystemExit(f"page not found: {page_title}")
else:
    print(json.dumps({"pages": pages}, ensure_ascii=False, indent=2))
PY
