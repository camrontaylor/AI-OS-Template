#!/usr/bin/env python3
"""
build_catalog.py - build context/notion/CATALOG.md from the synced item files.

Turns the raw Notion mirror (context/notion/items/) into one browsable,
categorised front page: the apps and tools you like, grouped by what they do,
plus resources. Covers the Stack and Resources databases only - the Notes
database is intentionally excluded (client and personal material). Makes ZERO
Notion API calls - it only reads the
markdown the daily sync already wrote, so it is credit-free and safe to run at
any time. The output is regenerated every run; do not hand-edit it.

Categories are decided by the ordered rules in CATEGORY_RULES below. Anything a
rule does not match lands in an "Uncategorised" bucket at the end of its
section, so a new tool is never silently mislabelled - it just shows up waiting
for a home. To teach the catalog a new category, add a rule to the map.

Run by hand:   python3 scripts/notion-sync/build_catalog.py
Wired into:    scripts/notion-sync/run-notion-sync.sh (runs after each sync)
"""
import json
import re
import sys
from pathlib import Path
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / "context" / "notion"
ITEMS = ROOT / "items"
OUT = ROOT / "CATALOG.md"
# Enriched records live OUTSIDE the gitignored mirror: they cost credits to
# produce, so they are git-tracked and must survive a re-sync. Stack and
# resources only - notes are excluded on purpose (client/personal material).
ENRICHED = REPO / "context" / "notion-enriched" / "enrichment.json"
# Category per Notion page id, from the one-time judgement pass. Git-tracked and
# survives a re-sync, same as the enrichment store.
CATEGORIES = REPO / "context" / "notion-enriched" / "categories.json"

# Display order for the assigned taxonomy. A category with no items is skipped,
# and anything unassigned falls through to the keyword rules below, then to the
# "needs a home" bucket, so a brand-new item is never silently mislabelled.
CATEGORY_ORDER = {
    "stack": [
        "AI models & inference", "AI agents, MCP & infra", "AI app builders & vibe coding",
        "Coding & developer tools", "Design & prototyping", "Web frameworks",
        "Hosting, deploy & DevOps", "Vector database & search", "Data, scraping & APIs",
        "Automation & workflow", "Video creation & editing", "Image & graphics",
        "Audio & voice", "Screen recording & demos", "Writing & content",
        "Newsletter & email marketing", "Email & messaging infra", "Social media & scheduling",
        "SEO & analytics", "CRM, sales & support", "Project management & docs",
        "Community & audience", "Security & passwords", "Finance & billing",
        "Learning & courses", "Productivity & utilities", "Playbooks, guides & reference",
    ],
    "resources": [
        "Agentic Academy course", "Team OS walkthroughs", "Courses & training",
        "Video tutorials", "Articles & blog posts", "Newsletters",
        "Design inspiration & galleries", "Templates & assets", "Documentation & reference",
        "Short social clips & tips", "Threads & discussions", "Podcasts", "Jobs & listings",
    ],
}

# Ordered category rules per database. Each rule is (category, matchers) where
# matchers is a list of lowercase substrings tested against the item's URL,
# name, and description. First matching rule wins, so put specific rules first.
# Edit this map to grow or rename categories over time.
CATEGORY_RULES = {
    # Specific rules first: a general word like "deploy" or "agent" must not
    # steal an item a sharper rule below would claim.
    "stack": [
        ("Vector database & search", ["milvus", "zilliz", "vector datab", "vector lakebase", "pinecone", "weaviate", "qdrant"]),
        ("AI support & chat", ["chatbase", "customer service", "customer support", "chatbot", "intercom"]),
        ("Analytics & AI visibility", ["ai visibility", "citations", "brand monitor", "analytics", "aeo", "geo", "seo"]),
        ("AI agents, MCP & infra", ["mcp", "manufact"]),
        ("AI models & inference", ["huggingface", "morphllm", "morph -", "inference", "glm-", "openrouter", "groq", "together.ai"]),
        ("Browser automation", ["browserbase", "browser", "playwright", "puppeteer"]),
        ("Screen recording & video", ["cap.so", "screen record", "loom", "tella"]),
        ("Email & messaging", ["resend", "email", "postmark", "sendgrid", "loops.so"]),
        ("Hosting, deploy & DevOps", ["zeabur", "elest", "deploy", "devops", "railway", "render.com", "fly.io", "vercel", "cloud"]),
        ("Playbooks & guides", ["playbook", "guide", ".pdf", "workflows that run"]),
    ],
    "resources": [
        ("Agentic Academy course", ["skool.com", "agentic academy"]),
        ("Team OS walkthroughs", ["team os", "tella.tv/video/team-os"]),
        ("Short social clips & tips", ["instagram.com", "x.com/", "/status/", "threads.net", "tiktok.com"]),
        ("Video tutorials", ["youtube.com", "youtu.be"]),
        ("Jobs & listings", ["seek.com", "/job/", "linkedin.com/jobs"]),
    ],
}

