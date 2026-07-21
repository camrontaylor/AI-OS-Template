#!/usr/bin/env bash
# Generate a read-only report for AI-OS local docs to Notion template coverage.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TODAY="$(date +%F)"
REPORT_DIR="$ROOT/projects/system-health"
REPORT="$REPORT_DIR/${TODAY}_notion-docs-coverage.md"

mkdir -p "$REPORT_DIR"

python3 - "$ROOT" "$REPORT" "$TODAY" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
report = Path(sys.argv[2])
today = sys.argv[3]

map_rel = "docs/notion-template-docs-map.md"
plan_rel = "projects/briefs/2026-06-29_ai-os-docs-notion-update-plan.md"
packet_rel = "projects/briefs/2026-06-29_ai-os-docs-notion-sync-packet.md"
drafts_rel = "projects/briefs/2026-06-29_ai-os-docs-notion-page-drafts.md"
approval_terms = ["Approval Gate", "Approval cue", "target", "action"]

required_artifacts = [
    "docs/README.md",
    map_rel,
    plan_rel,
    packet_rel,
    drafts_rel,
]

failures = []
warnings = []
passes = []

def read(rel: str) -> str:
    path = root / rel
    if not path.exists():
        failures.append(f"Missing required file: {rel}")
        return ""
    return path.read_text(encoding="utf-8", errors="replace")

def ok(message: str) -> None:
    passes.append(message)

def fail(message: str) -> None:
    failures.append(message)

def warn(message: str) -> None:
    warnings.append(message)

def linked_in_docs_index(rel: str, text: str) -> bool:
    if rel in text:
        return True
    if rel.startswith("docs/") and rel[5:] in text:
        return True
    return False

for rel in required_artifacts:
    if (root / rel).exists():
        ok(f"Required artifact exists: {rel}")
    else:
        fail(f"Required artifact missing: {rel}")

map_text = read(map_rel)
plan_text = read(plan_rel)
packet_text = read(packet_rel)
drafts_text = read(drafts_rel)
docs_index = read("docs/README.md")

rows = []
for line in map_text.splitlines():
    if not line.startswith("| `"):
        continue
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if len(cells) < 4:
        continue
    notion_page = cells[0].strip("`")
    primary_source = cells[1].strip("`")
    supporting_source = cells[2]
    action = cells[3]
    if notion_page == "Notion page":
        continue
    rows.append({
        "page": notion_page,
        "primary": primary_source,
        "supporting": supporting_source,
        "action": action,
    })

if rows:
    ok(f"Coverage map contains {len(rows)} Notion page row(s).")
else:
    fail("Coverage map contains no Notion page rows.")

for row in rows:
    page = row["page"]
    primary = row["primary"]

    if primary.startswith("docs/") or primary == "README.md" or primary == "AGENTS.md":
        if (root / primary).exists():
            ok(f"Primary source exists for {page}: {primary}")
        else:
            fail(f"Primary source missing for {page}: {primary}")

    for rel, text, label in [
        (plan_rel, plan_text, "update plan"),
        (packet_rel, packet_text, "sync packet"),
        (drafts_rel, drafts_text, "page drafts"),
    ]:
        if page in text:
            ok(f"{label} mentions page: {page}")
        else:
            fail(f"{label} missing page title: {page}")

    if primary.startswith("docs/") and not linked_in_docs_index(primary, docs_index) and page not in ["AI-OS Docs"]:
        warn(f"Docs index may not link primary source for {page}: {primary}")

for rel, text in [
    (plan_rel, plan_text),
    (packet_rel, packet_text),
]:
    missing_terms = [term for term in approval_terms if term.lower() not in text.lower()]
    if not missing_terms:
        ok(f"External-write approval gate present in {rel}")
    else:
        fail(f"External-write approval gate incomplete in {rel}: missing {', '.join(missing_terms)}")

if drafts_rel in packet_text:
    ok("Sync packet links the page draft bundle.")
else:
    fail("Sync packet does not link the page draft bundle.")

if packet_rel in plan_text and drafts_rel in plan_text:
    ok("Update plan links both sync packet and page draft bundle.")
else:
    fail("Update plan does not link both sync packet and page draft bundle.")

if linked_in_docs_index(map_rel, docs_index):
    ok("Docs index links the Notion template docs map.")
else:
    fail("Docs index does not link the Notion template docs map.")

if "Memory Search, Vector Databases, and AI Observability" in plan_text:
    ok("Update plan includes the new memory tooling page.")
else:
    fail("Update plan missing the new memory tooling page.")

lines = [
    f"# Notion Docs Coverage - {today}",
    "",
    "This is a read-only AI-OS report. It checks whether the local docs, Notion source map, sync packet, and draft bundle are aligned before any external Notion write.",
    "",
    "## Summary",
    "",
    f"- Failures: {len(failures)}",
    f"- Warnings: {len(warnings)}",
    f"- Passed checks: {len(passes)}",
    f"- Notion pages mapped: {len(rows)}",
    "",
]

if failures:
    lines.extend(["## Failures", ""])
    lines.extend(f"- `{item}`" for item in failures)
    lines.append("")

if warnings:
    lines.extend(["## Warnings", ""])
    lines.extend(f"- `{item}`" for item in warnings)
    lines.append("")

lines.extend(["## Passed Checks", ""])
if passes:
    lines.extend(f"- `{item}`" for item in passes)
else:
    lines.append("No passed checks.")

lines.extend([
    "",
    "## Fix Path",
    "",
])
if failures:
    lines.extend([
        "Fix the missing local source, page title, link, or approval gate, then rerun:",
        "",
        "```bash",
        "bash scripts/notion-docs-coverage-report.sh",
        "```",
    ])
else:
    lines.extend([
        "Local Notion docs coverage is ready for an approved external Notion sync.",
        "",
        "Do not write to Notion without clear approval for the target and action from the update plan.",
    ])

report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Notion docs coverage report saved to {report}")
print(f"Summary: {len(failures)} failure(s), {len(warnings)} warning(s), {len(passes)} passed check(s).")

if failures:
    sys.exit(1)
PY
