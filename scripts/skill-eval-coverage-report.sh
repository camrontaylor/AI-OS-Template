#!/usr/bin/env bash
# Generate a read-only report of live AI-OS skills with and without eval criteria.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TODAY="$(date +%F)"
REPORT_DIR="$ROOT/projects/system-health"
REPORT="$REPORT_DIR/${TODAY}_skill-eval-coverage.md"

mkdir -p "$REPORT_DIR"

python3 - "$ROOT" "$REPORT" "$TODAY" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
report = Path(sys.argv[2])
today = sys.argv[3]
skills_dir = root / ".claude" / "skills"

priority_prefix = {
    "meta": 0,
    "memory": 0,
    "ops": 1,
    "tool": 2,
    "str": 2,
    "mkt": 3,
    "viz": 3,
}

def priority_for(name: str) -> int:
    if name.startswith("memory-"):
        return 0
    prefix = name.split("-", 1)[0]
    return priority_prefix.get(prefix, 4)

def has_eval_section(text: str) -> bool:
    return re.search(r"(?im)^## +Evals?\b", text) is not None

def has_eval_file(skill_dir: Path) -> tuple[bool, str]:
    eval_file = skill_dir / "evals" / "evals.json"
    if not eval_file.exists():
        return False, ""
    try:
        data = json.loads(eval_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return False, f"invalid evals/evals.json: {exc}"
    evals = data.get("evals")
    if isinstance(evals, list) and len(evals) > 0:
        return True, ""
    return False, "evals/evals.json has no evals"

rows = []
for skill_md in sorted(skills_dir.glob("*/SKILL.md")):
    skill_dir = skill_md.parent
    name = skill_dir.name
    if name.startswith("_"):
        continue
    text = skill_md.read_text(encoding="utf-8", errors="replace")
    section = has_eval_section(text)
    eval_file_ok, eval_file_note = has_eval_file(skill_dir)
    covered = section or eval_file_ok
    rows.append({
        "name": name,
        "path": str(skill_md.relative_to(root)),
        "covered": covered,
        "eval_section": section,
        "eval_file": eval_file_ok,
        "note": eval_file_note,
        "priority": priority_for(name),
    })

covered = [row for row in rows if row["covered"]]
missing = [row for row in rows if not row["covered"]]
missing.sort(key=lambda row: (row["priority"], row["name"]))
coverage = 0 if not rows else round((len(covered) / len(rows)) * 100)

lines = [
    f"# Skill Eval Coverage - {today}",
    "",
    "This is a read-only AI-OS report. It checks whether each live skill has explicit eval coverage through a `## Eval` section or `evals/evals.json`.",
    "",
    "## Summary",
    "",
    f"- Live skills checked: {len(rows)}",
    f"- Skills with eval coverage: {len(covered)}",
    f"- Skills missing eval coverage: {len(missing)}",
    f"- Coverage: {coverage}%",
    "",
    "## What Counts As Coverage",
    "",
    "- A `## Eval` or `## Evals` section in `SKILL.md`, or",
    "- a non-empty `evals/evals.json` file.",
    "",
    "Coverage does not prove the evals are strong. It proves the skill has an explicit test target. Weak evals should be improved by `meta-skill-creator`.",
    "",
]

if missing:
    lines.extend([
        "## Missing Eval Coverage",
        "",
        "| Priority | Skill | Path | Next Action |",
        "|---|---|---|---|",
    ])
    for row in missing:
        if row["priority"] == 0:
            next_action = "Add pass/fail evals before changing this system skill."
        elif row["priority"] == 1:
            next_action = "Add evals before changing ops behavior."
        else:
            next_action = "Add evals when this skill is next edited or promoted."
        note = f" {row['note']}" if row["note"] else ""
        lines.append(f"| P{row['priority']} | `{row['name']}` | `{row['path']}` | {next_action}{note} |")
    lines.append("")
else:
    lines.extend(["## Missing Eval Coverage", "", "No missing eval coverage found.", ""])

lines.extend([
    "## Existing Coverage",
    "",
    "| Skill | Coverage Source |",
    "|---|---|",
])
for row in sorted(covered, key=lambda item: item["name"]):
    sources = []
    if row["eval_section"]:
        sources.append("`## Eval`")
    if row["eval_file"]:
        sources.append("`evals/evals.json`")
    lines.append(f"| `{row['name']}` | {', '.join(sources)} |")

lines.extend([
    "",
    "## Fix Path",
    "",
    "For each P0/P1 skill without coverage:",
    "",
    "1. Add a `## Eval` section to `SKILL.md` that names the exact command or manual pass/fail criteria.",
    "2. Prefer `bash scripts/skill-evals.sh <target>` when an executable eval exists.",
    "3. Add `evals/evals.json` when the skill needs prompt-output benchmark cases.",
    "4. Rerun `bash scripts/skill-eval-coverage-report.sh`.",
    "",
])

report.write_text("\n".join(lines), encoding="utf-8")
print(f"Skill eval coverage report saved to {report}")
print(f"Summary: {len(covered)}/{len(rows)} skill(s) covered, {len(missing)} missing.")
PY
