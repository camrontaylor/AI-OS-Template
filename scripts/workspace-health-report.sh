#!/usr/bin/env bash
# Generate a durable, read-only workspace drift report.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TODAY="$(date +%F)"
REPORT_DIR="$ROOT/projects/system-health"
REPORT="$REPORT_DIR/${TODAY}_workspace-health.md"
AUDIT_JSON="$(mktemp "${TMPDIR:-/tmp}/aios-workspace-audit.XXXXXX")"
cleanup() {
  rm -f "$AUDIT_JSON"
}
trap cleanup EXIT

mkdir -p "$REPORT_DIR"

INSPECTED_HEAD="$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
INSPECTED_STATUS="$(cd "$ROOT" && git status --branch --short 2>/dev/null | sed -n '1p' || echo unknown)"

bash "$ROOT/.claude/skills/meta-worktree/scripts/audit.sh" > "$AUDIT_JSON"

python3 - "$AUDIT_JSON" "$REPORT" "$TODAY" "$INSPECTED_HEAD" "$INSPECTED_STATUS" <<'PY'
import json
import sys
from pathlib import Path

audit_path = Path(sys.argv[1])
report_path = Path(sys.argv[2])
today = sys.argv[3]
inspected_head = sys.argv[4]
inspected_status = sys.argv[5]

data = json.loads(audit_path.read_text() or "{}")
findings = data.get("findings", [])
summary = data.get("summary", {})

rank = {"essential": 0, "needs-call": 1, "optional": 2, "fyi": 3}
actionable = [f for f in findings if f.get("severity") != "fyi"]
actionable.sort(key=lambda f: (rank.get(f.get("severity"), 9), f.get("id", "")))

lines = [
    f"# Workspace Health - {today}",
    "",
    "This is a read-only AI-OS workspace steward report. It does not pull, push, merge, delete, or archive anything.",
    "",
    "## Snapshot",
    "",
    f"- Base path: `{data.get('base_path', 'unknown')}`",
    f"- Current branch: `{data.get('branch', 'unknown')}`",
    f"- Inspected commit: `{inspected_head}`",
    f"- Inspected tracking state: `{inspected_status}`",
    f"- Unsaved edits: {data.get('dirty_count', 'unknown')}",
    f"- Local commits not on GitHub main: {data.get('ahead', 'unknown')}",
    f"- GitHub main updates not pulled locally: {data.get('behind', 'unknown')}",
    f"- Worktrees: {data.get('worktree_count', 'unknown')}",
    "",
    "Note: this report describes the workspace state before the report file is saved or committed. A later commit that stores the report can increase the ahead count by one.",
    "",
    "## Attention Summary",
    "",
    f"- Essential: {summary.get('essential', 0)}",
    f"- Needs your call: {summary.get('needs_call', 0)}",
    f"- Optional: {summary.get('optional', 0)}",
    f"- FYI: {summary.get('fyi', 0)}",
    "",
]

if actionable:
    lines.extend(["## Ranked Actions", ""])
    for idx, finding in enumerate(actionable[:10], 1):
        lines.append(f"{idx}. **{finding.get('title', 'Untitled')}**")
        lines.append(f"   - Why it matters: {finding.get('detail', '')}")
        lines.append(f"   - I can: {finding.get('action_label', '')}")
        lines.append(f"   - Action id: `{finding.get('id', '')}`")
        lines.append("")
    if len(actionable) > 10:
        lines.append(f"_And {len(actionable) - 10} smaller actionable item(s) not shown._")
        lines.append("")
else:
    lines.extend(["## Ranked Actions", "", "Everything looks clean.", ""])

needs_call = [f for f in actionable if f.get("severity") == "needs-call"]
if needs_call:
    lines.extend([
        "## Approval Boundary",
        "",
        "Items marked `needs-call` are intentionally not automatic. AI-OS can explain or prepare them, but should not merge, archive, delete, pull, or push without explicit approval.",
        "",
    ])

report_path.write_text("\n".join(lines), encoding="utf-8")
print(f"Workspace health report saved to {report_path}")
PY