FALLBACK = "Uncategorised (needs a home)"

# Sources that cannot be auto-enriched, so they are reported as a known limit
# rather than counted as outstanding work. Domain substring -> shown label.
GATED_SOURCES = [
    ("skool.com", "course lesson, source needs login"),
    ("tella.tv", "product walkthrough video"),
    ("seek.com", "job listing"),
]


def gated_label(url: str) -> str:
    u = (url or "").lower()
    for domain, label in GATED_SOURCES:
        if domain in u:
            return label
    return ""


def load_enrichment() -> dict:
    """Enriched records keyed by Notion page id. Missing file is fine - the
    catalog just falls back to the raw scraped description."""
    if not ENRICHED.is_file():
        return {}
    try:
        data = json.loads(ENRICHED.read_text(encoding="utf-8"))
        return {k: v for k, v in data.items() if not k.startswith("_")}
    except Exception:
        return {}


def parse_item(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="ignore")
    fm = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            fm_block = text[3:end]
            body = text[end + 4:]
            for line in fm_block.splitlines():
                m = re.match(r"^(\w+):\s*(.*)$", line)
                if m:
                    fm[m.group(1)] = m.group(2).strip().strip('"')
    # description: first non-empty line after "## Description", minus a stray
    # leading "Description:" prefix that some scraped pages carry.
    desc = ""
    lines = body.splitlines()
    for i, ln in enumerate(lines):
        if ln.strip().lower().startswith("## description"):
            for nxt in lines[i + 1:]:
                s = nxt.strip()
                if s and not s.startswith("#"):
                    desc = re.sub(r"^Description:\s*", "", s, flags=re.IGNORECASE)
                    break
            break
    # notion url from body "Notion: <url>" line, else build from id
    notion_url = ""
    mn = re.search(r"^Notion:\s*(\S+)", body, re.MULTILINE)
    if mn:
        notion_url = mn.group(1)
    elif fm.get("notion_id"):
        notion_url = "https://notion.so/" + fm["notion_id"].replace("-", "")
    return {
        "name": fm.get("name", path.stem),
        "url": fm.get("url", ""),
        "date": fm.get("date", ""),
        "notion_id": fm.get("notion_id", ""),
        "notion_url": notion_url,
        "desc": desc,
    }


def load_categories() -> dict:
    """Assigned category per Notion page id. Missing file is fine - the keyword
    rules below take over."""
    if not CATEGORIES.is_file():
        return {}
    try:
        data = json.loads(CATEGORIES.read_text(encoding="utf-8"))
        return {k: v for k, v in data.items() if not k.startswith("_")}
    except Exception:
        return {}


def categorise(db: str, item: dict) -> str:
    # An assigned category always wins: it came from reading the actual product,
    # not from a substring match.
    assigned = item.get("category")
    if assigned:
        return assigned
    en = item.get("enriched") or {}
    # Enriched text is the better signal, so feed it into the match too.
    hay = " ".join([
        item["url"], item["name"], item["desc"],
        en.get("category_hint", ""), en.get("what", ""), en.get("best_for", ""),
    ]).lower()
    for category, matchers in CATEGORY_RULES.get(db, []):
        if any(m in hay for m in matchers):
            return category
    return FALLBACK


def dedupe(items: list) -> tuple:
    """Collapse items that point at the same URL (the same tool saved twice).
    Keeps the first, prefers one that has an enriched record. Returns
    (kept, dropped_count) so the catalog can report what it merged."""
    seen = {}
    order = []
    dropped = 0
    for it in items:
        key = (it.get("url") or "").strip().rstrip("/").lower()
        if not key:
            order.append(it)
            continue
        if key in seen:
            dropped += 1
            # prefer the copy that carries enrichment
            if it.get("enriched") and not seen[key].get("enriched"):
                order[order.index(seen[key])] = it
                seen[key] = it
            continue
        seen[key] = it
        order.append(it)
    return order, dropped


def render_entry(item: dict) -> str:
    """One scannable line, plus an indented detail line when the record has been
    enriched. Unenriched items are marked so the gap is visible, not hidden."""
    label = item["name"].replace("\n", " ").strip()
    head = f"[{label}]({item['notion_url']})" if item["notion_url"] else label
    en = item.get("enriched") or {}

    # Enriched summary wins over the thin scraped description.
    summary = en.get("what") or en.get("gist") or item["desc"]
    parts = [f"- {head}"]
    if summary:
        parts.append(f" - {summary}")

    tail = []
    if item["url"]:
        tail.append(f"[link]({item['url']})")
    if item["date"]:
        tail.append(f"saved {item['date']}")
    if not en:
        g = gated_label(item["url"])
        tail.append(f"_{g}_" if g else "_not enriched yet_")
    if tail:
        parts.append("  ·  " + "  ·  ".join(tail))

    line = "".join(parts)

    detail = []
    if en.get("best_for"):
        detail.append(f"Best for: {en['best_for']}")
    if en.get("pricing") and en["pricing"] != "unknown":
        detail.append(f"Pricing: {en['pricing']}")
    if en.get("source_who"):
        detail.append(f"From: {en['source_who']}")
    if detail:
        line += "\n  " + "  ·  ".join(detail)
    for t in en.get("takeaways", [])[:4]:
        line += f"\n  - {t}"
    return line


def load_db(db: str, enrichment: dict, categories: dict) -> list:
    d = ITEMS / db
    if not d.is_dir():
        return []
    items = []
    for p in sorted(d.glob("*.md")):
        it = parse_item(p)
        nid = it.get("notion_id", "")
        it["enriched"] = enrichment.get(nid, {})
        it["category"] = categories.get(nid, "")
        items.append(it)
    return items


def group(db: str, items: list):
    """Return ordered list of (category, [items]): the assigned taxonomy first in
    CATEGORY_ORDER, then any keyword-rule categories, then the fallback bucket."""
    order = list(CATEGORY_ORDER.get(db, []))
    for c, _ in CATEGORY_RULES.get(db, []):
        if c not in order:
            order.append(c)
    order.append(FALLBACK)
    buckets = {c: [] for c in order}
    for it in items:
        cat = categorise(db, it)
        buckets.setdefault(cat, []).append(it)
        if cat not in order:
            order.insert(len(order) - 1, cat)
    return [(c, buckets[c]) for c in order if buckets.get(c)]


def main():
    enrichment = load_enrichment()
    categories = load_categories()
    stack, stack_dupes = dedupe(load_db("stack", enrichment, categories))
    resources, res_dupes = dedupe(load_db("resources", enrichment, categories))

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total = len(stack) + len(resources)
    catalogued = stack + resources
    done = sum(1 for i in catalogued if i.get("enriched"))
    gated = sum(1 for i in catalogued if not i.get("enriched") and gated_label(i["url"]))
    todo = len(catalogued) - done - gated
    dupes = stack_dupes + res_dupes

    out = []
    out.append("---")
    out.append(f'generated: "{now}"')
    out.append(f"total_items: {total}")
    out.append("---")
    out.append("")
    out.append("# Catalog - apps, tools & resources")
    out.append("")
    out.append(
        "Your Stack and Resources databases, categorised. This is the browsable "
        "front page of `context/notion/`. It is rebuilt every time the daily sync runs, "
        "so it grows on its own - do not hand-edit it (changes are overwritten). To find "
        'something semantically, ask memory-recall or run '
        "`bash scripts/memsearch-search.sh \"your query\" 10`."
    )
    out.append("")
    out.append(f"Last built: {now}  ·  {len(stack)} apps/tools  ·  {len(resources)} resources")
    out.append("")
    cover = f"**Enriched: {done} of {len(catalogued)}**"
    if todo:
        cover += f"  ·  {todo} still to do (marked _not enriched yet_)."
    else:
        cover += "  ·  everything that can be enriched, is."
    if gated:
        cover += f"  ·  {gated} cannot be auto-enriched (login-walled or low value), labelled with why."
    if dupes:
        cover += f"  ·  {dupes} duplicate link(s) merged."
    out.append(cover)
    out.append("")

    out.append("## Apps & tools")
    out.append("")
    if stack:
        for category, items in group("stack", stack):
            out.append(f"### {category}  ({len(items)})")
            for it in items:
                out.append(render_entry(it))
            out.append("")
    else:
        out.append("_None synced yet._")
        out.append("")

    out.append("## Resources")
    out.append("")
    if resources:
        for category, items in group("resources", resources):
            out.append(f"### {category}  ({len(items)})")
            for it in items:
                out.append(render_entry(it))
            out.append("")
    else:
        out.append("_None synced yet._")
        out.append("")

    OUT.write_text("\n".join(out), encoding="utf-8")
    print(f"catalog: wrote {OUT} ({total} items, {len(stack)} tools / {len(resources)} resources)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never break the sync run on a catalog error
        print(f"catalog: skipped ({e})", file=sys.stderr)
        sys.exit(0)
